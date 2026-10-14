import { ApiError } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import { createModelBackend, loadConfig } from "../src/config.ts";
import { createGenAiBackend, toContents } from "../src/model/genai.ts";
import { createOllamaBackend } from "../src/model/ollama.ts";
import type { GenerateRequest, Message } from "../src/model/types.ts";

const TOOL = {
  name: "read_file",
  description: "Read one workspace file.",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
};

const CONVERSATION: Message[] = [
  { role: "user", text: "Start" },
  { role: "model", text: "", calls: [{ id: "c1", name: "read_file", args: { path: "SPEC.md" } }] },
  { role: "tool", results: [{ id: "c1", name: "read_file", output: "spec text" }] },
];

function request(messages: Message[] = CONVERSATION): GenerateRequest {
  return {
    system: "SYSTEM",
    messages,
    tools: [TOOL],
    maxOutputTokens: 100,
    signal: new AbortController().signal,
  };
}

describe("ollama backend", () => {
  it("sends the conversation and tools to /api/chat and reads tool calls back", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            { function: { name: "write_file", arguments: { path: "a.py", content: "x" } } },
          ],
        },
        prompt_eval_count: 40,
        eval_count: 7,
      }),
    );
    const backend = createOllamaBackend({
      model: "gemma4:26b-a4b",
      host: "http://ollama:11434",
      fetch,
    });
    const res = await backend.generate(request());

    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("http://ollama:11434/api/chat");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: "gemma4:26b-a4b",
      stream: false,
      options: { num_predict: 100 },
    });
    expect(body.messages).toEqual([
      { role: "system", content: "SYSTEM" },
      { role: "user", content: "Start" },
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "c1", function: { name: "read_file", arguments: { path: "SPEC.md" } } }],
      },
      { role: "tool", content: "spec text", tool_name: "read_file", tool_call_id: "c1" },
    ]);
    expect(body.tools).toEqual([{ type: "function", function: TOOL }]);
    expect(res).toEqual({
      message: {
        role: "model",
        text: "",
        calls: [{ name: "write_file", args: { path: "a.py", content: "x" } }],
      },
      usage: { inputTokens: 40, outputTokens: 7 },
    });
  });

  it("reports an HTTP error with the model to pull", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response("model not found", { status: 404 }),
    );
    const backend = createOllamaBackend({
      model: "gemma4:26b-a4b",
      host: "http://ollama:11434",
      fetch,
    });
    await expect(backend.generate(request())).rejects.toThrow(
      /404: model not found.*ollama pull gemma4:26b-a4b/,
    );
  });
});

describe("genai backend", () => {
  const reply = {
    candidates: [
      {
        content: {
          role: "model",
          parts: [
            { text: "thinking", thought: true },
            { functionCall: { id: "c2", name: "submit", args: {} }, thoughtSignature: "sig" },
          ],
        },
      },
    ],
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3 },
  };

  it("maps tool calls and results to Gemini contents", () => {
    expect(toContents(CONVERSATION)).toEqual([
      { role: "user", parts: [{ text: "Start" }] },
      {
        role: "model",
        parts: [{ functionCall: { id: "c1", name: "read_file", args: { path: "SPEC.md" } } }],
      },
      {
        role: "user",
        parts: [
          { functionResponse: { id: "c1", name: "read_file", response: { output: "spec text" } } },
        ],
      },
    ]);
  });

  it("keeps the model's own turn, with its thought signature, for the next call", async () => {
    const generateContent = vi.fn(async () => reply);
    const backend = createGenAiBackend("vertex", "gemma", { generateContent } as never);
    const res = await backend.generate(request());
    expect(res.message.calls).toEqual([{ id: "c2", name: "submit", args: {} }]);
    expect(res.message.text).toBe("");
    expect(res.usage).toEqual({ inputTokens: 12, outputTokens: 3 });
    expect(toContents([res.message])).toEqual([reply.candidates[0]!.content]);
  });

  it("retries 429 'queue is full' and gives up on other errors", async () => {
    const generateContent = vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ message: "The request queue is full", status: 429 }))
      .mockResolvedValueOnce(reply);
    const backend = createGenAiBackend("vertex", "gemma", { generateContent } as never, [1]);
    await expect(backend.generate(request())).resolves.toBeDefined();
    expect(generateContent).toHaveBeenCalledTimes(2);

    const failing = vi
      .fn()
      .mockRejectedValue(new ApiError({ message: "bad request", status: 400 }));
    const strict = createGenAiBackend(
      "vertex",
      "gemma",
      { generateContent: failing } as never,
      [1],
    );
    await expect(strict.generate(request())).rejects.toThrow(/bad request/);
    expect(failing).toHaveBeenCalledTimes(1);
  });
});

describe("model config", () => {
  it("defaults to Gemma on Ollama", () => {
    const backend = createModelBackend(loadConfig({}));
    expect([backend.name, backend.model]).toEqual(["ollama", "gemma4:26b-a4b"]);
  });

  it("uses --model over SIDEAGENT_MODEL", () => {
    const config = loadConfig({ SIDEAGENT_MODEL: "gemma4:12b" });
    expect(createModelBackend(config).model).toBe("gemma4:12b");
    expect(createModelBackend(config, "gemma4:e4b").model).toBe("gemma4:e4b");
  });

  it("needs a project for Vertex and a model ID for the Gemini API", () => {
    expect(() => createModelBackend(loadConfig({ SIDEAGENT_MODEL_BACKEND: "vertex" }))).toThrow(
      /GOOGLE_CLOUD_PROJECT/,
    );
    const vertex = createModelBackend(
      loadConfig({ SIDEAGENT_MODEL_BACKEND: "vertex", GOOGLE_CLOUD_PROJECT: "p" }),
    );
    expect(vertex.model).toBe("gemini-2.5-flash-lite");
    expect(() =>
      createModelBackend(
        loadConfig({ SIDEAGENT_MODEL_BACKEND: "gemini-api", GEMINI_API_KEY: "k" }),
      ),
    ).toThrow(/--model or set SIDEAGENT_MODEL/);
  });
});
