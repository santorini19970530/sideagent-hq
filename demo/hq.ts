// HQ REST calls shared by the demo scripts.
import { randomUUID } from "node:crypto";
import type { JobState } from "../protocol/src/job.ts";
import type { createFirestore } from "../hq/src/store/firestore.ts";
import type { DemoJob } from "./jobs/counterintel.ts";

const POLL_MS = 1000;
// Longer than any step takes in a run (test review waits for the one-at-a-time sandbox), so a
// stuck job fails the run instead of hanging it.
const WAIT_MS = 10 * 60_000;
const NETWORK_TRIES = 4;

/**
 * Retries a dropped connection (seen in a rehearsal: ECONNRESET mid-run), so one blip doesn't
 * end a take. Writes carry an idempotency key in the body, so a retried POST is safe.
 */
async function fetchRetrying(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      if (attempt >= NETWORK_TRIES) throw err;
      await new Promise((r) => setTimeout(r, attempt * POLL_MS));
    }
  }
}

/** `poster` is the default key for posting and following jobs. */
export function createDemoClient(
  hq: string,
  db: ReturnType<typeof createFirestore>,
  poster: string,
) {
  async function call(key: string, method: string, path: string, body?: unknown) {
    const res = await fetchRetrying(`${hq}/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    try {
      return { status: res.status, body: JSON.parse(text) };
    } catch {
      throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
    }
  }

  async function must(key: string, method: string, path: string, body?: unknown) {
    const res = await call(key, method, path, body);
    if (res.status !== 200) {
      throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body;
  }

  /** Polls the job until it leaves every state in `waiting`, or throws after WAIT_MS. */
  async function until(jobId: string, waiting: JobState[], key = poster) {
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      const status = await must(key, "GET", `/jobs/${jobId}`);
      if (!waiting.includes(status.state)) return status;
      if (Date.now() > deadline) {
        throw new Error(`${jobId} still ${status.state} after ${WAIT_MS / 60_000} minutes`);
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }

  /** Posts a demo job due in an hour and returns its id. */
  async function post(job: DemoJob): Promise<string> {
    const { job_id } = await must(poster, "POST", "/jobs", {
      ...job,
      deadline: new Date(Date.now() + 3600_000).toISOString(),
      idempotency_key: randomUUID(),
    });
    return job_id;
  }

  async function feed(jobId: string): Promise<string[]> {
    const snap = await db.collection("feed").where("jobId", "==", jobId).get();
    return snap.docs.map((doc) => doc.get("detail") as string);
  }

  return { call, must, until, post, feed };
}
