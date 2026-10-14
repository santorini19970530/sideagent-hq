import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BudgetGuardConfig,
  cloudBillingOff,
  createBudgetGuardApp,
  decide,
  firestorePause,
  parsePushEnvelope,
  type BillingCaller,
  type BudgetActions,
} from "../src/budget/guard.ts";
import type { IdTokenVerifier } from "../src/oidc.ts";
import { createHarness } from "./harness.ts";

const URL_ = "https://budget-guard.example.test";
const PUSH_SA = "sa-budget-push@sideagent-hq.iam.gserviceaccount.com";

const verifier: IdTokenVerifier = {
  async verify(token, audience) {
    const audiences = Array.isArray(audience) ? audience : [audience];
    if (token === "push" && audiences.includes(`${URL_}/`)) {
      return { email: PUSH_SA, email_verified: true };
    }
    return token === "other" ? { email: "x@example.com", email_verified: true } : null;
  },
};

function envelope(costAmount: number, budgetAmount = 10) {
  const data = Buffer.from(JSON.stringify({ costAmount, budgetAmount, currencyCode: "USD" }));
  return { message: { data: data.toString("base64"), messageId: "1" }, subscription: "s" };
}

/** Cloud Billing as a flag the PUT clears. */
function fakeBilling() {
  const state = { enabled: true, puts: [] as unknown[] };
  const caller: BillingCaller = {
    async request<T>({ method, data }: { method: string; data?: unknown }) {
      if (method === "PUT") {
        state.puts.push(data);
        state.enabled = false;
      }
      return { data: { billingEnabled: state.enabled } as T };
    },
  };
  return { state, caller };
}

function guard(env: Record<string, string> = {}, pause?: BudgetActions["pause"]) {
  const h = createHarness();
  const doc = `config/test-guard-${randomUUID()}`;
  const billing = fakeBilling();
  const lines: string[] = [];
  const config = BudgetGuardConfig.parse({
    GCP_PROJECT: "sideagent-hq",
    BUDGET_GUARD_URL: URL_,
    PUSH_SA_EMAIL: PUSH_SA,
    ...env,
  });
  const app = createBudgetGuardApp(config, {
    verifier,
    actions: {
      pause: pause ?? firestorePause(h.adapters.db, doc),
      billingOff: cloudBillingOff(billing.caller, config.GCP_PROJECT),
    },
    now: () => new Date("2026-10-15T00:00:00Z"),
    log: (line) => lines.push(line),
  });
  const push = (body: unknown, token: string | null = "push") =>
    app.request("/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  const platform = async () => (await h.adapters.db.doc(doc).get()).data();
  return { push, platform, billing, lines, db: h.adapters.db, doc };
}

describe("budget guard decisions", () => {
  const limits = { PAUSE_AT: 1, BILLING_OFF_AT: 2 };

  it("pauses at the budget and turns billing off at twice it", () => {
    expect(decide({ costAmount: 9.99, budgetAmount: 10 }, limits)).toEqual({
      ratio: 0.999,
      pause: false,
      billingOff: false,
    });
    expect(decide({ costAmount: 10, budgetAmount: 10 }, limits)).toMatchObject({
      pause: true,
      billingOff: false,
    });
    expect(decide({ costAmount: 20, budgetAmount: 10 }, limits)).toMatchObject({
      pause: true,
      billingOff: true,
    });
    // Billing off implies a pause, even with the thresholds the wrong way round.
    expect(
      decide({ costAmount: 20, budgetAmount: 10 }, { PAUSE_AT: 5, BILLING_OFF_AT: 2 }),
    ).toMatchObject({ pause: true, billingOff: true });
  });

  it("reads the notification from the push envelope, or nothing", () => {
    expect(parsePushEnvelope(envelope(3))).toMatchObject({ costAmount: 3, budgetAmount: 10 });
    expect(parsePushEnvelope({})).toBeNull();
    expect(parsePushEnvelope({ message: { data: "bm90IGpzb24=" } })).toBeNull();
    expect(parsePushEnvelope(envelope(3, 0))).toBeNull();
  });
});

describe("budget guard service", () => {
  it("refuses pushes without the push account's token", async () => {
    const g = guard();
    expect((await g.push(envelope(30), null)).status).toBe(401);
    expect((await g.push(envelope(30), "forged")).status).toBe(401);
    expect((await g.push(envelope(30), "other")).status).toBe(403);
    expect(await g.platform()).toBeUndefined();
    expect(g.billing.state.puts).toEqual([]);
  });

  it("does nothing under the budget and acks what it can't read", async () => {
    const g = guard();
    expect((await g.push(envelope(5))).status).toBe(200);
    expect((await g.push({ message: { data: "e30=" } })).status).toBe(204);
    expect(await g.platform()).toBeUndefined();
  });

  it("pauses once, however often the notification comes", async () => {
    const g = guard();
    for (let i = 0; i < 3; i++) expect((await g.push(envelope(12))).status).toBe(200);
    expect(await g.platform()).toMatchObject({ paused: true, pausedBy: "budget-guard" });
    expect(g.lines).toEqual([
      "budget guard: spend at 120.0% of the budget; paused the platform",
      "budget guard: spend at 120.0% of the budget; platform already paused",
      "budget guard: spend at 120.0% of the budget; platform already paused",
    ]);
    expect(g.billing.state.puts).toEqual([]);
  });

  it("keeps a pause set by hand as it is", async () => {
    const g = guard();
    await g.db.doc(g.doc).set({ paused: true, pausedBy: "william" });
    await g.push(envelope(12));
    expect(await g.platform()).toEqual({ paused: true, pausedBy: "william" });
  });

  it("turns billing off at 200%, once", async () => {
    const g = guard();
    await g.push(envelope(20));
    await g.push(envelope(25));
    expect(g.billing.state.puts).toEqual([{ billingAccountName: "" }]);
    expect(g.lines.at(-1)).toBe(
      "budget guard: spend at 250.0% of the budget; platform already paused, billing already off",
    );
  });

  it("turns billing off even when the pause fails, then asks for a redelivery", async () => {
    const g = guard({}, async () => {
      throw new Error("Firestore is down");
    });
    expect((await g.push(envelope(20))).status).toBe(500);
    expect(g.billing.state.puts).toEqual([{ billingAccountName: "" }]);
    expect(g.lines.at(-1)).toBe(
      "budget guard: spend at 200.0% of the budget; pause failed, turned off billing",
    );
  });

  it("only logs the billing change with DRY_RUN", async () => {
    const g = guard({ DRY_RUN: "true" });
    expect((await g.push(envelope(30))).status).toBe(200);
    expect(g.billing.state.puts).toEqual([]);
    expect(await g.platform()).toMatchObject({ paused: true });
    expect(g.lines).toEqual([
      "budget guard: spend at 300.0% of the budget; paused the platform, would turn off billing (DRY_RUN)",
    ]);
  });
});
