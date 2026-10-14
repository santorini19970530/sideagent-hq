import type { Firestore } from "firebase-admin/firestore";
import type { HouseRunnerDispatcher } from "../adapters/dispatch/types.ts";
import type { StepHandler } from "../adapters/pipeline/types.ts";
import { appendEvent, updateJob } from "../store/jobs.ts";

/**
 * Starts one house-runner run for a newly opened job. The job stays `open`; the run claims it
 * like any runner. Without a dispatcher (`HOUSE_RUNNERS=off`) outside runners take the job.
 */
export function createDispatchStep(
  db: Firestore,
  dispatcher: HouseRunnerDispatcher | null,
): StepHandler {
  return async ({ jobId }) => {
    if (!dispatcher) return;
    // Marked first, so a retried step never starts a second run.
    const marked = await updateJob(db, jobId, new Date(), (u) => {
      if (u.job.state !== "open" || u.job.dispatchedAt) return false;
      u.job.dispatchedAt = u.at;
      appendEvent(u.tx, u.ref, u.job, "open", "open", "Field agent dispatched", u.at);
      return true;
    });
    if (!marked) return;
    try {
      await dispatcher.start(jobId);
    } catch (err) {
      // Unmarked, so a retry can dispatch again; outside runners can still claim the job.
      await updateJob(db, jobId, new Date(), (u) => {
        delete u.job.dispatchedAt;
        appendEvent(
          u.tx,
          u.ref,
          u.job,
          u.job.state,
          u.job.state,
          "Field agent dispatch failed",
          u.at,
        );
      });
      throw err;
    }
  };
}
