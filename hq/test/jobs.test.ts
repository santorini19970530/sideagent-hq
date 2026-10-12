import { ApiError, ClaimJobOutput, JobStatus, JobSummary } from "@sideagent/protocol";
import { describe, expect, it, vi } from "vitest";
import { createHarness } from "./harness.ts";

const h = createHarness();

async function postedJob() {
  const keys = await h.agents();
  const posted = await h.call(keys.poster, "POST", "/v1/jobs", h.jobSpec());
  expect(posted.status).toBe(200);
  return { keys, jobId: JobSummary.parse(posted.body).job_id };
}

describe("auth", () => {
  it("rejects a missing or unknown key", async () => {
    for (const key of [null, "sk_unknown"]) {
      const res = await h.call(key, "GET", "/v1/jobs");
      expect(res.status).toBe(401);
      expect(ApiError.parse(res.body).code).toBe("unauthorized");
    }
  });

  it("refuses calls made with the wrong role", async () => {
    const keys = await h.agents();
    const res = await h.call(keys.runner, "POST", "/v1/jobs", h.jobSpec());
    expect(res.status).toBe(403);
    expect(ApiError.parse(res.body).code).toBe("forbidden");
  });
});

describe("post_job", () => {
  it("opens the job and records draft → open", async () => {
    const { keys, jobId } = await postedJob();
    const status = JobStatus.parse((await h.call(keys.poster, "GET", `/v1/jobs/${jobId}`)).body);
    expect(status.state).toBe("open");
    expect(status.role).toBe("poster");
    expect(status.events.map((e) => [e.from, e.to])).toEqual([
      [null, "draft"],
      ["draft", "open"],
    ]);
  });

  it("returns the same job for a repeated idempotency key", async () => {
    const keys = await h.agents();
    const spec = h.jobSpec();
    const first = await h.call(keys.poster, "POST", "/v1/jobs", spec);
    const second = await h.call(keys.poster, "POST", "/v1/jobs", spec);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    const status = JobStatus.parse(
      (await h.call(keys.poster, "GET", `/v1/jobs/${first.body.job_id}`)).body,
    );
    expect(status.events).toHaveLength(2);
  });

  it("refuses a reused idempotency key with a different request", async () => {
    const keys = await h.agents();
    const spec = h.jobSpec();
    await h.call(keys.poster, "POST", "/v1/jobs", spec);
    const res = await h.call(keys.poster, "POST", "/v1/jobs", { ...spec, budget: 99 });
    expect(res.status).toBe(409);
    expect(ApiError.parse(res.body).code).toBe("conflict");
  });

  it("explains validation failures", async () => {
    const keys = await h.agents();
    const res = await h.call(keys.poster, "POST", "/v1/jobs", {
      ...h.jobSpec(),
      runtime: undefined,
    });
    expect(res.status).toBe(400);
    const err = ApiError.parse(res.body);
    expect(err.code).toBe("invalid_request");
    expect(err.fix_hint).toContain("runtime");
  });
});

