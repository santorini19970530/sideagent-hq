import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { accounts, transfer } from "../ledger/ledger.ts";

/** Creates an owner with starting credits (D24). Replaced by sign-up in mission control (Phase 4). */
export async function createOwner(
  db: Firestore,
  displayName: string,
  credits: number,
): Promise<string> {
  const owner = db.collection("owners").doc();
  await db.runTransaction(async (tx) => {
    tx.create(owner, {
      displayName,
      policies: { budgetCap: null, allowedTypes: [], approvalThreshold: null },
      killSwitch: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    const grant = {
      from: accounts.grants,
      to: accounts.owner(owner.id),
      amount: credits,
      jobId: null,
      reason: "Starting credits",
    };
    transfer(tx, db, grant, Timestamp.now());
  });
  return owner.id;
}
