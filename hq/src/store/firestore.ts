import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import type { Config } from "../config.ts";

function firebaseApp(config: Config): App {
  const name = config.GCP_PROJECT;
  return (
    getApps().find((a) => a.name === name) ?? initializeApp({ projectId: config.GCP_PROJECT }, name)
  );
}

export function createFirestore(config: Config): Firestore {
  // Emulator only until Phase 7 (D19). firebase-admin reads the host from the environment.
  if (!config.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      "Firestore is emulator-only until Phase 7: run `pnpm emulators` and set FIRESTORE_EMULATOR_HOST",
    );
  }
  process.env.FIRESTORE_EMULATOR_HOST = config.FIRESTORE_EMULATOR_HOST;
  return getFirestore(firebaseApp(config));
}

/**
 * Verifies mission control's Firebase ID tokens. Emulator only until Phase 7 (D19); without the
 * emulator there is no Auth and the owner API refuses every call.
 */
export function createAuth(config: Config): Auth | null {
  if (!config.FIREBASE_AUTH_EMULATOR_HOST) return null;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = config.FIREBASE_AUTH_EMULATOR_HOST;
  return getAuth(firebaseApp(config));
}
