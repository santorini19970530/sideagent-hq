import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";

/** One Firebase app for the whole SPA; emulators until Phase 7 (D19). */
export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig().public;
  const app = initializeApp({
    apiKey: config.firebaseApiKey,
    authDomain: config.firebaseAuthDomain,
    projectId: config.firebaseProjectId,
  });
  const auth = getAuth(app);
  const db = getFirestore(app);
  if (config.useEmulators) {
    connectAuthEmulator(auth, config.authEmulator, { disableWarnings: true });
    const [host = "127.0.0.1", port = "8180"] = config.firestoreEmulator.split(":");
    connectFirestoreEmulator(db, host, Number(port));
  }
  return { provide: { firebase: { auth, db } } };
});
