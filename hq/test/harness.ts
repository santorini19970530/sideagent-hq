import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JobSpec } from "@sideagent/protocol";
import { createAdapters } from "../src/adapters/index.ts";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import type { CheckOutcome, Sandbox } from "../src/sandbox/types.ts";
import { createAgent } from "../src/store/agents.ts";
import { createOwner } from "../src/store/owners.ts";

export const SOLUTION = "def add(a, b):\n    return a + b\n";
export const WRONG = "def add(a, b):\n    return None\n";

/**
 * Stands in for Docker in pipeline tests: a result passes when it contains SOLUTION's body.
 * Set `next` to make the following check return or throw something else.
 */
export function createFakeSandbox() {
  const fake = {
    next: null as (() => Promise<CheckOutcome>) | null,
    runChecks: async (bundle: Parameters<Sandbox["runChecks"]>[0]): Promise<CheckOutcome> => {
      const override = fake.next;
      fake.next = null;
      if (override) return override();
      const ok = bundle.result.some((f) => f.content.includes("return a + b"));
      const passed = ok ? 1 : 0;
      return {
        kind: "scored",
        summary: {
          passed: passed * 2,
          total: 2,
          categories: { hidden: { passed, total: 1 }, public: { passed, total: 1 } },
        },
      };
    },
  };
  return fake;
}

// Runs against the Firestore emulator started by `pnpm test`. Every test creates its own
// owner and agents, so test files can share the emulator without clearing it.
export function createHarness() {
  const config = {
    ...loadConfig(process.env),
    BLOB_LOCAL_DIR: mkdtempSync(join(tmpdir(), "sideagent-blobs-")),
  };
  const sandbox = createFakeSandbox();
  const adapters = createAdapters(config, { sandbox });
  const clock = { now: new Date() };
  const app = createApp(config, adapters, { now: () => clock.now });

  async function call(apiKey: string | null, method: string, path: string, body?: unknown) {
    const res = await app.request(path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, text, body: (text ? JSON.parse(text) : null) as any };
  }

  /** A poster and two runners under one new owner with `credits` starting credits. */
  async function agents(credits = config.STARTING_CREDITS) {
    const ownerId = await createOwner(adapters.db, `owner-${randomUUID()}`, credits);
    const [poster, runner, otherRunner] = await Promise.all([
      createAgent(adapters.db, ownerId, "poster"),
      createAgent(adapters.db, ownerId, "runner"),
      createAgent(adapters.db, ownerId, "runner"),
    ]);
    return {
      ownerId,
      poster: poster.apiKey,
      runner: runner.apiKey,
      otherRunner: otherRunner.apiKey,
    };
  }

  function jobSpec(overrides: Partial<JobSpec> = {}): JobSpec {
    return {
      type: "code.implement",
      runtime: "python",
      title: "Add two numbers",
      spec: "Write add(a, b) in solution.py that returns a + b.",
      public_tests: [
        {
          path: "test_public.py",
          content: "from solution import add\n\ndef test_add():\n    assert add(1, 2) == 3\n",
        },
      ],
      hidden_tests: [
        {
          path: "test_hidden.py",
          content:
            "# HIDDEN_MARKER\nfrom solution import add\n\ndef test_add():\n    assert add(2, 2) == 4\n",
        },
      ],
      reference_solution: [{ path: "solution.py", content: "# REFERENCE_MARKER\n" }],
      budget: 10,
      deadline: new Date(clock.now.getTime() + 24 * 3600_000).toISOString(),
      idempotency_key: randomUUID(),
      ...overrides,
    };
  }

  return { config, adapters, sandbox, app, clock, call, agents, jobSpec };
}
