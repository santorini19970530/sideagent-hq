import { execFile, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { ApiError, TestSummary } from "@sideagent/protocol";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const IMAGE = "sideagent-sandbox-python:dev";
const CONTEXT = resolve(import.meta.dirname, "../../images/python-sandbox");
const SECRET = "SIDEAGENT_TEST_SECRET";
const execFileAsync = promisify(execFile);

const hasDocker = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
if (process.env.CI && !hasDocker) throw new Error("CI needs Docker for the sandbox tests");

// The isolation flags HQ and laptop runners start the image with (technical.md, "Test sandbox").
const RUN_FLAGS = [
  "--rm",
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
];

type Files = Record<string, string>;

const SOLUTION = "def add(a, b):\n    return a + b\n";
const WRONG = "def add(a, b):\n    return None\n";
const TESTS: Files = {
  "tests/public/test_public.py":
    "from solution import add\n\ndef test_one():\n    assert add(1, 2) == 3\n",
  "tests/hidden/test_hidden.py":
    "from solution import add\n\ndef test_zero():\n    assert add(0, 0) == 0\n\ndef test_negative():\n    assert add(-1, -2) == -3\n",
  "tests/trap/test_trap.py":
    "from solution import add\n\ndef test_big():\n    assert add(10**6, 1) == 1000001\n",
};
const ALL_PASS: TestSummary = {
  passed: 4,
  total: 4,
  categories: {
    hidden: { passed: 2, total: 2 },
    public: { passed: 1, total: 1 },
    trap: { passed: 1, total: 1 },
  },
};

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "sideagent-sandbox-"));
  dirs.push(dir);
  await chmod(dir, 0o777); // The container user (uid 10001) isn't the host user.
  return dir;
}

async function writeFiles(dir: string, files: Files): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
}

async function docker(args: string[]): Promise<{ code: number; stdout: string }> {
  try {
    // The host secret is in the docker CLI's environment but must not reach the container.
    const { stdout } = await execFileAsync("docker", args, {
      env: { ...process.env, [SECRET]: "leaked" },
    });
    return { code: 0, stdout };
  } catch (err) {
    const e = err as { code?: unknown; stdout?: string };
    if (typeof e.code !== "number") throw err;
    return { code: e.code, stdout: e.stdout ?? "" };
  }
}

