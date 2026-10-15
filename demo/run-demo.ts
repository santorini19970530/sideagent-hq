// Drives the demo video (docs/proposal.md, "Demo script"; shot list in demo/video.md) against an
// HQ, usually production, one line per beat with timings.
//
// SIDEAGENT_POSTER_KEY is a handler key issued in mission control, so every job shows on that
// owner's mission map. SIDEAGENT_FOLLOW_JOB, when set, is the escalation-note job Gemini CLI
// already posted (demo/gemini-prompt.md); the script follows it instead of posting its own. The
// double agent and the laptop field agent get new owners in Firestore on every run, so the
// script needs credentials for the project. The field agent needs Ollama with Gemma and
// `pnpm sandbox:build`.
//
//   SIDEAGENT_HQ_URL=https://… SIDEAGENT_POSTER_KEY=sk_… GCP_PROJECT=sideagent-hq \
//     GOOGLE_CLOUD_PROJECT=sideagent-hq pnpm demo:run
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { fakeSolution } from "../field/src/executor/cheat.ts";
import { loadConfig } from "../hq/src/config.ts";
import { createAgent } from "../hq/src/store/agents.ts";
import { createFirestore } from "../hq/src/store/firestore.ts";
import { createOwner } from "../hq/src/store/owners.ts";
import type { JobState } from "../protocol/src/job.ts";
import { createDemoClient } from "./hq.ts";
import { EXFIL_JOB, PRIVATE_JOB, STING_JOB, type DemoJob } from "./jobs/counterintel.ts";

const CLI = fileURLToPath(new URL("../field/src/cli.ts", import.meta.url));
// Until a job is screened and reviewed; until a claimed job is released, failed or reopened.
const SCREENING: JobState[] = ["draft", "screening", "test_review"];
const IN_PLAY: JobState[] = ["open", "claimed", "running", "submitted", "checking", "passed"];

const config = loadConfig();
const hq = process.env.SIDEAGENT_HQ_URL ?? `http://localhost:${config.PORT}`;
const poster = process.env.SIDEAGENT_POSTER_KEY;
if (!poster) throw new Error("Set SIDEAGENT_POSTER_KEY to a handler key from mission control");
const db = createFirestore(config);
const { call, must, until, post, feed } = createDemoClient(hq, db, poster);

const start = Date.now();
const say = (line: string) =>
  console.log(`[${((Date.now() - start) / 1000).toFixed(0).padStart(4)} s] ${line}`);

async function opened(job: DemoJob, jobId?: string) {
  const id = jobId ?? (await post(job));
  say(`${jobId ? "Following" : "Posted"} "${job.title}" (${id})`);
  return until(id, SCREENING);
}

async function sayFeed(jobId: string) {
  for (const detail of await feed(jobId)) say(`  Feed: ${detail}`);
}

/** `sideagent field --once --job <id>` on Gemma, with its own runner key and not the handler's. */
function fieldAgent(apiKey: string, jobId: string): Promise<void> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SIDEAGENT_HQ_URL: hq,
    SIDEAGENT_API_KEY: apiKey,
  };
  delete env.SIDEAGENT_POSTER_KEY;
  const child = spawn(
    process.execPath,
    ["--import", "tsx", CLI, "field", "--once", "--job", jobId],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      for (const line of chunk.split("\n").filter(Boolean)) say(`  [field agent] ${line}`);
    });
  }
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`field agent exited with ${signal ?? code}`)),
    );
  });
}

const [cheatOwner, fieldOwner] = await Promise.all([
  createOwner(db, "Demo double agent", config.STARTING_CREDITS),
  createOwner(db, "Demo field agent (Gemma)", config.STARTING_CREDITS),
]);
const cheat = (await createAgent(db, cheatOwner, "runner")).apiKey;
const field = (await createAgent(db, fieldOwner, "runner")).apiKey;
const opening = (await must(poster, "GET", "/balance")).balance;
say(`HQ ${hq}; handler balance ${opening} credits`);

say(`1. ${PRIVATE_JOB.title}`);
const priv = await opened(PRIVATE_JOB, process.env.SIDEAGENT_FOLLOW_JOB);
say(
  `  ${priv.state}; redacted ${JSON.stringify(priv.redactions)}, strength ${priv.test_strength}%`,
);
const released = await until(priv.job_id, IN_PLAY);
say(`  ${released.state}; the handler receives the real values:`);
say(`  ${released.result?.[0]?.content?.split("\n")[1]?.trim()}`);
await sayFeed(priv.job_id);

say(`2. ${EXFIL_JOB.title}`);
const blocked = await opened(EXFIL_JOB);
say(`  ${blocked.state}: ${blocked.rejection?.reason}`);
await sayFeed(blocked.job_id);

say(`3. ${STING_JOB.title}`);
const sting = await opened(STING_JOB);
say(`  ${sting.state}, strength ${sting.test_strength}%; the double agent claims it`);
await must(cheat, "POST", `/jobs/${sting.job_id}/claim`);
await must(cheat, "POST", `/jobs/${sting.job_id}/submissions`, {
  result: fakeSolution(STING_JOB.public_tests),
  idempotency_key: randomUUID(),
});
const caught = await until(sting.job_id, ["claimed", "submitted", "checking"]);
const after = await call(cheat, "GET", "/balance");
say(`  Double agent: ${caught.last_check?.outcome}; its key now gets ${after.status}`);
await sayFeed(sting.job_id);
say("  A field agent on Gemma takes the reopened mission");
await fieldAgent(field, sting.job_id);
const done = await until(sting.job_id, IN_PLAY);
const summary = done.last_check?.summary;
say(`  ${done.state}: ${summary?.passed}/${summary?.total} tests`);

const closing = (await must(poster, "GET", "/balance")).balance;
say(`Done. Handler balance ${opening} → ${closing} credits`);
