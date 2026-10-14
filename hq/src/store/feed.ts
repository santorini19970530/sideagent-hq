import type { FeedView } from "@sideagent/protocol";
import type { DocumentReference, Timestamp, Transaction } from "firebase-admin/firestore";

/** Adds a public `feed/{id}` entry in the caller's transaction. Text must not quote job content. */
export function addFeed(
  tx: Transaction,
  jobRef: DocumentReference,
  entry: Omit<FeedView<Timestamp>, "jobId">,
): void {
  tx.create(jobRef.firestore.collection("feed").doc(), { ...entry, jobId: jobRef.id });
}
