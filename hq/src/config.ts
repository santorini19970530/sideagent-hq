import { z } from "zod";

// Local defaults for every adapter (D19). Production values arrive in Phase 7.
const Config = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  BLOB_BACKEND: z.enum(["local", "gcs"]).default("local"),
  BLOB_LOCAL_DIR: z.string().default(".data/blobs"),
  PIPELINE_MODE: z.enum(["inline", "cloud-tasks"]).default("inline"),
  SANDBOX_MODE: z.enum(["local", "docker", "cloud-run-job"]).default("local"),
  GCP_PROJECT: z.string().default("demo-sideagent"),
  // Set by `firebase emulators:exec`; the `dev` script points it at `pnpm emulators`.
  FIRESTORE_EMULATOR_HOST: z.string().optional(),
  CLAIM_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
  CLAIM_ATTEMPTS: z.coerce.number().int().positive().default(3),
});
export type Config = z.infer<typeof Config>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return Config.parse(env);
}
