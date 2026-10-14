// Phase 1 runner stand-in: waits for an open job, claims it, submits a stub file and
// follows the job until its check finishes. Run with `pnpm demo:runner` after `pnpm --filter @sideagent/hq seed`.
const hq = process.env.SIDEAGENT_HQ_URL ?? "http://localhost:8080";
const apiKey = process.env.SIDEAGENT_API_KEY;
if (!apiKey) throw new Error("Set SIDEAGENT_API_KEY to a runner key from the seed script");

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${hq}/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}

console.log("Waiting for an open job...");
let job = null;
while (!job) job = await call("GET", "/runner/next?wait=30");
console.log(`Found ${job.job_id}: ${job.title}`);

const claim = await call("POST", `/jobs/${job.job_id}/claim`);
console.log(`Claimed until ${claim.claim_deadline}. Spec:\n${claim.job.spec}\n`);

const submitted = await call("POST", `/jobs/${job.job_id}/submissions`, {
  result: [{ path: "solution.py", content: "# Phase 1 stub: checks are not enforced yet\n" }],
  idempotency_key: `demo-${job.job_id}`,
});
console.log(`Submitted ${submitted.submission_id}`);

let state = submitted.state;
while (["submitted", "checking", "passed"].includes(state)) {
  await new Promise((r) => setTimeout(r, 500));
  const status = await call("GET", `/jobs/${job.job_id}`);
  if (status.state !== state) console.log(`State: ${state} → ${status.state}`);
  state = status.state;
}
console.log(
  state === "released"
    ? "Done. The poster can now read the result with get_status."
    : `Check finished with the job ${state}; get_status shows the counts in last_check.`,
);
