import type { Finding, Redactor } from "./types.ts";

// `REDACTOR_BACKEND=pattern`, the local default: emails, phone numbers, card numbers and
// account numbers. Earlier rules win where matches overlap.
const RULES: { type: string; pattern: RegExp; valid?: (value: string) => boolean }[] = [
  { type: "EMAIL", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
  // 13–19 digits, optionally grouped by spaces or dashes, passing the Luhn check.
  { type: "CARD", pattern: /\b\d(?:[ -]?\d){12,18}\b/g, valid: (v) => luhn(v.replace(/\D/g, "")) },
  // A number after "account", "acct" or "a/c": only the number is replaced.
  {
    type: "ACCT",
    pattern:
      /(?<=\b(?:account|acct|a\/c)(?:\s*(?:no\.?|number|#))?\s*[:#]?\s*)[A-Z0-9][A-Z0-9-]{4,32}\d\b/gi,
    valid: (v) => /\d{4}/.test(v.replace(/-/g, "")),
  },
  // International (+65 9123 4567) or North American style (415-555-0100, (415) 555-0100).
  {
    type: "PHONE",
    pattern:
      /(?:\+\d{1,3}[ .-]?\(?\d{1,4}\)?(?:[ .-]?\d{2,4}){2,3}|\(?\b\d{3}\)?[ .-]\d{3}[ .-]\d{4})\b/g,
  },
];

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function findPatterns(text: string): Finding[] {
  const found: Finding[] = [];
  for (const { type, pattern, valid } of RULES) {
    for (const m of text.matchAll(pattern)) {
      const start = m.index;
      const end = start + m[0].length;
      if (valid && !valid(m[0])) continue;
      if (found.some((f) => start < f.end && f.start < end)) continue;
      found.push({ type, start, end });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

export function createPatternRedactor(): Redactor {
  return { inspect: async (texts) => texts.map(findPatterns) };
}
