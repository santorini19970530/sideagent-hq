import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { accounts, transfer } from "../ledger/ledger.ts";

/** Creates an owner with a generated ID and starting credits (D24): seed script and tests. */
export async function createOwner(
  db: Firestore,
  displayName: string,
  credits: number,
): Promise<string> {
  const ownerId = db.collection("owners").doc().id;
  await ensureOwner(db, ownerId, displayName, credits);
  return ownerId;
}

/**
 * Creates `owners/{ownerId}` with starting credits unless it exists. Mission control calls it on
 * every sign-in with the Firebase Auth UID (D28), so the grant is paid once.
 */
export async function ensureOwner(
  db: Firestore,
  ownerId: string,
  displayName: string,
  credits: number,
): Promise<{ displayName: string; created: boolean }> {
  const owner = db.collection("owners").doc(ownerId);
  const existing = await owner.get();
  if (existing.exists)
    return { displayName: existing.get("displayName") as string, created: false };
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(owner);
    if (snap.exists) return { displayName: snap.get("displayName") as string, created: false };
    tx.create(owner, {
      displayName,
      policies: { budgetCap: null, allowedTypes: [], approvalThreshold: null },
      killSwitch: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    const grant = {
      from: accounts.grants,
      to: accounts.owner(ownerId),
      amount: credits,
      jobId: null,
      reason: "Starting credits",
    };
    transfer(tx, db, grant, Timestamp.now());
    return { displayName, created: true };
  });
}
