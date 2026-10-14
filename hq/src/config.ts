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
  CLAIM_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
  CLAIM_ATTEMPTS: z.coerce.number().int().positive().default(3),
  // Credit amounts (D24).
  STARTING_CREDITS: z.coerce.number().int().nonnegative().default(100),
  STAKE_PERCENT: Percent.default(20),
  TIMEOUT_SLASH_PERCENT: Percent.default(50),
});
export type Config = z.infer<typeof Config>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return Config.parse(env);
}
