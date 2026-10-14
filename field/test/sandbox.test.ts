import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDockerTestRunner } from "../src/sandbox/docker.ts";
import { createWorkspace, type Workspace } from "../src/workspace.ts";
import { runnerJob } from "./fixtures.ts";

const IMAGE = "sideagent-sandbox-python:dev";
const CONTEXT = resolve(import.meta.dirname, "../../images/python-sandbox");
const SECRET = "SIDEAGENT_TEST_SECRET";

const hasDocker = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
if (process.env.CI && !hasDocker) throw new Error("CI needs Docker for the sandbox tests");

// A public test written by a stranger that probes the runner's host.
const PROBE = `import os, socket

def test_no_host_env():
    assert "${SECRET}" not in os.environ

def test_no_network():
    try:
        socket.create_connection(("1.1.1.1", 53), timeout=3)
    except OSError:
        return
    raise AssertionError("network reachable")

def test_workspace_read_only():
    try:
        open("/work/planted.py", "w")
    except OSError:
        return
    raise AssertionError("workspace writable")
`;

const ADD_TEST = {
  path: "test_public.py",
  content: "from solution import add\n\ndef test_one():\n    assert add(1, 2) == 3\n",
};

let ws: Workspace | undefined;
afterEach(async () => {
  await ws?.dispose();
  ws = undefined;
});

describe.skipIf(!hasDocker)("docker public test runner", () => {
  beforeAll(() => {
    const build = spawnSync("docker", ["build", "-q", "-t", IMAGE, CONTEXT], { stdio: "inherit" });
    if (build.status !== 0) throw new Error("docker build failed");
  }, 300_000);

  const runner = createDockerTestRunner({ image: IMAGE });
  const signal = new AbortController().signal;

  it("runs the public tests against the workspace", async () => {
    ws = await createWorkspace(runnerJob({ public_tests: [ADD_TEST] }));
    await writeFile(join(ws.dir, "solution.py"), "def add(a, b):\n    return a + b\n");
    const run = await runner.run(ws.dir, ["test_public.py"], signal);
    expect(run.exitCode).toBe(0);
    expect(run.output).toContain("1 passed");
  });

  it("returns failures as output", async () => {
    ws = await createWorkspace(runnerJob({ public_tests: [ADD_TEST] }));
    await writeFile(join(ws.dir, "solution.py"), "def add(a, b):\n    return None\n");
    const run = await runner.run(ws.dir, ["test_public.py"], signal);
    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("1 failed");
  });

  it("gives the tests no network, none of the runner's environment and a read-only workspace", async () => {
    process.env[SECRET] = "leaked";
    try {
      ws = await createWorkspace(
        runnerJob({ public_tests: [{ path: "test_probe.py", content: PROBE }] }),
      );
      const run = await runner.run(ws.dir, ["test_probe.py"], signal);
      expect(run.output).toContain("3 passed");
      expect(run.exitCode).toBe(0);
    } finally {
      delete process.env[SECRET];
    }
  });
});
