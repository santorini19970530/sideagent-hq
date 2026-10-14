import { apiError, type ApiError, type ErrorCode } from "@sideagent/protocol";
import type { z } from "zod";

const STATUS: Record<ErrorCode, 400 | 401 | 402 | 403 | 404 | 409 | 422 | 429 | 500> = {
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  invalid_state: 409,
  insufficient_credits: 402,
  spec_not_checkable: 422,
  job_blocked: 422,
  tests_invalid: 422,
  result_blocked: 422,
  rate_limited: 429,
  internal: 500,
};

/** An expected failure, returned to the caller as `{code, reason, fix_hint}`. */
export class HqError extends Error {
  readonly body: ApiError;
  readonly status: (typeof STATUS)[ErrorCode];

  constructor(code: ErrorCode, reason: string, fixHint: string) {
    super(reason);
    this.body = apiError(code, reason, fixHint);
    this.status = STATUS[code];
  }
}

/** Parses untrusted input, turning Zod issues into an `invalid_request` with a usable fix hint. */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  throw new HqError("invalid_request", "Request failed validation", `Fix these fields: ${issues}`);
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HqError("invalid_request", "Body is not valid JSON", "Send a JSON object body");
  }
}
