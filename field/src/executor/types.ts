import type { RunnerJobView } from "@sideagent/protocol";

export interface ExecutorRun {
  job: RunnerJobView;
  /** Workspace holding the spec and public tests; the executor writes its result files here. */
  dir: string;
  /** Claim deadline. The executor must stop before it so there is time to submit. */
  deadline: Date;
  signal?: AbortSignal;
}

/** Solves one claimed job inside its workspace. Phase 2b adds the Gemma tool-calling loop. */
export interface Executor {
  readonly name: string;
  /** Only claim jobs posted by the runner's own owner (dev command executor, D18). */
  readonly sameOwnerOnly: boolean;
  run(input: ExecutorRun): Promise<void>;
}
