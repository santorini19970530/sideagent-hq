import type { ApiError, CodeFile, Runtime, TestSummary } from "@sideagent/protocol";
import { z } from "zod";

export interface CheckBundle {
  jobId: string;
  checkId: string;
  runtime: Runtime;
  result: CodeFile[];
  /** Test files per category (`public`, `hidden`, `trap`, …); each is scored on its own. */
  tests: Record<string, CodeFile[]>;
  /**
   * Test review: also run these categories against up to `limit` mutants of the result, if the
   * unchanged result passes them all.
   */
  mutants?: { limit: number; categories: string[] };
}

/** How many mutants of the result the tests caught (any test failed). */
export const MutantScore = z.strictObject({
  killed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type MutantScore = z.infer<typeof MutantScore>;

/** A scored result, or a result the checker refused to run. */
export type CheckOutcome =
  | { kind: "scored"; summary: TestSummary; mutants?: MutantScore }
  | { kind: "rejected"; error: ApiError };

export interface Sandbox {
  /** Throws when the sandbox itself fails, so the step can be retried. */
  runChecks(bundle: CheckBundle): Promise<CheckOutcome>;
}
