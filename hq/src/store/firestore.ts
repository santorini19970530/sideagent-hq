import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import type { Config } from "../config.ts";

export function createFirestore(config: Config): Firestore {
  // Emulator only until Phase 7 (D19). firebase-admin reads the host from the environment.
  if (!config.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      "Firestore is emulator-only until Phase 7: run `pnpm emulators` and set FIRESTORE_EMULATOR_HOST",
    );
  }
  process.env.FIRESTORE_EMULATOR_HOST = config.FIRESTORE_EMULATOR_HOST;
  const name = config.GCP_PROJECT;
  const app =
    getApps().find((a) => a.name === name) ??
    initializeApp({ projectId: config.GCP_PROJECT }, name);
  return getFirestore(app);
}
