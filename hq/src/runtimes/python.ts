import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { ApiError, TestSummary, type CodeFile } from "@sideagent/protocol";
import type { CheckBundle, CheckOutcome } from "../sandbox/types.ts";

// Bundle layout and output files of `run_checks.py check` (technical.md, "Test sandbox").

async function writeFiles(dir: string, files: CodeFile[]): Promise<void> {
  const root = resolve(dir);
  await mkdir(root, { recursive: true });
  for (const file of files) {
    const path = resolve(root, file.path);
    // Protocol paths are already relative without `..`; this guards the host filesystem anyway.
    if (!path.startsWith(root + sep)) throw new Error(`Path escapes the bundle: ${file.path}`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.content);
  }
}

/** Writes `result/` and `tests/<category>/` under `jobDir`, which is mounted at `/job`. */
export async function writeCheckBundle(jobDir: string, bundle: CheckBundle): Promise<void> {
  await writeFiles(join(jobDir, "result"), bundle.result);
  for (const [category, files] of Object.entries(bundle.tests)) {
    if (files.length) await writeFiles(join(jobDir, "tests", category), files);
  }
}

/** Reads what `run_checks.py check` wrote to `outDir`, given its exit code. */
export async function readCheckOutcome(outDir: string, exitCode: number): Promise<CheckOutcome> {
  if (exitCode === 0) {
    const summary = await readFile(join(outDir, "summary.json"), "utf8");
    return { kind: "scored", summary: TestSummary.parse(JSON.parse(summary)) };
  }
  if (exitCode === 2) {
    const error = await readFile(join(outDir, "error.json"), "utf8");
    return { kind: "rejected", error: ApiError.parse(JSON.parse(error)) };
  }
  throw new Error(`run_checks.py exited with code ${exitCode}`);
}

/** How platform agents are told to write tests for this runtime. */
export const PYTHON_TEST_FORMAT =
  "a pytest file with plain `def test_*` functions and bare `assert` statements";

/** A trap check's file name; pytest collects `test_*.py`. */
export function pythonTrapPath(name: string): string {
  return `test_trap_${name}.py`;
}
