import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { accounts } from "@sideagent/protocol";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";

// Runs against the Firestore emulator started by `pnpm test`, in its own project: other HQ tests
// scan whole collections (the board, the ledger sum), so these seeded documents must not reach
// them. Every test seeds its own IDs, so nothing is cleared.
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8180").split(":");
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-sideagent-rules",
    firestore: {
      host,
      port: Number(port),
      rules: readFileSync(new URL("../../infra/firestore.rules", import.meta.url), "utf8"),
    },
  });
});

afterAll(() => env?.cleanup());

/**
 * A job posted by `poster` and claimed by `runner`, with an event and HQ-only documents, plus an
 * `openJobId` posted by `poster` whose claim has ended.
 */
async function seed() {
  const poster = `uid-${randomUUID()}`;
  const runner = `uid-${randomUUID()}`;
  const jobId = `job-${randomUUID()}`;
  const openJobId = `job-${randomUUID()}`;
  const runnerAgent = `agent-${randomUUID()}`;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await Promise.all([
      setDoc(doc(db, "owners", poster), { displayName: "Poster", killSwitch: false }),
      setDoc(doc(db, "agents", `agent-${randomUUID()}`), { ownerId: poster, role: "poster" }),
      setDoc(doc(db, "jobs", jobId), {
        posterOwnerId: poster,
        state: "claimed",
        claim: { runnerAgentId: runnerAgent, runnerOwnerId: runner },
      }),
      setDoc(doc(db, "jobs", jobId, "events", "000000"), { seq: 0, to: "draft" }),
      setDoc(doc(db, "jobs", openJobId), { posterOwnerId: poster, state: "open", claim: null }),
      setDoc(doc(db, "jobs", openJobId, "events", "000000"), { seq: 0, to: "draft" }),
      setDoc(doc(db, "jobs", jobId, "private", "main"), { hiddenTestsRef: "x" }),
      setDoc(doc(db, "jobs", jobId, "submissions", "s1"), { resultRef: "x" }),
      setDoc(doc(db, "balances", accounts.owner(poster)), { amount: 90 }),
      setDoc(doc(db, "balances", accounts.escrow(jobId)), { amount: 10 }),
      setDoc(doc(db, "balances", accounts.stake(jobId, runnerAgent)), { amount: 2 }),
      setDoc(doc(db, "ledger", `entry-${randomUUID()}`), { from: "a", to: "b", amount: 1 }),
      setDoc(doc(db, "vault", jobId), { ciphertext: "x" }),
      setDoc(doc(db, "feed", `feed-${randomUUID()}`), { detail: "Mission blocked" }),
    ]);
  });
  return { poster, runner, jobId, openJobId, runnerAgent };
}

const as = (uid: string) => env.authenticatedContext(uid).firestore();

describe("firestore rules", () => {
  it("lets an owner read their own owner doc, agents, balance and jobs", async () => {
    const { poster, jobId } = await seed();
    const db = as(poster);
    await assertSucceeds(getDoc(doc(db, "owners", poster)));
    await assertSucceeds(getDocs(query(collection(db, "agents"), where("ownerId", "==", poster))));
    await assertSucceeds(getDoc(doc(db, "balances", accounts.owner(poster))));
    await assertSucceeds(
      getDocs(query(collection(db, "jobs"), where("posterOwnerId", "==", poster))),
    );
    await assertSucceeds(getDocs(collection(db, "jobs", jobId, "events")));
    await assertSucceeds(getDoc(doc(db, "balances", accounts.escrow(jobId))));
  });

  it("keeps a job whose claim has ended visible to its poster only", async () => {
    const { poster, runner, openJobId } = await seed();
    await assertSucceeds(getDoc(doc(as(poster), "jobs", openJobId)));
    await assertSucceeds(getDocs(collection(as(poster), "jobs", openJobId, "events")));
    await assertFails(getDoc(doc(as(runner), "jobs", openJobId)));
    await assertFails(getDocs(collection(as(runner), "jobs", openJobId, "events")));
  });

  it("lets the claiming runner's owner read the job and its stake", async () => {
    const { poster, runner, jobId, runnerAgent } = await seed();
    const db = as(runner);
    await assertSucceeds(getDoc(doc(db, "jobs", jobId)));
    await assertSucceeds(
      getDocs(query(collection(db, "jobs"), where("claim.runnerOwnerId", "==", runner))),
    );
    await assertSucceeds(getDoc(doc(db, "balances", accounts.stake(jobId, runnerAgent))));
    await assertSucceeds(getDocs(collection(db, "jobs", jobId, "events")));
    await assertFails(getDoc(doc(db, "balances", accounts.owner(poster))));
    await assertFails(getDoc(doc(db, "jobs", jobId, "private", "main")));
  });

  it("hides other owners' documents", async () => {
    const { poster, jobId } = await seed();
    const db = as(`uid-${randomUUID()}`);
    await assertFails(getDoc(doc(db, "owners", poster)));
    await assertFails(getDocs(query(collection(db, "agents"), where("ownerId", "==", poster))));
    await assertFails(getDoc(doc(db, "balances", accounts.owner(poster))));
    await assertFails(getDoc(doc(db, "balances", accounts.escrow(jobId))));
    await assertFails(getDoc(doc(db, "jobs", jobId)));
    await assertFails(getDocs(collection(db, "jobs")));
    await assertFails(getDocs(collection(db, "jobs", jobId, "events")));
    await assertFails(getDocs(collection(db, "agents")));
    await assertFails(getDoc(doc(db, "balances", "owner:")));
    await assertFails(getDoc(doc(db, "balances", accounts.escrow("no-such-job"))));
  });

  it("keeps HQ-only documents from everyone, including the poster", async () => {
    const { poster, jobId } = await seed();
    const db = as(poster);
    await assertFails(getDoc(doc(db, "jobs", jobId, "private", "main")));
    await assertFails(getDocs(collection(db, "jobs", jobId, "submissions")));
    await assertFails(getDocs(collection(db, "ledger")));
    await assertFails(getDoc(doc(db, "vault", jobId)));
    await assertFails(getDoc(doc(db, "balances", accounts.fees)));
    await assertFails(getDocs(collection(db, "balances")));
  });

  it("refuses every client write", async () => {
    const { poster, jobId } = await seed();
    const db = as(poster);
    await assertFails(setDoc(doc(db, "owners", poster), { killSwitch: true }));
    await assertFails(setDoc(doc(db, "jobs", jobId), { state: "released" }));
    await assertFails(setDoc(doc(db, "balances", accounts.owner(poster)), { amount: 1e6 }));
    await assertFails(setDoc(doc(db, "agents", "new"), { ownerId: poster, role: "poster" }));
    await assertFails(setDoc(doc(db, "feed", "new"), { detail: "x" }));
    await assertFails(updateDoc(doc(db, "jobs", jobId), { budget: 1000 }));
    await assertFails(deleteDoc(doc(db, "jobs", jobId)));
  });

  it("makes the feed public, even signed out", async () => {
    const { poster } = await seed();
    const db = env.unauthenticatedContext().firestore();
    await assertSucceeds(getDocs(collection(db, "feed")));
    await assertFails(getDocs(collection(db, "jobs")));
    await assertFails(getDoc(doc(db, "owners", poster)));
    await assertFails(getDoc(doc(db, "balances", accounts.owner(poster))));
  });
});
