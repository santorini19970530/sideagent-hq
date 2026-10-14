import { describe, expect, it } from "vitest";
import type { PrefixBlobStore } from "../src/adapters/blob/gcs.ts";
import type { JobsClient } from "../src/adapters/cloud-run-jobs.ts";
import {
  createCloudRunJobDispatcher,
  houseRunnerOverrides,
} from "../src/adapters/dispatch/cloud-run-job.ts";
import { createDlpRedactor, mapDlpFindings, type DlpClient } from "../src/adapters/redactor/dlp.ts";
import { redact } from "../src/adapters/redactor/redact.ts";
import { createKmsVault, type KmsClient } from "../src/adapters/vault/kms.ts";
import { createCloudRunJobSandbox } from "../src/sandbox/cloud-run-job.ts";
import type { CheckBundle } from "../src/sandbox/types.ts";

/** A DLP finding at code point offsets [start, end), with int64s as strings like the client. */
function finding(name: string, start: number, end: number) {
  return {
    infoType: { name },
    location: { codepointRange: { start: String(start), end: String(end) } },
  };
}

/** Code point offsets of `part` in `text`, as DLP reports them. */
function codepoints(text: string, part: string): [number, number] {
  const at = text.indexOf(part);
  const start = [...text.slice(0, at)].length;
  return [start, start + [...part].length];
}

describe("DLP redactor", () => {
  it("maps code point ranges to UTF-16 offsets in non-ASCII text", () => {
    const text = "Héllo 😀🎉 from Zoë Ångström, mail zoë@example.com or call +65 9123 4567.";
    const email = "zoë@example.com";
    const name = "Zoë Ångström";
    const findings = mapDlpFindings(text, [
      finding("EMAIL_ADDRESS", ...codepoints(text, email)),
      finding("PERSON_NAME", ...codepoints(text, name)),
      finding("PHONE_NUMBER", ...codepoints(text, "+65 9123 4567")),
    ]);
    expect(findings.map((f) => [f.type, text.slice(f.start, f.end)])).toEqual([
      ["PERSON", name],
      ["EMAIL", email],
      ["PHONE", "+65 9123 4567"],
    ]);
  });

  it("drops overlaps, keeping the stronger type, and skips infoTypes it doesn't map", () => {
    const text = "jane.doe@acme.com";
    const findings = mapDlpFindings(text, [
      finding("PERSON_NAME", 0, 8),
      finding("EMAIL_ADDRESS", 0, 17),
      finding("DOMAIN_NAME", 9, 17),
    ]);
    expect(findings).toEqual([{ type: "EMAIL", start: 0, end: 17 }]);
  });

  it("fails closed on a finding it can't place", () => {
    expect(() => mapDlpFindings("abc", [{ infoType: { name: "EMAIL_ADDRESS" } }])).toThrow(
      "no codepoint range",
    );
    expect(() => mapDlpFindings("abc", [finding("EMAIL_ADDRESS", 1, 9)])).toThrow("outside");
  });

  it("gives the same placeholders as the pattern redactor", async () => {
    const requests: unknown[] = [];
    const client: DlpClient = {
      async inspectContent(req) {
        requests.push(req);
        const text = req.item!.value!;
        const email = "zoë@example.com";
        const findings = text.includes(email)
          ? [finding("EMAIL_ADDRESS", ...codepoints(text, email))]
          : [];
        return [{ result: { findings } }];
      },
    };
    const out = await redact(createDlpRedactor(client, "sideagent-hq"), [
      "Write to zoë@example.com 😀",
      "",
      "assert send('zoë@example.com')",
    ]);
    expect(out.texts).toEqual(["Write to [EMAIL_1] 😀", "", "assert send('[EMAIL_1]')"]);
    expect(out.map).toEqual({ "[EMAIL_1]": "zoë@example.com" });
    // Empty texts aren't sent; the request names the fixed infoType list.
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      parent: "projects/sideagent-hq/locations/global",
      inspectConfig: { infoTypes: expect.arrayContaining([{ name: "PERSON_NAME" }]) },
    });
  });
});

