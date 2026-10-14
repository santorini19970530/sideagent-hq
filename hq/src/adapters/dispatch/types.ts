/** Starts one house-runner run for a job (D20): local child process now, Cloud Run Job in Phase 7. */
export interface HouseRunnerDispatcher {
  /** Returns once the run has started; the run itself claims, solves and submits on its own. */
  start(jobId: string): Promise<void>;
}
