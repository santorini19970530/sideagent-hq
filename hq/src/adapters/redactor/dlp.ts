import type { protos } from "@google-cloud/dlp";
import { findPatterns } from "./pattern.ts";
import type { Finding, Redactor } from "./types.ts";

/** The part of `DlpServiceClient` the redactor uses, so tests can pass a fake. */
export interface DlpClient {
  inspectContent(
    request: protos.google.privacy.dlp.v2.IInspectContentRequest,
  ): Promise<[protos.google.privacy.dlp.v2.IInspectContentResponse, ...unknown[]]>;
}

// The fixed infoType list (technical.md, "Redaction") and the placeholder type each maps to.
// Placeholder types are the pattern redactor's, plus PERSON and ADDRESS, which only DLP finds.
export const DLP_INFO_TYPES: Record<string, string> = {
  EMAIL_ADDRESS: "EMAIL",
  CREDIT_CARD_NUMBER: "CARD",
  FINANCIAL_ACCOUNT_NUMBER: "ACCT",
  IBAN_CODE: "ACCT",
  US_BANK_ROUTING_MICR: "ACCT",
  PHONE_NUMBER: "PHONE",
  STREET_ADDRESS: "ADDRESS",
  PERSON_NAME: "PERSON",
};

// Where findings overlap, the earlier type wins, then the longer finding (an email address
// holds what DLP may also call a name).
const PRIORITY = ["EMAIL", "CARD", "ACCT", "PHONE", "ADDRESS", "PERSON"];

/**
 * UTF-16 index of each code point offset in `text`, plus one past the end. DLP reports
 * `codepointRange` in Unicode code points; JS strings index UTF-16 code units, which differ
 * once the text holds characters outside the BMP (emoji, some CJK).
 */
function utf16Offsets(text: string): number[] {
  const offsets: number[] = [];
  let at = 0;
  for (const ch of text) {
    offsets.push(at);
    at += ch.length;
  }
  offsets.push(at);
  return offsets;
}

function int(value: number | string | { toString(): string } | null | undefined): number {
  // int64 fields arrive as strings (or Long) from the client library.
  const n = Number(String(value ?? 0));
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`Bad DLP offset: ${String(value)}`);
  return n;
}

/** DLP findings for one text as placeholder findings: mapped, in UTF-16 offsets, no overlaps. */
export function mapDlpFindings(
  text: string,
  findings: protos.google.privacy.dlp.v2.IFinding[],
): Finding[] {
  const offsets = utf16Offsets(text);
  const mapped: Finding[] = [];
  for (const f of findings) {
    const type = DLP_INFO_TYPES[f.infoType?.name ?? ""];
    if (!type) continue;
    const range = f.location?.codepointRange;
    // Fail closed: a finding we can't place would leave the value in the text.
    if (!range) throw new Error(`DLP finding ${f.infoType?.name} has no codepoint range`);
    const start = int(range.start);
    const end = int(range.end);
    if (end <= start || end >= offsets.length) {
      throw new Error(`DLP finding ${f.infoType?.name} is outside the text`);
    }
    mapped.push({ type, start: offsets[start]!, end: offsets[end]! });
  }
  return withoutOverlaps(mapped);
}

/** Keeps one finding per span: the higher-priority type, then the longer finding. */
function withoutOverlaps(findings: Finding[]): Finding[] {
  const mapped = [...findings];
  mapped.sort(
    (a, b) =>
      PRIORITY.indexOf(a.type) - PRIORITY.indexOf(b.type) ||
      b.end - b.start - (a.end - a.start) ||
      a.start - b.start,
  );
  const kept: Finding[] = [];
  for (const f of mapped) {
    if (!kept.some((k) => f.start < k.end && k.start < f.end)) kept.push(f);
  }
  return kept.sort((a, b) => a.start - b.start);
}

/**
 * `REDACTOR_BACKEND=dlp`: Sensitive Data Protection `inspectContent`, one call per text, plus
 * the pattern redactor's findings.
 */
export function createDlpRedactor(client: DlpClient, project: string): Redactor {
  const parent = `projects/${project}/locations/global`;
  const inspectConfig: protos.google.privacy.dlp.v2.IInspectConfig = {
    infoTypes: Object.keys(DLP_INFO_TYPES).map((name) => ({ name })),
    minLikelihood: "POSSIBLE",
    includeQuote: false,
    // 0 is the service maximum.
    limits: { maxFindingsPerItem: 0, maxFindingsPerRequest: 0 },
  };
  return {
    inspect: (texts) =>
      Promise.all(
        texts.map(async (text) => {
          if (!text) return [];
          const [res] = await client.inspectContent({
            parent,
            inspectConfig,
            item: { value: text },
          });
          if (res.result?.findingsTruncated) {
            throw new Error("DLP truncated its findings; the text is too large to redact");
          }
          // DLP's detectors miss what the pattern redactor catches, such as a bare number after
          // "account"; both backends must catch at least what the local default does.
          return withoutOverlaps([
            ...mapDlpFindings(text, res.result?.findings ?? []),
            ...findPatterns(text),
          ]);
        }),
      ),
  };
}
