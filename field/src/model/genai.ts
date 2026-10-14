import { setTimeout as sleep } from "node:timers/promises";
import { ApiError, GoogleGenAI, type Content, type Part } from "@google/genai";
import type {
  GenerateRequest,
  GenerateResponse,
  Message,
  ModelBackend,
  ToolCall,
} from "./types.ts";

// Managed Gemma answered 429 "The request queue is full" on day 1; a retry succeeded.
const RETRY_STATUSES = new Set([429, 503]);
// About 2.5 minutes in all; the queue stayed full for over 30 seconds on day 2.
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000, 30_000];

type Models = Pick<GoogleGenAI["models"], "generateContent">;

export interface VertexOptions {
  model: string;
  project: string;
  location: string;
}

/** `SIDEAGENT_MODEL_BACKEND=vertex`: Gemini on Vertex AI (house runners, D26) with application default credentials. */
export function createVertexBackend({ model, project, location }: VertexOptions): ModelBackend {
  const ai = new GoogleGenAI({ vertexai: true, project, location });
  return createGenAiBackend("vertex", model, ai.models);
}

/** `SIDEAGENT_MODEL_BACKEND=gemini-api`: the Gemini API with an API key (fallback, D17). */
export function createGeminiApiBackend({ model, apiKey }: { model: string; apiKey: string }) {
  const ai = new GoogleGenAI({ apiKey });
  return createGenAiBackend("gemini-api", model, ai.models);
}

export function createGenAiBackend(
  name: string,
  model: string,
  models: Models,
  retryDelaysMs: readonly number[] = RETRY_DELAYS_MS,
): ModelBackend {
  return {
    name,
    model,
    async generate(req: GenerateRequest): Promise<GenerateResponse> {
      const res = await withRetry(
        () =>
          models.generateContent({
            model,
            contents: toContents(req.messages),
            config: {
              systemInstruction: req.system,
              tools: [
                {
                  functionDeclarations: req.tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    parametersJsonSchema: t.parameters,
                  })),
                },
              ],
              maxOutputTokens: req.maxOutputTokens,
              abortSignal: req.signal,
            },
          }),
        retryDelaysMs,
        req.signal,
      );
      const content = res.candidates?.[0]?.content;
      const parts = content?.parts ?? [];
      const calls: ToolCall[] = parts.flatMap((p) =>
        p.functionCall?.name
          ? [
              {
                ...(p.functionCall.id ? { id: p.functionCall.id } : {}),
                name: p.functionCall.name,
                args: p.functionCall.args ?? {},
              },
            ]
          : [],
      );
      const text = parts
        .filter((p) => p.text && !p.thought)
        .map((p) => p.text)
        .join("");
      return {
        message: { role: "model", text, calls, raw: content },
        usage: {
          inputTokens: res.usageMetadata?.promptTokenCount ?? 0,
          // Thinking tokens are billed but not part of candidatesTokenCount.
          outputTokens:
            (res.usageMetadata?.candidatesTokenCount ?? 0) +
            (res.usageMetadata?.thoughtsTokenCount ?? 0),
        },
      };
    },
  };
}

export function toContents(messages: Message[]): Content[] {
  return messages.map((m): Content => {
    switch (m.role) {
      case "user":
        return { role: "user", parts: [{ text: m.text }] };
      case "model": {
        // The original turn keeps thought signatures, which Gemini 3 needs on later calls.
        if (m.raw) return m.raw as Content;
        const parts: Part[] = m.text ? [{ text: m.text }] : [];
        for (const c of m.calls) {
          parts.push({
            functionCall: { ...(c.id ? { id: c.id } : {}), name: c.name, args: c.args },
          });
        }
        return { role: "model", parts };
      }
      case "tool":
        return {
          role: "user",
          parts: m.results.map((r) => ({
            functionResponse: {
              ...(r.id ? { id: r.id } : {}),
              name: r.name,
              response: { output: r.output },
            },
          })),
        };
    }
  });
}

async function withRetry<T>(
  call: () => Promise<T>,
  delaysMs: readonly number[],
  signal: AbortSignal,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      const delay = delaysMs[attempt];
      if (!(err instanceof ApiError && RETRY_STATUSES.has(err.status)) || delay === undefined) {
        throw err;
      }
      await sleep(delay, undefined, { signal });
    }
  }
}
