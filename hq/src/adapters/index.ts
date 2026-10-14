import type { Firestore } from "firebase-admin/firestore";
import type { Config } from "../config.ts";
import { createCheckStep } from "../pipeline/check.ts";
import { createDispatchStep } from "../pipeline/dispatch.ts";
import { createReleaseStep } from "../pipeline/release.ts";
import { createDockerSandbox } from "../sandbox/docker.ts";
import type { Sandbox } from "../sandbox/types.ts";
import { createFirestore } from "../store/firestore.ts";
import { createLocalBlobStore } from "./blob/local.ts";
import type { BlobStore } from "./blob/types.ts";
import { createLocalDispatcher } from "./dispatch/local.ts";
import type { HouseRunnerDispatcher } from "./dispatch/types.ts";
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

function houseRunners(config: Config): HouseRunnerDispatcher | null {
  if (config.HOUSE_RUNNERS === "off") return null;
  if (config.HOUSE_RUNNERS !== "local") notYet("HOUSE_RUNNERS", config.HOUSE_RUNNERS);
  if (!config.HOUSE_RUNNER_API_KEY) {
    throw new Error("HOUSE_RUNNERS=local needs HOUSE_RUNNER_API_KEY; the seed script prints one");
  }
  return createLocalDispatcher({
    hqUrl: `http://localhost:${config.PORT}`,
    apiKey: config.HOUSE_RUNNER_API_KEY,
    modelBackend: config.HOUSE_RUNNER_MODEL_BACKEND,
    model: config.HOUSE_RUNNER_MODEL,
    maxRunning: config.HOUSE_RUNNER_MAX,
    // The claim's length plus a margin for submitting.
    timeoutSeconds: config.CLAIM_TTL_SECONDS + 60,
  });
}

/** `overrides` let tests swap in fakes so they don't need Docker or spawn runners. */
export function createAdapters(
  config: Config,
  overrides: { sandbox?: Sandbox; dispatcher?: HouseRunnerDispatcher | null } = {},
): Adapters {
  if (config.BLOB_BACKEND !== "local") notYet("BLOB_BACKEND", config.BLOB_BACKEND);
  if (config.PIPELINE_MODE !== "inline") notYet("PIPELINE_MODE", config.PIPELINE_MODE);
  if (config.SANDBOX_MODE !== "docker") notYet("SANDBOX_MODE", config.SANDBOX_MODE);

  const db = createFirestore(config);
  const blobs = createLocalBlobStore(config.BLOB_LOCAL_DIR);
  const sandbox =
    overrides.sandbox ??
    createDockerSandbox({
      image: config.SANDBOX_IMAGE,
      timeoutSeconds: config.SANDBOX_TIMEOUT_SECONDS,
    });
  // Step handlers are registered as each phase adds them.
  const dispatcher =
    overrides.dispatcher === undefined ? houseRunners(config) : overrides.dispatcher;
  const pipeline: PipelineRunner = createInlinePipeline({
    dispatch: createDispatchStep(db, dispatcher),
    check: createCheckStep(db, blobs, sandbox, {
      enqueue: (step, payload) => pipeline.enqueue(step, payload),
    }),
    release: createReleaseStep(db),
  });

  return { db, blobs, pipeline, sandbox };
}
