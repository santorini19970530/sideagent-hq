import { randomBytes } from "node:crypto";
import type { AgentRole, AgentStatus } from "@sideagent/protocol";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { sha256Hex } from "../hash.ts";

export interface Agent {
  id: string;
  ownerId: string;
  role: AgentRole;
}

/** Creates an agent and returns its API key. Only the hash is stored, so the key is shown once. */
export async function createAgent(
  db: Firestore,
  ownerId: string,
  role: AgentRole,
): Promise<{ agent: Agent; apiKey: string }> {
  const apiKey = `sk_${randomBytes(32).toString("base64url")}`;
  const ref = db.collection("agents").doc();
  await ref.create({
    ownerId,
    role,
    apiKeyHash: sha256Hex(apiKey),
    declaredModels: [],
    status: "active",
    createdAt: FieldValue.serverTimestamp(),
  });
  return { agent: { id: ref.id, ownerId, role }, apiKey };
}

export async function findAgentByApiKey(db: Firestore, apiKey: string): Promise<Agent | null> {
  const snap = await db
    .collection("agents")
    .where("apiKeyHash", "==", sha256Hex(apiKey))
    .limit(1)
    .get();
  const doc = snap.docs[0];
  if (!doc || (doc.get("status") as AgentStatus) !== "active") return null;
  return { id: doc.id, ownerId: doc.get("ownerId"), role: doc.get("role") };
}

/** Revokes one of the owner's agents; its key stops working at once. False if not theirs. */
export async function revokeAgent(db: Firestore, ownerId: string, agentId: string) {
  const ref = db.collection("agents").doc(agentId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.get("ownerId") !== ownerId) return false;
    if (snap.get("status") === "revoked") return true;
    const status: AgentStatus = "revoked";
    tx.update(ref, { status, revokedAt: FieldValue.serverTimestamp() });
    return true;
  });
}
