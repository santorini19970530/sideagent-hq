/** A private value found in a text: its placeholder type and position. */
export interface Finding {
  /** Placeholder type, e.g. `EMAIL`, `PHONE`, `CARD`, `ACCT`, `PERSON`. */
  type: string;
  start: number;
  end: number;
}

/**
 * Finds private data (technical.md, "Redaction"). Backends only find values; `redact` in
 * `redact.ts` replaces them with placeholders, so every backend yields the same tokens.
 */
export interface Redactor {
  inspect(texts: string[]): Promise<Finding[][]>;
}
