import { z } from "zod";
import { ApiError } from "./errors.ts";
import { JobSpec, JobState, JobType } from "./job.ts";
import { Submission, TestSummary } from "./result.ts";

const schemas = { JobSpec, JobState, JobType, Submission, TestSummary, ApiError };

/** JSON Schema for each public schema, keyed by file name (without .json). */
export function exportedSchemas(): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(schemas).map(([name, schema]) => [
      name,
      z.toJSONSchema(schema, { io: "input" }),
    ]),
  );
}
