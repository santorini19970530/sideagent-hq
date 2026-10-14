#!/usr/bin/env node
import { parseArgs } from "node:util";
import { JobType } from "@sideagent/protocol";
import pkg from "../package.json" with { type: "json" };
import { Config, createModelBackend } from "./config.ts";
import { createCheatExecutor } from "./executor/cheat.ts";
import { createCommandExecutor, TOOLS, type Tool } from "./executor/command.ts";
import { createGemmaLoopExecutor } from "./executor/gemma-loop.ts";
import type { Executor } from "./executor/types.ts";
import { createHqClient } from "./hq-client.ts";
import { runJob, runLoop } from "./poll.ts";
import { createDockerTestRunner } from "./sandbox/docker.ts";
import { createProcessTestRunner } from "./sandbox/process.ts";

const USAGE = `Usage: sideagent <command>

Commands:
  field     Run as a runner: claim jobs from HQ and solve them

Field options:
  --executor <name>    gemma (default): built-in tool-calling loop, public tests in Docker
                       command: dev only, hands the job to claude or codex
  --model <id>         Model for the gemma executor (default depends on the backend)
  --trusted-dev        Required by the command executor: no sandbox, own owner's jobs only
  --command <tool>     CLI the command executor runs: ${Object.keys(TOOLS).join(" or ")} (default claude)
  --types <a,b>        Only take jobs of these types, e.g. code.implement
  --once --job <id>    Claim and run one job, then exit (house runners)

Environment:
  SIDEAGENT_HQ_URL     HQ base URL (default http://localhost:8080)
  SIDEAGENT_API_KEY    Runner API key
  SIDEAGENT_MODEL_BACKEND  ollama (default), vertex or gemini-api
  SIDEAGENT_MODEL      Model ID; ollama defaults to gemma4:26b-a4b, vertex to gemini-2.5-flash-lite
  SIDEAGENT_MAX_TOKENS Token cap per job
  OLLAMA_HOST          Ollama URL (default http://127.0.0.1:11434)
  GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_LOCATION  Vertex AI project and location (default global)
  GEMINI_API_KEY       Key for the gemini-api backend
  SIDEAGENT_SANDBOX_IMAGE  Image for public tests (default sideagent-sandbox-python:dev)
  SIDEAGENT_TEST_RUNNER    docker (default) or process: public tests as a child process with
                           no sandbox; only for house-runner containers, where the container
                           is the sandbox
  SIDEAGENT_RUN_CHECKS     run_checks.py for the process runner (default /opt/sideagent/run_checks.py)

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
      executor: { type: "string", default: "gemma" },
      model: { type: "string" },
      "trusted-dev": { type: "boolean", default: false },
      command: { type: "string", default: "claude" },
      types: { type: "string" },
      once: { type: "boolean", default: false },
      job: { type: "string" },
    },
  });

  let executor: Executor;
  // The demo double agent, set by HQ's dispatcher with HOUSE_RUNNER_DOUBLE_AGENT=1 (Phase 5).
  if (process.env.SIDEAGENT_SIMULATE_CHEAT === "1") {
    executor = createCheatExecutor();
  } else if (values.executor === "command") {
    const tool = values.command;
    if (!isTool(tool)) fail(`Unknown --command ${tool}; use ${Object.keys(TOOLS).join(" or ")}`);
    if (!values["trusted-dev"]) {
      fail(
        "The command executor runs without a sandbox and is for development only. Pass --trusted-dev.",
      );
    }
    executor = createCommandExecutor({ argv: TOOLS[tool], trustedDev: true });
  } else if (values.executor === "gemma") {
    const parsed = Config.safeParse(process.env);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      fail(`Invalid ${issue?.path.join(".")}: ${issue?.message}`);
    }
    const config = parsed.data;
    executor = createGemmaLoopExecutor({
      model: createModelBackend(config, values.model),
      tests:
        config.SIDEAGENT_TEST_RUNNER === "process"
          ? createProcessTestRunner({ runChecks: config.SIDEAGENT_RUN_CHECKS })
          : createDockerTestRunner({ image: config.SIDEAGENT_SANDBOX_IMAGE }),
      maxTokens: config.SIDEAGENT_MAX_TOKENS,
    });
  } else {
    fail(`Unknown --executor ${values.executor}; use gemma or command`);
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
    executor,
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
