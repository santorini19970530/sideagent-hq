import { ApiError } from "@sideagent/protocol";
import { describe, expect, it } from "vitest";
import { createAdapters } from "../src/adapters/index.ts";
import { loadConfig } from "../src/config.ts";
import { createHarness } from "./harness.ts";

const { app } = createHarness();

describe("HQ app", () => {
  it("answers /healthz", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns a typed error for unknown routes", async () => {
    const res = await app.request("/nope");
    expect(res.status).toBe(404);
    const body = ApiError.parse(await res.json());
    expect(body.code).toBe("not_found");
  });
});

describe("createAdapters", () => {
  it("refuses a cloud backend without its variables", () => {
    const env = { FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST };
    expect(() => createAdapters(loadConfig({ ...env, BLOB_BACKEND: "gcs" }))).toThrow(
      "BLOB_BACKEND=gcs needs JOBS_BUCKET",
    );
  });

  it("refuses the demo project without the Firestore emulator", () => {
    expect(() => createAdapters(loadConfig({}))).toThrow(/emulator/);
  });
});
