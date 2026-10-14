import type { protos } from "@google-cloud/kms";
import type { Vault } from "./types.ts";

/** The part of `KeyManagementServiceClient` the vault uses, so tests can pass a fake. */
export interface KmsClient {
  encrypt(
    request: protos.google.cloud.kms.v1.IEncryptRequest,
  ): Promise<[protos.google.cloud.kms.v1.IEncryptResponse, ...unknown[]]>;
  decrypt(
    request: protos.google.cloud.kms.v1.IDecryptRequest,
  ): Promise<[protos.google.cloud.kms.v1.IDecryptResponse, ...unknown[]]>;
}

function bytes(value: Uint8Array | string | null | undefined, what: string): Buffer {
  if (value === null || value === undefined) throw new Error(`Cloud KMS returned no ${what}`);
  return typeof value === "string" ? Buffer.from(value, "base64") : Buffer.from(value);
}

/**
 * `VAULT_BACKEND=kms`: the placeholder map is encrypted directly with the Cloud KMS key
 * (`KMS_KEY`). Like the local vault, the job ID is bound in as additional authenticated data, so
 * a ciphertext copied to another job doesn't decrypt.
 */
export function createKmsVault(client: KmsClient, keyName: string): Vault {
  return {
    async encrypt(jobId, plaintext) {
      const [res] = await client.encrypt({
        name: keyName,
        plaintext: Buffer.from(plaintext, "utf8"),
        additionalAuthenticatedData: Buffer.from(jobId),
      });
      return bytes(res.ciphertext, "ciphertext").toString("base64");
    },
    async decrypt(jobId, ciphertext) {
      const [res] = await client.decrypt({
        name: keyName,
        ciphertext: Buffer.from(ciphertext, "base64"),
        additionalAuthenticatedData: Buffer.from(jobId),
      });
      return bytes(res.plaintext, "plaintext").toString("utf8");
    },
  };
}
