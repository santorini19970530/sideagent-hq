#!/usr/bin/env node
import pkg from "../package.json" with { type: "json" };

const USAGE = `Usage: sideagent <command>

Commands:
  field     Run as a runner: claim jobs from HQ and solve them (Phase 2a)

Options:
  --version Print the version
  --help    Print this message`;

const [command] = process.argv.slice(2);

if (command === "--version") {
  console.log(pkg.version);
} else if (command === "field") {
  console.error("sideagent field is not implemented yet (Phase 2a)");
  process.exitCode = 1;
} else {
  console.log(USAGE);
  if (command && command !== "--help") process.exitCode = 1;
}
