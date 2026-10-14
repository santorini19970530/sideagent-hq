import type { protos } from "@google-cloud/tasks";
import type { PipelineRunner, PipelineStep } from "./types.ts";

/** The part of `CloudTasksClient` the pipeline uses, so tests can pass a fake. */
export interface TasksClient {
  createTask(request: protos.google.cloud.tasks.v2.ICreateTaskRequest): Promise<unknown>;
}

export interface CloudTasksPipelineOptions {
  client: TasksClient;
  /** `projects/<project>/locations/<region>/queues/<queue>`. */
  queue: string;
  /**
   * The queue for SANDBOX_STEPS, which runs one task at a time: the sandbox job mounts whole
   * buckets, so two checks at once could read each other's hidden tests.
   */
  sandboxQueue: string;
  /** HQ's own URL; also the OIDC audience the step route checks. */
  hqUrl: string;
  /** Account whose OIDC token each task carries (`sa-tasks`). */
  serviceAccountEmail: string;
}

// A step can run a sandbox check or a model call; Cloud Tasks allows up to 30 minutes.
const DISPATCH_DEADLINE_SECONDS = 1800;
/** The steps that start a sandbox execution. */
export const SANDBOX_STEPS: ReadonlySet<PipelineStep> = new Set(["review", "check"]);

/**
 * `PIPELINE_MODE=cloud-tasks`: each step is an HTTP task that POSTs the payload to
 * `${hqUrl}/internal/steps/<step>`. Cloud Tasks retries a step that answers with an error.
 */
export function createCloudTasksPipeline({
  client,
  queue,
  sandboxQueue,
  hqUrl,
  serviceAccountEmail,
}: CloudTasksPipelineOptions): PipelineRunner {
  return {
    async enqueue(step, payload) {
      await client.createTask({
        parent: SANDBOX_STEPS.has(step) ? sandboxQueue : queue,
        task: {
          httpRequest: {
            httpMethod: "POST",
            url: `${hqUrl}/internal/steps/${step}`,
            headers: { "content-type": "application/json" },
            body: Buffer.from(JSON.stringify(payload)),
            oidcToken: { serviceAccountEmail, audience: hqUrl },
          },
          dispatchDeadline: { seconds: DISPATCH_DEADLINE_SECONDS },
        },
      });
    },
  };
}
