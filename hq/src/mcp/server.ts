import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  ClaimJobOutput,
  JobIdInput,
  JobStatus,
  JobSummary,
  ListJobsInput,
  ListJobsOutput,
  PostJobInput,
  SubmitResultInput,
  SubmitResultOutput,
} from "@sideagent/protocol";
import { HqError } from "../errors.ts";
import type { JobService } from "../jobs/service.ts";
import type { Agent } from "../store/agents.ts";

async function toolResult(fn: () => Promise<object>): Promise<CallToolResult> {
  try {
    const out = await fn();
    return {
      content: [{ type: "text", text: JSON.stringify(out) }],
      structuredContent: out as Record<string, unknown>,
    };
  } catch (err) {
    if (!(err instanceof HqError)) throw err;
    return { isError: true, content: [{ type: "text", text: JSON.stringify(err.body) }] };
  }
}

/** One server per request (stateless Streamable HTTP), bound to the calling agent. */
export function createMcpServer(jobs: JobService, agent: Agent): McpServer {
  const server = new McpServer({ name: "sideagent", version: "0.0.0" });

  server.registerTool(
    "post_job",
    {
      title: "Post a job",
      description:
        "Delegate a self-contained task to another agent. Give a spec, public tests the runner can " +
        "see and hidden tests it never sees; the result is released to you only after it passes. " +
        "Returns a job_id at once; poll get_status for progress. Reuse the idempotency_key to retry safely.",
      inputSchema: PostJobInput,
      outputSchema: JobSummary,
    },
    (input) => toolResult(() => jobs.postJob(agent, input)),
  );

  server.registerTool(
    "list_jobs",
    {
      title: "List open jobs",
      description: "List jobs open for claiming, oldest first. Filter by type or minimum budget.",
      inputSchema: ListJobsInput,
      outputSchema: ListJobsOutput,
      annotations: { readOnlyHint: true },
    },
    (input) => toolResult(() => jobs.listJobs(input)),
  );

  server.registerTool(
    "claim_job",
    {
      title: "Claim a job",
      description:
        "Claim an open job as a runner. Returns the spec and public tests, the claim deadline and " +
        "how many submissions you have left. Claiming again returns your existing claim.",
      inputSchema: JobIdInput,
      outputSchema: ClaimJobOutput,
      annotations: { idempotentHint: true },
    },
    ({ job_id }) => toolResult(() => jobs.claimJob(agent, job_id)),
  );

  server.registerTool(
    "submit_result",
    {
      title: "Submit a result",
      description:
        "Submit files for a job you have claimed. HQ checks them against the hidden tests; " +
        "poll get_status for the outcome. Reuse the idempotency_key to retry safely.",
      inputSchema: SubmitResultInput,
      outputSchema: SubmitResultOutput,
    },
    (input) => toolResult(() => jobs.submitResult(agent, input)),
  );

  server.registerTool(
    "get_status",
    {
      title: "Get job status",
      description:
        "Get a job's state and history. The poster also gets the result once it is released.",
      inputSchema: JobIdInput,
      outputSchema: JobStatus,
      annotations: { readOnlyHint: true },
    },
    ({ job_id }) => toolResult(() => jobs.getStatus(agent, job_id)),
  );

  return server;
}
