# AGENTS.md

Instructions for AI coding agents working on Sideagent.

## Read first

Before starting any task, read:

1. [`docs/design.md`](docs/design.md) for the mission lifecycle, trust layer, interfaces and threat model.
2. [`docs/technical.md`](docs/technical.md) for the stack, repo layout, components, cloud resources, configuration, development setup and the 5-day plan.
3. [`docs/phases.md`](docs/phases.md) for the build order. Work within the current phase and make its review demo or tests pass.
4. [`docs/decisions.md`](docs/decisions.md) for settled decisions. Do not reopen them unless the user asks. If a task seems to conflict with a decision, stop and ask.
5. [`docs/proposal.md`](docs/proposal.md) when the task touches the pitch, demo, dashboard copy or anything a hackathon judge will see.

## Project context

- Sideagent is a hackathon project for the Gen AI Academy APAC AI Builder Cup.
- **Hard requirements:** the solution must use Google AI models (Gemini or Gemma) and be deployed on Google Cloud via Cloud Run or Firebase. Everything must be in English.
- Judging weights: technical merit and Gen AI use 40%, problem alignment and impact 25%, innovation 25%, user experience 10%.
- The deliverable is a working prototype plus a 3 to 4 minute demo video, built in 5 days by 2 people. The must-have list in `docs/technical.md` is the contract; favor making the demo flow work end to end over breadth.

## Naming rules

- **Spy-agency terms are for the UI, the deck and the video only:** mission, handler, field agent, briefing, debrief, eyes only, dead drop, sting, double agent, burned, clearance, station, counterintelligence, mission control.
- **Code, APIs, schemas and MCP tools use plain terms:** job, poster, runner, spec, result, hidden tests, escrow, trap job, reputation, board. The mapping is in the glossary in `docs/design.md`.
- Keep the theme generic spy. No "007", James Bond names, imagery or music.
- Product name is `Sideagent` (one word, singular). Package and CLI name: `sideagent`.

## Security rules

These follow from the product's core promise. Treat violations as bugs.

- **Job content is untrusted input.** Specs, tests, results and logs come from strangers. Never interpolate them into a privileged prompt without screening and clear delimiting. Never execute them outside a sandbox.
- **Results are untrusted for the poster too.** Screen results before returning them to a poster's agent.
- **Sandboxes get no credentials.** Test and runner sandboxes must not see platform secrets, user tokens or the host environment. Restrict network access.
- **Posters never see a result before it passes.** Only pass/fail counts and diagnostics leak before release.
- **Runners never see hidden tests.** Only counts and categories, with limited attempts.
- **No private data in logs or public pages.** Redacted values are restored only on the poster's side.
- Do not build features that resell consumer AI subscriptions (Claude, ChatGPT or Gemini consumer plans). See `docs/decisions.md`.

## Stack and commands

- TypeScript everywhere (pnpm workspace): `protocol/`, `hq/`, `field/`, `control/`. The only non-TypeScript code is the check script inside sandbox images.
- `pnpm install`, then `pnpm typecheck`, `pnpm lint`, `pnpm test`. Run `pnpm schemas` after changing `protocol/` schemas and commit the JSON. Run typecheck and lint before committing.
- Local first: every cloud dependency goes behind an adapter with a local default (see "Cloud adapters" in `docs/technical.md`); tests never touch GCP, and local development calls only the model and redaction APIs. Production is deployed: infrastructure changes go through `infra/terraform/` (D33), code through `infra/deploy.sh`. Don't create GCP resources by hand or with gcloud outside those two.
- No always-on cloud resources (minimum instances, Cloud NAT, VPC connectors, load balancers). Everything must scale to zero (D20).
- Schemas live in `protocol/` (Zod) and are the single source for validation, MCP tools and Gemini output. Don't redefine types elsewhere.
- Model IDs come from configuration, never hardcoded.
- Code jobs carry a required `runtime`; only `python` is implemented. Keep runtime-specific logic inside `hq/src/runtimes/`.

## Working conventions

- Keep the API agent-friendly: typed JSON Schemas, idempotency keys on writes, async job IDs instead of blocking calls, and errors shaped as `{code, reason, fix_hint}`.
- Reuse standards before inventing (A2A, MCP, OpenTelemetry GenAI conventions, RFC 8628). See "Standards" in `docs/design.md`.
- When implementation changes the design or the technical plan, update `docs/design.md` or `docs/technical.md` in the same change. Record new decisions in `docs/decisions.md` with the reason.
- Stage explicit paths when committing; never `git add -A`. Follow the commit style already in `git log`.
- Open questions are listed at the end of `docs/design.md` and `docs/technical.md`. Do not silently pick an answer for one; ask, or note the assumption in the doc.