describe("KMS vault", () => {
  // Stands in for Cloud KMS: "encrypts" by reversing, and refuses a different AAD.
  const client: KmsClient = {
    async encrypt({ plaintext, additionalAuthenticatedData }) {
      const aad = Buffer.from(additionalAuthenticatedData as Uint8Array).toString();
      const body = Buffer.from(plaintext as Uint8Array).reverse();
      return [{ ciphertext: Buffer.concat([Buffer.from(`${aad}|`), body]) }];
    },
    async decrypt({ ciphertext, additionalAuthenticatedData }) {
      const raw = Buffer.from(ciphertext as Uint8Array).toString("latin1");
      const aad = Buffer.from(additionalAuthenticatedData as Uint8Array).toString();
      if (!raw.startsWith(`${aad}|`)) throw new Error("Decryption failed");
      return [{ plaintext: Buffer.from(raw.slice(aad.length + 1), "latin1").reverse() }];
    },
  };

  it("round-trips through KMS with the job ID as AAD, as base64", async () => {
    const vault = createKmsVault(client, "projects/p/locations/l/keyRings/r/cryptoKeys/vault");
    const ciphertext = await vault.encrypt("job-1", '{"[EMAIL_1]":"zoë@example.com"}');
    expect(Buffer.from(ciphertext, "base64").toString("latin1")).toMatch(/^job-1\|/);
    expect(await vault.decrypt("job-1", ciphertext)).toBe('{"[EMAIL_1]":"zoë@example.com"}');
    await expect(vault.decrypt("job-2", ciphertext)).rejects.toThrow("Decryption failed");
  });
});

/** A bucket as a map of object names; folder markers end in `/`. */
function fakeBucket(): PrefixBlobStore & { objects: Map<string, string> } {
  const objects = new Map<string, string>();
  return {
    objects,
    async put(key, data) {
      objects.set(key, typeof data === "string" ? data : new TextDecoder().decode(data));
    },
    async get(key) {
      const v = objects.get(key);
      return v === undefined ? null : new TextEncoder().encode(v);
    },
    async delete(key) {
      objects.delete(key);
    },
    async putDir(dir) {
      objects.set(`${dir}/`, "");
    },
    async deletePrefix(prefix) {
      for (const key of [...objects.keys()]) if (key.startsWith(`${prefix}/`)) objects.delete(key);
    },
  };
}

const BUNDLE: CheckBundle = {
  jobId: "job-1",
  checkId: "sub-1",
  runtime: "python",
  result: [{ path: "pkg/solution.py", content: "def add(a, b):\n    return a + b\n" }],
  tests: {
    public: [{ path: "test_public.py", content: "def test_x(): pass\n" }],
    hidden: [{ path: "test_hidden.py", content: "def test_y(): pass\n" }],
    trap: [],
  },
  mutants: { limit: 4, categories: ["public", "hidden"] },
};

const SUMMARY = {
  passed: 2,
  total: 2,
  categories: { public: { passed: 1, total: 1 }, hidden: { passed: 1, total: 1 } },
};

/**
 * Runs the sandbox against fake buckets and a fake jobs client, whose execution writes
 * `outputs` to the out folder and records what it saw. `run` is how the execution ends:
 * succeeded, failed (the operation reports a failed task), or the operation itself errors.
 */
async function runSandbox(
  outputs: Record<string, string>,
  run: "succeeded" | "failed" | "errors" = "succeeded",
) {
  const input = fakeBucket();
  const output = fakeBucket();
  // Left by an earlier attempt of the same check.
  output.objects.set("job-1/sub-1/summary.json", JSON.stringify(SUMMARY));
  const seen: { request?: unknown; input?: Map<string, string> } = {};
  const jobs: JobsClient = {
    async runJob(request) {
      seen.request = request;
      seen.input = new Map(input.objects);
      return [
        {
          name: "operations/1",
          async promise() {
            for (const [name, body] of Object.entries(outputs)) {
              output.objects.set(`job-1/sub-1/${name}`, body);
            }
            if (run === "errors") throw new Error("Task failed with exit code 2");
            return [run === "failed" ? { failedCount: 1 } : { succeededCount: 1 }];
          },
        },
      ];
    },
  };
  const sandbox = createCloudRunJobSandbox({
    jobs,
    jobName: "projects/p/locations/us-west1/jobs/sideagent-sandbox-python",
    input,
    output,
    timeoutSeconds: 600,
  });
  const outcome = sandbox.runChecks(BUNDLE);
  return { outcome, seen, input, output };
}

