import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { apiError, type CodeFile, type JobStatus, type JobSummary } from "@sideagent/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Executor } from "../src/executor/types.ts";
import { HqApiError, type HqClient } from "../src/hq-client.ts";
import { runJob, runLoop } from "../src/poll.ts";
import { claimOutput, runnerJob } from "./fixtures.ts";

function status(state: JobStatus["state"], overrides: Partial<JobStatus> = {}): JobStatus {
  const { spec: _, public_tests: __, ...summary } = runnerJob();
  return { ...summary, state, role: "runner", events: [], ...overrides };
}

const failedCheck = (attemptsLeft: number) =>
  status("claimed", {
    claim: { deadline: new Date(Date.now() + 600_000).toISOString(), attempts_left: attemptsLeft },
    last_check: {
      submission_id: "sub_1",
      outcome: "failed",
      summary: { passed: 2, total: 3, categories: {} },
    },
  });

function fakeHq() {
  const submitted: { jobId: string; result: CodeFile[]; key: string }[] = [];
  let attemptsLeft = 3;
  const hq = {
    nextJob: vi.fn<HqClient["nextJob"]>(async () => null),
    claimJob: vi.fn<HqClient["claimJob"]>(async () => ({
      ...claimOutput(),
      attempts_left: attemptsLeft,
    })),
    submitResult: vi.fn<HqClient["submitResult"]>(async (jobId, result, key) => {
      submitted.push({ jobId, result, key });
      attemptsLeft -= 1;
      return {
        job_id: jobId,
        submission_id: "sub_1",
        state: "submitted",
        attempts_left: attemptsLeft,
      };
    }),
    getStatus: vi.fn<HqClient["getStatus"]>(async () => status("released")),
  } satisfies HqClient;
  return { hq, submitted };
}

const writesSolution: Executor = {
  name: "fake",
  sameOwnerOnly: false,
  async run({ dir }) {
    await writeFile(join(dir, "solution.py"), "def add(a, b):\n    return a + b\n");
  },
};

const quiet = () => {};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runJob", () => {
  it("claims, runs the executor in the workspace and submits its files", async () => {
    const { hq, submitted } = fakeHq();
    const run = vi.spyOn(writesSolution, "run");
    const out = await runJob({ hq, executor: writesSolution, log: quiet }, "job_1");

    expect(hq.claimJob).toHaveBeenCalledWith("job_1", { sameOwner: false });
    expect(run.mock.calls[0]?.[0].job.spec).toContain("add(a, b)");
    expect(submitted).toEqual([
      {
        jobId: "job_1",
        result: [{ path: "solution.py", content: "def add(a, b):\n    return a + b\n" }],
        key: expect.stringMatching(/\/3$/),
      },
    ]);
    expect(out.state).toBe("released");
  });

  it("waits for the check, then tries again under the same claim after a fail", async () => {
    const { hq, submitted } = fakeHq();
    hq.getStatus
      .mockResolvedValueOnce(status("checking"))
      .mockResolvedValueOnce(failedCheck(2))
      .mockResolvedValueOnce(status("released"));
    const run = vi.spyOn(writesSolution, "run");
    const out = await runJob({ hq, executor: writesSolution, log: quiet }, "job_1", undefined, {
      pollMs: 1,
    });

    expect(out.state).toBe("released");
    expect(hq.claimJob).toHaveBeenCalledTimes(2);
    expect(submitted.map((s) => s.key.split("/")[1])).toEqual(["3", "2"]);
    expect(run.mock.calls[0]?.[0].previousCheck).toBeUndefined();
    expect(run.mock.calls[1]?.[0].previousCheck?.summary?.passed).toBe(2);
  });

  it("does not pass on a check from an earlier submission", async () => {
    const { hq } = fakeHq();
    const stale = failedCheck(2);
    stale.last_check = { ...stale.last_check!, submission_id: "sub_0" };
    hq.getStatus.mockResolvedValueOnce(stale).mockResolvedValueOnce(status("released"));
    const run = vi.spyOn(writesSolution, "run");
    await runJob({ hq, executor: writesSolution, log: quiet }, "job_1");

    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[0].previousCheck).toBeUndefined();
  });

  it("stops once the job reopens with no attempts left", async () => {
    const { hq, submitted } = fakeHq();
    hq.getStatus
      .mockResolvedValueOnce(failedCheck(2))
      .mockResolvedValueOnce(failedCheck(1))
      .mockResolvedValueOnce(status("open", { role: "observer" }));
    const out = await runJob({ hq, executor: writesSolution, log: quiet }, "job_1");

    expect(out.state).toBe("open");
    expect(submitted).toHaveLength(3);
    expect(hq.claimJob).toHaveBeenCalledTimes(3);
  });

  it("stops waiting when the check outlives the claim", async () => {
    const { hq, submitted } = fakeHq();
    hq.claimJob.mockResolvedValue(claimOutput(runnerJob(), 50));
    hq.getStatus.mockResolvedValue(status("checking"));
    const out = await runJob({ hq, executor: writesSolution, log: quiet }, "job_1", undefined, {
      pollMs: 20,
    });

    expect(out.state).toBe("checking");
    expect(submitted).toHaveLength(1);
  });

  it("asks HQ for same-owner claims when the executor requires it", async () => {
    const { hq } = fakeHq();
    const executor = { ...writesSolution, sameOwnerOnly: true };
    await runJob({ hq, executor, log: quiet }, "job_1");
    expect(hq.claimJob).toHaveBeenCalledWith("job_1", { sameOwner: true });
  });

  it("does not submit when the executor fails or writes nothing", async () => {
    const { hq } = fakeHq();
    const failing: Executor = {
      ...writesSolution,
      run: async () => Promise.reject(new Error("x")),
    };
    const idle: Executor = { ...writesSolution, run: async () => {} };
    await expect(runJob({ hq, executor: failing, log: quiet }, "job_1")).rejects.toThrow("x");
    await expect(runJob({ hq, executor: idle, log: quiet }, "job_1")).rejects.toThrow(/no result/);
    expect(hq.submitResult).not.toHaveBeenCalled();
  });
});

describe("runLoop", () => {
  const summary: JobSummary = { ...runnerJob(), state: "open" };

  it("skips a job another runner claimed first and runs the next one", async () => {
    const controller = new AbortController();
    const { hq, submitted } = fakeHq();
    hq.nextJob
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...summary, job_id: "taken" })
      .mockResolvedValueOnce(summary)
      .mockImplementation(async () => {
        controller.abort();
        return null;
      });
    hq.claimJob.mockImplementation(async (jobId) => {
      if (jobId === "taken") {
        throw new HqApiError(409, apiError("conflict", "Job is claimed", "Claim another job"));
      }
      return claimOutput(runnerJob({ job_id: jobId }));
    });

    await runLoop(
      { hq, executor: { ...writesSolution, sameOwnerOnly: true }, log: quiet },
      { types: ["code.implement"], signal: controller.signal },
    );

    expect(hq.nextJob).toHaveBeenCalledWith(
      { types: ["code.implement"], sameOwner: true, waitSeconds: 30 },
      controller.signal,
    );
    expect(submitted.map((s) => s.jobId)).toEqual(["job_1"]);
  });
});
