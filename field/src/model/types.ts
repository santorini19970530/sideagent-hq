/** A tool the model may call. `parameters` is a JSON Schema object. */
export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  /** Set by backends that pair calls with results by ID. */
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  id?: string;
  name: string;
  output: string;
}

export type Message =
  | { role: "user"; text: string }
  /** `raw` is the backend's own copy of the turn (e.g. Gemini thought signatures), sent back as is. */
  | { role: "model"; text: string; calls: ToolCall[]; raw?: unknown }
  | { role: "tool"; results: ToolResult[] };

export interface GenerateRequest {
  system: string;
  messages: Message[];
  tools: ToolDeclaration[];
  maxOutputTokens: number;
  signal: AbortSignal;
}

export interface GenerateResponse {
  message: Extract<Message, { role: "model" }>;
  usage: { inputTokens: number; outputTokens: number };
}

/** One model provider: Ollama on the laptop, Vertex AI for house runners, Gemini API as fallback. */
export interface ModelBackend {
  readonly name: string;
  readonly model: string;
  generate(request: GenerateRequest): Promise<GenerateResponse>;
}
