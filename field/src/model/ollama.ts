import type {
  GenerateRequest,
  GenerateResponse,
  Message,
  ModelBackend,
  ToolCall,
} from "./types.ts";

/** Context window asked of Ollama; its default is too small for a spec, tests and a few turns. */
const NUM_CTX = 32_768;

interface OllamaToolCall {
  id?: string;
  function: { name: string; arguments: Record<string, unknown> };
}

interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
  tool_call_id?: string;
}

interface OllamaChatResponse {
  message: OllamaMessage;
  prompt_eval_count?: number;
  eval_count?: number;
}

export interface OllamaOptions {
  model: string;
  host: string;
  fetch?: typeof fetch;
}

/** `SIDEAGENT_MODEL_BACKEND=ollama`: local Gemma through Ollama's `/api/chat` with tools. */
export function createOllamaBackend({
  model,
  host,
  fetch = globalThis.fetch,
}: OllamaOptions): ModelBackend {
  return {
    name: "ollama",
    model,
    async generate(req: GenerateRequest): Promise<GenerateResponse> {
      const res = await fetch(new URL("/api/chat", host), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          messages: [{ role: "system", content: req.system }, ...req.messages.flatMap(toOllama)],
          tools: req.tools.map((t) => ({ type: "function", function: t })),
          options: { num_ctx: NUM_CTX, num_predict: req.maxOutputTokens },
        }),
        signal: req.signal,
      });
      if (!res.ok) {
        const body = (await res.text()).slice(0, 500);
        throw new Error(
          `Ollama returned ${res.status}: ${body}. Is \`ollama pull ${model}\` done?`,
        );
      }
      const data = (await res.json()) as OllamaChatResponse;
      const calls: ToolCall[] = (data.message.tool_calls ?? []).map((c) => ({
        ...(c.id ? { id: c.id } : {}),
        name: c.function.name,
        args: c.function.arguments ?? {},
      }));
      return {
        message: { role: "model", text: data.message.content ?? "", calls },
        usage: { inputTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0 },
      };
    },
  };
}

function toOllama(message: Message): OllamaMessage[] {
  switch (message.role) {
    case "user":
      return [{ role: "user", content: message.text }];
    case "model":
      return [
        {
          role: "assistant",
          content: message.text,
          tool_calls: message.calls.map((c) => ({
            ...(c.id ? { id: c.id } : {}),
            function: { name: c.name, arguments: c.args },
          })),
        },
      ];
    case "tool":
      return message.results.map((r) => ({
        role: "tool",
        content: r.output,
        tool_name: r.name,
        ...(r.id ? { tool_call_id: r.id } : {}),
      }));
  }
}
