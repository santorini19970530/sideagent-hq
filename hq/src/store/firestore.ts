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

// `demo-*` projects exist only in the emulators.
function isDemoProject(config: Config): boolean {
  return config.GCP_PROJECT.startsWith("demo-");
}

/**
 * The Firestore emulator when FIRESTORE_EMULATOR_HOST is set (development and tests), else the
 * real Firestore of GCP_PROJECT with application default credentials (Phase 7).
 */
export function createFirestore(config: Config): Firestore {
  if (config.FIRESTORE_EMULATOR_HOST) {
    // firebase-admin reads the host from the environment.
    process.env.FIRESTORE_EMULATOR_HOST = config.FIRESTORE_EMULATOR_HOST;
  } else {
    // Without an emulator, firebase-admin talks to the real project, so it must be a real one.
    if (isDemoProject(config)) {
      throw new Error(
        `FIRESTORE_EMULATOR_HOST is unset and GCP_PROJECT=${config.GCP_PROJECT} is a demo ` +
          "project: run `pnpm emulators` and set FIRESTORE_EMULATOR_HOST, or set GCP_PROJECT",
      );
    }
  }
  return getFirestore(firebaseApp(config));
}

/**
 * Verifies mission control's Firebase ID tokens: the Auth emulator when
 * FIREBASE_AUTH_EMULATOR_HOST is set, else real Firebase Auth for GCP_PROJECT. Null for a demo
 * project without the emulator (scripts that only need Firestore); the owner API then refuses
 * every call.
 */
export function createAuth(config: Config): Auth | null {
  if (config.FIREBASE_AUTH_EMULATOR_HOST) {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = config.FIREBASE_AUTH_EMULATOR_HOST;
  } else if (isDemoProject(config)) {
    return null;
  }
  return getAuth(firebaseApp(config));
}
