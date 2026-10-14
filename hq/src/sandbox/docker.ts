import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCheckOutcome, writeCheckBundle } from "../runtimes/python.ts";
import type { Sandbox } from "./types.ts";

/** Isolation flags for the sandbox image (technical.md, "Test sandbox"). No `-e`: no host env. */
export const DOCKER_RUN_FLAGS = [
  "--rm",
  "--pull=never",
  "--network=none",
  "--read-only",
  "--tmpfs=/tmp:size=64m",
  "--cap-drop=ALL",
  "--security-opt=no-new-privileges",
  "--user=10001",
  "--pids-limit=128",
  "--memory=512m",
  "--cpus=1",
  "--init",
] as const;

const STDERR_TAIL = 2000;

export interface DockerSandboxOptions {
  image: string;
  timeoutSeconds: number;
}

/** `SANDBOX_MODE=docker`: one `docker run` of the python-sandbox image per check. */
export function createDockerSandbox({ image, timeoutSeconds }: DockerSandboxOptions): Sandbox {
  return {
    async runChecks(bundle) {
      if (bundle.runtime !== "python") throw new Error(`No sandbox for runtime ${bundle.runtime}`);
      const root = await mkdtemp(join(tmpdir(), "sideagent-check-"));
      const job = join(root, "job");
      const out = join(root, "out");
      try {
        await writeCheckBundle(job, bundle);
        await mkdir(out);
        // The container user (uid 10001) isn't the host user.
        await chmod(job, 0o755);
        await chmod(out, 0o777);
        const name = `sideagent-check-${randomUUID()}`;
        const args = [
          "run",
          ...DOCKER_RUN_FLAGS,
          `--name=${name}`,
          `--volume=${job}:/job:ro`,
          `--volume=${out}:/out`,
          image,
          "check",
        ];
        const code = await dockerRun(args, name, timeoutSeconds * 1000);
        return await readCheckOutcome(out, code);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  };
}

/** Exit code of `docker run`. Kills the container and throws if it outlives the timeout. */
function dockerRun(args: string[], name: string, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL);
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // Killing the CLI would leave the container running; kill the container by name. If it was
      // never created, the kill fails, so stop the CLI too.
      execFile("docker", ["kill", name], () => child.kill("SIGKILL"));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`Sandbox run exceeded ${timeoutMs / 1000} seconds`));
      // 125–127 are docker's own failures (bad flags, image missing, command not found).
      else if (code === null || code >= 125) reject(new Error(`docker run failed: ${stderr}`));
      else resolve(code);
    });
  });
}
