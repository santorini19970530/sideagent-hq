export type PipelineStep = "screen" | "redact" | "review" | "dispatch" | "check" | "release";

export interface StepPayload {
  jobId: string;
  submissionId?: string;
}

export type StepHandler = (payload: StepPayload) => Promise<void>;

export interface PipelineRunner {
  /**
   * Schedules a step; it runs after the caller's work completes, never inline with it, and no
   * sooner than `delaySeconds` from now.
   */
  enqueue(
    step: PipelineStep,
    payload: StepPayload,
    opts?: { delaySeconds?: number },
  ): Promise<void>;
}
