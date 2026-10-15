import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { HouseRunnerDispatcher } from "../adapters/dispatch/types.ts";
import type { StepHandler } from "../adapters/pipeline/types.ts";
import type { Limits } from "../limits.ts";
import { jobRef, updateJob } from "../store/jobs.ts";

/**
 * Starts one house-runner run for a job still open after the grace period (D27). The job stays
 * `open`; the run claims it like any runner, and the mission log doesn't mention the dispatch, so a
 * house runner looks like any other field agent. Without a dispatcher (`HOUSE_RUNNERS=off`), or
 * while the platform is paused (D32), outside runners take the job.
 */
export function createDispatchStep(
  db: Firestore,
  dispatcher: HouseRunnerDispatcher | null,
  limits: Pick<Limits, "paused">,
): StepHandler {
  return async ({ jobId }) => {
    if (!dispatcher || (await limits.paused())) return;
    // Marked first, so a retried step never starts a second run.
    const marked = await updateJob(db, jobId, new Date(), (u) => {
      if (u.job.state !== "open" || u.job.dispatchedAt) return false;
      u.tx.update(u.ref, { dispatchedAt: u.at });
      return true;
    });
    if (!marked) return;
    try {
      await dispatcher.start(jobId);
    } catch (err) {
      // Unmarked, so a retry can dispatch again; outside runners can still claim the job.
      await jobRef(db, jobId).update({ dispatchedAt: FieldValue.delete() });
      throw err;
    }
  };
}
