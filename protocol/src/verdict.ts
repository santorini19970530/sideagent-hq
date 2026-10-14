import { z } from "zod";

// Structured output of HQ's platform agents (technical.md, "Platform agents"). Each schema is
// passed to Gemini as `responseJsonSchema` and parses the reply.

export const ScreeningCategory = z.enum([
  "prompt_injection",
  "exfiltration",
  "abuse",
  "unfit",
  "private_data",
]);
export type ScreeningCategory = z.infer<typeof ScreeningCategory>;

export const ScreeningVerdict = z.object({
  verdict: z
    .enum(["allow", "block", "escalate"])
    .describe("escalate: unsure, ask the stronger model"),
  categories: z.array(ScreeningCategory).describe("Empty when nothing is wrong"),
  confidence: z.number().min(0).max(1).describe("How sure you are of the verdict"),
  reason: z.string().max(500).describe("One sentence; do not quote the content"),
  fix_hint: z.string().max(500).describe("How the author can fix it; empty when allowed"),
});
export type ScreeningVerdict = z.infer<typeof ScreeningVerdict>;

/** What HQ keeps of a screening: the final verdict, without its prose. */
export const ScreeningRecord = z.object({
  verdict: z.enum(["allow", "block"]),
  categories: z.array(ScreeningCategory),
  confidence: z.number().min(0).max(1),
  model: z.string(),
  escalated: z.boolean(),
});
export type ScreeningRecord = z.infer<typeof ScreeningRecord>;

// Lenient on purpose: one draft off the format would otherwise discard the whole answer (seen
// live: a name off the pattern left a job without trap checks). The trap writer cleans names
// and drops drafts it can't use.
export const TrapTestDrafts = z.object({
  tests: z.array(
    z.object({
      name: z.string().describe("snake_case, at most 40 characters, used in the file name"),
      content: z.string().describe("A complete test file, at most 8000 characters"),
    }),
  ),
});
export type TrapTestDrafts = z.infer<typeof TrapTestDrafts>;
