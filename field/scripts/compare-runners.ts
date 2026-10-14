// Phase 2b review: runs the candidate demo jobs through several runners and scores each result
// with HQ's Docker checks (public and hidden tests), to pick demo jobs the runner models solve
// reliably. Needs `pnpm sandbox:build`, plus Ollama, Vertex AI access or the claude CLI for the
// runners asked for.
//
//   pnpm compare:runners --trials 3 --runners reference,ollama:gemma4:26b-a4b,vertex:gemini-2.5-flash-lite,claude
//
// Runners: `reference` (the job's reference solution; checks the jobs themselves),
// `ollama:<model>`, `vertex:<model>`, `claude`, `codex`. Vertex uses application default
// credentials, or GCP_ACCESS_TOKEN when those belong to an account without access, as in
// infra/experiments. GOOGLE_CLOUD_PROJECT defaults to sideagent-hq.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { GoogleGenAI } from "@google/genai";
import type { CodeFile } from "@sideagent/protocol";
import { CODE_JOBS, type DemoCodeJob } from "../../demo/jobs/code.ts";
import { createDockerSandbox } from "../../hq/src/sandbox/docker.ts";
import { createModelBackend, loadConfig } from "../src/config.ts";
import { createCommandExecutor, TOOLS } from "../src/executor/command.ts";
import { createGemmaLoopExecutor } from "../src/executor/gemma-loop.ts";
import type { Executor } from "../src/executor/types.ts";
import { createGenAiBackend } from "../src/model/genai.ts";
import { createDockerTestRunner } from "../src/sandbox/docker.ts";
import { createWorkspace, resolveInside } from "../src/workspace.ts";

const RUN_MINUTES = 10;

const { values } = parseArgs({
  options: {
    runners: {
      type: "string",
      default: "reference,ollama:gemma4:26b-a4b,vertex:gemini-2.5-flash-lite,claude",
    },
    trials: { type: "string", default: "1" },
    jobs: { type: "string" },
  },
});
const trials = Number(values.trials);
if (!Number.isInteger(trials) || trials < 1) throw new Error("--trials must be a positive integer");
const runners = values.runners.split(",");
// Checked up front: an unknown runner would otherwise stop the sweep only when its turn comes.
const RUNNER_KINDS = ["reference", "ollama", "vertex", "claude", "codex"];
const badRunners = runners.filter((r) => !RUNNER_KINDS.includes(r.split(":")[0]!));
if (badRunners.length) throw new Error(`Unknown --runners: ${badRunners.join(", ")}`);
const jobIds = values.jobs?.split(",") ?? CODE_JOBS.map((j) => j.id);
const unknown = jobIds.filter((id) => !CODE_JOBS.some((j) => j.id === id));
if (unknown.length) throw new Error(`Unknown --jobs: ${unknown.join(", ")}`);
const jobs = CODE_JOBS.filter((j) => jobIds.includes(j.id));

const config = loadConfig({ GOOGLE_CLOUD_PROJECT: "sideagent-hq", ...process.env });
const tests = createDockerTestRunner({ image: config.SIDEAGENT_SANDBOX_IMAGE });
const checker = createDockerSandbox({ image: config.SIDEAGENT_SANDBOX_IMAGE, timeoutSeconds: 300 });

let vertex: GoogleGenAI["models"] | undefined;
function vertexModels() {
  if (vertex) return vertex;
  const token = process.env.GCP_ACCESS_TOKEN;
  const authClient = token && {
    getAccessToken: async () => ({ token }),
    getRequestHeaders: async () => new Headers({ authorization: `Bearer ${token}` }),
  };
  vertex = new GoogleGenAI({
    vertexai: true,
    project: config.GOOGLE_CLOUD_PROJECT!,
    location: config.GOOGLE_CLOUD_LOCATION,
    ...(authClient ? { googleAuthOptions: { authClient: authClient as never } } : {}),
  }).models;
  return vertex;
}

