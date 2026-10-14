import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCapped, TEST_TIMEOUT_SECONDS } from "./spawn.ts";
import type { PublicTestRun, PublicTestRunner } from "./types.ts";

/** Extra time for run_checks.py to stop pytest at its own timeout before it is killed. */
const PROCESS_GRACE_MS = 15_000;
/** Time run_checks.py gets after SIGTERM to kill the tests before SIGKILL. */
const TERM_GRACE_MS = 5_000;

/**
 * The tests' whole environment, built from scratch: the runner's own holds its HQ key
 * (SIDEAGENT_API_KEY) and model settings, and the test code is untrusted.
 */
export const TEST_ENV: Readonly<Record<string, string>> = {
  PATH: "/usr/local/bin:/usr/bin:/bin",
  HOME: "/tmp",
  LANG: "C.UTF-8",
};

export interface ProcessTestRunnerOptions {
  /** Path to run_checks.py (SIDEAGENT_RUN_CHECKS). */
  runChecks: string;
  python?: string;
  timeoutSeconds?: number;
  graceMs?: number;
}

/**
 * House runners (SIDEAGENT_TEST_RUNNER=process): `run_checks.py run` as a child process on a copy
 * of the workspace, so tests can't change what is submitted.
 *
 * This is not a sandbox: the tests have the network and run as the runner's user, so they could
 * read the runner's key from /proc. It is safe only where the container is the sandbox, as on
 * Cloud Run (D20; "Field CLI and house runners" in docs/technical.md): one job per container, a
 * house-runner key and a service account that can only call Vertex AI. Never make it the laptop
 * default; laptops use the Docker runner.
 */
export function createProcessTestRunner({
  runChecks,
  python = "python3",
  timeoutSeconds = TEST_TIMEOUT_SECONDS,
  graceMs = PROCESS_GRACE_MS,
}: ProcessTestRunnerOptions): PublicTestRunner {
  return {
    async run(dir, tests, signal) {
      try {
        await access(runChecks, constants.R_OK);
      } catch {
        throw new Error(
          `${runChecks} not found: set SIDEAGENT_RUN_CHECKS, or SIDEAGENT_TEST_RUNNER=docker`,
        );
      }
      const work = await mkdtemp(join(tmpdir(), "sideagent-tests-"));
      try {
        await cp(dir, work, { recursive: true });
        const args = [
          "-I",
          runChecks,
          "run",
          `--work=${work}`,
          `--timeout=${timeoutSeconds}`,
          "--",
          ...tests,
        ];
        return await processRun(python, args, work, timeoutSeconds * 1000 + graceMs, signal);
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    },
  };
}

async function processRun(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<PublicTestRun> {
  // Its own process group, so a stop reaches run_checks.py and anything it started.
  const child = spawn(command, args, {
    cwd,
    env: TEST_ENV,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const killGroup = (sig: NodeJS.Signals) => {
    try {
      if (child.pid) process.kill(-child.pid, sig);
    } catch {
      // Already gone.
    }
  };
  let killTimer: NodeJS.Timeout | undefined;
  child.once("close", () => clearTimeout(killTimer));
  const {
    code,
    signal: sig,
    stdout,
    stderr,
  } = await runCapped(child, {
    what: command,
    timeoutMs,
    signal,
    // SIGTERM first: run_checks.py then kills pytest, which runs in a session of its own.
    kill: () => {
      killGroup("SIGTERM");
      killTimer = setTimeout(() => killGroup("SIGKILL"), TERM_GRACE_MS);
    },
  });
  if (code === null) throw new Error(`run_checks.py died (${sig}): ${stderr}`);
  return { exitCode: code, output: stdout };
}
