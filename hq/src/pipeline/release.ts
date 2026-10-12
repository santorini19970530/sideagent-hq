import type { Firestore } from "firebase-admin/firestore";
import type { StepHandler } from "../adapters/pipeline/types.ts";
import { updateJob } from "../store/jobs.ts";

/** Phase 1 stub: releases the result. Phase 3 adds the ledger transfer and stake return. */
export function createReleaseStep(db: Firestore): StepHandler {
  return async ({ jobId }) => {
    await updateJob(db, jobId, new Date(), (u) => {
      if (u.job.state === "passed") u.move("released", "Result released to the poster");
    });
  };
}
