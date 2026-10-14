import { apiError, type ApiError, type CodeFile, type TestSummary } from "@sideagent/protocol";
import type { Firestore } from "firebase-admin/firestore";
import type { PlatformModel } from "../agents/model.ts";
import { draftTrapTests } from "../agents/trap-writer.ts";
import { getJson, getText, putJson } from "../adapters/blob/helpers.ts";
import type { BlobStore } from "../adapters/blob/types.ts";
import type { PipelineRunner, StepHandler } from "../adapters/pipeline/types.ts";
import type { Config } from "../config.ts";
import { TRAP_PATH } from "../runtimes/index.ts";
import type { Sandbox } from "../sandbox/types.ts";
import { addFeed } from "../store/feed.ts";
import { jobRef, refundBudget, updateJob, type JobDoc } from "../store/jobs.ts";
import { passedAll } from "./check.ts";

export interface ReviewDeps {
  db: Firestore;
  blobs: BlobStore;
  model: PlatformModel;
  sandbox: Sandbox;
  config: Pick<Config, "MODEL_ESCALATE">;
  pipeline: Pick<PipelineRunner, "enqueue">;
}

/**
 * Test review, first part (D29): the reference solution must pass every public and hidden test,
 * and Gemini's trap check drafts are kept only where it passes them too. Phase 6 adds the
 * empty-answer check, the mutation score and the test-reviewer agent. A job without a reference
 * solution opens without trap checks. Sandbox and blob failures throw, for a retry.
 */
export function createReviewStep({
  db,
  blobs,
  model,
  sandbox,
  config,
  pipeline,
}: ReviewDeps): StepHandler {
  return async ({ jobId }) => {
    const ref = jobRef(db, jobId);
    const [snap, priv] = await Promise.all([
      ref.get(),
      ref.collection("private").doc("main").get(),
    ]);
    if (!snap.exists) return;
    const job = snap.data() as JobDoc;
    if (job.state !== "test_review") return;
    const referenceRef = priv.get("referenceSolutionRef") as string | null;
    const hiddenRef = priv.get("hiddenTestsRef") as string | null;

    let traps: CodeFile[] = [];
    let rejection: ApiError | null = null;
    const runtime = job.runtime;
    if (runtime && referenceRef) {
      const [spec, reference, hidden] = await Promise.all([
        getText(blobs, job.specRef),
        getJson<CodeFile[]>(blobs, referenceRef),
        hiddenRef ? getJson<CodeFile[]>(blobs, hiddenRef) : [],
      ]);
      const drafts = await draftTrapTests(model, config, {
        runtime,
        spec,
        publicTests: job.publicTests,
      }).catch((err: unknown) => {
        // Without drafts the job still opens; it just carries no trap checks.
        console.warn(`trap writer failed for ${jobId}`, err);
        return [];
      });
      const candidates = drafts.map((d, i) => ({
        category: `trap_${i}`,
        file: { path: TRAP_PATH[runtime](`${i}_${d.name}`), content: d.content },
      }));
      const check = await sandbox.runChecks({
        jobId,
        checkId: "review",
        runtime,
        result: reference,
        tests: {
          public: job.publicTests,
          ...(hidden.length ? { hidden } : {}),
          ...Object.fromEntries(candidates.map((c) => [c.category, [c.file]])),
        },
      });
      if (check.kind === "rejected") {
        rejection = invalid(`The checker refused the reference solution: ${check.error.reason}`);
      } else {
        rejection = referenceFailures(check.summary);
        traps = candidates
          .filter((c) => {
            const counts = check.summary.categories[c.category];
            return counts && passedAll(counts);
          })
          .map((c) => c.file);
      }
    }
    const trapChecksRef =
      traps.length && !rejection
        ? await putJson(blobs, `jobs/${jobId}/trap_tests.json`, traps)
        : null;

    const opened = await updateJob(db, jobId, new Date(), (u) => {
      if (u.job.state !== "test_review") return false;
      if (rejection) {
        u.job.rejection = rejection;
        u.move("rejected", "Tests rejected: the reference solution fails them");
        refundBudget(u, "Budget refunded; tests rejected in review");
        addFeed(u.tx, u.ref, {
          kind: "job_rejected",
          agentId: u.job.posterAgentId,
          categories: ["tests_invalid"],
          detail: "Briefing rejected: its reference solution fails its own tests",
          createdAt: u.at,
        });
        return false;
      }
      u.tx.set(u.ref.collection("private").doc("main"), { trapChecksRef }, { merge: true });
      // Trap checks stay secret: the event doesn't say how many were added.
      u.move("open", "Tests reviewed; open for claims");
      return true;
    });
    if (opened) await pipeline.enqueue("dispatch", { jobId });
  };
}

function referenceFailures(summary: TestSummary): ApiError | null {
  const failing = ["public", "hidden"].flatMap((category) => {
    const c = summary.categories[category];
    return c && !passedAll(c) ? [`${c.total - c.passed} of ${c.total} ${category}`] : [];
  });
  if (!failing.length) return null;
  return invalid(`The reference solution fails ${failing.join(" and ")} tests`);
}

function invalid(reason: string): ApiError {
  return apiError(
    "tests_invalid",
    reason,
    "Fix the tests or the reference solution so it passes every test, then post the job again",
  );
}
