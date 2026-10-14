import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Vault } from "./types.ts";

/**
 * `VAULT_BACKEND=local`: AES-256-GCM with a local key. The job ID is bound in as associated
 * data, so a ciphertext copied to another job doesn't decrypt.
 */
export function createLocalVault(key: Buffer): Vault {
  if (key.length !== 32) throw new Error("The local vault key must be 32 bytes");
  return {
    async encrypt(jobId, plaintext) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv).setAAD(Buffer.from(jobId));
      const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
    },
    async decrypt(jobId, ciphertext) {
      const raw = Buffer.from(ciphertext, "base64");
      const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12))
        .setAAD(Buffer.from(jobId))
        .setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    },
  };
}

/** `VAULT_LOCAL_KEY` (base64), else the key in `file`, generated on first use. */
export function loadLocalKey(envKey: string | undefined, file: string): Buffer {
  if (envKey) return Buffer.from(envKey, "base64");
  try {
    return Buffer.from(readFileSync(file, "utf8").trim(), "base64");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const key = randomBytes(32);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, key.toString("base64"), { mode: 0o600, flag: "wx" });
  return key;
}
