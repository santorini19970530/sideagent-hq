import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CodeFile } from "@sideagent/protocol";
import { resolveInside } from "../workspace.ts";
import type { Executor } from "./types.ts";

// `SIDEAGENT_SIMULATE_CHEAT=1`: the demo double agent (Phase 5). It never solves the task: it
// reads the public tests and submits a lookup table of their answers, which passes them and
// fails HQ's trap checks (D29). Python only, like the rest of the runtimes.

const IMPORT = /^from[ \t]+([\w.]+)[ \t]+import[ \t]+([\w \t,]+)$/gm;
const ASSERT = /^\s*assert\s+(\w+)\((.*)\)\s*==\s*(.+?)\s*$/gm;

/** Module → function → [args source, expected source] pairs, from `assert f(args) == expected`. */
export function fakeSolution(publicTests: CodeFile[]): CodeFile[] {
  const modules = new Map<string, Map<string, [string, string][]>>();
  for (const test of publicTests) {
    const owner = new Map<string, string>();
    for (const [, module, names] of test.content.matchAll(IMPORT)) {
      for (const name of names!
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean)) {
        owner.set(name, module!);
      }
    }
    for (const [, fn, args, expected] of test.content.matchAll(ASSERT)) {
      const module = owner.get(fn!);
      if (!module) continue;
      const fns = modules.get(module) ?? new Map<string, [string, string][]>();
      modules.set(module, fns);
      fns.set(fn!, [...(fns.get(fn!) ?? []), [args!, expected!]]);
    }
  }
  return [...modules].map(([module, fns]) => ({
    path: `${module.replaceAll(".", "/")}.py`,
    content: [...fns]
      .map(([fn, cases]) => {
        const table = cases.map(([args, expected]) => `    (${args},): ${expected},`).join("\n");
        return `_${fn.toUpperCase()} = {\n${table}\n}\n\n\ndef ${fn}(*args):\n    return _${fn.toUpperCase()}.get(args)\n`;
      })
      .join("\n\n"),
  }));
}

export function createCheatExecutor(): Executor {
  return {
    name: "double-agent",
    sameOwnerOnly: false,
    async run({ job, dir }) {
      const files = fakeSolution(job.public_tests);
      if (!files.length) throw new Error("No `assert f(...) == ...` lines in the public tests");
      for (const file of files) {
        const path = resolveInside(dir, file.path);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, file.content);
      }
      console.log(
        `Double agent: faked ${files.map((f) => f.path).join(", ")} from the public tests`,
      );
    },
  };
}
