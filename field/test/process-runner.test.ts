import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { STDOUT_TAIL } from "../src/sandbox/spawn.ts";
import { createProcessTestRunner } from "../src/sandbox/process.ts";

// Fake run_checks.py scripts; the real one is tested against the image in hq.
const python = spawnSync("python3", ["-c", "import sys; print(sys.executable)"], {
  encoding: "utf8",
}).stdout?.trim();

const ECHO = `import json, os, sys
open("planted.txt", "w").write("x")
print(json.dumps({"env": dict(os.environ), "argv": sys.argv[1:], "cwd": os.getcwd()}))
sys.exit(1)
`;
// Ignores SIGTERM and leaves a child behind, so only SIGKILL to the group stops both.
const HANG = `import os, signal, subprocess, sys, time
signal.signal(signal.SIGTERM, signal.SIG_IGN)
child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
open(os.path.join(os.path.dirname(__file__), "child.pid"), "w").write(str(child.pid))
time.sleep(60)
`;
const FLOOD = `import sys
sys.stdout.write("x" * (300 * 1024))
`;

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "sideagent-process-test-"));
  dirs.push(dir);
  return dir;
}

async function script(body: string): Promise<string> {
  const path = join(await tempDir(), "run_checks.py");
  await writeFile(path, body);
  return path;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Whether the child HANG started is still running, allowing a moment for it to be reaped. */
async function childAlive(runChecks: string): Promise<boolean> {
  const pid = Number(await readFile(join(dirname(runChecks), "child.pid"), "utf8"));
  for (let i = 0; i < 20 && alive(pid); i++) await sleep(100);
  return alive(pid);
}

describe.skipIf(!python)("process public test runner", () => {
  const signal = new AbortController().signal;
  let workspace: string;
  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "sideagent-process-ws-"));
    await writeFile(join(workspace, "test_public.py"), "");
    return () => rm(workspace, { recursive: true, force: true });
  });

  it("gives the tests a fresh environment and a copy of the workspace", async () => {
    process.env.SIDEAGENT_API_KEY = "sk_leaked";
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/secret.json";
    try {
      const runner = createProcessTestRunner({ runChecks: await script(ECHO), python });
      const run = await runner.run(workspace, ["test_public.py"], signal);
      expect(run.exitCode).toBe(1);
      const seen = JSON.parse(run.output) as {
        env: Record<string, string>;
        argv: string[];
        cwd: string;
      };
      // macOS adds __CF_USER_TEXT_ENCODING to every process.
      const keys = Object.keys(seen.env).filter((k) => !k.startsWith("__CF_"));
      expect(keys.sort()).toEqual(["HOME", "LANG", "PATH"]);
      expect(run.output).not.toContain("sk_leaked");
      const work = seen.argv[1]!.replace(/^--work=/, "");
      expect(seen.argv).toEqual(["run", `--work=${work}`, "--timeout=60", "--", "test_public.py"]);
      expect(basename(work)).toMatch(/^sideagent-tests-/);
      expect(basename(seen.cwd)).toBe(basename(work));
      // The tests wrote into the copy, which is gone; the workspace is unchanged.
      expect(existsSync(work)).toBe(false);
      expect(await readdir(workspace)).toEqual(["test_public.py"]);
    } finally {
      delete process.env.SIDEAGENT_API_KEY;
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }
  });

  it("kills the run and everything it started at the timeout", async () => {
    const runChecks = await script(HANG);
    const runner = createProcessTestRunner({ runChecks, python, timeoutSeconds: 1, graceMs: 200 });
    const started = Date.now();
    await expect(runner.run(workspace, ["test_public.py"], signal)).rejects.toThrow(
      /exceeded 1.2 seconds/,
    );
    // SIGTERM is ignored, so this took the SIGKILL after the grace period.
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(await childAlive(runChecks)).toBe(false);
  }, 20_000);

  it("stops when the runner aborts and leaves no child behind", async () => {
    const runChecks = await script(HANG);
    const runner = createProcessTestRunner({ runChecks, python });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 500);
    await expect(runner.run(workspace, ["test_public.py"], controller.signal)).rejects.toThrow(
      /Stopped by the runner/,
    );
    expect(await childAlive(runChecks)).toBe(false);
  }, 20_000);

  it("keeps only the tail of the output", async () => {
    const runner = createProcessTestRunner({ runChecks: await script(FLOOD), python });
    const run = await runner.run(workspace, ["test_public.py"], signal);
    expect(run.exitCode).toBe(0);
    expect(run.output.length).toBe(STDOUT_TAIL);
  });

  it("explains a missing run_checks.py", async () => {
    const runner = createProcessTestRunner({ runChecks: "/no/such/run_checks.py", python });
    await expect(runner.run(workspace, ["test_public.py"], signal)).rejects.toThrow(
      /SIDEAGENT_RUN_CHECKS/,
    );
  });
});
