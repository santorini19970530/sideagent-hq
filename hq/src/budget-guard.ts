import { serve } from "@hono/node-server";
import { GoogleAuth } from "google-auth-library";
import {
  cloudBillingOff,
  BudgetGuardConfig,
  createBudgetGuardApp,
  firestorePause,
} from "./budget/guard.ts";
import { loadConfig } from "./config.ts";
import { createGoogleIdTokenVerifier } from "./oidc.ts";
import { createFirestore } from "./store/firestore.ts";

// The budget guard service (D32), from the HQ image: `node --import tsx hq/src/budget-guard.ts`.
const config = BudgetGuardConfig.parse(process.env);
const db = createFirestore(loadConfig());
const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });

const app = createBudgetGuardApp(config, {
  verifier: createGoogleIdTokenVerifier(),
  actions: {
    pause: firestorePause(db),
    billingOff: cloudBillingOff(auth, config.GCP_PROJECT),
  },
});

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`budget guard listening on port ${info.port}${config.DRY_RUN ? " (DRY_RUN)" : ""}`);
});
