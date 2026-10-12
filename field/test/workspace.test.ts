import { existsSync } from "node:fs";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkspace, SPEC_FILE } from "../src/workspace.ts";
import { runnerJob } from "./fixtures.ts";

describe("workspace", () => {
  it("writes the spec and public tests, and collects only new files", async () => {
    const ws = await createWorkspace(runnerJob());
    try {
      expect(await readFile(join(ws.dir, SPEC_FILE), "utf8")).toContain("add(a, b)");
      expect(existsSync(join(ws.dir, "test_public.py"))).toBe(true);

      await writeFile(join(ws.dir, "solution.py"), "def add(a, b):\n    return a + b\n");
      await writeFile(join(ws.dir, "test_public.py"), "# edited by the executor\n");
      await mkdir(join(ws.dir, "__pycache__"));
      await writeFile(join(ws.dir, "__pycache__", "solution.pyc"), "x");
      await writeFile(join(ws.dir, ".env"), "SECRET=1");
      await symlink("/etc/hosts", join(ws.dir, "hosts"));

      expect(await ws.collect()).toEqual([
        { path: "solution.py", content: "def add(a, b):\n    return a + b\n" },
      ]);
    } finally {
      await ws.dispose();
    }
    expect(existsSync(ws.dir)).toBe(false);
  });

  it("keeps nested result paths in POSIX form", async () => {
    const ws = await createWorkspace(runnerJob());
    try {
      await mkdir(join(ws.dir, "pkg"));
      await writeFile(join(ws.dir, "pkg", "mod.py"), "x = 1\n");
      expect((await ws.collect()).map((f) => f.path)).toEqual(["pkg/mod.py"]);
    } finally {
      await ws.dispose();
    }
  });

  it("refuses a public test path that escapes the workspace", async () => {
    const job = runnerJob({ public_tests: [{ path: "../escape.py", content: "" }] });
    await expect(createWorkspace(job)).rejects.toThrow(/escapes the workspace/);
  });

  it("refuses a public test that would replace the spec", async () => {
    const job = runnerJob({ public_tests: [{ path: SPEC_FILE, content: "other task" }] });
    await expect(createWorkspace(job)).rejects.toThrow(/can't be named/);
  });

  it("refuses to collect a file over the size limit", async () => {
    const ws = await createWorkspace(runnerJob());
    try {
      await writeFile(join(ws.dir, "big.py"), "x".repeat(300 * 1024));
      await expect(ws.collect()).rejects.toThrow(/big\.py can't be submitted/);
      await writeFile(join(ws.dir, "big.py"), "x".repeat(2 * 1024 * 1024));
      await expect(ws.collect()).rejects.toThrow(/big\.py can't be submitted: larger/);
    } finally {
      await ws.dispose();
    }
  });
});
