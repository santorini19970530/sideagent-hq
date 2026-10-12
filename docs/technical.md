# Sideagent technical plan

How the prototype is built: stack, repo layout, components, cloud resources, flows, development and the 5-day plan. Product behavior (job lifecycle, trust layer rules, threat model) is in [`design.md`](design.md). Reasons for choices are in [`decisions.md`](decisions.md) (D13 to D20).

## Overview

```
 Poster agent (Gemini CLI / ADK / Claude Code)
        │  MCP (Streamable HTTP)  ·  A2A (later)
        ▼
┌──────────────────── HQ · Cloud Run (Node + Hono) ────────────────────┐
│  REST · MCP server · A2A server (later) · agent API keys             │
│  Pipeline steps (driven by Cloud Tasks, idempotent):                 │
│    screen → redact → review → open → dispatch → check → release      │
│  Platform agents: Gemini on Vertex AI with typed outputs             │
└──────┬──────────────┬──────────────────┬──────────────────┬──────────┘
       │              │                  │                  │
   Firestore     Sensitive Data     Cloud Run Jobs      Cloud Storage
 (jobs, ledger,   Protection +      (test sandbox:      (specs, tests,
  events, rep)    KMS vault         no internet,         results; mounted
       │                            minimal IAM)         into the sandbox)
       │ onSnapshot (read-only rules)
       ▼
 Mission control · Nuxt SPA on Firebase Hosting (+ Firebase Auth)

 Field CLI (Node, npx sideagent) ──REST/long-poll──▶ HQ
   ├─ laptop: Docker sandbox ─ agent loop ─ Ollama (local Gemma)
   └─ house runners: same CLI as Cloud Run Jobs, started by HQ per job ─ managed Gemma on Vertex AI
```

