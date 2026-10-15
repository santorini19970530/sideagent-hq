import type { CheckOutcome, CodeFile, TestSummary } from "@sideagent/protocol";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import type { PlatformModel } from "../agents/model.ts";
import type { ModelConfig } from "../agents/platform-agent.ts";
import { screenResult } from "../agents/result-screener.ts";
import { getJson, getText } from "../adapters/blob/helpers.ts";
import type { BlobStore } from "../adapters/blob/types.ts";
import type { PipelineRunner, StepHandler } from "../adapters/pipeline/types.ts";
import type { CheckOutcome as SandboxOutcome, Sandbox } from "../sandbox/types.ts";
import type { Config } from "../config.ts";
import { agentRef, recordTrapFailure } from "../store/agents.ts";
import { addFeed } from "../store/feed.ts";
import { jobRef, releaseStake, updateJob, type JobDoc, type JobUpdate } from "../store/jobs.ts";

export function passedAll(counts: { passed: number; total: number }): boolean {
  return counts.total > 0 && counts.passed === counts.total;
}

export interface CheckDeps {
  db: Firestore;
  blobs: BlobStore;
  sandbox: Sandbox;
  model: PlatformModel;
  config: ModelConfig & Pick<Config, "TRAP_BURN_AFTER">;
  pipeline: Pick<PipelineRunner, "enqueue">;
}

/**
 * Runs public, hidden and trap tests on a submission, then screens a passing result before the
 * poster can read it. A pass goes to `release`. A fail or a blocked result returns the job to the
 * runner while it has attempts left, then reopens it and returns the stake (D23). Passing the
 * public tests but failing a trap check slashes the whole stake and burns the runner (D29).
 * Sandbox, blob and model failures throw, leaving the job in `checking` for a retry.
 */
export function createCheckStep({
  db,
  blobs,
  sandbox,
  model,
  config,
  pipeline,
}: CheckDeps): StepHandler {
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
    const trapRef = priv.get("trapChecksRef") as string | null | undefined;
    const [result, hidden, trap, spec] = await Promise.all([
      getJson<CodeFile[]>(blobs, sub.get("resultRef")),
      hiddenRef ? getJson<CodeFile[]>(blobs, hiddenRef) : [],
      trapRef ? getJson<CodeFile[]>(blobs, trapRef) : [],
      getText(blobs, job.specRef),
    ]);
    const check = await sandbox.runChecks({
      jobId,
      checkId: submissionId,
      runtime: job.runtime,
      result,
      tests: { public: job.publicTests, hidden, trap },
    });

    let outcome = classify(check);
    let reason = check.kind === "rejected" ? check.error.reason : null;
    let blockedCategories: string[] = [];
    if (outcome === "passed") {
      // Screened in placeholder form, before the poster's side ever restores it.
      const { verdict } = await screenResult(model, config, { spec, result });
      if (verdict.verdict === "block") {
        outcome = "blocked";
        reason = [verdict.reason, verdict.fix_hint].filter(Boolean).join(" ");
        blockedCategories = verdict.categories;
      }
    }
    const summary = check.kind === "scored" ? mergeTraps(check.summary) : null;
    const runnerRef = agentRef(db, sub.get("runnerAgentId") as string);
    const moved = await updateJob(db, jobId, new Date(), async (u) => {
      const [current, runner] = await Promise.all([
        u.tx.get(subRef),
        outcome === "trap_failed" ? u.tx.get(runnerRef) : null,
      ]);
      if (u.job.state !== "checking" || current.get("outcome")) return false;
      u.tx.update(subRef, { outcome, testSummary: summary, rejectedReason: reason });
      u.job.lastCheck = { submissionId, outcome, summary };
      if (outcome === "passed") {
        u.move("passed", describe(outcome, summary));
        u.job.passedSubmissionId = submissionId;
        return true;
      }
      u.move("failed", describe(outcome, summary));
      if (runner) {
        const trapsFailed = ((runner.get("trapsFailed") as number | undefined) ?? 0) + 1;
        penalizeTrapFailure(u, runner.ref, trapsFailed, config.TRAP_BURN_AFTER);
        return true;
      }
      if (outcome === "blocked") {
        addFeed(u.tx, u.ref, {
          kind: "result_blocked",
          agentId: u.job.claim?.runnerAgentId ?? null,
          categories: blockedCategories,
          detail: "Result held at the checkpoint before it reached the poster",
          createdAt: u.at,
        });
      }
      returnToRunnerOrReopen(u);
      return true;
    });
    if (moved && outcome === "passed") await pipeline.enqueue("release", { jobId, submissionId });
  };
}

function classify(check: SandboxOutcome): CheckOutcome {
  if (check.kind === "rejected") return "rejected";
  const { public: pub, trap } = check.summary.categories;
  // Every public test passes and every trap check fails: answers fitted to the examples (D29).
  // An honest but buggy answer usually passes some traps, so it fails without being burned.
  if (pub && passedAll(pub) && trap && trap.total > 0 && trap.passed === 0) return "trap_failed";
  return passedAll(check.summary) ? "passed" : "failed";
}

/** Counts trap checks under `hidden`, so neither side can tell which kind of test failed. */
function mergeTraps(summary: TestSummary): TestSummary {
  const { trap, ...categories } = summary.categories;
  if (!trap) return summary;
  const hidden = categories.hidden ?? { passed: 0, total: 0 };
  categories.hidden = { passed: hidden.passed + trap.passed, total: hidden.total + trap.total };
  return { ...summary, categories };
}

/**
 * A trap failure (D29): the whole stake goes to platform fees and the claim ends. After
 * TRAP_BURN_AFTER failures the runner is burned and its key stops working.
 */
function penalizeTrapFailure(
  u: JobUpdate,
  runnerRef: DocumentReference,
  trapsFailed: number,
  burnAfter: number,
): void {
  const claim = u.job.claim;
  const burned = trapsFailed >= burnAfter;
  u.move("open", burned ? "Trap check failed; runner burned" : "Trap check failed; stake slashed");
  if (claim) releaseStake(u, claim, claim.stake, "Stake slashed for a failed trap check");
  u.job.claim = null;
  recordTrapFailure(u.tx, runnerRef, trapsFailed, burned, u.at);
  if (burned) {
    addFeed(u.tx, u.ref, {
      kind: "runner_burned",
      agentId: runnerRef.id,
      categories: ["trap_check"],
      detail: "Double agent burned: failed a trap check and lost its stake",
      createdAt: u.at,
    });
  }
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
  if (outcome === "blocked") return "Passed, but the result was blocked at the checkpoint";
  if (outcome === "trap_failed") return "Failed a trap check";
  return `${outcome === "passed" ? "Passed" : "Failed"} ${summary.passed}/${summary.total} tests`;
}
