import { ModelBackendName } from "@sideagent/protocol";
import { z } from "zod";

const Percent = z.coerce.number().int().min(0).max(100);

// Local defaults for every adapter (D19). Production values arrive in Phase 7.
const Config = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  BLOB_BACKEND: z.enum(["local", "gcs"]).default("local"),
  BLOB_LOCAL_DIR: z.string().default(".data/blobs"),
  PIPELINE_MODE: z.enum(["inline", "cloud-tasks"]).default("inline"),
  SANDBOX_MODE: z.enum(["docker", "cloud-run-job"]).default("docker"),
  SANDBOX_IMAGE: z.string().default("sideagent-sandbox-python:dev"),
  // Host-side cap on one check run; run_checks.py enforces the per-category timeouts itself.
  SANDBOX_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(600),
  GCP_PROJECT: z.string().default("demo-sideagent"),
  // Set by `firebase emulators:exec`; the `dev` script points it at `pnpm emulators`.
  FIRESTORE_EMULATOR_HOST: z.string().optional(),
  // Same for the Auth emulator, which issues mission control's sign-in tokens.
  FIREBASE_AUTH_EMULATOR_HOST: z.string().optional(),
  // Mission control's origin, allowed by CORS on the owner API.
  CONTROL_ORIGIN: z.string().default("http://localhost:3000"),
  CLAIM_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
  CLAIM_ATTEMPTS: z.coerce.number().int().positive().default(3),
  // Credit amounts (D24).
  STARTING_CREDITS: z.coerce.number().int().nonnegative().default(100),
  STAKE_PERCENT: Percent.default(20),
  TIMEOUT_SLASH_PERCENT: Percent.default(50),
  // House runners (D20): `local` starts the field CLI as a child process per job.
  HOUSE_RUNNERS: z.enum(["off", "local", "cloud-run-job"]).default("off"),
  // Runner key from `pnpm --filter @sideagent/hq seed`; Secret Manager in Phase 7 (D17).
  HOUSE_RUNNER_API_KEY: z.string().min(1).optional(),
  HOUSE_RUNNER_MODEL_BACKEND: ModelBackendName.default("vertex"),
  HOUSE_RUNNER_MODEL: z.string().min(1).optional(),
  HOUSE_RUNNER_MAX: z.coerce.number().int().positive().default(2),
  // Demo double agent (Phase 5): dispatched instead of the honest runner, with its own key.
  HOUSE_RUNNER_DOUBLE_AGENT: z.stringbool().default(false),
  HOUSE_RUNNER_DOUBLE_AGENT_API_KEY: z.string().min(1).optional(),
  // Platform agents (screener, trap writer, result screener): triage, then escalate below
  // ESCALATE_BELOW confidence. Same project and location variables as the field CLI.
  PLATFORM_MODEL_BACKEND: z.enum(["vertex", "gemini-api"]).default("vertex"),
  MODEL_TRIAGE: z.string().min(1).default("gemini-2.5-flash-lite"),
  MODEL_ESCALATE: z.string().min(1).default("gemini-2.5-flash"),
  ESCALATE_BELOW: z.coerce.number().min(0).max(1).default(0.8),
  GOOGLE_CLOUD_PROJECT: z.string().min(1).optional(),
  GOOGLE_CLOUD_LOCATION: z.string().default("global"),
  GEMINI_API_KEY: z.string().min(1).optional(),
  // Held with the budget on post; paid to platform fees once screening runs (D30).
  SCREENING_FEE: z.coerce.number().int().nonnegative().default(1),
  // Trap failures before a runner is burned (D29).
  TRAP_BURN_AFTER: z.coerce.number().int().positive().default(1),
  REDACTOR_BACKEND: z.enum(["pattern", "dlp"]).default("pattern"),
  VAULT_BACKEND: z.enum(["local", "kms"]).default("local"),
  // Local vault key: base64 of 32 bytes. Without it, one is generated into VAULT_LOCAL_KEY_FILE.
  VAULT_LOCAL_KEY: z.string().min(1).optional(),
  VAULT_LOCAL_KEY_FILE: z.string().default(".data/vault.key"),
});
export type Config = z.infer<typeof Config>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return Config.parse(env);
}