async function check(files: Files) {
  const job = await tempDir();
  const out = await tempDir();
  await writeFiles(job, files);
  const { code } = await docker([
    "run",
    ...RUN_FLAGS,
    `--volume=${job}:/job:ro`,
    `--volume=${out}:/out`,
    IMAGE,
    "check",
  ]);
  const read = async (name: string): Promise<unknown> => {
    try {
      return JSON.parse(await readFile(join(out, name), "utf8"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw err;
    }
  };
  const [summary, error] = await Promise.all([read("summary.json"), read("error.json")]);
  return {
    code,
    summary: summary === undefined ? undefined : TestSummary.parse(summary),
    error: error === undefined ? undefined : ApiError.parse(error),
  };
}

async function run(files: Files, tests: string[]) {
  const work = await tempDir();
  await writeFiles(work, files);
  const flags = [...RUN_FLAGS, `--volume=${work}:/work:ro`];
  return docker(["run", ...flags, IMAGE, "run", "--timeout=10", "--", ...tests]);
}

describe.skipIf(!hasDocker)("python sandbox image", () => {
  beforeAll(() => {
    const build = spawnSync("docker", ["build", "-q", "-t", IMAGE, CONTEXT], { stdio: "inherit" });
    if (build.status !== 0) throw new Error("docker build failed");
  }, 300_000);

  describe("check", () => {
    it("scores a correct result per category", async () => {
      expect(await check({ ...TESTS, "result/solution.py": SOLUTION })).toEqual({
        code: 0,
        summary: ALL_PASS,
        error: undefined,
      });
    });

    it("scores a wrong result as zero", async () => {
      const { summary } = await check({ ...TESTS, "result/solution.py": WRONG });
      expect(summary).toMatchObject({ passed: 0, total: 4 });
    });

    it("counts partial passes", async () => {
      const partial = "def add(a, b):\n    return a + b if a >= 0 else 0\n";
      const { summary } = await check({ ...TESTS, "result/solution.py": partial });
      expect(summary?.categories.hidden).toEqual({ passed: 1, total: 2 });
      expect(summary).toMatchObject({ passed: 3, total: 4 });
    });

    it("counts a skipped test as not passed without failing the category", async () => {
      const skipping = TESTS["tests/hidden/test_hidden.py"]!.replace(
        "def test_zero():\n",
        "def test_zero():\n    import pytest; pytest.skip('flaky')\n",
      );
      const { summary } = await check({
        ...TESTS,
        "tests/hidden/test_hidden.py": skipping,
        "result/solution.py": SOLUTION,
      });
      expect(summary?.categories.hidden).toEqual({ passed: 1, total: 2 });
    });

    it("runs inside the sandbox: no network, no host env, non-root, read-only job", async () => {
      const probe = [
        "import os, socket, pytest",
        "def test_no_network():",
        "    with pytest.raises(OSError):",
        "        socket.create_connection(('1.1.1.1', 53), timeout=3)",
        "def test_no_host_env():",
        `    assert '${SECRET}' not in os.environ`,
        "def test_not_root():",
        "    assert os.getuid() == 10001",
        "def test_job_read_only():",
        "    with pytest.raises(OSError):",
        "        open('/job/result/new.py', 'w')",
      ].join("\n");
      const { summary } = await check({ "tests/hidden/test_probe.py": probe, "result/x.py": "" });
      expect(summary).toMatchObject({ passed: 4, total: 4 });
    });

    it("ignores test files in the result", async () => {
      const extra = "def test_free():\n    assert True\n";
      const { summary } = await check({
        ...TESTS,
        "result/solution.py": WRONG,
        "result/test_extra.py": extra,
      });
      expect(summary).toMatchObject({ passed: 0, total: 4 });
    });

    it.each(["conftest.py", "pytest.py", "_pytest/__init__.py", "lib/pytest.ini", "x.pth"])(
      "rejects a result containing %s",
      async (path) => {
        const { code, summary, error } = await check({
          ...TESTS,
          "result/solution.py": WRONG,
          [`result/${path}`]: "",
        });
        expect(code).toBe(2);
        expect(summary).toBeUndefined();
        expect(error).toMatchObject({
          code: "invalid_request",
          reason: expect.stringContaining(path),
        });
      },
    );

    it("rejects a result that overwrites a test without naming it", async () => {
      const { error } = await check({
        ...TESTS,
        "result/solution.py": WRONG,
        "result/test_hidden.py": "def test_free():\n    assert True\n",
      });
      expect(error?.code).toBe("invalid_request");
      expect(error?.reason).not.toContain("test_hidden");
    });

    it.each([
      ["skips itself", "import pytest\npytest.skip('no', allow_module_level=True)\n"],
      ["exits early", "import os\nos._exit(0)\n"],
      ["fails to import", "raise ImportError('broken')\n"],
    ])("fails a result that %s", async (_, solution) => {
      const { summary } = await check({ ...TESTS, "result/solution.py": solution });
      // No usable report, so each test file counts as one failed test.
      expect(summary).toMatchObject({ passed: 0, total: 3 });
    });

    it("stops a result that hangs at the timeout", async () => {
      const { summary } = await check({
        "config.json": JSON.stringify({ timeout_seconds: 2 }),
        "tests/hidden/test_hidden.py": TESTS["tests/hidden/test_hidden.py"]!,
        "result/solution.py": "while True:\n    pass\n",
      });
      expect(summary).toEqual({
        passed: 0,
        total: 1,
        categories: { hidden: { passed: 0, total: 1 } },
      });
    }, 30_000);

    it("replaces a summary forged by the result", async () => {
      const forge = [
        "import json",
        "for name in ('summary.json', 'error.json'):",
        "    with open('/out/' + name, 'w') as f:",
        "        json.dump({'passed': 99, 'total': 99, 'categories': {}}, f)",
        WRONG,
      ].join("\n");
      const { summary, error } = await check({ ...TESTS, "result/solution.py": forge });
      expect(summary).toMatchObject({ passed: 0, total: 4 });
      expect(error).toBeUndefined();
    });
  });

  describe("run", () => {
    const publicTest = { "test_public.py": TESTS["tests/public/test_public.py"]! };

    it("prints pytest output and exits 0 when public tests pass", async () => {
      const { code, stdout } = await run({ ...publicTest, "solution.py": SOLUTION }, [
        "test_public.py",
      ]);
      expect(code).toBe(0);
      expect(stdout).toContain("1 passed");
    });

    it("shows the failure to the runner when public tests fail", async () => {
      const { code, stdout } = await run({ ...publicTest, "solution.py": WRONG }, [
        "test_public.py",
      ]);
      expect(code).toBe(1);
      expect(stdout).toContain("assert None == 3");
    });
  });
});
