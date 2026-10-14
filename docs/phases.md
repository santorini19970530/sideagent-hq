# Implementation phases

Build order for the 5-day, 2-person prototype. Every phase ends with something a person can review: a demo, a recording or a test run. From Phase 4 on, the dashboard shows each phase live.

Person **A** owns HQ and the trust layer. Person **B** owns the field CLI, dashboard and demo. The must-have list in [`technical.md`](technical.md#5-day-plan) is the contract; this file is the order of work.

**Local first (D19):** Phases 0–6 run on laptops with local stand-ins (emulators, Docker sandbox, inline pipeline, local blob store, vault and redactor). The only cloud calls before Phase 7 are model APIs and, optionally, Sensitive Data Protection. GCP is deployed once, in Phase 7. Two cloud-only unknowns are tested on day 1 as throwaway experiments.

## Overview

| # | Phase | Owner | Day | Runs | Review |
|---|---|---|---|---|---|
| 0 | Skeleton + day-1 experiments | A | 1 AM | Local; throwaway GCP experiments | CI green; HQ `/healthz` on localhost; experiment results recorded |
| 1 | Job board over MCP (no checks yet) | A | 1 | Local | Demo: Gemini CLI and Claude Code or Codex post jobs; a script claims and submits |
| 2a | Runner protocol with dev command executor | B | 1 | Local | Recording: claim → solve with `claude -p` / `codex exec` → submit |
| 2b | Gemma field agent with Docker sandbox | B | 2 | Local | Recording: the same job solved by Gemma with no network |
| 3 | Real checks and escrow | A | 2 | Local | Demo + tests: correct answer paid, wrong answer withheld; sandbox has no network |
| 4 | Mission control v1 | B | 3 | Local | Demo: a job moving live in the dashboard, with a local house runner finishing it |
| 5 | Counterintelligence | A (B: feed) | 3–4 | Local + model APIs | Demo: malicious job blocked, private data redacted, double agent burned |
| 6 | Test review | A | 4 | Local | Demo: weak tests get a low strength score and a fix hint |
| 7 | Deploy to GCP | A+B | 4 PM | GCP | Demo: Gemini CLI posts to live HQ; a dispatched house runner finishes; nothing runs when idle |
| 8 | Demo hardening and submission | A+B | 5 | GCP | Final video, deck PDF, frozen deploys |

**Checkpoints**
- **End of day 2:** the core works end to end locally (post → solve → check → pay).
- **Day 4, 3pm:** Phase 7 starts even if Phase 5 or 6 isn't finished. A deployed core beats a finished local feature, because judges need a live URL.
- If days 3–4 run short, cut Phase 6 before Phase 5.

**Dependencies:** Phase 2a needs only the `protocol/` schemas from Phase 0, so B is not blocked by A. B writes the Terraform (`infra/terraform/`, D33) and `infra/deploy.sh` alongside Phases 4–5 so Phase 7 is mostly running scripts.

## Phase 0: Skeleton + day-1 experiments

**Scope**
- pnpm workspace, TypeScript config, ESLint, Prettier, Vitest; GitHub Actions running typecheck, lint and test (no deploy steps yet).
- `protocol/` with first schemas: `JobSpec`, `JobState`, `Submission`, `TestSummary`, errors; JSON Schema export.
- Hono HQ with `/healthz` running locally.
- Adapter interfaces with local implementations: `BlobStore`, `PipelineRunner`, `Sandbox` (stub), later filled in by each phase.
- **Day-1 experiments** in `infra/experiments/` (throwaway, nothing left running):
  - Call managed Gemma (`gemma-4-26b-a4b-it-maas`, `global`) with function calling through `@google/genai`.
  - One Cloud Run Job mounting a bucket with all-traffic egress to a subnet without NAT: mount works, `curl https://example.com` fails. Delete it afterwards.

**Review**
- CI green on a pull request.
- `curl localhost:<port>/healthz` returns OK.
- `protocol/schemas/*.json` generated.
- Experiment results recorded in `technical.md` under "Verified facts". If either fails, raise it the same day.

## Phase 1: Job board over MCP, no checks yet

**Scope**
- MCP tools `post_job`, `list_jobs`, `claim_job`, `submit_result`, `get_status` on `/mcp`, plus matching REST routes for runners.
- Per-agent API keys, created by a seed script.
- Firestore emulator; `PIPELINE_MODE=inline`; `BLOB_BACKEND=local`; every submission auto-passes.

**Review demo**
- Gemini CLI connected to local HQ posts a job. Claude Code or Codex connected to the same HQ posts another, showing any MCP agent can delegate.
- A small script claims and submits. The Firestore emulator UI shows each state change.

**Tests**
- Valid and invalid state transitions.
- Idempotency: repeating `post_job` with the same key returns the same job.
- Claim timeout returns the job to `open`.

## Phase 2a: Runner protocol with dev command executor

**Scope**
- `sideagent field`: long-poll, claim, prepare a throwaway workspace, run an executor, submit. Also `--once --job <id>` (used by house runners).
- Executor interface with a **dev-only command executor** that runs `claude -p "<prompt>"` or `codex exec "<prompt>"` in the workspace.
- The command executor requires `--executor command --trusted-dev` and only claims jobs posted by the same owner (D18).

**Review**
- Terminal recording: runner picks up a Phase 1 job, Claude Code or Codex solves it, runner submits, `get_status` shows `submitted`.

**Tests**
- Executor interface with a fake executor.
- The command executor refuses jobs from other owners and refuses to start without `--trusted-dev`.

## Phase 2b: Gemma field agent with Docker sandbox

**Scope**
- Built-in tool-calling loop (`read_file`, `write_file`, `list_files`, `run_public_tests`, `submit`) with step and token limits.
- Model backends behind one interface: `ollama`, `vertex`, `gemini-api`.
- Docker sandbox from `images/python-sandbox` with `--network none`, workspace as the only mount, no environment passthrough, non-root user.

**Review**
- Terminal recording: the Phase 2a job solved by Gemma through Ollama inside the sandbox. Recorded in `demo/recordings/phase2b-field-gemma.cast` (`asciinema play` it) with a slugify job instead of the Phase 2a one: posted to local HQ, solved by `sideagent field --once` on Ollama Gemma, passed 3/3 and released.
- The same job solved with the `vertex` backend (Gemini 2.5 Flash-Lite, D26), as house runners will.
- Side-by-side note of which demo jobs Gemma solves reliably compared with Claude Code or Codex. Use it to pick the demo jobs. Done: "Field runner checks" in `technical.md`.

**Tests**
- Agent loop with a fake model.
- Sandbox test: environment variables and the network are unreachable from inside.

## Phase 3: Real checks and escrow

**Scope**
- `images/python-sandbox/run_checks.py` (pytest) writing `summary.json`.
- `check` step runs public and hidden tests with `SANDBOX_MODE=docker`. The Cloud Run Jobs implementation of `Sandbox` is written in Phase 7, against the same interface, because it can't be run before then.
- Ledger: post holds budget in escrow, claim holds stake, pass pays the runner and returns the stake, fail withholds the result from the poster.

**Review demo**
- `demo/` script posts one job, submits a correct and a wrong answer, prints balances before and after, and shows the poster sees only counts for the wrong one.

**Tests**
- Ledger invariant: the sum of all balances is constant across random sequences of operations.
- Hidden tests never appear in any runner-facing response.
- Sandbox container has no network.

## Phase 4: Mission control v1

**Scope**
- Nuxt app with Firebase Auth (emulator) and Google sign-in, served by `nuxt dev`.
- Pages: mission map (live job graph with Vue Flow), ledger, agents (create and revoke API keys through HQ, replacing the seed script).
- Read-only Firestore rules.
- HQ `dispatch` step with `HOUSE_RUNNERS=local`: starts `sideagent field --once --job <id>` as a child process.

**Review demo**
- Gemini CLI posts a job; the local house runner is dispatched and finishes it; the job moves across the map and credits move in the ledger, live.
- Done locally (2026-10-15): signed in through the Auth emulator, issued a handler key on the Field agents page, posted a slugify job with it through `/mcp` (the call Gemini CLI makes). The house runner (Gemini 2.5 Flash-Lite) was dispatched, claimed it and passed 3/3. The card moved from "In the field" to "Dead drop" and the balance went from 100 to 88 credits, with escrow and stake back to 0, all without a reload. Recorded in `demo/recordings/phase4-mission-control.mp4` (the dashboard, 20 s) and `demo/recordings/phase4-mission-control.cast` (`asciinema play` it: the MCP post and the house runner's log). Both come from one run that signs in, issues the handler key in the dashboard and posts the job. That run passed 3/3, ending at 88 credits with escrow 0.
- Gap found while recording: Flash-Lite's slugify answer sometimes fails a hidden test. The job then goes back to the house runner (D23), but a `--once` run had already exited, so the job stayed `claimed` until the claim timed out. Fixed: a runner now waits for the check after each submit and tries again under the same claim while it has attempts left.

**Tests**
- Firestore rules tests against the emulator: clients can't write, and can't read `private`, `vault`, `ledger` or `submissions`.

## Phase 5: Counterintelligence

**Scope**
- Screener (jobs) and result-screener (results) agents with triage then escalation, calling Gemini on Vertex AI from the laptop.
- Redaction behind `Redactor`: pattern matcher by default; Sensitive Data Protection verified once with `REDACTOR_BACKEND=dlp`. Placeholder map encrypted through `Vault` (local key) and restored on release.
- Trap checks added to every job; a trap failure slashes the stake and burns the runner.
- Local double-agent house runner with `HOUSE_RUNNER_DOUBLE_AGENT=1`.
- Feed page in the dashboard (B).

**Review demo** with three jobs from `demo/jobs/`:
1. A job trying to read the runner's `.env` is blocked; the reason appears in the feed.
2. A job containing an email and an account number reaches the runner as `[EMAIL_1]` and `[ACCT_1]`; the poster gets real values back.
3. The double agent fails a trap check, is burned and loses its stake.

- Done locally (2026-10-15) with `pnpm demo:counterintel` against Gemini on Vertex AI and the Docker sandbox: the `.env` job was rejected in 1.6 s with a fix hint and a feed entry; the private-data job reached the runner as `[EMAIL_1]` and `[ACCT_1]` and the poster got the real values back; the double agent's lookup table of the public answers failed the trap checks (D29), lost its stake and was burned. The script plays the double agent with the same code as `SIDEAGENT_SIMULATE_CHEAT=1`; with `HOUSE_RUNNER_DOUBLE_AGENT=1` HQ dispatches it as a house runner instead. Results under "Counterintelligence checks" in `technical.md`.
- Also done: the first part of Phase 6 test review (the reference solution must pass its tests), because trap checks need it. `REDACTOR_BACKEND=dlp` (Sensitive Data Protection) and the Cloud KMS vault came with Phase 7.

**Tests**
- Screener eval set reports block rate and false positives (run on demand, not in CI): `pnpm --filter @sideagent/hq eval:screening`, 6/6 blocked and 0/6 false positives on Flash-Lite.
- Trap failure moves the stake to `platform:fees`.

## Phase 6: Test review

**Scope**
- `review` step: reference solution must pass, empty answer must fail.
- Mutation score with capped mutants (mutmut) in the Docker sandbox.
- Test-reviewer agent checks tests against the spec.
- Weak or missing tests return a fix hint. Platform-written tests are a stretch goal.

**Review demo**
- A job with `assert result is not None` gets a low strength score and a fix hint.
- A job whose tests contradict its spec is rejected with an explanation.
- A good job opens with a high score shown in the dashboard.

**If behind:** keep only the reference-solution and empty-answer checks; move the mutation score to the roadmap slide.

- Done locally (2026-10-15): the empty-answer check (tests an empty answer passes get the job rejected as `tests_invalid`) and the strength score from up to 12 mutants of the reference solution (D31). Weak tests open with `test_strength` on the board and in mission control, and a `test_fix_hint` for the poster only. Covered by tests with the fake sandbox and against the Docker image (`assert diff(5, 2) is not None` catches 1 of 5 mutants; exact asserts catch 5 of 5). Not yet: the test-reviewer agent (tests contradicting the spec), platform-written tests, and a recorded demo against live HQ.

## Phase 7: Deploy to GCP

Starts by day 4 at 3pm at the latest.

**Scope**
- `infra/terraform/` (D33): APIs, service accounts, buckets with lifecycle rules, Cloud Tasks queue, KMS key, sandbox subnet (no NAT), Artifact Registry cleanup policy, Cloud Run services and jobs, budget with `budget-guard`.
- `infra/deploy.sh`: build images; deploy `sideagent-hq` (minimum 0 instances), `sideagent-sandbox-python`, `house-runner-honest` and `house-runner-double-agent` as Cloud Run Jobs; deploy the dashboard, rules and indexes to Firebase.
- `Sandbox` for Cloud Run Jobs (`hq/src/sandbox/cloud-run-job.ts`), deferred from Phase 3.
- Switch adapters to GCP: `PIPELINE_MODE=cloud-tasks`, `SANDBOX_MODE=cloud-run-job`, `BLOB_BACKEND=gcs`, `VAULT_BACKEND=kms`, `REDACTOR_BACKEND=dlp`, `HOUSE_RUNNERS=cloud-run-job`.
- Add deploy steps to GitHub Actions (Workload Identity Federation).
- Gemini API fallback backend tested against production.
- Spend caps (D32), built and tested locally first: HQ limits on posts per owner per hour, posts per day and checks per job, the `config/platform.paused` kill switch and the house-runner token cap; GCP settings in the scripts (HQ max 2 instances, jobs with `--max-retries 0` and a task timeout, Cloud Tasks `--max-attempts 5`); the $10 budget with the `budget-guard` function (pause at 100%, billing off at 200%). `terraform destroy` removes everything billable after judging.
- Done locally (2026-10-15): the HQ caps (`LIMIT_POSTS_PER_HOUR`, `LIMIT_POSTS_PER_DAY`, `LIMIT_CHECKS_PER_JOB`), the kill switch and `HOUSE_RUNNER_MAX_TOKENS`, covered by `hq/test/limits.test.ts`.
- Deployed (2026-10-15): Terraform applied (79 resources), images built and rolled out, house-runner keys seeded. A job posted to live HQ went through screening, test review on the Cloud Run sandbox, a dispatched house runner and a 12/12 check to release in about 2.5 minutes; the budget guard paused the platform on a 100% notification and posts were refused. Details under "Production checks" in `technical.md`. Sandbox steps run one at a time on their own queue, so concurrent checks can't see each other's hidden tests.
- Not yet: mission control on Firebase Hosting (Firebase is linked and the web app registered; Google sign-in has to be turned on in the console, and the Firebase CLI needs the project owner's login), the Gemini CLI demo against live HQ, the per-hour limit and the 200% billing-off path live, and the GitHub Actions deploy steps.

**Review demo**
- Gemini CLI pointed at the live HQ posts a job; HQ dispatches a house runner; the result comes back; the job moves in the dashboard on its Firebase URL.
- Rerun the Phase 5 demo jobs against production.
- After 15 minutes idle, `gcloud run services list` and `gcloud run jobs executions list` show nothing running.
- Against production: an 11th post in one hour gets `rate_limited`; setting `config/platform.paused` refuses posts; a test budget notification at 100% makes `budget-guard` pause the platform (the 200% path is checked with a dry run, not by turning billing off).

## Phase 8: Demo hardening and submission

**Scope**
- `demo/run-demo.ts` drives the full video scenario from `proposal.md`.
- Warm up by running one demo job, rehearse twice, freeze deploys.
- Record the 3-minute video; build the deck PDF from `proposal.md`.

**Review**
- Final video and deck.
- Clean run of the demo script against production.
