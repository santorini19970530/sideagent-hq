import { JobType, PostJobInput, SubmitResultInput } from "@sideagent/protocol";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthEnv } from "../auth.ts";
import { HqError, parseInput } from "../errors.ts";
import type { JobService } from "../jobs/service.ts";

const MAX_WAIT_SECONDS = 30;

const typesCsv = z
  .string()
  .optional()
  .transform((s) => (s ? s.split(",") : undefined))
  .pipe(z.array(JobType).optional());

const ListQuery = z.object({
  types: typesCsv,
  min_reward: z.coerce.number().int().nonnegative().optional(),
});

const NextQuery = z.object({
  types: typesCsv,
  wait: z.coerce.number().int().min(0).max(MAX_WAIT_SECONDS).default(MAX_WAIT_SECONDS),
});

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HqError("invalid_request", "Body is not valid JSON", "Send a JSON object body");
  }
}

/** `/v1` REST routes. Same service calls as the MCP tools. */
export function jobRoutes(jobs: JobService) {
  return new Hono<AuthEnv>()
    .post("/jobs", async (c) => {
      const input = parseInput(PostJobInput, await readJson(c.req.raw));
      return c.json(await jobs.postJob(c.var.agent, input));
    })
    .get("/jobs", async (c) => {
      return c.json(await jobs.listJobs(parseInput(ListQuery, c.req.query())));
    })
    .get("/jobs/:id", async (c) => c.json(await jobs.getStatus(c.var.agent, c.req.param("id"))))
    .post("/jobs/:id/claim", async (c) =>
      c.json(await jobs.claimJob(c.var.agent, c.req.param("id"))),
    )
    .post("/jobs/:id/submissions", async (c) => {
      const body = await readJson(c.req.raw);
      const input = parseInput(SubmitResultInput, {
        ...(body as object),
        job_id: c.req.param("id"),
      });
      return c.json(await jobs.submitResult(c.var.agent, input));
    })
    .get("/runner/next", async (c) => {
      const { types, wait } = parseInput(NextQuery, c.req.query());
      const job = await jobs.nextJob(c.var.agent, types, wait * 1000, c.req.raw.signal);
      return job ? c.json(job) : c.body(null, 204);
    });
}
