/** Encrypts placeholder maps for `vault/{jobId}`: a local key in development, Cloud KMS in production. */
export interface Vault {
  encrypt(jobId: string, plaintext: string): Promise<string>;
  decrypt(jobId: string, ciphertext: string): Promise<string>;
}
