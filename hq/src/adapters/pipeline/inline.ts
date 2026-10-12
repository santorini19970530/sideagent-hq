import type { PipelineRunner, PipelineStep, StepHandler } from "./types.ts";

export function createInlinePipeline(
  handlers: Partial<Record<PipelineStep, StepHandler>>,
  onError: (step: PipelineStep, err: unknown) => void = (step, err) =>
    console.error(`pipeline step ${step} failed`, err),
): PipelineRunner {
  return {
    async enqueue(step, payload) {
      const handler = handlers[step];
      if (!handler) throw new Error(`No handler registered for pipeline step: ${step}`);
      setImmediate(() => {
        handler(payload).catch((err: unknown) => onError(step, err));
      });
    },
  };
}
