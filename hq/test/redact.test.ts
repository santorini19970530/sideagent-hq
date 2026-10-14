import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPatternRedactor, findPatterns } from "../src/adapters/redactor/pattern.ts";
import { countByType, redact, restore } from "../src/adapters/redactor/redact.ts";
import { createLocalVault } from "../src/adapters/vault/local.ts";

const redactor = createPatternRedactor();

function found(text: string) {
  return findPatterns(text).map((f) => [f.type, text.slice(f.start, f.end)]);
}

describe("pattern redactor", () => {
  it("finds emails, cards that pass Luhn, account numbers and phone numbers", () => {
    expect(found("Mail jane.doe@acme.co.uk or call +65 9123 4567.")).toEqual([
      ["EMAIL", "jane.doe@acme.co.uk"],
      ["PHONE", "+65 9123 4567"],
    ]);
    expect(found("Card 4111 1111 1111 1111, not 4111 1111 1111 1112")).toEqual([
      ["CARD", "4111 1111 1111 1111"],
    ]);
    expect(found("Account no. 4402917735 and acct#: AB-99812-3")).toEqual([
      ["ACCT", "4402917735"],
      ["ACCT", "AB-99812-3"],
    ]);
    expect(found("Call (415) 555-0100 or 415-555-0100")).toEqual([
      ["PHONE", "(415) 555-0100"],
      ["PHONE", "415-555-0100"],
    ]);
  });

  it("leaves ordinary code alone", () => {
    const code =
      "def add(a, b):\n    return a + b\n\nassert add(1234, 5678) == 6912\nx = 3.14159\n";
    expect(found(code)).toEqual([]);
  });
});

describe("redact", () => {
  it("gives the same value the same placeholder across texts, and restores it", async () => {
    const { texts, map } = await redact(redactor, [
      "Reply to jane@acme.com",
      'assert contact() == "jane@acme.com"',
      "Copy bob@acme.com",
    ]);
    expect(texts).toEqual([
      "Reply to [EMAIL_1]",
      'assert contact() == "[EMAIL_1]"',
      "Copy [EMAIL_2]",
    ]);
    expect(map).toEqual({ "[EMAIL_1]": "jane@acme.com", "[EMAIL_2]": "bob@acme.com" });
    expect(countByType(map)).toEqual({ EMAIL: 2 });
    expect(restore('return "[EMAIL_1]"', map)).toBe('return "jane@acme.com"');
  });

  it("gives the same result when run again over half-redacted texts", async () => {
    const first = await redact(redactor, ["a jane@acme.com", "b bob@acme.com"]);
    const again = await redact(
      redactor,
      ["a [EMAIL_1]", "b bob@acme.com", "c new@acme.com"],
      first.map,
    );
    expect(again.texts).toEqual(["a [EMAIL_1]", "b [EMAIL_2]", "c [EMAIL_3]"]);
  });
});

describe("local vault", () => {
  it("round-trips, and refuses a ciphertext moved to another job", async () => {
    const vault = createLocalVault(randomBytes(32));
    const secret = await vault.encrypt("job_a", '{"[EMAIL_1]":"jane@acme.com"}');
    expect(secret).not.toContain("jane");
    expect(await vault.decrypt("job_a", secret)).toBe('{"[EMAIL_1]":"jane@acme.com"}');
    await expect(vault.decrypt("job_b", secret)).rejects.toThrow();
  });
});
