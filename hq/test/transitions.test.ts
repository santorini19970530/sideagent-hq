import { JobState, TERMINAL_STATES } from "@sideagent/protocol";
import { describe, expect, it } from "vitest";
import { canTransition } from "../src/jobs/transitions.ts";

describe("job transitions", () => {
  it.each([
    ["draft", "open"],
    ["open", "claimed"],
    ["claimed", "open"],
    ["claimed", "submitted"],
    ["submitted", "checking"],
    ["checking", "passed"],
    ["checking", "failed"],
    ["passed", "released"],
    ["failed", "open"],
  ] as const)("allows %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ["draft", "claimed"],
    ["open", "released"],
    ["open", "submitted"],
    ["submitted", "passed"],
    ["checking", "released"],
    ["claimed", "cancelled"],
  ] as const)("refuses %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it("never moves a terminal state", () => {
    for (const from of TERMINAL_STATES) {
      for (const to of JobState.options) expect(canTransition(from, to)).toBe(false);
    }
  });
});
