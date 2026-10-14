import type { ModelBackendName } from "@sideagent/protocol";
import type { JobsClient, RunJobOverrides } from "../cloud-run-jobs.ts";
import type { HouseRunnerDispatcher } from "./types.ts";

export interface CloudRunJobDispatcherOptions {
  jobs: JobsClient;
  /** Full name of the house-runner job: honest, or the double agent (Phase 5). */
  jobName: string;
  modelBackend: ModelBackendName;
  model?: string;
  /** Token cap per run (D32). */
  maxTokens: number;
}

/**
 * Per-execution overrides: the job to take and the run's limits. The HQ URL, the runner key
 * (Secret Manager) and the double agent's flag are set on the Cloud Run Job itself, so HQ never
 * holds the key.
 */
export function houseRunnerOverrides(
  jobId: string,
  { modelBackend, model, maxTokens }: Omit<CloudRunJobDispatcherOptions, "jobs" | "jobName">,
): RunJobOverrides {
  return {
    containerOverrides: [
      {
        args: ["--once", "--job", jobId],
        env: [
          { name: "SIDEAGENT_MAX_TOKENS", value: String(maxTokens) },
          { name: "SIDEAGENT_MODEL_BACKEND", value: modelBackend },
          ...(model ? [{ name: "SIDEAGENT_MODEL", value: model }] : []),
        ],
      },
    ],
  };
}

/**
 * `HOUSE_RUNNERS=cloud-run-job` (D20): one execution of the house-runner job per job. Returns
 * once Cloud Run has accepted the execution; the run claims, solves and submits on its own, and
 * the job's task timeout ends a run that outlives its claim.
 */
export function createCloudRunJobDispatcher(
  options: CloudRunJobDispatcherOptions,
): HouseRunnerDispatcher {
  return {
    async start(jobId) {
      const [operation] = await options.jobs.runJob({
        name: options.jobName,
        overrides: houseRunnerOverrides(jobId, options),
      });
      console.log(`house runner for ${jobId} started: ${operation.name ?? options.jobName}`);
    },
  };
}