describe("cloud-run-job sandbox", () => {
  it("writes the bundle with folder markers, runs the job on it and reads the summary", async () => {
    const mutants = { killed: 3, total: 4 };
    const run = await runSandbox({
      "summary.json": JSON.stringify(SUMMARY),
      "mutants.json": JSON.stringify(mutants),
    });
    expect(await run.outcome).toEqual({ kind: "scored", summary: SUMMARY, mutants });
    expect(run.seen.request).toEqual({
      name: "projects/p/locations/us-west1/jobs/sideagent-sandbox-python",
      overrides: {
        containerOverrides: [
          {
            args: ["check", "--job", "/mnt/in/job-1/sub-1", "--out", "/mnt/out/job-1/sub-1"],
          },
        ],
        timeout: { seconds: 600 },
      },
    });
    expect([...run.seen.input!.keys()].sort()).toEqual([
      "job-1/",
      "job-1/sub-1/",
      "job-1/sub-1/config.json",
      "job-1/sub-1/result/",
      "job-1/sub-1/result/pkg/",
      "job-1/sub-1/result/pkg/solution.py",
      "job-1/sub-1/tests/",
      "job-1/sub-1/tests/hidden/",
      "job-1/sub-1/tests/hidden/test_hidden.py",
      "job-1/sub-1/tests/public/",
      "job-1/sub-1/tests/public/test_public.py",
    ]);
    expect(JSON.parse(run.seen.input!.get("job-1/sub-1/config.json")!)).toEqual({
      mutants: BUNDLE.mutants,
    });
    // The check's folders are gone afterwards; hidden tests don't linger in the bucket.
    expect([...run.input.objects.keys()]).toEqual(["job-1/"]);
    expect([...run.output.objects.keys()]).toEqual(["job-1/"]);
  });

  it("reads a rejection from error.json, though the execution failed", async () => {
    const error = { code: "result_blocked", reason: "conftest.py", fix_hint: "Remove it" };
    for (const run of ["failed", "errors"] as const) {
      const sandbox = await runSandbox({ "error.json": JSON.stringify(error) }, run);
      expect(await sandbox.outcome).toEqual({ kind: "rejected", error });
    }
  });

  it("doesn't trust a summary from a failed execution", async () => {
    // Test code can write the out folder, then kill the checker before it writes its own.
    for (const run of ["failed", "errors"] as const) {
      const sandbox = await runSandbox({ "summary.json": JSON.stringify(SUMMARY) }, run);
      await expect(sandbox.outcome).rejects.toThrow("Sandbox execution operations/1 failed");
    }
  });

  it("throws when the execution left neither file, ignoring an earlier attempt's", async () => {
    await expect((await runSandbox({}, "errors")).outcome).rejects.toThrow(
      "Sandbox execution operations/1 failed",
    );
    await expect((await runSandbox({})).outcome).rejects.toThrow("neither summary.json");
  });
});

describe("cloud-run-job dispatcher", () => {
  it("starts the house-runner job with the job and the run's limits", async () => {
    const requests: unknown[] = [];
    let awaited = false;
    const jobs: JobsClient = {
      async runJob(request) {
        requests.push(request);
        return [
          {
            name: "operations/2",
            promise: async () => {
              awaited = true;
              return [{ succeededCount: 1 }];
            },
          },
        ];
      },
    };
    const dispatcher = createCloudRunJobDispatcher({
      jobs,
      jobName: "projects/p/locations/us-west1/jobs/house-runner-honest",
      modelBackend: "vertex",
      model: "gemini-2.5-flash-lite",
      maxTokens: 200_000,
    });
    await dispatcher.start("job-9");
    expect(requests).toEqual([
      {
        name: "projects/p/locations/us-west1/jobs/house-runner-honest",
        overrides: {
          containerOverrides: [
            {
              args: ["--once", "--job", "job-9"],
              env: [
                { name: "SIDEAGENT_MAX_TOKENS", value: "200000" },
                { name: "SIDEAGENT_MODEL_BACKEND", value: "vertex" },
                { name: "SIDEAGENT_MODEL", value: "gemini-2.5-flash-lite" },
              ],
            },
          ],
        },
      },
    ]);
    // Returns once the execution exists, without waiting for the run.
    expect(awaited).toBe(false);
  });

  it("leaves the model to the job without HOUSE_RUNNER_MODEL, and never sends a key", () => {
    const overrides = houseRunnerOverrides("job-9", { modelBackend: "vertex", maxTokens: 5 });
    const env = overrides.containerOverrides![0]!.env!.map((e) => e.name);
    expect(env).toEqual(["SIDEAGENT_MAX_TOKENS", "SIDEAGENT_MODEL_BACKEND"]);
  });
});
