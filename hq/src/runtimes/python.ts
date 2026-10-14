import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix, resolve, sep } from "node:path";
import { ApiError, TestSummary, type CodeFile } from "@sideagent/protocol";
import { MutantScore, type CheckBundle, type CheckOutcome } from "../sandbox/types.ts";

// Bundle layout and output files of `run_checks.py check` (technical.md, "Test sandbox").

/** One file of a check bundle, at its path relative to the bundle root (`/job` in the sandbox). */
export interface BundleFile {
  path: string;
  content: string;
}

/**
 * The bundle's files: `result/`, `tests/<category>/` and, when mutants are asked for,
 * `config.json`. The same layout goes to a local folder (Docker) or a bucket (Cloud Run).
 */
export function checkBundleFiles(bundle: CheckBundle): BundleFile[] {
  const files: BundleFile[] = [];
  const add = (dir: string, list: CodeFile[]) => {
    for (const file of list) {
      // Protocol paths are already relative without `..`; this guards the host and bucket anyway.
      const path = posix.normalize(file.path);
      if (posix.isAbsolute(path) || path === ".." || path.startsWith("../") || path === ".") {
        throw new Error(`Path escapes the bundle: ${file.path}`);
      }
      files.push({ path: `${dir}/${path}`, content: file.content });
    }
  };
  add("result", bundle.result);
  for (const [category, list] of Object.entries(bundle.tests)) add(`tests/${category}`, list);
  if (bundle.mutants) {
    files.push({ path: "config.json", content: JSON.stringify({ mutants: bundle.mutants }) });
  }
  return files;
}

/** Writes the bundle under `jobDir`, which is mounted at `/job`. */
export async function writeCheckBundle(jobDir: string, bundle: CheckBundle): Promise<void> {
  const root = resolve(jobDir);
  await mkdir(join(root, "result"), { recursive: true });
  for (const file of checkBundleFiles(bundle)) {
    const path = resolve(root, file.path);
    if (!path.startsWith(root + sep)) throw new Error(`Path escapes the bundle: ${file.path}`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.content);
  }
}

/** Output files of `run_checks.py check`; any of them may be missing. */
export interface CheckOutputs {
  summary: string | null;
  mutants: string | null;
  error: string | null;
}

export const CHECK_OUTPUT_FILES = {
  summary: "summary.json",
  mutants: "mutants.json",
  error: "error.json",
} as const satisfies Record<keyof CheckOutputs, string>;

function scored(summary: string, mutants: string | null): CheckOutcome {
  return {
    kind: "scored",
    summary: TestSummary.parse(JSON.parse(summary)),
    ...(mutants ? { mutants: MutantScore.parse(JSON.parse(mutants)) } : {}),
  };
}

function rejected(error: string): CheckOutcome {
  return { kind: "rejected", error: ApiError.parse(JSON.parse(error)) };
}

async function readOptional(path: string): Promise<string | null> {
  return readFile(path, "utf8").catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
}

/** Reads what `run_checks.py check` wrote to `outDir`, given its exit code. */
export async function readCheckOutcome(outDir: string, exitCode: number): Promise<CheckOutcome> {
  if (exitCode === 0) {
    const [summary, mutants] = await Promise.all([
      readFile(join(outDir, CHECK_OUTPUT_FILES.summary), "utf8"),
      readOptional(join(outDir, CHECK_OUTPUT_FILES.mutants)),
    ]);
    return scored(summary, mutants);
  }
  if (exitCode === 2)
    return rejected(await readFile(join(outDir, CHECK_OUTPUT_FILES.error), "utf8"));
  throw new Error(`run_checks.py exited with code ${exitCode}`);
}

/**
 * The outcome where the exit code isn't visible (Cloud Run), from the output files and whether
 * the execution succeeded. `error.json` means rejected (exit 2, which fails the execution).
 * `summary.json` counts only from a successful execution: test code runs as the checker's user
 * and can write the output folder, so a summary beside a failed run (say, the checker killed
 * after a fake summary was written) is not trusted. Anything else is a sandbox failure, which
 * throws so the step retries.
 */
export function inferCheckOutcome(
  { summary, mutants, error }: CheckOutputs,
  succeeded: boolean,
): CheckOutcome {
  if (error !== null) return rejected(error);
  if (summary !== null && succeeded) return scored(summary, mutants);
  if (summary !== null) throw new Error("run_checks.py wrote summary.json but the run failed");
  throw new Error("run_checks.py wrote neither summary.json nor error.json");
}

/** `run_checks.py check` arguments for a bundle at `jobDir` and output to `outDir`. */
export function pythonCheckArgs(jobDir: string, outDir: string): string[] {
  return ["check", "--job", jobDir, "--out", outDir];
}

/** How platform agents are told to write tests for this runtime. */
export const PYTHON_TEST_FORMAT =
  "a pytest file with plain `def test_*` functions and bare `assert` statements";

/** A trap check's file name; pytest collects `test_*.py`. */
export function pythonTrapPath(name: string): string {
  return `test_trap_${name}.py`;
}
