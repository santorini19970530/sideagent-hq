import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalBlobStore } from "../src/adapters/blob/local.ts";

describe("local BlobStore", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sideagent-blobs-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips, overwrites and deletes", async () => {
    const blobs = createLocalBlobStore(dir);
    await blobs.put("jobs/j1/spec.md", "hello");
    expect(new TextDecoder().decode((await blobs.get("jobs/j1/spec.md"))!)).toBe("hello");
    await blobs.put("jobs/j1/spec.md", "again");
    expect(new TextDecoder().decode((await blobs.get("jobs/j1/spec.md"))!)).toBe("again");
    await blobs.delete("jobs/j1/spec.md");
    expect(await blobs.get("jobs/j1/spec.md")).toBeNull();
  });

  it("allows keys that only start with dots", async () => {
    const blobs = createLocalBlobStore(dir);
    await blobs.put("..notes", "x");
    expect(await blobs.get("..notes")).not.toBeNull();
  });

  it("returns null for missing keys", async () => {
    expect(await createLocalBlobStore(dir).get("missing")).toBeNull();
  });

  it.each(["../outside", "a/../../outside", "/etc/passwd", ""])("rejects key %j", async (key) => {
    await expect(createLocalBlobStore(dir).put(key, "x")).rejects.toThrow(/escapes/);
  });
});
