import type { Firestore } from "firebase-admin/firestore";
import type { StepHandler } from "../adapters/pipeline/types.ts";
import { accounts, transfer } from "../ledger/ledger.ts";
import { releaseStake, updateJob } from "../store/jobs.ts";

/** Releases the result to the poster, pays the budget to the runner and returns the stake. */
export function createReleaseStep(db: Firestore): StepHandler {
  return async ({ jobId }) => {
    await updateJob(db, jobId, new Date(), (u) => {
      const claim = u.job.claim;
      if (u.job.state !== "passed" || !claim) return;
      u.move("released", "Result released to the poster");
      transfer(
        u.tx,
        db,
        {
          from: accounts.escrow(jobId),
          to: accounts.owner(claim.runnerOwnerId),
          amount: u.job.budget,
          jobId,
          reason: "Budget paid for a passing result",
        },
        u.at,
      );
      releaseStake(u, claim, 0, "Stake returned after a pass");
    });
  };
}
