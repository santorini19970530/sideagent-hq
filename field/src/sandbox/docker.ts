import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod } from "node:fs/promises";
import { DOCKER_RUN_FLAGS } from "@sideagent/protocol";
import { runCapped, TEST_TIMEOUT_SECONDS } from "./spawn.ts";
import type { PublicTestRun, PublicTestRunner } from "./types.ts";

/** Extra time for the container to start and stop before it is killed. */
const DOCKER_GRACE_MS = 30_000;

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

async function dockerRun(
  args: string[],
  name: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<PublicTestRun> {
  const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
  const { code, stdout, stderr } = await runCapped(child, {
    what: "docker",
    timeoutMs,
    signal,
    // Killing the CLI would leave the container running; kill the container by name. If it was
    // never created, the kill fails, so stop the CLI too.
    kill: () => execFile("docker", ["kill", name], () => child.kill("SIGKILL")),
  });
  // 125–127 are docker's own failures (bad flags, image missing, command not found). Higher
  // codes are the tests dying (137: out of memory) and go back to the model.
  if (code === null || (code >= 125 && code <= 127)) {
    throw new Error(`docker run failed: ${stderr}. Run \`pnpm sandbox:build\` first.`);
  }
  return { exitCode: code, output: stdout };
}
