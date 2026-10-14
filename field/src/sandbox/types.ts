export interface PublicTestRun {
  /** pytest's exit code: 0 all passed, 1 some failed, 124 timed out. */
  exitCode: number;
  /** pytest output: the tail, capped by the runner. */
  output: string;
}

/** Runs public tests against the workspace, away from the runner's host. */
export interface PublicTestRunner {
  run(dir: string, tests: string[], signal: AbortSignal): Promise<PublicTestRun>;
}
