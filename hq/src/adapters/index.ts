import type { Config } from "../config.ts";
import { createDockerSandbox } from "../sandbox/docker.ts";
import type { Sandbox } from "../sandbox/types.ts";
import { createLocalBlobStore } from "./blob/local.ts";
import type { BlobStore } from "./blob/types.ts";
import { createInlinePipeline } from "./pipeline/inline.ts";
import type { PipelineRunner } from "./pipeline/types.ts";

export interface Adapters {
  blobs: BlobStore;
  pipeline: PipelineRunner;
  sandbox: Sandbox;
}

function notYet(name: string, mode: string): never {
  throw new Error(`${name}=${mode} is available from Phase 7; use the local default`);
}

export function createAdapters(config: Config): Adapters {
  if (config.BLOB_BACKEND !== "local") notYet("BLOB_BACKEND", config.BLOB_BACKEND);
  if (config.PIPELINE_MODE !== "inline") notYet("PIPELINE_MODE", config.PIPELINE_MODE);
  if (config.SANDBOX_MODE !== "docker") notYet("SANDBOX_MODE", config.SANDBOX_MODE);

  return {
    blobs: createLocalBlobStore(config.BLOB_LOCAL_DIR),
    // Step handlers are registered as each phase adds them.
    pipeline: createInlinePipeline({}),
    sandbox: createDockerSandbox(),
  };
}
