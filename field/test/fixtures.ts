import type { ClaimJobOutput, RunnerJobView } from "@sideagent/protocol";

export function runnerJob(overrides: Partial<RunnerJobView> = {}): RunnerJobView {
  return {
    job_id: "job_1",
    type: "code.implement",
    runtime: "python",
    title: "Add two numbers",
    state: "claimed",
    budget: 10,
    deadline: new Date(Date.now() + 3600_000).toISOString(),
    created_at: new Date().toISOString(),
    spec: "Write add(a, b) in solution.py that returns a + b.",
    public_tests: [
      { path: "test_public.py", content: "from solution import add\nassert add(1, 2) == 3\n" },
    ],
    ...overrides,
  };
}

export function claimOutput(job = runnerJob(), deadlineMs = 600_000): ClaimJobOutput {
  return {
    job,
    claim_deadline: new Date(Date.now() + deadlineMs).toISOString(),
    attempts_left: 3,
  };
}
