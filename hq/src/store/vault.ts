import { Timestamp, type Firestore } from "firebase-admin/firestore";
import type { PlaceholderMap } from "../adapters/redactor/redact.ts";
import type { Vault } from "../adapters/vault/types.ts";

// `vault/{jobId}`: a job's placeholder map, encrypted. HQ only; mission control can't read it.

function vaultRef(db: Firestore, jobId: string) {
  return db.collection("vault").doc(jobId);
}

export async function loadPlaceholders(
  db: Firestore,
  vault: Vault,
  jobId: string,
): Promise<PlaceholderMap> {
  const snap = await vaultRef(db, jobId).get();
  const ciphertext = snap.get("ciphertext") as string | undefined;
  return ciphertext ? (JSON.parse(await vault.decrypt(jobId, ciphertext)) as PlaceholderMap) : {};
}

export async function savePlaceholders(
  db: Firestore,
  vault: Vault,
  jobId: string,
  map: PlaceholderMap,
): Promise<void> {
  if (!Object.keys(map).length) return;
  const ciphertext = await vault.encrypt(jobId, JSON.stringify(map));
  await vaultRef(db, jobId).set({ ciphertext, updatedAt: Timestamp.now() });
}
