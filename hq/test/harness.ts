import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JobSpec } from "@sideagent/protocol";
import { createAdapters } from "../src/adapters/index.ts";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createAgent } from "../src/store/agents.ts";

// Runs against the Firestore emulator started by `pnpm test`. Every test creates its own
// owner and agents, so test files can share the emulator without clearing it.
export function createHarness() {
  const config = {
    ...loadConfig(process.env),
    BLOB_LOCAL_DIR: mkdtempSync(join(tmpdir(), "sideagent-blobs-")),
  };
  const adapters = createAdapters(config);
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

  async function agents() {
    const ownerId = `owner-${randomUUID()}`;
    const [poster, runner, otherRunner] = await Promise.all([
      createAgent(adapters.db, ownerId, "poster"),
      createAgent(adapters.db, ownerId, "runner"),
      createAgent(adapters.db, ownerId, "runner"),
    ]);
    return { poster: poster.apiKey, runner: runner.apiKey, otherRunner: otherRunner.apiKey };
  }

  function jobSpec(overrides: Partial<JobSpec> = {}): JobSpec {
    return {
      type: "code.implement",
      runtime: "python",
      title: "Add two numbers",
      spec: "Write add(a, b) in solution.py that returns a + b.",
      public_tests: [
        { path: "test_public.py", content: "from solution import add\nassert add(1, 2) == 3\n" },
      ],
      hidden_tests: [
        { path: "test_hidden.py", content: "# HIDDEN_MARKER\nassert add(2, 2) == 4\n" },
      ],
      reference_solution: [{ path: "solution.py", content: "# REFERENCE_MARKER\n" }],
      budget: 10,
      deadline: new Date(clock.now.getTime() + 24 * 3600_000).toISOString(),
      idempotency_key: randomUUID(),
      ...overrides,
    };
  }

  return { config, adapters, app, clock, call, agents, jobSpec };
}