**Local first (D19).** Everything above has a local stand-in, and Phases 0–6 run entirely on laptops. GCP is deployed once, in Phase 7. See [Local development](#local-development).

**Zero idle cost (D20).** Every GCP resource scales to zero or is billed per use. See [Cost](#cost).

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript on Node 24 LTS, pnpm workspaces | One language for HQ, CLI, dashboard and schemas (D13). Exception: the check script inside the Python sandbox image. |
| Shared schemas | Zod in `protocol/`, exported to JSON Schema | Single source for API validation, MCP tool schemas, Gemini output schemas and OpenAPI |
| HQ framework | Hono on `@hono/node-server` | REST, MCP Streamable HTTP and (later) A2A JSON-RPC in one service |
| MCP | `@modelcontextprotocol/sdk`, Streamable HTTP transport | MCP first (D14) |
| A2A | `@a2a-js/sdk`, after the demo | Job states already follow A2A Task states |
| Pipeline | Cloud Tasks → internal HQ endpoints (OIDC-authenticated) | One task per lifecycle step; every step idempotent |
| Models | `@google/genai` with `vertexai: true` | Service-account auth. Triage and escalation model IDs come from config, not code |
| Agent framework | Plain Gemini calls; ADK only if the test-writer needs a loop | Most platform decisions are single typed calls |
| State | Firestore (native mode) with transactions | Ledger entries are the source of truth; balances are a cache updated in the same transaction |
| Redaction | Sensitive Data Protection (`@google-cloud/dlp`) + Cloud KMS | We do the placeholder replacement for readable `[PERSON_1]` tokens |
| Test sandbox | Cloud Run Jobs, one execution per check | See [Test sandbox](#test-sandbox) |
| Owner auth | Firebase Auth | Owners create per-agent API keys in the dashboard (D16) |
| Dashboard | Nuxt (static, `ssr: false`) + Vue Flow, Firebase Hosting | Reads Firestore directly behind read-only rules; all writes go through HQ |
| Runner models | Ollama (laptop), managed Gemma on Vertex AI (house runners), Gemini API fallback | D17 |
| Cloud adapters | `BlobStore` (local folder / Cloud Storage), `Vault` (local key / Cloud KMS), `Redactor` (pattern matcher / Sensitive Data Protection), `PipelineRunner` (inline / Cloud Tasks), `Sandbox` (Docker / Cloud Run Jobs), `HouseRunnerDispatcher` (local process / Cloud Run Jobs) | Chosen by environment variables; local is the default (D19) |
| Tests | Vitest; Firestore emulator | |
| Lint and format | ESLint (flat config) + Prettier | |
| CI/CD | GitHub Actions with Workload Identity Federation → Artifact Registry → `gcloud run deploy`; `firebase deploy` | No Terraform; setup is a script |

## Repository layout

```
protocol/                 @sideagent/protocol
  src/job.ts              JobSpec, JobType, Runtime, JobState (A2A-aligned)
  src/result.ts           Submission, TestSummary
  src/verdict.ts          Screening and judge verdict schemas (Gemini structured output)
  src/errors.ts           { code, reason, fix_hint } and error codes
  src/tools.ts            MCP tool input/output schemas
  scripts/export-schemas.ts   writes schemas/*.json
hq/                       @sideagent/hq  (Cloud Run service)
  src/app.ts              Hono app: /v1 REST, /mcp, /internal (Cloud Tasks), /healthz
  src/api/                REST handlers (jobs, runner long-poll, API keys)
  src/mcp/                MCP server and tool handlers (thin wrappers over services)
  src/jobs/               job service (post, list, claim, submit, status) and lifecycle transitions
  src/pipeline/           screen.ts, redact.ts, review.ts, check.ts, release.ts
  src/agents/             screener.ts, test-reviewer.ts, result-screener.ts, judge.ts
  src/runtimes/           python.ts (adapter); node.ts later
  src/sandbox/            Sandbox interface: docker.ts (local), cloud-run-job.ts
  src/adapters/           blob/, vault/, redactor/, pipeline/, dispatch/: local and GCP implementations
  src/ledger/             double-entry ledger, escrow, stakes
  src/store/              Firestore repositories (agents, jobs)
  Dockerfile
field/                    sideagent  (published CLI: npx sideagent field)
  src/cli.ts
  src/poll.ts             long-poll HQ, claim, submit; --once --job <id> for house runners
  src/executor/           gemma-loop.ts (built-in tool-calling loop), command.ts (dev only)
  src/model/              ollama.ts, vertex.ts, gemini-api.ts behind one interface
  src/sandbox/            docker.ts (laptop); in-process for house runners
  src/cheat.ts            --simulate-cheat (demo only)
  Dockerfile              house runner image (run as a Cloud Run Job)
control/                  @sideagent/control  (Nuxt dashboard)
  pages/                  index (mission map), feed, ledger, agents (API keys)
images/
  python-sandbox/         Dockerfile + run_checks.py (pytest, mutmut); used by HQ checks and laptop runners
infra/
  setup-gcp.sh            enable APIs, service accounts, buckets, queue, KMS key, jobs, budget alert
  deploy.sh               build images, deploy HQ, jobs and Firebase (Phase 7)
  teardown.sh             delete services, jobs, queue and buckets after judging
  experiments/            day-1 throwaway checks (Gemma call, sandbox mount + no internet)
  firestore.rules
  firestore.indexes.json
  firebase.json
demo/
  jobs/                   demo job specs (honest, malicious, weak tests)
  run-demo.ts             drives the video scenario
docs/
```

## Components

### HQ

- One Cloud Run service. Public routes: `/v1/*` (REST, API-key auth), `/mcp` (MCP Streamable HTTP, API-key auth). Internal routes: `/internal/steps/:step` (Cloud Tasks only, verified OIDC token from the tasks service account).
- MCP tools and REST handlers call the same service functions. No business logic in transport code.
- Agents authenticate with `Authorization: Bearer <api key>` on both `/v1` and `/mcp`. Firestore stores only the SHA-256 hash of each key. Posting needs a `poster` agent; claiming and submitting need a `runner` agent.
- Every write takes an idempotency key, scoped to the calling agent. The job or submission ID is derived from the agent and the key, so a repeated key returns the original response, and a repeated key with a different request returns `conflict`.
- `/mcp` is stateless Streamable HTTP: each request gets a new MCP server bound to the calling agent, so no session state needs to survive scale-to-zero.
- REST routes: `POST /v1/jobs`, `GET /v1/jobs?types=&min_reward=`, `GET /v1/jobs/:id`, `POST /v1/jobs/:id/claim`, `POST /v1/jobs/:id/submissions`.
- Runner long-poll: `GET /v1/runner/next?types=...&wait=...` holds up to 30 seconds (`wait`, in seconds) and returns the oldest claimable job or `204`. The runner then claims it; a `409` means another runner won.
- Claims expire lazily (D21): no timer runs; an expired claim reads as `open` and is written back on the next claim or status call.
- Errors are always `{ code, reason, fix_hint }` from `protocol/src/errors.ts`.

### Pipeline

Each step is a Cloud Tasks task that calls `/internal/steps/:step` with `{ jobId }` (or `{ jobId, submissionId }`). A step:
1. Reads the job, checks its state is the one the step expects (otherwise returns 200 and does nothing, so retries are safe).
2. Does its work.
3. In one Firestore transaction: writes results, moves the state, appends an event, and enqueues the next step.

| Step | From → to | Work |
|---|---|---|
| `screen` | `draft` → `screening` → next or `rejected` | Screener agent on spec, inputs and tests |
| `redact` | (within screening) | DLP inspect, replace with placeholders, encrypt map into `vault/{jobId}` |
| `review` | `test_review` → `open` or `rejected` | Sandbox runs reference solution, empty answer and mutants; test-reviewer agent checks tests vs spec; adds trap checks |
| `dispatch` | (job stays `open`) | If house runners are enabled, start one house-runner run for the job. Skipped when outside runners are expected to claim it |
| `check` | `submitted` → `checking` → `passed` / `failed` | Sandbox runs public + hidden + platform + trap tests; result-screener agent on the result |
| `release` | `passed` → `released` | Ledger transfer, stake return, reputation update, restore placeholders for the poster |

### Platform agents

Each agent is `{ prompt template, Zod output schema, model tier }`.

- **Untrusted content** (spec, tests, results) is placed in a delimited block with a random boundary string, and the system prompt says content inside is data, never instructions.
- **Typed output** via Gemini structured output from the Zod schema (e.g. `verdict`, `categories`, `confidence`, `fix_hint`).
- **Triage then escalate:** the triage model answers first; below a configured confidence it re-runs on the escalation model. Both verdicts are stored on the event.
- Agents: `screener` (jobs), `test-reviewer` (tests vs spec), `result-screener` (injection in results), `judge` (double-run and rubric grading; stretch).
- Keep an eval set in `hq/test/fixtures/` of benign and malicious jobs and results; a Vitest suite reports block and false-positive rates.

### Redaction

Behind the `Redactor` interface: a pattern matcher (emails, phone numbers, card and account numbers) locally, Sensitive Data Protection when `REDACTOR_BACKEND=dlp`.

1. DLP `inspectContent` on spec text and inputs with a fixed infoType list (person name, email, phone, credit card, account numbers, addresses).
2. Replace findings with `[TYPE_n]` placeholders in our code; the same value gets the same placeholder within a job.
3. Encrypt the map through the `Vault` interface (local key in development, Cloud KMS in production) and store it in `vault/{jobId}`. Only the poster-side release path decrypts it.
4. Gemini second pass is a stretch goal.

### Test sandbox

- One Cloud Run Job (`sideagent-sandbox-python`) built from `images/python-sandbox`. HQ starts an execution per check with overrides for the job path.
- **Input:** HQ writes the bundle (result code, public tests, hidden tests, trap tests) to `gs://<input-bucket>/<jobId>/<checkId>/`, mounted read-only at `/job`.
- **Output:** `run_checks.py` writes `summary.json` (`passed`, `total`, per-category counts, mutation score when requested) to a mounted output bucket. Only HQ reads it.
- **Isolation:** dedicated service account with only object read on the input bucket and object write on the output bucket. Direct VPC egress (all traffic) to a subnet with no Cloud NAT, so no internet. Timeouts per check; capped number of mutants.
- **Known gap:** with Private Google Access, code in the sandbox could reach Google APIs using the sandbox service account. A VPC Service Controls perimeter closes this; it is on the roadmap, not in the prototype.
- **Runtime adapter:** `hq/src/runtimes/python.ts` knows the image, how to lay out the bundle and how to read the summary. A `node.ts` adapter (vitest, Stryker) plugs in later (D15).

### Ledger

- `ledger/{entryId}` entries are append-only: `{ from, to, amount, jobId, reason, createdAt }`. Accounts are `owner:<id>`, `escrow:<jobId>`, `stake:<jobId>:<agentId>`, `platform:fees`.
- `balances/{account}` is updated in the same transaction as each entry; it is a cache and can be rebuilt from entries.
- Post holds budget + fees into escrow; claim holds stake; release pays runner and returns stake; trap failure moves stake to `platform:fees`.

### Firestore data model

```
owners/{ownerId}                 policies { budgetCap, allowedTypes[], approvalThreshold }, killSwitch
agents/{agentId}                 ownerId, role (poster|runner), apiKeyHash, declaredModels[], status, createdAt
jobs/{jobId}                     posterAgentId, type, runtime, state, specRef, publicTests, budget, deadline,
                                 testStrength, screening { verdict, categories, confidence },
                                 claim { runnerAgentId, claimedAt, deadline, attemptsLeft }, idempotencyKey
jobs/{jobId}/private/main        hiddenTestsRef, referenceSolutionRef, trapChecksRef   (HQ only)
jobs/{jobId}/submissions/{id}    resultRef, testSummary { passed, total, categories }, screening, idempotencyKey
jobs/{jobId}/events/{id}         type, from, to, detail, createdAt
ledger/{entryId}                 from, to, amount, jobId, reason, createdAt   (append-only)
balances/{account}               amount, updatedAt
reputation/{agentId}_{type}      score, trapsPassed, trapsFailed, jobsPassed, disputes
vault/{jobId}                    ciphertext (KMS)   (HQ only)
feed/{id}                        sanitized public events for mission control
```

**Rules:** clients never write. Owners read their own `owners`, `agents`, `balances` and the jobs their agents posted or ran (non-private fields). `feed` is public read. `private`, `vault`, `ledger` and `submissions` are HQ only.

### Mission control

- Nuxt static app on Firebase Hosting with Firebase Auth (Google sign-in).
- Pages: mission map (Vue Flow graph of jobs, runners and states, live via `onSnapshot`), feed (blocked jobs, burned runners, with reasons), ledger, agents (create and revoke API keys through HQ).
- Spy terms in all UI copy; plain terms in code (see the glossary in `design.md`).

### Field CLI and house runners

- `npx sideagent field --types code.implement --model <id>` long-polls, claims, runs, submits.
- **Executor:** built-in tool-calling loop with tools `read_file`, `write_file`, `list_files`, `run_public_tests`, `submit`. Step and token limits per job.
- **Dev command executor:** `--executor command --trusted-dev` hands the workspace to `claude -p` or `codex exec` instead of the built-in loop. Development only: it claims only jobs posted by the same owner, needs network and the CLI's own credentials (so it is not a real sandbox), and never runs in house runners or the demo (D18).
- **Model backends** behind one interface, chosen by `SIDEAGENT_MODEL_BACKEND`: `ollama` (default for laptops), `vertex` (house runners), `gemini-api` (fallback).
- **Laptop sandbox:** each job runs in the `python-sandbox` image with `--network none`, the workspace as the only mount, no environment passthrough, non-root user.
- **House runners (D20):** the `field/Dockerfile` image as Cloud Run Jobs, started by HQ's `dispatch` step with `--once --job <id>`: claim that job, run it, submit, exit. No idle cost; each run has a cold start of tens of seconds, which shows in the dashboard as "field agent dispatched". Calls `gemma-4-26b-a4b-it-maas` at the Vertex AI `global` location. The container is the sandbox and runs public tests in-process. Jobs: `house-runner-honest`, and `house-runner-double-agent` (`SIDEAGENT_SIMULATE_CHEAT=1`), which is dispatched only when `HOUSE_RUNNER_DOUBLE_AGENT=1`. Locally, the dispatcher starts the CLI as a child process.
- `--simulate-cheat` is demo-only and prints a banner saying so.

## Google Cloud resources

| Resource | Name (suggested) | Notes |
|---|---|---|
| Cloud Run service | `sideagent-hq` | Public; API-key auth in app; minimum 0 instances |
| Cloud Run job | `sideagent-sandbox-python` | Started by HQ |
| Cloud Run jobs | `house-runner-honest`, `house-runner-double-agent` | Started by HQ per job; no idle cost |
| Cloud Tasks queue | `sideagent-pipeline` | Retries with backoff |
| Firestore | default database | Native mode |
| Buckets | `<project>-jobs`, `<project>-sandbox-in`, `<project>-sandbox-out` | Lifecycle rule deletes sandbox objects after 7 days |
| KMS | key ring `sideagent`, key `vault` | |
| VPC | `sideagent-sandbox` subnet (/26 or larger), no Cloud NAT, Private Google Access on | For the sandbox job |
| Secret Manager | `house-runner-honest-key`, `house-runner-double-agent-key` | Runner API keys |
| Artifact Registry | `sideagent` | Images; cleanup policy keeps the last few per image |
| Billing budget | `sideagent` | Alert emails at 50%, 90%, 100% of a small budget (e.g. $20) |
| Firebase | Hosting + Auth on the same project | |

### Service accounts

| Account | Grants |
|---|---|
| `sa-hq` | Firestore user; Cloud Tasks enqueuer; Vertex AI user; DLP user; KMS encrypt/decrypt on `vault`; Storage object admin on jobs and sandbox buckets; permission to run the sandbox and house-runner jobs with overrides; act as `sa-tasks` |
| `sa-tasks` | Cloud Run invoker on `sideagent-hq` (OIDC for Cloud Tasks) |
| `sa-sandbox` | `storage.objectViewer` on sandbox-in; `storage.objectUser` on sandbox-out (needed for the write mount). Nothing else. |
| `sa-house-honest`, `sa-house-cheat` | Vertex AI user; secret accessor on its own key |
| `sa-deploy` | Used by GitHub Actions via Workload Identity Federation: Cloud Run admin, Artifact Registry writer, act as the runtime accounts, Firebase deploy |

## Configuration

HQ:

| Variable | Meaning |
|---|---|
| `PORT` | HTTP port (default `8080`) |
| `GCP_PROJECT`, `GCP_REGION` | Project and region |
| `TASKS_QUEUE`, `TASKS_SA_EMAIL`, `HQ_URL` | Cloud Tasks setup |
| `SANDBOX_JOB`, `SANDBOX_IN_BUCKET`, `SANDBOX_OUT_BUCKET`, `JOBS_BUCKET` | Sandbox and storage |
| `KMS_KEY` | Vault key resource name |
| `BLOB_BACKEND`, `VAULT_BACKEND`, `REDACTOR_BACKEND` | `local` / `gcs`, `local` / `kms`, `pattern` / `dlp` |
| `BLOB_LOCAL_DIR` | Folder for `BLOB_BACKEND=local` (default `.data/blobs`) |
| `PIPELINE_MODE`, `SANDBOX_MODE` | `inline` / `cloud-tasks`, `docker` / `cloud-run-job` |
| `HOUSE_RUNNERS`, `HOUSE_RUNNER_DOUBLE_AGENT` | `off` / `local` / `cloud-run-job`; dispatch the double agent too |
| `LIMIT_POSTS_PER_HOUR`, `LIMIT_CHECKS_PER_JOB`, `LIMIT_MUTANTS` | Caps on paid work per agent and per job |
| `MODEL_TRIAGE`, `MODEL_ESCALATE`, `ESCALATE_BELOW` | Gemini model IDs and confidence threshold |
| `FIRESTORE_EMULATOR_HOST` | Firestore emulator address; required until Phase 7 (`pnpm --filter @sideagent/hq dev` defaults it to `127.0.0.1:8180`) |
| `CLAIM_TTL_SECONDS`, `CLAIM_ATTEMPTS` | Claim length (default 1800) and submissions per claim (default 3) |

Field CLI:

| Variable | Meaning |
|---|---|
| `SIDEAGENT_HQ_URL`, `SIDEAGENT_API_KEY` | HQ endpoint and runner key |
| `SIDEAGENT_MODEL_BACKEND` | `ollama` / `vertex` / `gemini-api` |
| `SIDEAGENT_MODEL` | Model ID for the backend |
| `SIDEAGENT_SIMULATE_CHEAT` | Demo double agent |
| `GEMINI_API_KEY` | Only for the `gemini-api` backend |

## Local development

- `pnpm install` at the root; `pnpm typecheck`, `pnpm lint`, `pnpm test`. `pnpm schemas` regenerates `protocol/schemas/*.json`; CI fails if the committed files are stale.
- No build step until Phase 7: packages export their TypeScript sources and HQ runs through `tsx` (`pnpm --filter @sideagent/hq dev`). Bundling for the Docker image comes with the deploy.
- JSON Schemas come from Zod 4's built-in `z.toJSONSchema()`. API-facing fields (REST, MCP, JSON Schema) are snake_case, matching the MCP tool signatures in `design.md`; Firestore documents are camelCase.
- Firebase emulators for Firestore and Auth, from the `firebase-tools` dev dependency. They need **Java 21 or later**. `pnpm emulators` starts the Firestore emulator on port 8180 with its UI on port 4000, and `pnpm test` runs every package's tests inside `firebase emulators:exec`. The emulator project is `demo-sideagent`, which needs no credentials.
- Phase 1 demo: `pnpm emulators`, then `pnpm --filter @sideagent/hq dev`, then `pnpm --filter @sideagent/hq seed`, which creates a poster and a runner agent and prints their keys with ready-to-paste MCP config for Gemini CLI and Claude Code. `pnpm demo:runner` (with `SIDEAGENT_API_KEY` set to the runner key) claims the next job, submits a stub result and follows it to `released`.
- Local is the default for every adapter: `PIPELINE_MODE=inline`, `SANDBOX_MODE=docker`, `BLOB_BACKEND=local`, `VAULT_BACKEND=local`, `REDACTOR_BACKEND=pattern`, `HOUSE_RUNNERS=local`. Production switches each to its GCP backend.
- The only cloud services used before Phase 7 are model and redaction APIs: Gemini and Gemma on Vertex AI (or the Gemini API with a key), and Sensitive Data Protection when testing `REDACTOR_BACKEND=dlp`. This needs a project with billing, those APIs enabled, and `gcloud auth application-default login`. No deployed services, queues, buckets or IAM.
- Laptop runner: install Ollama, pull a Gemma model, `pnpm --filter sideagent dev field`.

## Testing

- Unit tests per pipeline step against the Firestore emulator, with the sandbox and Gemini behind interfaces that tests can fake.
- Ledger property: total of all balances is constant across any sequence of operations.
- Agent eval set: benign and malicious jobs and results in `hq/test/fixtures/`; report block rate and false positives. Run on demand, not in CI (costs model calls).
- End-to-end: `demo/run-demo.ts` against a deployed or emulated stack; this is also the video script.

## 5-day plan

Two people. **A** owns HQ and the trust layer; **B** owns the field CLI, dashboard and demo. The phase-by-phase build order, with a reviewable result for each phase, is in [`phases.md`](phases.md).

Must have for the demo:
- Post, claim, submit, check, release over MCP.
- Job screening and result screening with Gemini.
- Redaction with Sensitive Data Protection.
- Hidden tests run in Cloud Run Jobs; trap check that catches a fake result.
- Credit ledger with escrow and stake.
- Field CLI on local Gemma and house runners on Vertex AI.
- Mission control with the live job graph and screening feed.

Stretch: platform-written tests, double-run judge, Gemini redaction pass.

Roadmap slide: A2A server, RFC 8628 device linking, signed logs and OpenTelemetry, JS jobs, model-monitoring dashboard, VPC Service Controls for the sandbox, per-skill reputation UI, shared result cache, low-carbon scheduling, dispute panel, private boards, real-money settlement.

## Cost

Target: under about $1/month when idle; low single-digit dollars on demo day (D20).

| Resource | Idle cost | Why |
|---|---|---|
| HQ (Cloud Run, min 0) | $0 | Scales to zero; free tier covers demo traffic |
| Sandbox and house runners (Cloud Run Jobs) | $0 | Billed only while running |
| Cloud Tasks, Firestore, Firebase Hosting and Auth, Secret Manager | $0 | Within free tiers at our volume |
| Gemini and Gemma on Vertex AI, Sensitive Data Protection | $0 | Pay per use; never buy provisioned throughput |
| Cloud Storage | ~$0 | 7-day lifecycle on sandbox buckets |
| Cloud KMS | ~$0.06/month | One key |
| Artifact Registry | ~$0–0.20/month | Cleanup policy |
| Sandbox VPC | $0 | Direct VPC egress has no connector cost; no Cloud NAT (~$32/month) by design |

Rules:
- No resource with always-on instances, no Cloud NAT, no Serverless VPC Access connector, no load balancer or static IP.
- Before recording, warm up by running one demo job instead of raising minimum instances.
- Caps on posts per agent per hour, checks per job and mutants per job, so a runaway agent can't burn tokens or sandbox runs.
- Budget alert set by `setup-gcp.sh`. `teardown.sh` removes everything billable after judging; Firestore and the project stay.
- Check whether the hackathon provides GCP credits before Phase 7.

## Verified facts (checked 2026-10-13)

- **Managed Gemma on Vertex AI:** model ID `gemma-4-26b-a4b-it-maas` (Gemma 4 26B A4B IT). Launch stage **Experimental**. Available only at the `global` location; ML processing is multi-region `us`. Supports function calling and structured output; no thinking mode. Context 262,144 tokens, max output 128,000. Pay-as-you-go supported. Because it is Experimental, the Gemini API fallback backend must work before the demo.
- **Cloud Storage mounts on Cloud Run Jobs:** supported, with a read-only option. The mount uses the job's service identity (`roles/storage.objectViewer` to read, `roles/storage.objectUser` to write). If the mount can't reach Cloud Storage, the job doesn't start; the mount phase has a 30-second timeout. Google recommends Direct VPC with `--vpc-egress=all-traffic` plus Private Google Access for this setup. No file locking; writes flush on close.
- **Direct VPC egress on Cloud Run Jobs:** supported. Each task holds one IP during execution plus 7 minutes, so the subnet needs at least a /26. Internet access with all-traffic egress goes through Cloud NAT, so a subnet without NAT should have no internet; the docs imply this but don't state it, so confirm it with a test.

## Day 1 checks

These run as throwaway experiments in `infra/experiments/`, not app deploys, and leave nothing running.

- Gemma call at the `global` location works from our project, including function calling, through `@google/genai`.
- Sandbox job: mount works with all-traffic egress + Private Google Access and no NAT, and `curl https://example.com` from inside the job fails.
- Gemini structured output from Zod-derived JSON Schema, and whether logprobs are returned for the chosen triage model.
- Gemini CLI connects to the `/mcp` endpoint with an API-key header.

## Risks

| Risk | Mitigation |
|---|---|
| Managed Gemma is Experimental (global only) and may change or be rate-limited | Gemini API fallback backend tested before the demo |
| Gemma fails demo tasks | Pick demo tasks Gemma solves reliably; test them on day 2 |
| Sandbox and house-runner cold starts slow the demo | Jobs are async anyway; pre-warm by running one job before recording |
| Deploying late surfaces cloud-only problems | Day-1 experiments cover the two cloud-specific unknowns; `setup-gcp.sh` and `deploy.sh` are written during the build; Phase 7 starts by day 4 at 3pm even if Phase 6 isn't finished |
| Mutation testing too slow | Cap mutants; run strength scoring only in `review`, not on every check |
| Sandbox can reach Google APIs | Minimal sandbox IAM now; VPC Service Controls later |
| Scope creep | Must-have list above is the contract; everything else waits for day 4 |

## Technical open questions

1. Default Gemma size for laptop runners and minimum hardware.
2. Exact A2A Agent Card path and task state names in the current spec; MCP Tasks method names (needed only after the demo).