describe("claim and submit", () => {
  it("runs a job from open to released and gives the result only to the poster", async () => {
    const { keys, jobId } = await postedJob();

    const listed = await h.call(keys.runner, "GET", "/v1/jobs?types=code.implement");
    expect(listed.body.jobs.map((j: JobSummary) => j.job_id)).toContain(jobId);

    const claim = await h.call(keys.runner, "POST", `/v1/jobs/${jobId}/claim`);
    expect(claim.status).toBe(200);
    const claimed = ClaimJobOutput.parse(claim.body);
    expect(claimed.job.spec).toContain("add(a, b)");
    expect(claimed.attempts_left).toBe(3);

    const before = JobStatus.parse((await h.call(keys.poster, "GET", `/v1/jobs/${jobId}`)).body);
    expect(before.result).toBeUndefined();

    const submit = await h.call(keys.runner, "POST", `/v1/jobs/${jobId}/submissions`, {
      result: [{ path: "solution.py", content: "def add(a, b):\n    return a + b\n" }],
      idempotency_key: "s1",
    });
    expect(submit.status).toBe(200);
    expect(submit.body).toMatchObject({ state: "submitted", attempts_left: 2 });

    await vi.waitFor(async () => {
      const status = await h.call(keys.poster, "GET", `/v1/jobs/${jobId}`);
      expect(status.body.state).toBe("released");
    });
    const poster = JobStatus.parse((await h.call(keys.poster, "GET", `/v1/jobs/${jobId}`)).body);
    expect(poster.result?.[0]?.content).toContain("return a + b");
    expect(poster.events.map((e) => e.to)).toEqual([
      "draft",
      "open",
      "claimed",
      "submitted",
      "checking",
      "passed",
      "released",
    ]);

    const runner = JobStatus.parse((await h.call(keys.runner, "GET", `/v1/jobs/${jobId}`)).body);
    expect(runner.role).toBe("runner");
    expect(runner.result).toBeUndefined();
    const observer = JobStatus.parse(
      (await h.call(keys.otherRunner, "GET", `/v1/jobs/${jobId}`)).body,
    );
    expect(observer.role).toBe("observer");
    expect(observer.claim).toBeUndefined();
  });

  it("never shows hidden tests or the reference solution to runners", async () => {
    const { keys, jobId } = await postedJob();
    const responses = [
      await h.call(keys.runner, "GET", "/v1/jobs"),
      await h.call(keys.runner, "GET", "/v1/runner/next?wait=0"),
      await h.call(keys.runner, "POST", `/v1/jobs/${jobId}/claim`),
      await h.call(keys.runner, "GET", `/v1/jobs/${jobId}`),
    ];
    for (const res of responses) {
      expect(res.text).not.toMatch(
        /HIDDEN_MARKER|REFERENCE_MARKER|hidden_tests|reference_solution/,
      );
    }
  });

  it("lets exactly one of two concurrent claims win", async () => {
    const { keys, jobId } = await postedJob();
    const results = await Promise.all([
      h.call(keys.runner, "POST", `/v1/jobs/${jobId}/claim`),
      h.call(keys.otherRunner, "POST", `/v1/jobs/${jobId}/claim`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it("returns the existing claim when the same runner claims again", async () => {
    const { keys, jobId } = await postedJob();
    const first = await h.call(keys.runner, "POST", `/v1/jobs/${jobId}/claim`);
    const second = await h.call(keys.runner, "POST", `/v1/jobs/${jobId}/claim`);
    expect(second.status).toBe(200);
    expect(second.body.claim_deadline).toBe(first.body.claim_deadline);
  });

  it("counts a repeated submission once", async () => {
    const { keys, jobId } = await postedJob();
    await h.call(keys.runner, "POST", `/v1/jobs/${jobId}/claim`);
    const body = { result: [{ path: "solution.py", content: "x = 1\n" }], idempotency_key: "k" };
    const first = await h.call(keys.runner, "POST", `/v1/jobs/${jobId}/submissions`, body);
    const second = await h.call(keys.runner, "POST", `/v1/jobs/${jobId}/submissions`, body);
    expect(second.body.submission_id).toBe(first.body.submission_id);
    expect(second.body.attempts_left).toBe(2);
  });

  it("refuses a submission from a runner without the claim", async () => {
    const { keys, jobId } = await postedJob();
    await h.call(keys.runner, "POST", `/v1/jobs/${jobId}/claim`);
    const res = await h.call(keys.otherRunner, "POST", `/v1/jobs/${jobId}/submissions`, {
      result: [{ path: "solution.py", content: "x = 1\n" }],
      idempotency_key: "k",
    });
    expect(res.status).toBe(409);
    expect(ApiError.parse(res.body).code).toBe("invalid_state");
  });
});

describe("claim timeout", () => {
  it("returns a timed-out job to open for another runner", async () => {
    const { keys, jobId } = await postedJob();
    await h.call(keys.runner, "POST", `/v1/jobs/${jobId}/claim`);

    const started = h.clock.now;
    h.clock.now = new Date(started.getTime() + (h.config.CLAIM_TTL_SECONDS + 1) * 1000);
    try {
      const listed = await h.call(keys.otherRunner, "GET", "/v1/jobs");
      const entry = listed.body.jobs.find((j: JobSummary) => j.job_id === jobId);
      expect(entry?.state).toBe("open");

      const status = JobStatus.parse((await h.call(keys.poster, "GET", `/v1/jobs/${jobId}`)).body);
      expect(status.state).toBe("open");
      expect(status.events.at(-1)).toMatchObject({ from: "claimed", to: "open" });

      const late = await h.call(keys.runner, "POST", `/v1/jobs/${jobId}/submissions`, {
        result: [{ path: "solution.py", content: "x = 1\n" }],
        idempotency_key: "late",
      });
      expect(late.status).toBe(409);

      const reclaim = await h.call(keys.otherRunner, "POST", `/v1/jobs/${jobId}/claim`);
      expect(reclaim.status).toBe(200);
    } finally {
      h.clock.now = started;
    }
  });
});

describe("runner long-poll", () => {
  it("returns 204 when no job matches", async () => {
    const keys = await h.agents();
    const res = await h.call(keys.runner, "GET", "/v1/runner/next?types=eval.run&wait=0");
    expect(res.status).toBe(204);
  });

  it("with same_owner, skips jobs from other owners", async () => {
    const { jobId } = await postedJob();
    const keys = await h.agents();
    const res = await h.call(keys.runner, "GET", "/v1/runner/next?same_owner=true&wait=0");
    expect(res.status).toBe(204);

    const claim = await h.call(keys.runner, "POST", `/v1/jobs/${jobId}/claim?same_owner=true`);
    expect(claim.status).toBe(403);
    expect(ApiError.parse(claim.body).code).toBe("forbidden");
  });

  it("with same_owner, returns and claims the owner's own job", async () => {
    const { keys, jobId } = await postedJob();
    const next = await h.call(keys.runner, "GET", "/v1/runner/next?same_owner=true&wait=0");
    expect(JobSummary.parse(next.body).job_id).toBe(jobId);

    const claim = await h.call(keys.runner, "POST", `/v1/jobs/${jobId}/claim?same_owner=true`);
    expect(claim.status).toBe(200);
    ClaimJobOutput.parse(claim.body);
  });
});
