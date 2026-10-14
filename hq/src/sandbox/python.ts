import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { ApiError, TestSummary, type CodeFile } from "@sideagent/protocol";
import type { CheckBundle, Sandbox } from "./types.ts";

const execFileAsync = promisify(execFile);
const SCRIPT = join(import.meta.dirname, "../../../images/python-sandbox/run_checks.py");

/** A script-style assert file has no pytest test. Wrap it so pytest collects one test. */
function asPytest(content: string): string {
  if (/^\s*(?:def test_|class Test)/m.test(content)) return content;
  const body = content
    .split("\n")
    .map((line) => (line.trim() === "" ? "" : `    ${line}`))
    .join("\n");
  return `def test_job():\n${body.trim() ? body : "    pass"}\n`;
}

async function writeFiles(dir: string, files: CodeFile[], wrap: boolean): Promise<void> {
  const root = resolve(dir);
  await mkdir(dir, { recursive: true });
  for (const file of files) {
    const path = resolve(dir, file.path);
    if (path !== root && !path.startsWith(root + sep)) {
      throw new Error(`Test path escapes the job directory: ${file.path}`);
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, wrap ? asPytest(file.content) : file.content);
  }
}

/** Runs `run_checks.py` on the host. The Docker image is the later sandbox; this is the local one. */
export function createPythonSandbox(): Sandbox {
  return {
    async runChecks(bundle: CheckBundle): Promise<TestSummary> {
      const root = await mkdtemp(join(tmpdir(), "sideagent-check-"));
      const job = join(root, "job");
      const out = join(root, "out");
      try {
        await writeFiles(join(job, "result"), bundle.result, false);
        if (bundle.publicTests.length) {
          await writeFiles(join(job, "tests", "public"), bundle.publicTests, true);
        }
        if (bundle.hiddenTests.length) {
          await writeFiles(join(job, "tests", "hidden"), bundle.hiddenTests, true);
        }
        if (bundle.trapTests.length) {
          await writeFiles(join(job, "tests", "trap"), bundle.trapTests, true);
        }
        await mkdir(out, { recursive: true });
        const scratch = join(root, "scratch");
        await mkdir(scratch, { recursive: true });
        try {
          await execFileAsync("python3", [SCRIPT, "check"], {
            env: {
              ...process.env,
              SIDEAGENT_JOB_DIR: job,
              SIDEAGENT_OUT_DIR: out,
              SIDEAGENT_SCRATCH_DIR: scratch,
            },
          });
        } catch (err) {
          const error = await readJson(join(out, "error.json"));
          const parsed = error ? ApiError.safeParse(error) : undefined;
          if (parsed?.success) throw new Error(parsed.data.reason, { cause: err });
          throw err;
        }
        const summary = TestSummary.parse(
          JSON.parse(await readFile(join(out, "summary.json"), "utf8")),
        );
        return summary;
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  };
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}
