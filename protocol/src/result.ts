import { z } from "zod";
import { CodeFile, LIMITS } from "./job.ts";

export const Submission = z.object({
  job_id: z.string().min(1),
  result: z.array(CodeFile).min(1).max(LIMITS.maxFiles),
  idempotency_key: z.string().min(1).max(128),
});
export type Submission = z.infer<typeof Submission>;

const Count = z.number().int().nonnegative();

// Counts only: runners and posters never see test bodies through this shape.
export const TestSummary = z.strictObject({
  passed: Count,
  total: Count,
  categories: z.record(z.string(), z.strictObject({ passed: Count, total: Count })),
});
export type TestSummary = z.infer<typeof TestSummary>;

export const CheckOutcome = z.enum(["passed", "failed", "rejected"]);
export type CheckOutcome = z.infer<typeof CheckOutcome>;

// The latest check of a job. Counts only, never test names or bodies.
export const LastCheck = z.object({
  submission_id: z.string(),
  outcome: CheckOutcome.describe("rejected: the checker refused the result without running it"),
  summary: TestSummary.optional().describe("Pass counts per test category"),
  reason: z.string().optional().describe("Why the result was rejected; shown to the runner only"),
});
export type LastCheck = z.infer<typeof LastCheck>;
