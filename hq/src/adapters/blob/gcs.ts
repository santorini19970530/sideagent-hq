import type { Bucket } from "@google-cloud/storage";
import type { BlobStore } from "./types.ts";

/** A blob store with folders, for the sandbox's mounted check folders. */
export interface PrefixBlobStore extends BlobStore {
  /** Writes a folder marker (`<dir>/`), so a Cloud Storage FUSE mount lists the folder. */
  putDir(dir: string): Promise<void>;
  /** Deletes every object under `<prefix>/`. */
  deletePrefix(prefix: string): Promise<void>;
  /** Deletes every object in the bucket. */
  clear(): Promise<void>;
}

function objectName(key: string): string {
  // Same rule as the local store: keys are relative paths that stay inside the store.
  if (!key || key.startsWith("/") || key.split("/").some((part) => part === ".." || !part)) {
    throw new Error(`Invalid blob key: ${key}`);
  }
  return key;
}

/** `BLOB_BACKEND=gcs`: one object per key in `bucket` (JOBS_BUCKET). */
export function createGcsBlobStore(bucket: Bucket): PrefixBlobStore {
  return {
    async put(key, data) {
      await bucket.file(objectName(key)).save(typeof data === "string" ? data : Buffer.from(data), {
        resumable: false,
      });
    },
    async get(key) {
      try {
        const [data] = await bucket.file(objectName(key)).download();
        return new Uint8Array(data);
      } catch (err) {
        if ((err as { code?: number }).code === 404) return null;
        throw err;
      }
    },
    async delete(key) {
      await bucket.file(objectName(key)).delete({ ignoreNotFound: true });
    },
    async putDir(dir) {
      await bucket.file(`${objectName(dir)}/`).save("", { resumable: false });
    },
    async deletePrefix(prefix) {
      await bucket.deleteFiles({ prefix: `${objectName(prefix)}/`, force: true });
    },
    async clear() {
      await bucket.deleteFiles({ force: true });
    },
  };
}
