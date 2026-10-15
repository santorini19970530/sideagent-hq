import type { PipelineRunner, PipelineStep, StepHandler } from "./types.ts";

export function createInlinePipeline(
  handlers: Partial<Record<PipelineStep, StepHandler>>,
  onError: (step: PipelineStep, err: unknown) => void = (step, err) =>
    console.error(`pipeline step ${step} failed`, err),
): PipelineRunner {
  return {
    async enqueue(step, payload, { delaySeconds = 0 } = {}) {
      const handler = handlers[step];
      if (!handler) throw new Error(`No handler registered for pipeline step: ${step}`);
      const run = () => {
        handler(payload).catch((err: unknown) => onError(step, err));
      };
      // Unref'd, so a pending step doesn't hold up shutdown.
      if (delaySeconds > 0) setTimeout(run, delaySeconds * 1000).unref();
      else setImmediate(run);
    },
  };
}
