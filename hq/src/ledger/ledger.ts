import {
  FieldValue,
  type DocumentSnapshot,
  type Firestore,
  type Timestamp,
  type Transaction,
} from "firebase-admin/firestore";
import { HqError } from "../errors.ts";

// Double-entry, append-only ledger (technical.md, "Ledger"). Every transfer writes one entry and
// moves the same amount between two balances, so the sum of all balances never changes.
// `platform:grants` goes negative by the credits it hands out.

export const accounts = {
  owner: (ownerId: string) => `owner:${ownerId}`,
  escrow: (jobId: string) => `escrow:${jobId}`,
  stake: (jobId: string, agentId: string) => `stake:${jobId}:${agentId}`,
  fees: "platform:fees",
  grants: "platform:grants",
} as const;

export interface Transfer {
  from: string;
  to: string;
  amount: number;
  jobId: string | null;
  reason: string;
}

function balanceRef(db: Firestore, account: string) {
  return db.collection("balances").doc(account);
}

function amountOf(snap: DocumentSnapshot): number {
  return (snap.get("amount") as number | undefined) ?? 0;
}

/** Reads a balance inside a transaction. Firestore needs every read before the first write. */
export async function balanceInTx(tx: Transaction, db: Firestore, account: string) {
  return amountOf(await tx.get(balanceRef(db, account)));
}

export async function balanceOf(db: Firestore, account: string): Promise<number> {
  return amountOf(await balanceRef(db, account).get());
}

/** Throws `insufficient_credits` unless `balance` covers `amount`. */
export function requireCredits(balance: number, amount: number, what: string): void {
  if (balance < amount) {
    throw new HqError(
      "insufficient_credits",
      `${what} needs ${amount} credits; your owner has ${balance}`,
      "Ask your owner for more credits, or lower the amount",
    );
  }
}

/** Writes an entry and both balance changes. Needs no reads, so it can follow other writes. */
export function transfer(tx: Transaction, db: Firestore, t: Transfer, at: Timestamp): void {
  if (t.amount <= 0) return;
  tx.create(db.collection("ledger").doc(), { ...t, createdAt: at });
  for (const [account, delta] of [
    [t.from, -t.amount],
    [t.to, t.amount],
  ] as const) {
    tx.set(
      balanceRef(db, account),
      { amount: FieldValue.increment(delta), updatedAt: at },
      { merge: true },
    );
  }
}

/** Stake held on claim: a share of the budget, at least 1 credit. */
export function stakeFor(budget: number, stakePercent: number): number {
  return Math.max(1, Math.ceil((budget * stakePercent) / 100));
}
