import {
  apiError,
  type ApiError,
  type CodeFile,
  type TestStrengthView,
  type TestSummary,
} from "@sideagent/protocol";
import type { Firestore } from "firebase-admin/firestore";
import type { PlatformModel } from "../agents/model.ts";
import { draftTrapTests } from "../agents/trap-writer.ts";
import { getJson, getText, putJson } from "../adapters/blob/helpers.ts";
import type { BlobStore } from "../adapters/blob/types.ts";
import type { PipelineRunner, StepHandler } from "../adapters/pipeline/types.ts";
import type { Config } from "../config.ts";
import { TRAP_PATH } from "../runtimes/index.ts";
import type { CheckOutcome, MutantScore, Sandbox } from "../sandbox/types.ts";
import { addFeed } from "../store/feed.ts";
import { jobRef, refundBudget, updateJob, type JobDoc } from "../store/jobs.ts";
import { passedAll } from "./check.ts";

export interface ReviewDeps {
  db: Firestore;
  blobs: BlobStore;
  model: PlatformModel;
  sandbox: Sandbox;
  config: Pick<Config, "MODEL_ESCALATE" | "LIMIT_MUTANTS" | "TEST_STRENGTH_MIN">;
  pipeline: Pick<PipelineRunner, "enqueue">;
}

/**
 * Test review (D29, D31): an empty answer must fail the public and hidden tests, the reference
 * solution must pass them, and Gemini's trap check drafts are kept only where it passes them too.
 * The strength score is the share of mutants of the reference solution the tests catch; weak
 * tests still open, with a fix hint for the poster. A job without a reference solution opens
 * without trap checks or a score. Sandbox and blob failures throw, for a retry.
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
    let rejection: Rejection | null = null;
    let strength: TestStrengthView | null = null;
    const runtime = job.runtime;
    if (runtime) {
      const [spec, reference, hidden] = await Promise.all([
        getText(blobs, job.specRef),
        referenceRef ? getJson<CodeFile[]>(blobs, referenceRef) : null,
        hiddenRef ? getJson<CodeFile[]>(blobs, hiddenRef) : [],
      ]);
      const posterTests = { public: job.publicTests, ...(hidden.length ? { hidden } : {}) };
      const posterCategories = Object.keys(posterTests);
      // The empty-answer run overlaps the trap writer's model call.
      const [drafts, empty] = await Promise.all([
        reference
          ? draftTrapTests(model, config, {
              runtime,
              spec,
              publicTests: job.publicTests,
            }).catch((err: unknown) => {
              // Without drafts the job still opens; it just carries no trap checks.
              console.warn(`trap writer failed for ${jobId}`, err);
              return [];
            })
          : [],
        sandbox.runChecks({
          jobId,
          checkId: "review-empty",
          runtime,
          result: [],
          tests: posterTests,
        }),
      ]);
      // Tests an empty answer passes can't judge anything; skip the reference run and mutants.
      rejection = passesEmpty(empty, posterCategories);
      if (reference && !rejection) {
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
            ...posterTests,
            ...Object.fromEntries(candidates.map((c) => [c.category, [c.file]])),
          },
          mutants: { limit: config.LIMIT_MUTANTS, categories: posterCategories },
        });
        if (check.kind === "rejected") {
          rejection = referenceRejected(
            `The checker refused the reference solution: ${check.error.reason}`,
          );
        } else {
          rejection = referenceFailures(check.summary);
          traps = candidates
            .filter((c) => {
              const counts = check.summary.categories[c.category];
              return counts && passedAll(counts);
            })
            .map((c) => c.file);
          strength = scoreStrength(check.mutants, config.TEST_STRENGTH_MIN);
        }
      } else if (!reference) {
        strength = {
          score: null,
          killed: 0,
          mutants: 0,
          fixHint:
            "Add a reference_solution so the platform can score your tests and add trap checks",
        };
      }
    }
    const trapChecksRef =
      traps.length && !rejection
        ? await putJson(blobs, `jobs/${jobId}/trap_tests.json`, traps)
        : null;

    const opened = await updateJob(db, jobId, new Date(), (u) => {
      if (u.job.state !== "test_review") return false;
      if (rejection) {
        u.job.rejection = rejection.error;
        u.move("rejected", `Tests rejected: ${rejection.why}`);
        refundBudget(u, "Budget refunded; tests rejected in review");
        addFeed(u.tx, u.ref, {
          kind: "job_rejected",
          agentId: u.job.posterAgentId,
          categories: ["tests_invalid"],
          detail: `Briefing rejected: ${rejection.feed}`,
          createdAt: u.at,
        });
        return false;
      }
      u.tx.set(u.ref.collection("private").doc("main"), { trapChecksRef }, { merge: true });
      if (strength) u.job.testStrength = strength;
      // Trap checks stay secret: the event doesn't say how many were added.
      const score = strength?.score;
      u.move(
        "open",
        score == null
          ? "Tests reviewed; open for claims"
          : `Tests reviewed, strength ${score}%; open for claims`,
      );
      return true;
    });
    if (opened) await pipeline.enqueue("dispatch", { jobId });
  };
}

/** Why test review rejects a job: the poster's error, plus fixed text for the event and feed. */
interface Rejection {
  error: ApiError;
  why: string;
  feed: string;
}

function referenceFailures(summary: TestSummary): Rejection | null {
  const failing = ["public", "hidden"].flatMap((category) => {
    const c = summary.categories[category];
    return c && !passedAll(c) ? [`${c.total - c.passed} of ${c.total} ${category}`] : [];
  });
  if (!failing.length) return null;
  return referenceRejected(`The reference solution fails ${failing.join(" and ")} tests`);
}

function referenceRejected(reason: string): Rejection {
  return {
    error: apiError(
      "tests_invalid",
      reason,
      "Fix the tests or the reference solution so it passes every test, then post the job again",
    ),
    why: "the reference solution fails them",
    feed: "its reference solution fails its own tests",
  };
}

/** Tests an empty answer passes check nothing. Only counted when every category passes. */
function passesEmpty(empty: CheckOutcome, categories: string[]): Rejection | null {
  if (empty.kind !== "scored") return null;
  const all = categories.every((category) => {
    const c = empty.summary.categories[category];
    return c && passedAll(c);
  });
  if (!all) return null;
  return {
    error: apiError(
      "tests_invalid",
      "The tests pass an empty answer",
      "Make the tests import the code the spec asks for and check its results, then post the job again",
    ),
    why: "they pass an empty answer",
    feed: "its tests pass an empty answer",
  };
}

function scoreStrength(mutants: MutantScore | undefined, min: number): TestStrengthView {
  if (!mutants?.total) return { score: null, killed: 0, mutants: 0, fixHint: null };
  const score = Math.round((100 * mutants.killed) / mutants.total);
  return {
    score,
    killed: mutants.killed,
    mutants: mutants.total,
    fixHint:
      score < min
        ? `Your tests caught ${mutants.killed} of ${mutants.total} small changes to the reference ` +
          "solution. Assert exact results for every case in the spec, including edge cases and errors"
        : null,
  };
}
