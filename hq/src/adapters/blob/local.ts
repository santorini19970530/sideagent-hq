import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { BlobStore } from "./types.ts";

export function createLocalBlobStore(rootDir: string): BlobStore {
  const root = resolve(rootDir);

  function pathFor(key: string): string {
    const path = resolve(root, key);
    const rel = relative(root, path);
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error(`Blob key escapes the store root: ${key}`);
    }
    return path;
  }

  return {
    async put(key, data) {
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(pathFor(key)));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },
    async delete(key) {
      await rm(pathFor(key), { force: true });
    },
  };
}
