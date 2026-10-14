import { z } from "zod";

/** Model backends a field runner can use (`SIDEAGENT_MODEL_BACKEND`); HQ picks one for house runners. */
export const ModelBackendName = z.enum(["ollama", "vertex", "gemini-api"]);
export type ModelBackendName = z.infer<typeof ModelBackendName>;
