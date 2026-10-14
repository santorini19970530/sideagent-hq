import type { CheckOutcome, CodeFile, TestSummary } from "@sideagent/protocol";
import type { Firestore } from "firebase-admin/firestore";
import { getJson } from "../adapters/blob/helpers.ts";
import type { BlobStore } from "../adapters/blob/types.ts";
import type { PipelineRunner, StepHandler } from "../adapters/pipeline/types.ts";
import type { CheckOutcome as SandboxOutcome, Sandbox } from "../sandbox/types.ts";
import { jobRef, releaseStake, updateJob, type JobDoc, type JobUpdate } from "../store/jobs.ts";

function passedAll(summary: TestSummary): boolean {
  return summary.total > 0 && summary.passed === summary.total;
}

/**
 * Runs public and hidden tests on a submission. A pass goes to `release`. A fail returns the job
 * to the runner while it has attempts left, then reopens it and returns the stake (D23).
 * Sandbox and blob failures throw, leaving the job in `checking` for a retry.
 */
export function createCheckStep(
  db: Firestore,
  blobs: BlobStore,
  sandbox: Sandbox,
  pipeline: Pick<PipelineRunner, "enqueue">,
): StepHandler {
  return async ({ jobId, submissionId }) => {
    if (!submissionId) throw new Error("check needs a submissionId");
    const ref = jobRef(db, jobId);
    const subRef = ref.collection("submissions").doc(submissionId);
    const [snap, sub, priv] = await Promise.all([
      ref.get(),
      subRef.get(),
      ref.collection("private").doc("main").get(),
    ]);
    // A checked submission is done; a retried submit of an older one must not re-score it.
    if (!snap.exists || !sub.exists || sub.get("outcome")) return;
    const job = snap.data() as JobDoc;
    if (job.state !== "submitted" && job.state !== "checking") return;
    if (job.runtime !== "python") throw new Error(`Job ${jobId} has no checkable runtime`);

    // Its own transaction first, so the dashboard shows the check while it runs.
    const started = await updateJob(db, jobId, new Date(), (u) => {
      if (u.job.state === "submitted") u.move("checking", `Checking submission ${submissionId}`);
      return u.job.state === "checking";
    });
    if (!started) return;

    const hiddenRef = priv.get("hiddenTestsRef") as string | null;
    const [result, hiddenTests] = await Promise.all([
      getJson<CodeFile[]>(blobs, sub.get("resultRef")),
      hiddenRef ? getJson<CodeFile[]>(blobs, hiddenRef) : [],
    ]);
    const check = await sandbox.runChecks({
      jobId,
      checkId: submissionId,
      runtime: job.runtime,
      result,
      publicTests: job.publicTests,
      hiddenTests,
      trapTests: [],
    });

    const outcome = classify(check);
    const summary = check.kind === "scored" ? check.summary : null;
    const moved = await updateJob(db, jobId, new Date(), async (u) => {
      const current = await u.tx.get(subRef);
      if (u.job.state !== "checking" || current.get("outcome")) return false;
      u.tx.update(subRef, {
        outcome,
        testSummary: summary,
        rejectedReason: check.kind === "rejected" ? check.error.reason : null,
      });
      u.job.lastCheck = { submissionId, outcome, summary };
      if (outcome === "passed") {
        u.move("passed", describe(outcome, summary));
        u.job.passedSubmissionId = submissionId;
        return true;
      }
      u.move("failed", describe(outcome, summary));
      returnToRunnerOrReopen(u);
      return true;
    });
    if (moved && outcome === "passed") await pipeline.enqueue("release", { jobId, submissionId });
  };
}

function classify(check: SandboxOutcome): CheckOutcome {
  if (check.kind === "rejected") return "rejected";
  return passedAll(check.summary) ? "passed" : "failed";
}

/** D23: the runner retries while its claim has attempts left; then the job reopens. */
function returnToRunnerOrReopen(u: JobUpdate): void {
  const claim = u.job.claim;
  if (claim && claim.attemptsLeft > 0) {
    u.move("claimed", `Back to the runner; ${claim.attemptsLeft} attempts left`);
    return;
  }
  u.move("open", "No attempts left; open for claims");
  if (claim) releaseStake(u, claim, 0, "Claim ended without a pass");
  u.job.claim = null;
}

/** Event detail, readable by anyone who can see the job: counts only, never the reason. */
function describe(outcome: CheckOutcome, summary: TestSummary | null): string {
  if (!summary) return "Result rejected by the checker";
  return `${outcome === "passed" ? "Passed" : "Failed"} ${summary.passed}/${summary.total} tests`;
}
