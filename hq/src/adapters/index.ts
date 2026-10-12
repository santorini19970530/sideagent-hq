import type { Firestore } from "firebase-admin/firestore";
import type { Config } from "../config.ts";
import { createCheckStep } from "../pipeline/check.ts";
import { createReleaseStep } from "../pipeline/release.ts";
import { createDockerSandbox } from "../sandbox/docker.ts";
import type { Sandbox } from "../sandbox/types.ts";
import { createFirestore } from "../store/firestore.ts";
import { createLocalBlobStore } from "./blob/local.ts";
import type { BlobStore } from "./blob/types.ts";
import { createInlinePipeline } from "./pipeline/inline.ts";
import type { PipelineRunner } from "./pipeline/types.ts";

export interface Adapters {
  db: Firestore;
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

  const db = createFirestore(config);
  // Step handlers are registered as each phase adds them.
  const pipeline: PipelineRunner = createInlinePipeline({
    check: createCheckStep(db, { enqueue: (step, payload) => pipeline.enqueue(step, payload) }),
    release: createReleaseStep(db),
  });

  return {
    db,
    blobs: createLocalBlobStore(config.BLOB_LOCAL_DIR),
    pipeline,
    sandbox: createDockerSandbox(),
  };
}
