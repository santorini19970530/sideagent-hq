import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod } from "node:fs/promises";
import { DOCKER_RUN_FLAGS } from "@sideagent/protocol";
import type { PublicTestRun, PublicTestRunner } from "./types.ts";

/** Cap on pytest inside the container; run_checks.py enforces it. */
const TEST_TIMEOUT_SECONDS = 60;
/** Extra time for the container to start and stop before it is killed. */
const DOCKER_GRACE_MS = 30_000;
const STDERR_TAIL = 2000;
// run_checks.py caps pytest's output at 64 KB, but test code can write to stdout directly.
const STDOUT_TAIL = 128 * 1024;

/**
 * Laptop runners: `run_checks.py run` in the python-sandbox image, with the workspace mounted
 * read-only at /work, no network and none of the runner's environment.
 */
export function createDockerTestRunner({ image }: { image: string }): PublicTestRunner {
  return {
    async run(dir, tests, signal) {
      // The container user (uid 10001) isn't the host user; mkdtemp makes the workspace 0700.
      await chmod(dir, 0o755);
      const name = `sideagent-run-${randomUUID()}`;
      const args = [
        "run",
        ...DOCKER_RUN_FLAGS,
        `--name=${name}`,
        `--volume=${dir}:/work:ro`,
        image,
        "run",
        `--timeout=${TEST_TIMEOUT_SECONDS}`,
        "--",
        ...tests,
      ];
      return dockerRun(args, name, TEST_TIMEOUT_SECONDS * 1000 + DOCKER_GRACE_MS, signal);
    },
  };
}

function dockerRun(
  args: string[],
  name: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<PublicTestRun> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = (stdout + chunk).slice(-STDOUT_TAIL);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL);
    });
    let stopReason: string | null = null;
    // Killing the CLI would leave the container running; kill the container by name. If it was
    // never created, the kill fails, so stop the CLI too.
    const stop = (reason: string) => {
      stopReason ??= reason;
      execFile("docker", ["kill", name], () => child.kill("SIGKILL"));
    };
    const timer = setTimeout(
      () => stop(`Public tests exceeded ${timeoutMs / 1000} seconds`),
      timeoutMs,
    );
    const onAbort = () => stop("Stopped by the runner");
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    child.on("error", (err) => {
      cleanup();
      reject(new Error(`Could not start docker: ${err.message}`));
    });
    child.on("close", (code) => {
      cleanup();
      if (stopReason) reject(new Error(stopReason));
      // 125–127 are docker's own failures (bad flags, image missing, command not found). Higher
      // codes are the tests dying (137: out of memory) and go back to the model.
      else if (code === null || (code >= 125 && code <= 127)) {
        reject(new Error(`docker run failed: ${stderr}. Run \`pnpm sandbox:build\` first.`));
      } else resolve({ exitCode: code, output: stdout });
    });
  });
}
