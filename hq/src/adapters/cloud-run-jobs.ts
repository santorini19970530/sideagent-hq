import type { protos } from "@google-cloud/run";

export type Execution = protos.google.cloud.run.v2.IExecution;

/** A started execution's long-running operation; `promise` settles when the execution ends. */
export interface RunJobOperation {
  name?: string | null;
  promise(): Promise<[Execution | null | undefined, ...unknown[]]>;
}

/** The part of the Cloud Run v2 `JobsClient` HQ uses, so tests can pass a fake. */
export interface JobsClient {
  runJob(
    request: protos.google.cloud.run.v2.IRunJobRequest,
    options?: { longrunning?: OperationPolling },
  ): Promise<[RunJobOperation, ...unknown[]]>;
}

/** google-gax's backoff settings for polling a long-running operation. */
export interface OperationPolling {
  initialRetryDelayMillis: number;
  retryDelayMultiplier: number;
  maxRetryDelayMillis: number;
  initialRpcTimeoutMillis: number | null;
  rpcTimeoutMultiplier: number | null;
  maxRpcTimeoutMillis: number | null;
  totalTimeoutMillis: number | null;
}

export type RunJobOverrides = protos.google.cloud.run.v2.RunJobRequest.IOverrides;

export function cloudRunJobName(project: string, region: string, job: string): string {
  return `projects/${project}/locations/${region}/jobs/${job}`;
}
