import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { ModelBackendName } from "@sideagent/protocol";
import type { HouseRunnerDispatcher } from "./types.ts";

const CLI = fileURLToPath(new URL("../../../../field/src/cli.ts", import.meta.url));

// What the runner itself needs from HQ's environment: tools, model credentials and Docker.
// Nothing else passes, so HQ's own secrets never reach the child.
const PASSTHROUGH = [
  "PATH",
  "HOME",
  "DOCKER_HOST",
  "OLLAMA_HOST",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_LOCATION",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GEMINI_API_KEY",
  "SIDEAGENT_SANDBOX_IMAGE",
] as const;

export interface RunnerSettings {
  hqUrl: string;
  apiKey: string;
  modelBackend: ModelBackendName;
  model?: string;
  /** Runs the demo double agent, which fakes its answers (Phase 5). */
  simulateCheat?: boolean;
}

export interface LocalDispatcherOptions extends RunnerSettings {
  maxRunning: number;
  /** Kills a run that outlives its claim. */
  timeoutSeconds: number;
}

export function houseRunnerEnv(
  { hqUrl, apiKey, modelBackend, model, simulateCheat }: RunnerSettings,
  parent: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of PASSTHROUGH) if (parent[key] !== undefined) env[key] = parent[key];
  return {
    ...env,
    SIDEAGENT_HQ_URL: hqUrl,
    SIDEAGENT_API_KEY: apiKey,
    SIDEAGENT_MODEL_BACKEND: modelBackend,
    ...(model ? { SIDEAGENT_MODEL: model } : {}),
    ...(simulateCheat ? { SIDEAGENT_SIMULATE_CHEAT: "1" } : {}),
  };
}

const running = new Set<ChildProcess>();
let cleanupInstalled = false;

/** Runs stop with HQ; a `tsx watch` restart sends SIGTERM, which skips the `exit` event. */
function installCleanup() {
  if (cleanupInstalled) return;
  cleanupInstalled = true;
  const killAll = () => running.forEach((child) => child.kill("SIGKILL"));
  process.once("exit", killAll);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      killAll();
      process.kill(process.pid, signal);
    });
  }
}

/** Runs `sideagent field --once --job <id>` as a child of HQ, with its output in HQ's log. */
export function createLocalDispatcher(options: LocalDispatcherOptions): HouseRunnerDispatcher {
  return {
    async start(jobId) {
      if (running.size >= options.maxRunning) {
        throw new Error(`${running.size} house runners are already running (HOUSE_RUNNER_MAX)`);
      }
      installCleanup();
      const child = spawn(
        process.execPath,
        ["--import", "tsx", CLI, "field", "--once", "--job", jobId],
        { env: houseRunnerEnv(options), stdio: ["ignore", "pipe", "pipe"] },
      );
      running.add(child);
      const prefix = `[house ${jobId}]`;
      for (const stream of [child.stdout, child.stderr]) {
        createInterface({ input: stream }).on("line", (line) => console.log(`${prefix} ${line}`));
      }
      const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutSeconds * 1000);
      timer.unref();
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        running.delete(child);
        console.log(`${prefix} exited with ${signal ?? code}`);
      });
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
    },
  };
}
