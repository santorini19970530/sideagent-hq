import type { CodeFile, TestSummary } from "@sideagent/protocol";
import type { Firestore } from "firebase-admin/firestore";
import { getJson } from "../adapters/blob/helpers.ts";
import type { BlobStore } from "../adapters/blob/types.ts";
import type { PipelineRunner, StepHandler } from "../adapters/pipeline/types.ts";
import type { Sandbox } from "../sandbox/types.ts";
import { jobRef, updateJob, type JobDoc } from "../store/jobs.ts";

function passedAll(summary: TestSummary): boolean {
  return summary.total > 0 && summary.passed === summary.total;
}

/** Runs public and hidden tests. The result is released only when every test passes. */
export function createCheckStep(
  db: Firestore,
  blobs: BlobStore,
  sandbox: Sandbox,
  pipeline: Pick<PipelineRunner, "enqueue">,
): StepHandler {
  return async ({ jobId, submissionId }) => {
    if (!submissionId) throw new Error("check needs a submissionId");
    const snap = await jobRef(db, jobId).get();
    if (!snap.exists) return;
    const job = snap.data() as JobDoc;
    if (job.state !== "submitted") return;

    const subRef = jobRef(db, jobId).collection("submissions").doc(submissionId);
    const sub = await subRef.get();
    if (!sub.exists) return;
    const result = await getJson<CodeFile[]>(blobs, sub.get("resultRef"));
    const priv = await jobRef(db, jobId).collection("private").doc("main").get();
    const hiddenRef = priv.get("hiddenTestsRef") as string | null;
    const hiddenTests = hiddenRef ? await getJson<CodeFile[]>(blobs, hiddenRef) : [];

    let summary: TestSummary | undefined;
    let detail: string;
    try {
      if (job.runtime !== "python") throw new Error("Only python jobs can be checked");
      summary = await sandbox.runChecks({
        jobId,
        checkId: submissionId,
        runtime: "python",
        result,
        publicTests: job.publicTests,
        hiddenTests,
        trapTests: [],
      });
      detail = `${passedAll(summary) ? "Passed" : "Failed"} ${summary.passed}/${summary.total}`;
    } catch (err) {
      detail = err instanceof Error ? err.message : "Checks failed";
    }
    if (detail.length > 200) detail = detail.slice(0, 200);

    const passed = summary !== undefined && passedAll(summary);
    const moved = await updateJob(db, jobId, new Date(), async (u) => {
      if (u.job.state !== "submitted") return false;
      const current = await u.tx.get(subRef);
      u.move("checking", `Checking submission ${submissionId}`);
      if (passed) {
        u.move("passed", detail);
        u.job.passedSubmissionId = submissionId;
      } else {
        u.move("failed", detail);
      }
      if (current.exists && summary) u.tx.update(subRef, { testSummary: summary });
      return true;
    });
    if (moved && passed) await pipeline.enqueue("release", { jobId, submissionId });
  };
}
