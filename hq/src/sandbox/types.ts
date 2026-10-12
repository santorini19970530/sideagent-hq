import type { CodeFile, Runtime, TestSummary } from "@sideagent/protocol";

export interface CheckBundle {
  jobId: string;
  checkId: string;
  runtime: Runtime;
  result: CodeFile[];
  publicTests: CodeFile[];
  hiddenTests: CodeFile[];
  trapTests: CodeFile[];
}

export interface Sandbox {
  runChecks(bundle: CheckBundle): Promise<TestSummary>;
}
