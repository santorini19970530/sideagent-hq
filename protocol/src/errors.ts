import { z } from "zod";

export const ErrorCode = z.enum([
  "invalid_request",
  "not_found",
  "unauthorized",
  "forbidden",
  "conflict",
  "invalid_state",
  "insufficient_credits",
  "spec_not_checkable",
  "rate_limited",
  "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ApiError = z.object({
  code: ErrorCode,
  reason: z.string(),
  fix_hint: z.string(),
});
export type ApiError = z.infer<typeof ApiError>;

export function apiError(code: ErrorCode, reason: string, fix_hint: string): ApiError {
  return { code, reason, fix_hint };
}
