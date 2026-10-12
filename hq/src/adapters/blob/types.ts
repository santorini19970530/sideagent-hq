export interface BlobStore {
  put(key: string, data: Uint8Array | string): Promise<void>;
  /** Returns null when the key does not exist. */
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}
