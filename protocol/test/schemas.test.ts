import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { A2A_STATE, JobSpec, JobState, TestSummary, exportedSchemas } from "../src/index.ts";

const validJob = {
  type: "code.implement",
  runtime: "python",
  title: "Parse ISO dates",
  spec: "Implement parse_date(s) returning a datetime.date.",
  public_tests: [{ path: "test_public.py", content: "def test_ok(): pass\n" }],
  hidden_tests: [{ path: "tests/test_hidden.py", content: "def test_hidden(): pass\n" }],
  budget: 10,
  deadline: "2026-10-20T00:00:00Z",
  idempotency_key: "job-1",
};

describe("JobSpec", () => {
  it("accepts a valid code job", () => {
    expect(JobSpec.safeParse(validJob).success).toBe(true);
  });

  it("requires runtime for code jobs", () => {
    const { runtime: _, ...job } = validJob;
    const result = JobSpec.safeParse(job);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["runtime"]);
  });

  it("does not require runtime for non-code jobs", () => {
    const { runtime: _, ...job } = validJob;
    expect(JobSpec.safeParse({ ...job, type: "data.extract" }).success).toBe(true);
  });

  it.each([
    "../escape.py",
    "tests/../../x.py",
    "/etc/passwd",
    "a\\..\\b.py",
    "C:/x.py",
    "\\x.py",
    "a\0.py",
  ])("rejects unsafe path %s", (path) => {
    const job = { ...validJob, public_tests: [{ path, content: "" }] };
    expect(JobSpec.safeParse(job).success).toBe(false);
  });

  it("accepts deadlines with a timezone offset", () => {
    expect(JobSpec.safeParse({ ...validJob, deadline: "2026-10-20T08:00:00+08:00" }).success).toBe(
      true,
    );
  });

  it("requires at least one public test", () => {
    expect(JobSpec.safeParse({ ...validJob, public_tests: [] }).success).toBe(false);
  });
});

describe("TestSummary", () => {
  it("rejects extra fields so test content cannot leak through it", () => {
    const summary = { passed: 1, total: 2, categories: {}, tests: ["def test_hidden(): ..."] };
    expect(TestSummary.safeParse(summary).success).toBe(false);
  });
});

describe("A2A_STATE", () => {
  it("maps every job state", () => {
    expect(Object.keys(A2A_STATE).sort()).toEqual([...JobState.options].sort());
  });
});

describe("exported JSON Schemas", () => {
  it("match the committed files (run `pnpm schemas` if this fails)", async () => {
    for (const [name, schema] of Object.entries(exportedSchemas())) {
      const committed = await readFile(new URL(`../schemas/${name}.json`, import.meta.url), "utf8");
      expect(JSON.parse(committed), name).toEqual(schema);
    }
  });
});
