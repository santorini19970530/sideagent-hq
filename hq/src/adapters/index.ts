import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { createPlatformModel, type PlatformModel } from "../agents/model.ts";
import type { Config } from "../config.ts";
import { createCheckStep } from "../pipeline/check.ts";
import { createDispatchStep } from "../pipeline/dispatch.ts";
import { createReleaseStep } from "../pipeline/release.ts";
import { createReviewStep } from "../pipeline/review.ts";
import { createScreenStep } from "../pipeline/screen.ts";
import { createDockerSandbox } from "../sandbox/docker.ts";
import type { Sandbox } from "../sandbox/types.ts";
import { createAuth, createFirestore } from "../store/firestore.ts";
import { createLocalBlobStore } from "./blob/local.ts";
import type { BlobStore } from "./blob/types.ts";
import { createLocalDispatcher } from "./dispatch/local.ts";
import type { HouseRunnerDispatcher } from "./dispatch/types.ts";
import { createInlinePipeline } from "./pipeline/inline.ts";
import type { PipelineRunner } from "./pipeline/types.ts";
import { createPatternRedactor } from "./redactor/pattern.ts";
import type { Redactor } from "./redactor/types.ts";
import { createLocalVault, loadLocalKey } from "./vault/local.ts";
import type { Vault } from "./vault/types.ts";

export interface Adapters {
  db: Firestore;
  /** Null without the Auth emulator; see `createAuth`. */
  auth: Auth | null;
  blobs: BlobStore;
  pipeline: PipelineRunner;
  sandbox: Sandbox;
  model: PlatformModel;
  vault: Vault;
}

function redactor(config: Config): Redactor {
  if (config.REDACTOR_BACKEND !== "pattern") notYet("REDACTOR_BACKEND", config.REDACTOR_BACKEND);
  return createPatternRedactor();
}

function notYet(name: string, mode: string): never {
  throw new Error(`${name}=${mode} is available from Phase 7; use the local default`);
}

function houseRunners(config: Config): HouseRunnerDispatcher | null {
  if (config.HOUSE_RUNNERS === "off") return null;
  if (config.HOUSE_RUNNERS !== "local") notYet("HOUSE_RUNNERS", config.HOUSE_RUNNERS);
  // The demo double agent replaces the honest runner, so it is the one that claims (Phase 5).
  const doubleAgent = config.HOUSE_RUNNER_DOUBLE_AGENT;
  const apiKey = doubleAgent
    ? config.HOUSE_RUNNER_DOUBLE_AGENT_API_KEY
    : config.HOUSE_RUNNER_API_KEY;
  if (!apiKey) {
    const name = doubleAgent ? "HOUSE_RUNNER_DOUBLE_AGENT_API_KEY" : "HOUSE_RUNNER_API_KEY";
    throw new Error(`HOUSE_RUNNERS=local needs ${name}; the seed script prints one`);
  }
  return createLocalDispatcher({
    hqUrl: `http://localhost:${config.PORT}`,
    apiKey,
    simulateCheat: doubleAgent,
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
  overrides: {
    sandbox?: Sandbox;
    dispatcher?: HouseRunnerDispatcher | null;
    model?: PlatformModel;
  } = {},
): Adapters {
  if (config.BLOB_BACKEND !== "local") notYet("BLOB_BACKEND", config.BLOB_BACKEND);
  if (config.VAULT_BACKEND !== "local") notYet("VAULT_BACKEND", config.VAULT_BACKEND);
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
  const model = overrides.model ?? createPlatformModel(config);
  const vault = createLocalVault(loadLocalKey(config.VAULT_LOCAL_KEY, config.VAULT_LOCAL_KEY_FILE));
  // Steps enqueue their successors through `pipeline`, which exists only once they are built.
  const next = {
    enqueue: (...args: Parameters<PipelineRunner["enqueue"]>) => pipeline.enqueue(...args),
  };
  const pipeline: PipelineRunner = createInlinePipeline({
    screen: createScreenStep({
      db,
      blobs,
      model,
      redactor: redactor(config),
      vault,
      config,
      pipeline: next,
    }),
    review: createReviewStep({ db, blobs, model, sandbox, config, pipeline: next }),
    dispatch: createDispatchStep(db, dispatcher),
    check: createCheckStep({ db, blobs, sandbox, model, config, pipeline: next }),
    release: createReleaseStep(db),
  });

  return { db, auth: createAuth(config), blobs, pipeline, sandbox, model, vault };
}
