import type { Firestore } from "firebase-admin/firestore";
import type { PipelineRunner, StepHandler } from "../adapters/pipeline/types.ts";
import { updateJob } from "../store/jobs.ts";

/** Phase 1 stub: every submission passes. Phase 3 runs public and hidden tests in the sandbox. */
export function createCheckStep(
  db: Firestore,
  pipeline: Pick<PipelineRunner, "enqueue">,
): StepHandler {
  return async ({ jobId, submissionId }) => {
    if (!submissionId) throw new Error("check needs a submissionId");
    const moved = await updateJob(db, jobId, new Date(), (u) => {
      // Any other state means this step already ran; retries are safe.
      if (u.job.state !== "submitted") return false;
      u.move("checking", `Checking submission ${submissionId}`);
      u.move("passed", "Passed (checks are not enforced yet)");
      u.job.passedSubmissionId = submissionId;
      return true;
    });
    if (moved) await pipeline.enqueue("release", { jobId, submissionId });
  };
}
