import { DlpServiceClient } from "@google-cloud/dlp";
import { KeyManagementServiceClient } from "@google-cloud/kms";
import { JobsClient as CloudRunJobsClient } from "@google-cloud/run";
import { Storage } from "@google-cloud/storage";
import { CloudTasksClient } from "@google-cloud/tasks";
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { createPlatformModel, type PlatformModel } from "../agents/model.ts";
import { required, type Config } from "../config.ts";
import { createLimits, type Limits, type LimitsOptions } from "../limits.ts";
import { createCheckStep } from "../pipeline/check.ts";
import { createDispatchStep } from "../pipeline/dispatch.ts";
import { createReleaseStep } from "../pipeline/release.ts";
import { createReviewStep } from "../pipeline/review.ts";
import { createScreenStep } from "../pipeline/screen.ts";
import { createGoogleIdTokenVerifier, type IdTokenVerifier } from "../oidc.ts";
import { createCloudRunJobSandbox } from "../sandbox/cloud-run-job.ts";
import { createDockerSandbox } from "../sandbox/docker.ts";
import type { Sandbox } from "../sandbox/types.ts";
import { createAuth, createFirestore } from "../store/firestore.ts";
import { createGcsBlobStore } from "./blob/gcs.ts";
import { createLocalBlobStore } from "./blob/local.ts";
import type { BlobStore } from "./blob/types.ts";
import { cloudRunJobName, type JobsClient } from "./cloud-run-jobs.ts";
import { createCloudRunJobDispatcher } from "./dispatch/cloud-run-job.ts";
import { createLocalDispatcher } from "./dispatch/local.ts";
import type { HouseRunnerDispatcher } from "./dispatch/types.ts";
import { createCloudTasksPipeline, type TasksClient } from "./pipeline/cloud-tasks.ts";
import { createInlinePipeline } from "./pipeline/inline.ts";
import type { PipelineRunner, PipelineStep, StepHandler } from "./pipeline/types.ts";
import { createDlpRedactor } from "./redactor/dlp.ts";
import { createPatternRedactor } from "./redactor/pattern.ts";
import type { Redactor } from "./redactor/types.ts";
import { createKmsVault } from "./vault/kms.ts";
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
  limits: Limits;
  /** The pipeline's step handlers: run by the inline pipeline, or by `/internal/steps/:step`. */
  steps: Partial<Record<PipelineStep, StepHandler>>;
  /** Verifies Cloud Tasks' OIDC tokens on `/internal/steps/:step`. */
  idTokens: IdTokenVerifier;
}

/** GCP clients, built only for the modes that use them; tests pass fakes. */
export interface GcpClients {
  tasks?: TasksClient;
  jobs?: JobsClient;
  idTokens?: IdTokenVerifier;
}

let storageClient: Storage | undefined;
/** One Cloud Storage client for the jobs and sandbox buckets, made on first use. */
function storage(): Storage {
  return (storageClient ??= new Storage());
}

function redactor(config: Config): Redactor {
  if (config.REDACTOR_BACKEND === "pattern") return createPatternRedactor();
  return createDlpRedactor(new DlpServiceClient(), config.GCP_PROJECT);
}

function blobStore(config: Config): BlobStore {
  if (config.BLOB_BACKEND === "local") return createLocalBlobStore(config.BLOB_LOCAL_DIR);
  const bucket = required(config, "JOBS_BUCKET", "BLOB_BACKEND=gcs");
  return createGcsBlobStore(storage().bucket(bucket));
}

function vault(config: Config): Vault {
  if (config.VAULT_BACKEND === "local") {
    return createLocalVault(loadLocalKey(config.VAULT_LOCAL_KEY, config.VAULT_LOCAL_KEY_FILE));
  }
  return createKmsVault(
    new KeyManagementServiceClient(),
    required(config, "KMS_KEY", "VAULT_BACKEND=kms"),
  );
}

function sandbox(config: Config, gcp: GcpClients): Sandbox {
  if (config.SANDBOX_MODE === "docker") {
    return createDockerSandbox({
      image: config.SANDBOX_IMAGE,
      timeoutSeconds: config.SANDBOX_TIMEOUT_SECONDS,
    });
  }
  const mode = "SANDBOX_MODE=cloud-run-job";
  return createCloudRunJobSandbox({
    jobs: gcp.jobs ?? new CloudRunJobsClient(),
    jobName: cloudRunJobName(
      config.GCP_PROJECT,
      config.GCP_REGION,
      required(config, "SANDBOX_JOB", mode),
    ),
    input: createGcsBlobStore(storage().bucket(required(config, "SANDBOX_IN_BUCKET", mode))),
    output: createGcsBlobStore(storage().bucket(required(config, "SANDBOX_OUT_BUCKET", mode))),
    timeoutSeconds: config.SANDBOX_TIMEOUT_SECONDS,
  });
}

