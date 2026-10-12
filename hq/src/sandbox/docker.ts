import type { Sandbox } from "./types.ts";

export function createDockerSandbox(): Sandbox {
  return {
    async runChecks() {
      throw new Error("Docker sandbox is not implemented yet (Phase 3)");
    },
  };
}