/** An executor for `runner`, and the log lines it wrote during the last run. */
function createRunner(runner: string, job: DemoCodeJob, lines: string[]): Executor {
  const log = (line: string) => lines.push(line);
  const [kind, model = ""] = runner.split(/:(.*)/s);
  switch (kind) {
    case "reference":
      return {
        name: "reference",
        sameOwnerOnly: false,
        async run({ dir }) {
          for (const f of job.reference_solution) {
            const file = resolveInside(dir, f.path);
            await mkdir(dirname(file), { recursive: true });
            await writeFile(file, f.content);
          }
        },
      };
    case "ollama":
      return createGemmaLoopExecutor({
        model: createModelBackend({ ...config, SIDEAGENT_MODEL_BACKEND: "ollama" }, model),
        tests,
        log,
      });
    case "vertex":
      return createGemmaLoopExecutor({
        model: createGenAiBackend("vertex", model, vertexModels()),
        tests,
        log,
      });
    case "claude":
    case "codex":
      return createCommandExecutor({ argv: TOOLS[kind], trustedDev: true });
    default:
      throw new Error(`Unknown runner ${runner}`);
  }
}

interface Run {
  job: string;
  runner: string;
  passed: number;
  total: number;
  seconds: number;
  steps?: number;
  tokens?: number;
  error?: string;
}

async function runOnce(job: DemoCodeJob, runner: string): Promise<Run> {
  const view = {
    job_id: job.id,
    type: "code.implement" as const,
    runtime: "python" as const,
    title: job.title,
    state: "claimed" as const,
    budget: 10,
    deadline: new Date(Date.now() + 3600_000).toISOString(),
    created_at: new Date().toISOString(),
    spec: job.spec,
    public_tests: job.public_tests,
  };
  const lines: string[] = [];
  const executor = createRunner(runner, job, lines);
  const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
  const workspace = await createWorkspace(view);
  const started = Date.now();
  let error: string | undefined;
  let seconds: number;
  let result: CodeFile[];
  try {
    await executor
      .run({ job: view, dir: workspace.dir, deadline: new Date(Date.now() + RUN_MINUTES * 60_000) })
      .catch((err) => (error = message(err)));
    seconds = (Date.now() - started) / 1000;
    result = await workspace.collect().catch((err) => {
      error ??= message(err);
      return [];
    });
  } finally {
    await workspace.dispose();
  }

  // Unscored runs count as 0 of 0, so they never show as fully passed.
  let passed = 0;
  let total = 0;
  if (result.length > 0) {
    try {
      const outcome = await checker.runChecks({
        jobId: job.id,
        checkId: `${runner}-${started}`,
        runtime: "python",
        result,
        tests: { public: job.public_tests, hidden: job.hidden_tests },
      });
      if (outcome.kind === "scored") ({ passed, total } = outcome.summary);
      else error ??= outcome.error.reason;
    } catch (err) {
      error ??= `check failed: ${message(err)}`;
    }
  } else error ??= "no result files";

  const submitted = lines
    .find((l) => l.startsWith("Submitted after"))
    ?.match(/after (\d+) steps and (\d+) tokens/);
  return {
    job: job.id,
    runner,
    passed,
    total,
    seconds,
    ...(submitted ? { steps: Number(submitted[1]), tokens: Number(submitted[2]) } : {}),
    ...(error ? { error } : {}),
  };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)]! : NaN;
};

const runs: Run[] = [];
for (const job of jobs) {
  for (const runner of runners) {
    for (let t = 1; t <= (runner === "reference" ? 1 : trials); t++) {
      const run = await runOnce(job, runner);
      runs.push(run);
      console.error(
        `${job.id} ${runner} #${t}: ${run.passed}/${run.total} tests in ${run.seconds.toFixed(1)}s` +
          (run.steps ? `, ${run.steps} steps, ${run.tokens} tokens` : "") +
          (run.error ? ` (${run.error.slice(0, 160)})` : ""),
      );
    }
  }
}

console.log("| Job | Runner | Fully passed | Tests passed | Median time | Median steps / tokens |");
console.log("|---|---|---|---|---|---|");
for (const job of jobs) {
  for (const runner of runners) {
    const rs = runs.filter((r) => r.job === job.id && r.runner === runner);
    const full = rs.filter((r) => r.total > 0 && r.passed === r.total && !r.error).length;
    const tests = rs.map((r) => `${r.passed}/${r.total}`).join(", ");
    const steps = rs.flatMap((r) => (r.steps ? [r.steps] : []));
    const tokens = rs.flatMap((r) => (r.tokens ? [r.tokens] : []));
    const effort = steps.length ? `${median(steps)} / ${median(tokens)}` : "–";
    const time = `${median(rs.map((r) => r.seconds)).toFixed(0)} s`;
    console.log(
      `| ${job.id} | ${runner} | ${full}/${rs.length} | ${tests} | ${time} | ${effort} |`,
    );
  }
}
