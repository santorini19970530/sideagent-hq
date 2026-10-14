import { JobStatus } from "@sideagent/protocol";
import { describe, expect, it, vi } from "vitest";
import { accounts, balanceOf } from "../src/ledger/ledger.ts";
import { createHarness, SOLUTION, WRONG } from "./harness.ts";

const h = createHarness();
const { db } = h.adapters;

/** Deterministic PRNG (mulberry32), so a failing sequence can be replayed from its seed. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function sumOfAllBalances(): Promise<number> {
  const snap = await db.collection("balances").get();
  return snap.docs.reduce((sum, doc) => sum + (doc.get("amount") as number), 0);
}

/** A balance rebuilt from ledger entries, to check the `balances` cache against. */
async function replayed(account: string): Promise<number> {
  const [out, inn] = await Promise.all([
    db.collection("ledger").where("from", "==", account).get(),
    db.collection("ledger").where("to", "==", account).get(),
  ]);
  const total = (snap: typeof out) =>
    snap.docs.reduce((s, d) => s + (d.get("amount") as number), 0);
  return total(inn) - total(out);
}

describe("ledger", () => {
  it.each([1, 2, 3])(
    "keeps the sum of all balances constant across random operations (seed %i)",
    async (seed) => {
      const random = rng(seed);
      const pick = <T>(items: T[]): T | undefined => items[Math.floor(random() * items.length)];
      const poster = await h.agents();
      const runners = [await h.agents(), await h.agents(3)];
      const jobs: string[] = [];
      const touched = new Set(
        [poster.ownerId, ...runners.map((r) => r.ownerId)].map(accounts.owner),
      );

      const state = async (jobId: string) =>
        JobStatus.parse((await h.call(poster.poster, "GET", `/v1/jobs/${jobId}`)).body).state;

      for (let step = 0; step < 25; step++) {
        const jobId = pick(jobs);
        const runner = pick(runners)!;
        const op = random();
        if (op < 0.25 || !jobId) {
          const budget = 1 + Math.floor(random() * 40);
          const res = await h.call(poster.poster, "POST", "/v1/jobs", h.jobSpec({ budget }));
          expect([200, 402]).toContain(res.status);
          if (res.status === 200) {
            jobs.push(res.body.job_id);
            touched.add(accounts.escrow(res.body.job_id));
          }
        } else if (op < 0.5) {
          const res = await h.call(runner.runner, "POST", `/v1/jobs/${jobId}/claim`);
          expect([200, 402, 409]).toContain(res.status);
        } else if (op < 0.85) {
          const content = random() < 0.5 ? SOLUTION : WRONG;
          const res = await h.call(runner.runner, "POST", `/v1/jobs/${jobId}/submissions`, {
            result: [{ path: "solution.py", content }],
            idempotency_key: `step-${step}`,
          });
          expect([200, 409]).toContain(res.status);
          await vi.waitFor(async () =>
            expect(["submitted", "checking", "passed"]).not.toContain(await state(jobId)),
          );
        } else {
          h.clock.now = new Date(h.clock.now.getTime() + (h.config.CLAIM_TTL_SECONDS + 1) * 1000);
          await state(jobId); // A status call writes the lazy timeout back.
        }
        expect(await sumOfAllBalances()).toBe(0);
      }

      // Stake accounts are named after runner agent IDs, which tests only know from the entries.
      for (const jobId of jobs) {
        const entries = await db.collection("ledger").where("jobId", "==", jobId).get();
        for (const e of entries.docs) touched.add(e.get("from")).add(e.get("to"));
      }
      // Other test files move `platform:` balances at the same time, so the balance and its
      // replay can be read on either side of a transfer; the sum check above covers them.
      for (const account of touched) if (account.startsWith("platform:")) touched.delete(account);
      for (const account of touched) {
        const balance = await balanceOf(db, account);
        expect(balance).toBe(await replayed(account));
        if (account.startsWith("owner:")) expect(balance).toBeGreaterThanOrEqual(0);
      }
    },
    60_000,
  );
});
