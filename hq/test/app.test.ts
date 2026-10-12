import { ApiError } from "@sideagent/protocol";
import { describe, expect, it } from "vitest";
import { createAdapters } from "../src/adapters/index.ts";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";

const app = createApp(createAdapters(loadConfig({})));

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
  it("refuses cloud backends before Phase 7", () => {
    expect(() => createAdapters(loadConfig({ BLOB_BACKEND: "gcs" }))).toThrow(/Phase 7/);
  });
});
