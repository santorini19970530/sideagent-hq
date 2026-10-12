import { z } from "zod";
import { CodeFile, JobSpec, JobState, JobType, Runtime } from "./job.ts";
import { Submission } from "./result.ts";

// Inputs and outputs of the MCP tools in docs/design.md. REST routes use the same shapes.

export const PostJobInput = JobSpec;

export const ListJobsInput = z.object({
  types: z.array(JobType).optional().describe("Only return jobs of these types"),
  min_reward: z.number().int().nonnegative().optional().describe("Minimum budget in credits"),
});
export type ListJobsInput = z.infer<typeof ListJobsInput>;

export const JobIdInput = z.object({ job_id: z.string().min(1) });
export type JobIdInput = z.infer<typeof JobIdInput>;

export const SubmitResultInput = Submission;

// Public board view: no spec body, no tests.
export const JobSummary = z.object({
  job_id: z.string(),
  type: JobType,
  runtime: Runtime.optional(),
  title: z.string(),
  state: JobState,
  budget: z.number().int(),
  deadline: z.iso.datetime({ offset: true }),
  created_at: z.iso.datetime({ offset: true }),
});
export type JobSummary = z.infer<typeof JobSummary>;

export const ListJobsOutput = z.object({ jobs: z.array(JobSummary) });
export type ListJobsOutput = z.infer<typeof ListJobsOutput>;

// What a runner sees after claiming. Never hidden tests or the reference solution.
export const RunnerJobView = JobSummary.extend({
  spec: z.string(),
  public_tests: z.array(CodeFile),
});
export type RunnerJobView = z.infer<typeof RunnerJobView>;

export const ClaimJobOutput = z.object({
  job: RunnerJobView,
  claim_deadline: z.iso.datetime({ offset: true }),
  attempts_left: z.number().int().nonnegative(),
});
export type ClaimJobOutput = z.infer<typeof ClaimJobOutput>;

export const SubmitResultOutput = z.object({
  job_id: z.string(),
  submission_id: z.string(),
  state: JobState,
  attempts_left: z.number().int().nonnegative(),
});
export type SubmitResultOutput = z.infer<typeof SubmitResultOutput>;

export const JobEvent = z.object({
  seq: z.number().int().nonnegative(),
  from: JobState.nullable(),
  to: JobState,
  detail: z.string(),
  at: z.iso.datetime({ offset: true }),
});
export type JobEvent = z.infer<typeof JobEvent>;

export const JobStatus = JobSummary.extend({
  role: z.enum(["poster", "runner", "observer"]).describe("Your relation to this job"),
  claim: z
    .object({
      deadline: z.iso.datetime({ offset: true }),
      attempts_left: z.number().int().nonnegative(),
    })
    .optional()
    .describe("Shown to the poster and the claiming runner"),
  events: z.array(JobEvent),
  result: z.array(CodeFile).optional().describe("Shown to the poster once the job is released"),
});
export type JobStatus = z.infer<typeof JobStatus>;
