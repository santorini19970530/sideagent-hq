// Phase 3 review demo: escrow and real checks. Creates a poster owner and a runner owner, posts one
// job, submits a wrong answer then a correct one, and prints balances and what the poster sees.
// Needs `pnpm emulators`, `pnpm sandbox:build` and `pnpm --filter @sideagent/hq dev` running.
import { createAdapters } from "../hq/src/adapters/index.ts";
import { loadConfig } from "../hq/src/config.ts";
import { createAgent } from "../hq/src/store/agents.ts";
import { createOwner } from "../hq/src/store/owners.ts";

const config = loadConfig();
const hq = process.env.SIDEAGENT_HQ_URL ?? `http://localhost:${config.PORT}`;
const { db } = createAdapters(config);

const posterOwner = await createOwner(db, "Demo poster", config.STARTING_CREDITS);
const runnerOwner = await createOwner(db, "Demo runner", config.STARTING_CREDITS);
const poster = (await createAgent(db, posterOwner, "poster")).apiKey;
const runner = (await createAgent(db, runnerOwner, "runner")).apiKey;

async function call(key: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${hq}/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function balances(when: string) {
  const [p, r] = await Promise.all([
    call(poster, "GET", "/balance"),
    call(runner, "GET", "/balance"),
  ]);
  console.log(`  Balances ${when}: poster ${p.balance}, runner ${r.balance}`);
}

/** Polls until the check of the latest submission has finished. */
async function checked(jobId: string) {
  for (;;) {
    const status = await call(poster, "GET", `/jobs/${jobId}`);
    if (!["submitted", "checking", "passed"].includes(status.state)) return status;
    await new Promise((r) => setTimeout(r, 500));
  }
}

const test = (name: string, a: number, b: number) =>
  `def test_${name}():\n    assert add(${a}, ${b}) == ${a + b}\n`;

console.log(`HQ ${hq}\n`);
await balances("at the start");

const job = await call(poster, "POST", "/jobs", {
  type: "code.implement",
  runtime: "python",
  title: "Add two numbers",
  spec: "Write add(a, b) in solution.py that returns a + b.",
  public_tests: [
    { path: "test_public.py", content: `from solution import add\n\n${test("small", 1, 2)}` },
  ],
  hidden_tests: [
    {
      path: "test_hidden.py",
      content: `from solution import add\n\n${test("zero", 0, 0)}\n${test("negative", -1, -2)}`,
    },
  ],
  budget: 10,
  deadline: new Date(Date.now() + 3600_000).toISOString(),
  idempotency_key: `demo-${Date.now()}`,
});
console.log(`\nPosted ${job.job_id} with a budget of ${job.budget}`);
await balances("after posting (budget held in escrow)");

const claim = await call(runner, "POST", `/jobs/${job.job_id}/claim`);
console.log(`\nRunner claimed it with ${claim.attempts_left} attempts`);
await balances("after claiming (stake held)");

console.log("\nRunner submits a wrong answer...");
await call(runner, "POST", `/jobs/${job.job_id}/submissions`, {
  result: [{ path: "solution.py", content: "def add(a, b):\n    return a - b\n" }],
  idempotency_key: "wrong",
});
const failed = await checked(job.job_id);
console.log(`  Job is ${failed.state}. The poster sees:`);
console.log(`  last_check: ${JSON.stringify(failed.last_check)}`);
console.log(`  result: ${JSON.stringify(failed.result ?? "(withheld)")}`);

console.log("\nRunner submits a correct answer...");
await call(runner, "POST", `/jobs/${job.job_id}/submissions`, {
  result: [{ path: "solution.py", content: "def add(a, b):\n    return a + b\n" }],
  idempotency_key: "right",
});
const released = await checked(job.job_id);
console.log(`  Job is ${released.state}. The poster sees:`);
console.log(`  last_check: ${JSON.stringify(released.last_check)}`);
console.log(`  result: ${JSON.stringify(released.result)}`);
await balances("after release (budget paid, stake returned)");
process.exit(0);
