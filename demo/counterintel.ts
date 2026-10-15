// Phase 5 review demo: counterintelligence. Posts the three jobs in demo/jobs/counterintel.ts:
// 1. a job that reads the runner's .env is blocked, with a fix hint;
// 2. a job with an email and an account number reaches the runner as placeholders, and the
//    poster gets the real values back;
// 3. a double agent fakes the sting's public tests, fails a trap check and is burned.
// Needs `pnpm emulators`, `pnpm sandbox:build` and `pnpm --filter @sideagent/hq dev` running,
// with GOOGLE_CLOUD_PROJECT set for Gemini. Run HQ with HOUSE_RUNNERS=off so nothing races it.
import { randomUUID } from "node:crypto";
import { fakeSolution } from "../field/src/executor/cheat.ts";
import { loadConfig } from "../hq/src/config.ts";
import { createAgent } from "../hq/src/store/agents.ts";
import { createFirestore } from "../hq/src/store/firestore.ts";
import { createOwner } from "../hq/src/store/owners.ts";
import { createDemoClient } from "./hq.ts";
import { EXFIL_JOB, PRIVATE_JOB, STING_JOB, type DemoJob } from "./jobs/counterintel.ts";

const config = loadConfig();
const hq = process.env.SIDEAGENT_HQ_URL ?? `http://localhost:${config.PORT}`;
const db = createFirestore(config);

const posterOwner = await createOwner(db, "Demo handler", config.STARTING_CREDITS);
const runnerOwner = await createOwner(db, "Demo field agent", config.STARTING_CREDITS);
const cheatOwner = await createOwner(db, "Demo double agent", config.STARTING_CREDITS);
const poster = (await createAgent(db, posterOwner, "poster")).apiKey;
const runner = (await createAgent(db, runnerOwner, "runner")).apiKey;
const cheat = (await createAgent(db, cheatOwner, "runner")).apiKey;

const client = createDemoClient(hq, db, poster);
const { call, must, until } = client;

async function post(job: DemoJob) {
  const job_id = await client.post(job);
  const started = Date.now();
  const status = await until(job_id, ["draft", "screening", "test_review"]);
  console.log(`  ${status.state} after ${((Date.now() - started) / 1000).toFixed(1)} s`);
  return status;
}

async function submit(key: string, jobId: string, result: unknown) {
  await must(key, "POST", `/jobs/${jobId}/claim`);
  await must(key, "POST", `/jobs/${jobId}/submissions`, {
    result,
    idempotency_key: randomUUID(),
  });
  return until(jobId, ["claimed", "submitted", "checking", "passed"]);
}

async function feed(jobId: string) {
  for (const detail of await client.feed(jobId)) console.log(`  Feed: ${detail}`);
}

console.log(`HQ ${hq}\n\n1. ${EXFIL_JOB.title}`);
const blocked = await post(EXFIL_JOB);
console.log(`  ${blocked.rejection.code}: ${blocked.rejection.reason}`);
console.log(`  Fix hint: ${blocked.rejection.fix_hint}`);
await feed(blocked.job_id);

console.log(`\n2. ${PRIVATE_JOB.title}`);
const priv = await post(PRIVATE_JOB);
console.log(`  Redacted: ${JSON.stringify(priv.redactions)}`);
const claim = await must(runner, "POST", `/jobs/${priv.job_id}/claim`);
console.log(`  The field agent reads: ${claim.job.spec.split("\n")[0]}`);
// The runner only ever sees placeholders, so its answer uses them too.
const answer = claim.job.spec.match(/"(Refund .*)"/)?.[1].replace("{amount}", "{amount:.2f}");
await must(runner, "POST", `/jobs/${priv.job_id}/submissions`, {
  result: [
    {
      path: "note.py",
      content: `def escalation_note(amount: float) -> str:\n    return f"${answer}"\n`,
    },
  ],
  idempotency_key: randomUUID(),
});
const released = await until(priv.job_id, ["claimed", "submitted", "checking", "passed"]);
console.log(`  ${released.state}; the handler receives:`);
console.log(`  ${released.result?.[0]?.content.split("\n")[1]?.trim()}`);
await feed(priv.job_id);

console.log(`\n3. ${STING_JOB.title}`);
const sting = await post(STING_JOB);
const before = (await must(cheat, "GET", "/balance")).balance;
const caught = await submit(cheat, sting.job_id, fakeSolution(STING_JOB.public_tests));
const summary = caught.last_check.summary;
console.log(
  `  Double agent: ${caught.last_check.outcome}, ${summary.passed}/${summary.total} tests; ` +
    `mission ${caught.state} again`,
);
const after = await call(cheat, "GET", "/balance");
console.log(`  Double agent's balance was ${before}; its key now gets ${after.status}`);
await feed(sting.job_id);
