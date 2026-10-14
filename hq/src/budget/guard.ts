import { apiError } from "@sideagent/protocol";
import type { Firestore } from "firebase-admin/firestore";
import { Hono } from "hono";
import { z } from "zod";
import { HqError } from "../errors.ts";
import { PLATFORM_CONFIG_DOC } from "../limits.ts";
import { requireGoogleOidc, type IdTokenVerifier } from "../oidc.ts";

// The budget guard (D32): a Pub/Sub push subscription on the billing budget's topic calls it
// with each budget notification. It pauses the platform at PAUSE_AT of the budget and turns off
// billing for the project at BILLING_OFF_AT. Notifications repeat, so every action is idempotent.

export const BudgetGuardConfig = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  GCP_PROJECT: z.string().min(1),
  /** Its own URL: the audience of the push subscription's OIDC token. */
  BUDGET_GUARD_URL: z.url(),
  /** The push subscription's service account (`sa-budget-push`). */
  PUSH_SA_EMAIL: z.string().min(1),
  PAUSE_AT: z.coerce.number().positive().default(1),
  BILLING_OFF_AT: z.coerce.number().positive().default(2),
  /** Logs that billing would be turned off, without doing it. */
  DRY_RUN: z.stringbool().default(false),
});
export type BudgetGuardConfig = z.infer<typeof BudgetGuardConfig>;

/** The fields of a budget notification the guard reads. */
const Notification = z.looseObject({
  costAmount: z.number().nonnegative(),
  budgetAmount: z.number().positive(),
});
export type BudgetNotification = z.infer<typeof Notification>;

const PushEnvelope = z.looseObject({
  message: z.looseObject({ data: z.string().min(1) }),
});

/** The budget notification in a Pub/Sub push body, or null when it isn't one. */
export function parsePushEnvelope(body: unknown): BudgetNotification | null {
  const envelope = PushEnvelope.safeParse(body);
  if (!envelope.success) return null;
  try {
    const data = JSON.parse(Buffer.from(envelope.data.message.data, "base64").toString("utf8"));
    const parsed = Notification.safeParse(data);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface BudgetDecision {
  /** Spend as a share of the budget. */
  ratio: number;
  pause: boolean;
  billingOff: boolean;
}

/** What to do for one notification; turning billing off implies pausing. */
export function decide(
  { costAmount, budgetAmount }: BudgetNotification,
  { PAUSE_AT, BILLING_OFF_AT }: Pick<BudgetGuardConfig, "PAUSE_AT" | "BILLING_OFF_AT">,
): BudgetDecision {
  const ratio = costAmount / budgetAmount;
  const billingOff = ratio >= BILLING_OFF_AT;
  return { ratio, pause: billingOff || ratio >= PAUSE_AT, billingOff };
}

/** The guard's side effects; each reports whether it changed anything. */
export interface BudgetActions {
  pause(at: Date): Promise<boolean>;
  billingOff(): Promise<boolean>;
}

/** Sets the kill switch unless it is already on (by hand or by an earlier notification). */
export function firestorePause(db: Firestore, doc = PLATFORM_CONFIG_DOC): BudgetActions["pause"] {
  return (at) =>
    db.runTransaction(async (tx) => {
      const ref = db.doc(doc);
      const snap = await tx.get(ref);
      if (snap.get("paused") === true) return false;
      tx.set(ref, { paused: true, pausedBy: "budget-guard", pausedAt: at }, { merge: true });
      return true;
    });
}

/** `GoogleAuth`'s authorized request, or a fake in tests. */
export interface BillingCaller {
  request<T>(opts: { url: string; method: "GET" | "PUT"; data?: unknown }): Promise<{ data: T }>;
}

/** Unlinks the project's billing account through the Cloud Billing API, if it is still linked. */
export function cloudBillingOff(
  caller: BillingCaller,
  project: string,
): BudgetActions["billingOff"] {
  const url = `https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`;
  return async () => {
    const { data } = await caller.request<{ billingEnabled?: boolean }>({ url, method: "GET" });
    if (data.billingEnabled === false) return false;
    await caller.request({ url, method: "PUT", data: { billingAccountName: "" } });
    return true;
  };
}

export interface BudgetGuardDeps {
  verifier: IdTokenVerifier;
  actions: BudgetActions;
  now?: () => Date;
  log?: (line: string) => void;
}

/** Pub/Sub push endpoint: 2xx acks the message, anything else makes Pub/Sub redeliver it. */
export function createBudgetGuardApp(
  config: BudgetGuardConfig,
  { verifier, actions, now = () => new Date(), log = console.log }: BudgetGuardDeps,
) {
  const app = new Hono();
  // Pub/Sub's default audience is the push endpoint, `<url>/`; Terraform may set either form.
  const url = config.BUDGET_GUARD_URL.replace(/\/+$/, "");
  app.use("*", requireGoogleOidc(verifier, [url, `${url}/`], config.PUSH_SA_EMAIL));
  app.post("/", async (c) => {
    const notification = parsePushEnvelope(await c.req.json().catch(() => null));
    if (!notification) {
      // Redelivering a message we can't read wouldn't help; ack it.
      log("budget guard: ignored a message that is not a budget notification");
      return c.body(null, 204);
    }
    const decision = decide(notification, config);
    const pct = `${(decision.ratio * 100).toFixed(1)}% of the budget`;
    const done: string[] = [];
    // Billing off is the hard stop, so a failed pause must not keep it from running; the first
    // failure is rethrown afterwards so Pub/Sub redelivers the notification.
    let failure: unknown = null;
    if (decision.pause) {
      try {
        done.push((await actions.pause(now())) ? "paused the platform" : "platform already paused");
      } catch (err) {
        failure = err;
        done.push("pause failed");
      }
    }
    if (decision.billingOff) {
      if (config.DRY_RUN) done.push("would turn off billing (DRY_RUN)");
      else done.push((await actions.billingOff()) ? "turned off billing" : "billing already off");
    }
    log(`budget guard: spend at ${pct}; ${done.length ? done.join(", ") : "nothing to do"}`);
    if (failure) throw failure;
    return c.json({ ratio: decision.ratio, actions: done });
  });
  app.onError((err, c) => {
    if (err instanceof HqError) return c.json(err.body, err.status);
    console.error("budget guard failed", err);
    return c.json(apiError("internal", "Budget guard failed", "Pub/Sub redelivers it"), 500);
  });
  return app;
}
