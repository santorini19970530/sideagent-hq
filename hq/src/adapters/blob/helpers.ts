import type { BlobStore } from "./types.ts";

export async function putJson(blobs: BlobStore, key: string, value: unknown): Promise<string> {
  await blobs.put(key, JSON.stringify(value));
  return key;
}

export async function getText(blobs: BlobStore, key: string): Promise<string> {
  const data = await blobs.get(key);
  if (!data) throw new Error(`Missing blob ${key}`);
  return new TextDecoder().decode(data);
}

export async function getJson<T>(blobs: BlobStore, key: string): Promise<T> {
  return JSON.parse(await getText(blobs, key)) as T;
}
