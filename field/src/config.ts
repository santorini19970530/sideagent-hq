import { z } from "zod";
import { createGeminiApiBackend, createVertexBackend } from "./model/genai.ts";
import { createOllamaBackend } from "./model/ollama.ts";
import type { ModelBackend } from "./model/types.ts";

// Used when neither --model nor SIDEAGENT_MODEL is set. The Gemini API offers different model
// IDs from Vertex (day 1 checks), so it has no default and must be configured.
const DEFAULT_MODELS = {
  ollama: "gemma4:26b-a4b",
  // House runners (D26): managed Gemma kept answering 429 "queue is full".
  vertex: "gemini-2.5-flash-lite",
  "gemini-api": undefined,
} as const;

export const Config = z.object({
  SIDEAGENT_MODEL_BACKEND: z.enum(["ollama", "vertex", "gemini-api"]).default("ollama"),
  SIDEAGENT_MODEL: z.string().min(1).optional(),
  SIDEAGENT_SANDBOX_IMAGE: z.string().default("sideagent-sandbox-python:dev"),
  // Ollama's own variable; it may omit the scheme, e.g. `0.0.0.0:11434`.
  OLLAMA_HOST: z.string().default("http://127.0.0.1:11434"),
  GOOGLE_CLOUD_PROJECT: z.string().optional(),
  GOOGLE_CLOUD_LOCATION: z.string().default("global"),
  GEMINI_API_KEY: z.string().optional(),
});
export type Config = z.infer<typeof Config>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return Config.parse(env);
}

/** The backend chosen by `SIDEAGENT_MODEL_BACKEND`, with `--model` taking precedence over SIDEAGENT_MODEL. */
export function createModelBackend(config: Config, modelOverride?: string): ModelBackend {
  const backend = config.SIDEAGENT_MODEL_BACKEND;
  const model = modelOverride ?? config.SIDEAGENT_MODEL ?? DEFAULT_MODELS[backend];
  if (!model) throw new Error(`Pass --model or set SIDEAGENT_MODEL for the ${backend} backend`);
  switch (backend) {
    case "ollama": {
      const host = /^https?:\/\//.test(config.OLLAMA_HOST)
        ? config.OLLAMA_HOST
        : `http://${config.OLLAMA_HOST}`;
      return createOllamaBackend({ model, host });
    }
    case "vertex": {
      const project = config.GOOGLE_CLOUD_PROJECT;
      if (!project) throw new Error("Set GOOGLE_CLOUD_PROJECT for the vertex backend");
      return createVertexBackend({ model, project, location: config.GOOGLE_CLOUD_LOCATION });
    }
    case "gemini-api": {
      const apiKey = config.GEMINI_API_KEY;
      if (!apiKey) throw new Error("Set GEMINI_API_KEY for the gemini-api backend");
      return createGeminiApiBackend({ model, apiKey });
    }
  }
}
