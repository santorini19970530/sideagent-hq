import {
  FieldValue,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import type { Config } from "./config.ts";
import { HqError } from "./errors.ts";

const DAY_MS = 24 * 3600_000;
// Outlives the longest counter window, a UTC day, before a Firestore TTL policy deletes it.
const COUNTER_TTL_MS = 2 * DAY_MS;

export interface LimitsOptions {
  /**
   * The kill-switch document and the counters' collection. Tests use their own, so a pause or
   * a shared day counter doesn't reach, or slow down, other test files.
   */
  configDoc?: string;
  usageCollection?: string;
  /** How long a read of the kill switch is reused, so a pause reaches each instance this late. */
  cacheMs?: number;
}

export type Limits = ReturnType<typeof createLimits>;

/**
 * Spend caps in HQ (D32): posts per owner per hour, posts platform-wide per day, and the
 * `config/platform.paused` kill switch. Checks per job are counted on the job itself.
 */
export function createLimits(
  db: Firestore,
  config: Pick<Config, "LIMIT_POSTS_PER_HOUR" | "LIMIT_POSTS_PER_DAY">,
  {
    configDoc = "config/platform",
    usageCollection = "usage",
    cacheMs = 30_000,
  }: LimitsOptions = {},
) {
  let cached: { paused: boolean; until: number } | null = null;

  async function paused(): Promise<boolean> {
    if (cached && Date.now() < cached.until) return cached.paused;
    const snap = await db.doc(configDoc).get();
    cached = { paused: snap.get("paused") === true, until: Date.now() + cacheMs };
    return cached.paused;
  }

  /** Refuses paid work while the platform is paused, by hand or by the budget guard. */
  async function requireRunning(): Promise<void> {
    if (await paused()) {
      throw new HqError(
        "rate_limited",
        "Sideagent is paused and is not taking new paid work",
        "Try again later; jobs already posted keep their escrow",
      );
    }
  }

  /**
   * Counts one post against the owner's hourly and the platform's daily limit, or throws
   * `rate_limited`. Reads first, then writes, so call it after the transaction's other reads.
   */
  async function reservePost(tx: Transaction, ownerId: string, at: Date): Promise<void> {
    const iso = at.toISOString();
    const usage = db.collection(usageCollection);
    const hourRef = usage.doc(`owner-${ownerId}-${iso.slice(0, 13)}`);
    const dayRef = usage.doc(`day-${iso.slice(0, 10)}`);
    const [hour, day] = await Promise.all([tx.get(hourRef), tx.get(dayRef)]);
    const nextHour = new Date(at);
    nextHour.setUTCMinutes(60, 0, 0);
    const nextDay = new Date(at);
    nextDay.setUTCHours(24, 0, 0, 0);
    refuseIfFull(
      hour,
      config.LIMIT_POSTS_PER_HOUR,
      `This owner posted ${config.LIMIT_POSTS_PER_HOUR} jobs this hour, the most allowed`,
      nextHour,
    );
    refuseIfFull(
      day,
      config.LIMIT_POSTS_PER_DAY,
      "Sideagent has taken all the jobs it accepts today",
      nextDay,
    );
    const bump = {
      posts: FieldValue.increment(1),
      expireAt: new Date(at.getTime() + COUNTER_TTL_MS),
    };
    tx.set(hourRef, bump, { merge: true });
    tx.set(dayRef, bump, { merge: true });
  }

  return { paused, requireRunning, reservePost };
}

function refuseIfFull(counter: DocumentSnapshot, limit: number, reason: string, retryAt: Date) {
  if (((counter.get("posts") as number | undefined) ?? 0) < limit) return;
  throw new HqError("rate_limited", reason, `Try again after ${retryAt.toISOString()}`);
}
