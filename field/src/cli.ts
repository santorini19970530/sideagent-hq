#!/usr/bin/env node
import { parseArgs } from "node:util";
import { JobType } from "@sideagent/protocol";
import pkg from "../package.json" with { type: "json" };
import { createCommandExecutor, TOOLS, type Tool } from "./executor/command.ts";
import { createHqClient } from "./hq-client.ts";
import { runJob, runLoop } from "./poll.ts";

const USAGE = `Usage: sideagent <command>

Commands:
  field     Run as a runner: claim jobs from HQ and solve them

Field options:
  --executor command   Executor to run jobs with (only "command" until Phase 2b)
  --trusted-dev        Required by the command executor: no sandbox, own owner's jobs only
  --command <tool>     CLI the command executor runs: ${Object.keys(TOOLS).join(" or ")} (default claude)
  --types <a,b>        Only take jobs of these types, e.g. code.implement
  --once --job <id>    Claim and run one job, then exit (house runners)

Environment:
  SIDEAGENT_HQ_URL     HQ base URL (default http://localhost:8080)
  SIDEAGENT_API_KEY    Runner API key

Options:
  --version Print the version
  --help    Print this message`;

function isTool(name: string): name is Tool {
  return Object.hasOwn(TOOLS, name);
}

function fail(message: string): never {
  console.error(`${message}\n\nRun \`sideagent --help\` for usage.`);
  process.exit(1);
}

async function field(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      executor: { type: "string" },
      "trusted-dev": { type: "boolean", default: false },
      command: { type: "string", default: "claude" },
      types: { type: "string" },
      once: { type: "boolean", default: false },
      job: { type: "string" },
    },
  });

  if (values.executor !== "command") {
    fail("Pass --executor command (the Gemma executor arrives in Phase 2b)");
  }
  const tool = values.command;
  if (!isTool(tool)) fail(`Unknown --command ${tool}; use ${Object.keys(TOOLS).join(" or ")}`);
  if (!values["trusted-dev"]) {
    fail(
      "The command executor runs without a sandbox and is for development only. Pass --trusted-dev.",
    );
  }
  const types = values.types?.split(",").map((t) => {
    const parsed = JobType.safeParse(t.trim());
    return parsed.success ? parsed.data : fail(`Unknown job type in --types: ${t}`);
  });
  if (values.once !== Boolean(values.job)) fail("--once and --job <id> go together");
  const apiKey = process.env.SIDEAGENT_API_KEY;
  if (!apiKey) fail("Set SIDEAGENT_API_KEY to a runner key");

  const deps = {
    hq: createHqClient({ url: process.env.SIDEAGENT_HQ_URL ?? "http://localhost:8080", apiKey }),
    executor: createCommandExecutor({ argv: TOOLS[tool], trustedDev: true }),
  };

  const controller = new AbortController();
  // A second Ctrl-C falls through to the default handler and exits at once.
  process.once("SIGINT", () => {
    console.log("Stopping...");
    controller.abort();
  });

  if (values.job) {
    await runJob(deps, values.job, controller.signal);
  } else {
    await runLoop(deps, { types, signal: controller.signal });
  }
}

const [command, ...rest] = process.argv.slice(2);

if (command === "--version") {
  console.log(pkg.version);
} else if (command === "field") {
  try {
    await field(rest);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
} else {
  console.log(USAGE);
  if (command && command !== "--help") process.exitCode = 1;
}
