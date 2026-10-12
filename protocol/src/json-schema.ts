import { z } from "zod";
import { ApiError } from "./errors.ts";
import { JobSpec, JobState, JobType } from "./job.ts";
import { Submission, TestSummary } from "./result.ts";
import {
  ClaimJobOutput,
  JobStatus,
  JobSummary,
  ListJobsInput,
  ListJobsOutput,
  SubmitResultOutput,
} from "./tools.ts";

const schemas = {
  JobSpec,
  JobState,
  JobType,
  Submission,
  TestSummary,
  ApiError,
  ListJobsInput,
  JobSummary,
  ListJobsOutput,
  ClaimJobOutput,
  SubmitResultOutput,
  JobStatus,
};

/** JSON Schema for each public schema, keyed by file name (without .json). */
export function exportedSchemas(): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(schemas).map(([name, schema]) => [
      name,
      z.toJSONSchema(schema, { io: "input" }),
    ]),
  );
}
