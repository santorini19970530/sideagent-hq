import type { Redactor } from "./types.ts";

/** Placeholder → original value, e.g. `{"[EMAIL_1]": "jane@acme.com"}`. Stored only in the vault. */
export type PlaceholderMap = Record<string, string>;

/**
 * Replaces private values in `texts` with typed placeholders. The same value gets the same
 * placeholder in every text. `seed` is a map from an earlier run: its values keep their
 * placeholders, so running again over half-redacted texts gives the same result.
 */
export async function redact(
  redactor: Redactor,
  texts: string[],
  seed: PlaceholderMap = {},
): Promise<{ texts: string[]; map: PlaceholderMap }> {
  const map: PlaceholderMap = { ...seed };
  const byValue = new Map(Object.entries(map).map(([token, value]) => [value, token]));
  const counts = new Map<string, number>();
  for (const token of Object.keys(map)) {
    const [, type, n] = /^\[([A-Z]+)_(\d+)\]$/.exec(token) ?? [];
    if (type) counts.set(type, Math.max(counts.get(type) ?? 0, Number(n)));
  }
  const tokenFor = (type: string, value: string) => {
    let token = byValue.get(value);
    if (!token) {
      const n = (counts.get(type) ?? 0) + 1;
      counts.set(type, n);
      token = `[${type}_${n}]`;
      map[token] = value;
      byValue.set(value, token);
    }
    return token;
  };

  // Values found earlier may sit in texts the backend misses this time; replace them first.
  const seeded = texts.map((text) => replaceAll(text, byValue));
  const findings = await redactor.inspect(seeded);
  const out = seeded.map((text, i) => {
    let result = "";
    let at = 0;
    for (const f of findings[i] ?? []) {
      result += text.slice(at, f.start) + tokenFor(f.type, text.slice(f.start, f.end));
      at = f.end;
    }
    return result + text.slice(at);
  });
  return { texts: out, map };
}

/** Puts the original values back, on the poster's side only. */
export function restore(text: string, map: PlaceholderMap): string {
  return replaceAll(text, new Map(Object.entries(map)));
}

/** Counts placeholders per type, for the job and the feed. */
export function countByType(map: PlaceholderMap): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const token of Object.keys(map)) {
    const type = /^\[([A-Z]+)_\d+\]$/.exec(token)?.[1];
    if (type) counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}

/** Replaces each key with its value, longest key first so one key can't eat part of another. */
function replaceAll(text: string, pairs: Map<string, string>): string {
  const keys = [...pairs.keys()].filter(Boolean).sort((a, b) => b.length - a.length);
  if (!keys.length) return text;
  const pattern = new RegExp(keys.map(escapeRegExp).join("|"), "g");
  return text.replace(pattern, (m) => pairs.get(m)!);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