function houseRunners(config: Config, gcp: GcpClients): HouseRunnerDispatcher | null {
  if (config.HOUSE_RUNNERS === "off") return null;
  // The demo double agent replaces the honest runner, so it is the one that claims (Phase 5).
  const doubleAgent = config.HOUSE_RUNNER_DOUBLE_AGENT;
  if (config.HOUSE_RUNNERS === "cloud-run-job") {
    // The runner key is a Secret Manager secret on the job itself, never in HQ (D17).
    const mode = "HOUSE_RUNNERS=cloud-run-job";
    const job = doubleAgent
      ? required(config, "HOUSE_RUNNER_DOUBLE_AGENT_JOB", `${mode} with HOUSE_RUNNER_DOUBLE_AGENT`)
      : required(config, "HOUSE_RUNNER_JOB", mode);
    return createCloudRunJobDispatcher({
      jobs: gcp.jobs ?? new CloudRunJobsClient(),
      jobName: cloudRunJobName(config.GCP_PROJECT, config.GCP_REGION, job),
      modelBackend: config.HOUSE_RUNNER_MODEL_BACKEND,
      model: config.HOUSE_RUNNER_MODEL,
      maxTokens: config.HOUSE_RUNNER_MAX_TOKENS,
    });
  }
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
    maxTokens: config.HOUSE_RUNNER_MAX_TOKENS,
    // The claim's length plus a margin for submitting.
    timeoutSeconds: config.CLAIM_TTL_SECONDS + 60,
  });
}

function pipelineRunner(
  config: Config,
  steps: Partial<Record<PipelineStep, StepHandler>>,
  gcp: GcpClients,
): PipelineRunner {
  if (config.PIPELINE_MODE === "inline") return createInlinePipeline(steps);
  const mode = "PIPELINE_MODE=cloud-tasks";
  const queue = required(config, "TASKS_QUEUE", mode);
  return createCloudTasksPipeline({
    client: gcp.tasks ?? new CloudTasksClient(),
    queue: `projects/${config.GCP_PROJECT}/locations/${config.GCP_REGION}/queues/${queue}`,
    hqUrl: required(config, "HQ_URL", mode),
    serviceAccountEmail: required(config, "TASKS_SA_EMAIL", mode),
  });
}

/**
 * `overrides` let tests swap in fakes so they don't need Docker, GCP or spawn runners. Every
 * mode's required variables are checked here, so a misconfigured HQ fails at startup.
 */
export function createAdapters(
  config: Config,
  overrides: {
    sandbox?: Sandbox;
    dispatcher?: HouseRunnerDispatcher | null;
    model?: PlatformModel;
    limits?: LimitsOptions;
    gcp?: GcpClients;
  } = {},
): Adapters {
  const gcp = overrides.gcp ?? {};
  const db = createFirestore(config);
  const limits = createLimits(db, config, overrides.limits);
  const blobs = blobStore(config);
  const checks = overrides.sandbox ?? sandbox(config, gcp);
  const dispatcher =
    overrides.dispatcher === undefined ? houseRunners(config, gcp) : overrides.dispatcher;
  const model = overrides.model ?? createPlatformModel(config);
  const keys = vault(config);
  // Steps enqueue their successors through `pipeline`, which exists only once they are built.
  const next = {
    enqueue: (...args: Parameters<PipelineRunner["enqueue"]>) => pipeline.enqueue(...args),
  };
  const steps: Partial<Record<PipelineStep, StepHandler>> = {
    screen: createScreenStep({
      db,
      blobs,
      model,
      redactor: redactor(config),
      vault: keys,
      config,
      pipeline: next,
    }),
    review: createReviewStep({ db, blobs, model, sandbox: checks, config, pipeline: next }),
    dispatch: createDispatchStep(db, dispatcher, limits),
    check: createCheckStep({ db, blobs, sandbox: checks, model, config, pipeline: next }),
    release: createReleaseStep(db),
  };
  const pipeline = pipelineRunner(config, steps, gcp);
  const idTokens = gcp.idTokens ?? createGoogleIdTokenVerifier();

  return {
    db,
    auth: createAuth(config),
    blobs,
    pipeline,
    sandbox: checks,
    model,
    vault: keys,
    limits,
    steps,
    idTokens,
  };
}
