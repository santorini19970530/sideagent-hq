import { describe, expect, it } from "vitest";
import { createPythonSandbox } from "../src/sandbox/python.ts";

const sandbox = createPythonSandbox();
const publicTests = [
  { path: "test_public.py", content: "from solution import add\nassert add(1, 2) == 3\n" },
];
const hiddenTests = [
  { path: "test_hidden.py", content: "from solution import add\nassert add(2, 2) == 4\n" },
];

describe("local python checks", () => {
  it("passes a correct solution and fails a wrong one", async () => {
    const base = {
      jobId: "j",
      checkId: "c",
      runtime: "python" as const,
      publicTests,
      hiddenTests,
      trapTests: [],
    };
    const ok = await sandbox.runChecks({
      ...base,
      result: [{ path: "solution.py", content: "def add(a, b):\n    return a + b\n" }],
    });
    const bad = await sandbox.runChecks({
      ...base,
      result: [{ path: "solution.py", content: "def add(a, b):\n    return None\n" }],
    });
    expect(ok.passed).toBe(ok.total);
    expect(ok.total).toBeGreaterThan(0);
    expect(bad.passed).toBeLessThan(bad.total);
  });
});
