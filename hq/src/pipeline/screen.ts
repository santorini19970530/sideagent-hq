import { apiError, type CodeFile } from "@sideagent/protocol";
import type { Firestore } from "firebase-admin/firestore";
import { screenJob } from "../agents/screener.ts";
import type { PlatformModel } from "../agents/model.ts";
import type { ModelConfig } from "../agents/platform-agent.ts";
import { getJson, getText, putJson } from "../adapters/blob/helpers.ts";
import type { BlobStore } from "../adapters/blob/types.ts";
import type { PipelineRunner, StepHandler } from "../adapters/pipeline/types.ts";
import { countByType, redact } from "../adapters/redactor/redact.ts";
import type { Redactor } from "../adapters/redactor/types.ts";
import type { Vault } from "../adapters/vault/types.ts";
import { addFeed } from "../store/feed.ts";
import { jobRef, refundBudget, takeScreeningFee, updateJob, type JobDoc } from "../store/jobs.ts";
import { loadPlaceholders, savePlaceholders } from "../store/vault.ts";

export interface ScreenDeps {
  db: Firestore;
  blobs: BlobStore;
  model: PlatformModel;
  redactor: Redactor;
  vault: Vault;
  config: ModelConfig;
  pipeline: Pick<PipelineRunner, "enqueue">;
}

/**
 * Briefing screening (design.md, trust layer 1–2): redacts private data from the job, then the
 * screener agent allows or blocks it. Allowed jobs go to test review; blocked ones are rejected
 * with a fix hint and their budget refunded. The screening fee is kept either way (D30).
 * Model and blob failures throw, leaving the job in `screening` for a retry.
 */
export function createScreenStep({
  db,
  blobs,
  model,
  redactor,
  vault,
  config,
  pipeline,
}: ScreenDeps): StepHandler {
  return async ({ jobId }) => {
    // Its own transaction first, so the dashboard shows screening while the model runs.
    const started = await updateJob(db, jobId, new Date(), (u) => {
      if (u.job.state === "draft") u.move("screening", "Screening the briefing at the checkpoint");
      return u.job.state === "screening";
    });
    if (!started) return;

    const ref = jobRef(db, jobId);
    const [snap, priv] = await Promise.all([
      ref.get(),
      ref.collection("private").doc("main").get(),
    ]);
    const job = snap.data() as JobDoc;
    const hiddenRef = priv.get("hiddenTestsRef") as string | null;
    const referenceRef = priv.get("referenceSolutionRef") as string | null;
    const [spec, hidden, reference, seed] = await Promise.all([
      getText(blobs, job.specRef),
      hiddenRef ? getJson<CodeFile[]>(blobs, hiddenRef) : [],
      referenceRef ? getJson<CodeFile[]>(blobs, referenceRef) : [],
      loadPlaceholders(db, vault, jobId),
    ]);

    // One map for every part of the job, so tests and spec agree on each placeholder.
    const fileSets = [job.publicTests, hidden, reference];
    const { texts, map } = await redact(
      redactor,
      [job.title, spec, ...fileSets.flat().map((f) => f.content)],
      seed,
    );
    const [title, redactedSpec, ...contents] = texts as [string, string, ...string[]];
    let next = 0;
    const [publicTests, hiddenTests, referenceSolution] = fileSets.map((files) =>
      files.map((f) => ({ ...f, content: contents[next++]! })),
    ) as [CodeFile[], CodeFile[], CodeFile[]];
    // The map is saved before the blobs are overwritten, so a retry can finish the job.
    await savePlaceholders(db, vault, jobId, map);
    await Promise.all([
      blobs.put(job.specRef, redactedSpec),
      hiddenRef ? putJson(blobs, hiddenRef, hiddenTests) : null,
      referenceRef ? putJson(blobs, referenceRef, referenceSolution) : null,
    ]);

    const { verdict, record } = await screenJob(model, config, {
      title,
      spec: redactedSpec,
      publicTests,
      hiddenTests,
      referenceSolution,
    });
    const redactions = countByType(map);
    const redacted = Object.values(redactions).reduce((a, b) => a + b, 0);

    const allowed = await updateJob(db, jobId, new Date(), (u) => {
      if (u.job.state !== "screening") return false;
      u.job.title = title;
      u.job.publicTests = publicTests;
      u.job.screening = record;
      if (redacted) {
        u.job.redactions = redactions;
        addFeed(u.tx, u.ref, {
          kind: "redacted",
          agentId: u.job.posterAgentId,
          categories: Object.keys(redactions),
          detail: `${redacted} private ${redacted === 1 ? "value" : "values"} replaced with placeholders`,
          createdAt: u.at,
        });
      }
      takeScreeningFee(u);
      if (verdict.verdict === "allow") {
        u.move("test_review", "Briefing cleared the checkpoint");
        return true;
      }
      u.job.rejection = apiError(
        "job_blocked",
        verdict.reason || "The checkpoint blocked this job",
        verdict.fix_hint || "Remove the flagged content and post the job again",
      );
      const categories = verdict.categories.join(", ") || "unspecified";
      u.move("rejected", `Blocked at the checkpoint: ${categories}`);
      refundBudget(u, "Budget refunded; job blocked by screening");
      addFeed(u.tx, u.ref, {
        kind: "job_blocked",
        agentId: u.job.posterAgentId,
        categories: verdict.categories,
        detail: `Briefing blocked: ${categories}`,
        createdAt: u.at,
      });
      return false;
    });
    if (allowed) await pipeline.enqueue("review", { jobId });
  };
}
