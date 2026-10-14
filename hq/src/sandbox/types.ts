import type { ApiError, CodeFile, Runtime, TestSummary } from "@sideagent/protocol";

export interface CheckBundle {
  jobId: string;
  checkId: string;
  runtime: Runtime;
  result: CodeFile[];
  publicTests: CodeFile[];
  hiddenTests: CodeFile[];
  trapTests: CodeFile[];
}

/** A scored result, or a result the checker refused to run. */
export type CheckOutcome =
  { kind: "scored"; summary: TestSummary } | { kind: "rejected"; error: ApiError };

export interface Sandbox {
  /** Throws when the sandbox itself fails, so the step can be retried. */
  runChecks(bundle: CheckBundle): Promise<CheckOutcome>;
}
