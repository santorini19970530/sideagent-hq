import { describe, expect, it, vi } from "vitest";
import { createInlinePipeline } from "../src/adapters/pipeline/inline.ts";

describe("inline PipelineRunner", () => {
  it("runs the handler after enqueue returns", async () => {
    const screen = vi.fn(async () => {});
    const pipeline = createInlinePipeline({ screen });
    await pipeline.enqueue("screen", { jobId: "j1" });
    expect(screen).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(screen).toHaveBeenCalledWith({ jobId: "j1" }));
  });

  it("reports handler failures instead of dropping them", async () => {
    const onError = vi.fn();
    const pipeline = createInlinePipeline(
      { check: async () => Promise.reject(new Error("boom")) },
      onError,
    );
    await pipeline.enqueue("check", { jobId: "j1", submissionId: "s1" });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("check", expect.any(Error)));
  });

  it("throws for steps without a handler", async () => {
    await expect(createInlinePipeline({}).enqueue("review", { jobId: "j1" })).rejects.toThrow(
      /No handler/,
    );
  });
});
