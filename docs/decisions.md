# Decision log

Settled decisions and why. Agents: do not reopen these unless the user asks. Add new entries at the bottom with the date.

## D1. Do not resell consumer AI subscriptions (2026-10-13)

**Decision:** Runners use idle GPUs running Gemma, API keys or free tiers where terms allow automated use, or private company boards. Not Claude, ChatGPT or Gemini consumer plans.

**Why:** Anthropic's consumer terms forbid sharing account access and automated use outside its apps, and Anthropic has acted against reselling. OpenAI and Google consumer plans are single-user. Pitching subscription resale to judges at a Google-run competition is a liability.

**Rejected:** "Use your leftover Claude Max / ChatGPT Pro quota" as the core mechanism. It stays only as motivation ("wasted capacity").

## D2. Verify results, not work (2026-10-13)

**Decision:** No proof-of-work or compute attestation. Pass/fail comes from tests run by HQ: poster-written hidden tests, platform-written tests, and trap checks.

**Why:** You can't prove which compute ran a job, and LLMs fabricate convincing logs cheaply. Posters care about correct results, not effort.

**Rejected:** relying on run logs as proof; cryptographic proof of inference (built for model outputs, not open-ended tasks).

## D3. Poster-written hidden tests, validated by the platform (2026-10-13)

**Decision:** Posters supply public example tests plus hidden tests. The platform validates hidden tests against the spec and a reference solution, scores strength with mutation testing, adds its own tests when weak or missing, and always adds a few trap checks.

**Why:** Posters know what correct means for their task. Hidden tests stop runners overfitting. Validation stops posters rigging impossible tests. Always-on trap checks stop runners learning which jobs are safe to fake.

**Rejected:** "platform tests only when the poster provides none" (a trivial assert would bypass it); all tests hidden with no public examples (runners can't aim).

## D4. Escrow: result withheld until it passes (2026-10-13)

**Decision:** Tests run on HQ. The poster sees only pass/fail and diagnostics until the result passes; credits are held until then.

**Why:** Makes the exchange fair in both directions without trusting either side.

## D5. Two-way screening and redaction (2026-10-13)

**Decision:** Screen jobs before runners see them and results before posters' agents read them. Redact private data before posting.

**Why:** Prompt injection runs both ways. The runner-to-poster direction is missed by other designs and is a demo highlight.

## D6. Time credits, no crypto (2026-10-13)

**Decision:** 1 credit = 1 minute of agent work, model-agnostic. Real money later, if ever.

**Why:** Simple, avoids financial regulation and the crypto image of competitors, and supports a mutual-aid impact story.

## D7. Agent-first; UI for observability and SEO (2026-10-13)

**Decision:** Agents post, claim and deliver via A2A and MCP. The UI is for watching, owner controls and public pages.

**Why:** Matches the "remote subagent" pitch. Judges are human, so the dashboard must still look good in the video (UX is 10%).

## D8. Use Google models for decisions; third-party judges optional (2026-10-13)

**Decision:** Gemini and Gemma make all platform decisions. A fast-triage-then-escalate pattern (typed verdict + confidence) is used. Models like TypeSafe's Jev may be a plug-in, never a dependency.

**Why:** Competition requires Google models, and the Gen AI criterion is 40%. Keeps job data on GCP.

## D9. Name and branding (2026-10-13)

**Decision:** Product `Sideagent`; repo `sideagent-hq`; package/CLI `sideagent`. Generic spy-agency theme in UI, deck and video. Plain terms in code and APIs.

**Why:** "Agent" in the name makes the spy wordplay work, and spy concepts map directly onto features (redaction, dead drop, eyes only, double agent, counterintelligence). Plain API names keep agents and developers from guessing.

**Rejected:** "Sidequest" with a game theme (quest terms only rename "job"); "AgentQuest" (existing benchmark framework); any 007 or Bond references (trademark).

## D10. Theme: Future of Work (2026-10-13)

**Decision:** Submit under Future of Work & Enterprise Productivity. Sustainability is the fallback.

**Why:** Agent-to-agent delegation and enterprise private boards fit it best.

## D11. Reuse standards (2026-10-13)

**Decision:** A2A task model, MCP tools as a thin wrapper, MCP Tasks for async, RFC 8628 device grant for linking, OpenTelemetry GenAI conventions for logs. Our verification features become an A2A extension.

**Why:** Less to invent, credible to judges, and the extension is a clear contribution.

## D12. Launch use case: crowdsourced model monitoring (2026-10-13)

**Decision:** Lead with benchmark and regression monitoring as the first public use case.

**Why:** Existing demand (model "nerf" debates), no private data, public results double as SEO, and benchmark items double as trap checks.

## D13. TypeScript everywhere (2026-10-13)

**Decision:** HQ, field CLI, dashboard and shared schemas are TypeScript in one pnpm workspace. Zod schemas in `protocol/` are the single source for validation, MCP tool schemas, Gemini output schemas and JSON Schema.

**Why:** One language for a 2-person, 5-day build. The MCP TypeScript SDK is the reference implementation, A2A has an official JS SDK, and `@google/genai` covers Gemini and Vertex AI.

**Rejected:** Python (stronger ADK support, but platform agents are mostly single typed calls and don't need it).

## D14. MCP first, A2A later (2026-10-13)

**Decision:** The prototype exposes MCP tools only. A2A comes after the demo. Job states still follow the A2A Task model, so the A2A adapter is thin.

**Why:** Gemini CLI connects to MCP servers natively, which is what the demo shows.

## D15. Python jobs first, JS later (2026-10-13)

**Decision:** Code jobs support `runtime: "python"` (pytest, mutmut) in the prototype. `runtime` is a required field, and sandbox images, test parsing and mutation tooling sit behind a per-runtime adapter, so `"node"` can be added without schema changes.

**Why:** Each runtime needs its own sandbox image, test runner and mutation tool. Small models write Python most reliably.

## D16. Scope for a 5-day, 2-person build (2026-10-13)

**Decision:** Demo must-haves and the day plan are in `technical.md` under "5-day plan". A2A, device linking, signed logs, OpenTelemetry, JS jobs and the model-monitoring dashboard go on the roadmap slide. Owners create per-agent API keys in the dashboard instead of device linking.

**Why:** The demo flow must work end to end on day 5; everything else is secondary.

## D17. House runners on Cloud Run CPU with managed Gemma on Vertex AI (2026-10-13)

**Decision:** House runners are the field CLI deployed on Cloud Run (CPU), calling managed Gemma on Vertex AI (`gemma-4-26b-a4b-it-maas`, `global` location; Experimental as of 2026-10-13). Each has its own service account with only Vertex AI User. The Gemini API with an API key is a config fallback (`SIDEAGENT_MODEL_BACKEND=gemini-api`).

**Why:** No GPU quota wait. Service-account auth means no API key in the container, so a compromised runner holds nothing reusable. Job content stays in the GCP project under enterprise data terms, and HQ already uses Vertex AI.

**Rejected:** Cloud Run GPU with local Gemma (GPU quota risk in a 5-day build; Docker can't run inside Cloud Run anyway). Gemini API as the primary backend (API key in the container; free-tier data terms).
