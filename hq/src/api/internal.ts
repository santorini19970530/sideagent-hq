import { apiError } from "@sideagent/protocol";
import { Hono } from "hono";
import { z } from "zod";
import type { PipelineStep, StepHandler } from "../adapters/pipeline/types.ts";
import { required, type Config } from "../config.ts";
import { HqError } from "../errors.ts";
import { requireGoogleOidc, type IdTokenVerifier } from "../oidc.ts";

const StepPayload = z.object({
  jobId: z.string().min(1),
  submissionId: z.string().min(1).optional(),
});

const NOT_FOUND = new HqError(
  "not_found",
  "No internal routes on this HQ",
  "Pipeline steps arrive over HTTP only with PIPELINE_MODE=cloud-tasks",
);

/**
 * `/internal/steps/:step`, called by Cloud Tasks with an OIDC token from TASKS_SA_EMAIL and
 * HQ_URL as the audience. A thrown step answers 500, so Cloud Tasks retries it; steps are
 * idempotent (technical.md, "Pipeline"). Refuses everything unless PIPELINE_MODE=cloud-tasks.
 */
export function internalRoutes(
  config: Config,
  steps: Partial<Record<PipelineStep, StepHandler>>,
  verifier: IdTokenVerifier,
) {
  const app = new Hono();
  if (config.PIPELINE_MODE !== "cloud-tasks") {
    app.all("*", () => {
      throw NOT_FOUND;
    });
    return app;
  }
  const mode = "PIPELINE_MODE=cloud-tasks";
  app.use(
    "*",
    requireGoogleOidc(
      verifier,
      required(config, "HQ_URL", mode),
      required(config, "TASKS_SA_EMAIL", mode),
    ),
  );
  app.post("/steps/:step", async (c) => {
    const step = c.req.param("step");
    const handler = Object.hasOwn(steps, step) ? steps[step as PipelineStep] : undefined;
    if (!handler) throw new HqError("not_found", `No pipeline step ${step}`, "Check the task URL");
    const parsed = StepPayload.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HqError("invalid_request", "Bad step payload", "Send {jobId, submissionId?}");
    }
    try {
      await handler(parsed.data);
    } catch (err) {
      console.error(`pipeline step ${step} failed for ${parsed.data.jobId}`, err);
      return c.json(apiError("internal", `Step ${step} failed`, "Cloud Tasks retries it"), 500);
    }
    return c.json({ ok: true });
  });
  return app;
}
