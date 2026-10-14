import { TrapTestDrafts, type CodeFile, type Runtime } from "@sideagent/protocol";
import type { Config } from "../config.ts";
import { TEST_FORMAT } from "../runtimes/index.ts";
import type { PlatformModel } from "./model.ts";
import { dataRule, delimit } from "./platform-agent.ts";

export const TRAP_COUNT = 3;
const MAX_TRAP_BYTES = 8000;
// Gemini 2.5 Flash took about 40 s unbounded and about 9 s at this budget, with drafts as good.
const THINKING_BUDGET = 1024;

function instructions(runtime: Runtime): string {
  return `You write trap checks for Sideagent, a marketplace where AI agents solve small coding jobs. A trap check is a hidden test that a correct solution always passes, but a fake one fails: for example a solution that hard-codes the answers to the public example tests.

Write ${TRAP_COUNT} separate test files for the job below. Each one must:
- follow the spec exactly and test only behaviour the spec states; never guess at unstated edge cases,
- use inputs different from the public tests, so a lookup table of the public answers fails,
- be ${TEST_FORMAT[runtime]},
- import the solution the same way the public tests do,
- be deterministic, with no network, file, clock or environment access.

Keep each file short: two or three assertions.`;
}

/**
 * Drafts trap checks from a job's spec and public tests (D29). Drafts are unverified: the
 * `review` step keeps only those the poster's reference solution passes.
 */
export async function draftTrapTests(
  model: PlatformModel,
  config: Pick<Config, "MODEL_ESCALATE">,
  job: { runtime: Runtime; spec: string; publicTests: CodeFile[] },
): Promise<TrapTestDrafts["tests"]> {
  const { boundary, text } = delimit({ spec: job.spec, public_tests: job.publicTests });
  const { value } = await model.generateJson({
    agent: "trap-writer",
    model: config.MODEL_ESCALATE,
    system: `${instructions(job.runtime)}\n\n${dataRule(boundary)}`,
    prompt: text,
    schema: TrapTestDrafts,
    maxOutputTokens: 8192,
    thinkingBudget: THINKING_BUDGET,
  });
  return value.tests
    .filter((t) => t.content.trim() && t.content.length <= MAX_TRAP_BYTES)
    .slice(0, TRAP_COUNT)
    .map((t, i) => ({ name: fileSafeName(t.name, i), content: t.content }));
}

/** A model-written name as `[a-z0-9_]{1,40}`, since it becomes part of a file path. */
export function fileSafeName(name: string, index: number): string {
  const safe = name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return safe || `trap_${index}`;
}
