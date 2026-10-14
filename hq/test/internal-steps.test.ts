import { randomBytes } from "node:crypto";
import { JobStatus } from "@sideagent/protocol";
import { describe, expect, it } from "vitest";
import { createAdapters } from "../src/adapters/index.ts";
import type { TasksClient } from "../src/adapters/pipeline/cloud-tasks.ts";
import { loadConfig, type Config } from "../src/config.ts";
import type { IdTokenVerifier } from "../src/oidc.ts";
import { createFakeModel, createHarness } from "./harness.ts";

const HQ_URL = "https://hq.example.test";
const TASKS_SA = "sa-tasks@sideagent-hq.iam.gserviceaccount.com";

/** Tokens are `{aud, email, verified}` as JSON; the fake checks the audience like Google's. */
const verifier: IdTokenVerifier = {
  async verify(token, audience) {
    let claims: { aud: string; email: string; verified?: boolean };
    try {
      claims = JSON.parse(token);
    } catch {
      return null;
    }
    const audiences = Array.isArray(audience) ? audience : [audience];
    if (!audiences.includes(claims.aud)) return null;
    return { email: claims.email, email_verified: claims.verified ?? true };
  },
};
const token = (claims: { aud?: string; email?: string; verified?: boolean } = {}) =>
  JSON.stringify({ aud: HQ_URL, email: TASKS_SA, ...claims });

type Task = { url: string; body: string; audience: string; email: string; deadline: unknown };

function fakeTasks() {
  const tasks: Task[] = [];
  const client: TasksClient = {
    async createTask({ parent, task }) {
      expect(parent).toBe("projects/demo-sideagent/locations/us-west1/queues/sideagent-pipeline");
      const req = task!.httpRequest!;
      tasks.push({
        url: req.url!,
        body: Buffer.from(req.body as Uint8Array).toString("utf8"),
        audience: req.oidcToken!.audience!,
        email: req.oidcToken!.serviceAccountEmail!,
        deadline: task!.dispatchDeadline,
      });
      return [task];
    },
  };
  return { tasks, client };
}

function cloudHarness() {
  const fake = fakeTasks();
  const h = createHarness({
    config: {
      PIPELINE_MODE: "cloud-tasks",
      HQ_URL,
      TASKS_QUEUE: "sideagent-pipeline",
      TASKS_SA_EMAIL: TASKS_SA,
    },
    gcp: { tasks: fake.client, idTokens: verifier },
  });
  async function deliver(task: Task, auth: string | null = token()) {
    return h.app.request(new URL(task.url).pathname, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      },
      body: task.body,
    });
  }
  return { ...h, tasks: fake.tasks, deliver };
}

describe("cloud-tasks pipeline", () => {
  it("enqueues each step as an OIDC task and runs it from /internal/steps", async () => {
    const h = cloudHarness();
    const keys = await h.agents();
    const posted = await h.call(keys.poster, "POST", "/v1/jobs", h.jobSpec());
    expect(posted.status).toBe(200);
    const jobId = posted.body.job_id as string;

    // screen, review, dispatch: each run enqueues the next.
    const ran: string[] = [];
    while (h.tasks.length) {
      const task = h.tasks.shift()!;
      expect(task).toMatchObject({
        audience: HQ_URL,
        email: TASKS_SA,
        deadline: { seconds: 1800 },
      });
      expect(JSON.parse(task.body)).toEqual({ jobId });
      ran.push(new URL(task.url).pathname);
      expect((await h.deliver(task)).status).toBe(200);
    }
    expect(ran).toEqual([
      "/internal/steps/screen",
      "/internal/steps/review",
      "/internal/steps/dispatch",
    ]);
    const status = JobStatus.parse((await h.call(keys.poster, "GET", `/v1/jobs/${jobId}`)).body);
    expect(status.state).toBe("open");
  });

  it("refuses calls without a valid token from the tasks account", async () => {
    const h = cloudHarness();
    const task = { url: `${HQ_URL}/internal/steps/release`, body: '{"jobId":"x"}' } as Task;
    expect((await h.deliver(task, null)).status).toBe(401);
    expect((await h.deliver(task, token({ aud: "https://elsewhere.test" }))).status).toBe(401);
    expect((await h.deliver(task, token({ email: "intruder@example.com" }))).status).toBe(403);
    expect((await h.deliver(task, token({ verified: false }))).status).toBe(403);
    // An agent's API key is no use here either.
    const keys = await h.agents();
    expect((await h.deliver(task, keys.poster)).status).toBe(401);
  });

  it("answers 500 when a step throws, so Cloud Tasks retries it", async () => {
    const h = cloudHarness();
    h.adapters.steps.release = async () => {
      throw new Error("sandbox down");
    };
    const task = { url: `${HQ_URL}/internal/steps/release`, body: '{"jobId":"x"}' } as Task;
    expect((await h.deliver(task)).status).toBe(500);
    const unknown = { url: `${HQ_URL}/internal/steps/nope`, body: '{"jobId":"x"}' } as Task;
    expect((await h.deliver(unknown)).status).toBe(404);
    const bad = { url: `${HQ_URL}/internal/steps/release`, body: "{}" } as Task;
    expect((await h.deliver(bad)).status).toBe(400);
  });

  it("does not exist unless PIPELINE_MODE=cloud-tasks", async () => {
    const h = createHarness({ gcp: { idTokens: verifier } });
    const res = await h.app.request("/internal/steps/screen", {
      method: "POST",
      headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" },
      body: '{"jobId":"x"}',
    });
    expect(res.status).toBe(404);
  });

  it("fails at startup without the variables a mode needs", () => {
    const start = (config: Partial<Config>) => () =>
      createAdapters(
        {
          ...loadConfig(process.env),
          VAULT_LOCAL_KEY: randomBytes(32).toString("base64"),
          ...config,
        },
        { model: createFakeModel() },
      );
    expect(start({ PIPELINE_MODE: "cloud-tasks", HQ_URL, TASKS_QUEUE: "q" })).toThrow(
      "PIPELINE_MODE=cloud-tasks needs TASKS_SA_EMAIL",
    );
    expect(start({ SANDBOX_MODE: "cloud-run-job" })).toThrow(
      "SANDBOX_MODE=cloud-run-job needs SANDBOX_JOB",
    );
    expect(start({ HOUSE_RUNNERS: "cloud-run-job" })).toThrow(
      "HOUSE_RUNNERS=cloud-run-job needs HOUSE_RUNNER_JOB",
    );
    expect(start({ HOUSE_RUNNERS: "cloud-run-job", HOUSE_RUNNER_DOUBLE_AGENT: true })).toThrow(
      "needs HOUSE_RUNNER_DOUBLE_AGENT_JOB",
    );
    expect(start({ BLOB_BACKEND: "gcs" })).toThrow("BLOB_BACKEND=gcs needs JOBS_BUCKET");
    expect(start({ VAULT_BACKEND: "kms" })).toThrow("VAULT_BACKEND=kms needs KMS_KEY");
  });
});
