import { setTimeout as sleep } from "node:timers/promises";
import { ApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { Config } from "../config.ts";

// Same retry policy as the field CLI's Gemini backend: Vertex answers 429 when busy.
const RETRY_STATUSES = new Set([429, 503]);
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000];

export interface GenerateJson<T> {
  /** Which platform agent is asking; fakes in tests answer by name. */
  agent: string;
  model: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxOutputTokens: number;
  /** Ask for logprobs, which become the answer's confidence. */
  logprobs?: boolean;
  /** Caps thinking tokens on models that think (Gemini 2.5 Flash and later). */
  thinkingBudget?: number;
}

export interface JsonAnswer<T> {
  value: T;
  /** `exp(avgLogprobs)` when the model returned logprobs. */
  confidence: number | null;
}

/** Gemini structured output for HQ's platform agents. Model IDs come from config. */
export interface PlatformModel {
  generateJson<T>(req: GenerateJson<T>): Promise<JsonAnswer<T>>;
}

type Models = Pick<GoogleGenAI["models"], "generateContent">;

export function createGenAiModel(models: Models, delaysMs = RETRY_DELAYS_MS): PlatformModel {
  return {
    async generateJson({
      model,
      system,
      prompt,
      schema,
      maxOutputTokens,
      logprobs,
      thinkingBudget,
    }) {
      const res = await withRetry(
        () =>
          models.generateContent({
            model,
            contents: prompt,
            config: {
              systemInstruction: system,
              responseMimeType: "application/json",
              responseJsonSchema: z.toJSONSchema(schema),
              temperature: 0,
              maxOutputTokens,
              ...(logprobs ? { responseLogprobs: true } : {}),
              ...(thinkingBudget !== undefined ? { thinkingConfig: { thinkingBudget } } : {}),
            },
          }),
        delaysMs,
      );
      const value = schema.parse(JSON.parse(res.text ?? ""));
      const avg = res.candidates?.[0]?.avgLogprobs;
      return { value, confidence: typeof avg === "number" ? Math.exp(avg) : null };
    },
  };
}

/**
 * The model chosen by `PLATFORM_MODEL_BACKEND`. Built on first use, so HQ starts (and the seed
 * script runs) without model credentials; a screening step without them throws and is retried.
 */
export function createPlatformModel(config: Config): PlatformModel {
  let model: PlatformModel | null = null;
  return {
    generateJson(req) {
      model ??= createGenAiModel(genAi(config).models);
      return model.generateJson(req);
    },
  };
}

function genAi(config: Config): GoogleGenAI {
  if (config.PLATFORM_MODEL_BACKEND === "gemini-api") {
    if (!config.GEMINI_API_KEY) throw new Error("Set GEMINI_API_KEY for PLATFORM_MODEL_BACKEND");
    return new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  }
  if (!config.GOOGLE_CLOUD_PROJECT) {
    throw new Error("Set GOOGLE_CLOUD_PROJECT for screening on Vertex AI");
  }
  return new GoogleGenAI({
    vertexai: true,
    project: config.GOOGLE_CLOUD_PROJECT,
    location: config.GOOGLE_CLOUD_LOCATION,
  });
}

async function withRetry<T>(call: () => Promise<T>, delaysMs: readonly number[]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      const delay = delaysMs[attempt];
      if (!(err instanceof ApiError && RETRY_STATUSES.has(err.status)) || delay === undefined) {
        throw err;
      }
      await sleep(delay);
    }
  }
}
