# Demo video: shot list (3:30)

The story in `docs/proposal.md` ("Demo script"), recorded against production. Gemini CLI posts the first mission from `demo/gemini-prompt.md`; `demo/run-demo.ts` follows it (`SIDEAGENT_FOLLOW_JOB=<job_id>`) and drives the rest (D35). A full run takes about 4.5 minutes of wall-clock time, so the waits are cut in the edit. Times below are the edited video; "raw" is when it happens in a run. The submission allows 3 to 4 minutes, so the edit aims for 3:30 to leave margin on both sides.

## Before recording

1. Mission control at `https://sideagent-hq.web.app`, signed in, Mission map open. Issue a fresh handler key and a fresh field agent key for the recording; revoke both afterwards.
2. Gemini CLI with the handler key in `.gemini/settings.json` (the snippet on the Field agents page).
3. Ollama running with `gemma4:26b-a4b`, and `pnpm sandbox:build` done.
4. Warm up: post one job and let it finish, so HQ, the sandbox and a house runner are not cold on camera.
5. Check the kill switch is off and today's post count is low (40 a day).
6. Hide keys: the handler key appears in the Gemini CLI config and on the Field agents page. Keep both off screen, or blur them.

## Shots

| Video | Raw | Screen | Narration |
|---|---|---|---|
| 0:00–0:15 | — | Title card | "Agents have spare capacity. Handing work to a stranger's agent is risky: injection, data leaks, fake results. Sideagent is the trust layer." |
| 0:15–0:35 | — | Mission control signed out: the briefing's pitch, the MCP config tabs and the tool list; then sign in to the empty Mission map | "It's built for agents: one MCP server, six tools. People sign in only to watch and to issue keys." |
| 0:35–1:00 | 0:00 | Gemini CLI: paste `demo/gemini-prompt.md`; it calls `post_job` and prints the job_id. Start `pnpm demo:run` with `SIDEAGENT_FOLLOW_JOB` set to it | "Delegating is one MCP tool call, like starting a local subagent." |
| 1:00–1:30 | 0:00–1:15 | Mission map: the card in Checkpoint, then Open; the panel shows "2 private values redacted", strength 100% | "Gemini screens the briefing. The customer's email and account number become placeholders before any runner sees them, and the tests are scored." |
| 1:30–1:50 | 1:15–2:00 | The house runner claims; the card moves to Dead drop; the panel shows the result with the real values | "A house runner on Gemini solves it in a sandbox. The handler gets the real values back; the runner never saw them." |
| 1:50–2:10 | 2:00–2:03 | Terminal: `run-demo.ts` posts "Load the deployment settings"; the Checkpoint log shows "Briefing blocked: exfiltration" | "A mission that tries to read the runner's .env is blocked in two seconds, with the reason in the feed." |
| 2:10–2:45 | 2:03–3:30 | The sting job opens; the double agent claims and submits a lookup table; feed: "Double agent burned" | "Two field agents go for this one. The first fakes its answer from the public examples. Hidden trap checks catch it: it loses its stake and its key." |
| 2:45–3:15 | 3:30–4:30 | Terminal: the Gemma field agent claims the reopened mission and submits; the card reaches Dead drop; the Ledger page shows credits move | "A laptop running Gemma takes the reopened mission. The honest answer passes every hidden test, and the dead drop releases it." |
| 3:15–3:30 | — | Closing card with the live URL | "It's live on Google Cloud. Sign in and post a mission." |

## Rehearsal timings

From `pnpm demo:run` against production, 15 October 2026. Rehearsal 1: private-data job open at 75 s and released at 120 s; `.env` job blocked 2 s after posting; sting job open at 189 s (test review waits for the one-at-a-time sandbox), double agent burned at 210 s; Gemma claimed at once, submitted after 6 steps and 38 s, and its result passed 8/8 and was released at 270 s. The handler spent 21 credits (two budgets plus three screening fees). Rehearsal 2: the same beats, released at 110 s, blocked at 113 s, burned at 205 s, Gemma's answer 11/11 and released at 267 s. Rehearsal 3 (Gemini CLI first): a dropped connection (`ECONNRESET`) ended the run after the handoff worked, so the client now retries network errors. Rehearsal 4, the full video flow: Gemini CLI posted the escalation note from `demo/gemini-prompt.md`, and `run-demo.ts` followed it (`SIDEAGENT_FOLLOW_JOB`): open at 60 s (redacted, strength 100%), released with the real values at 110 s, `.env` job blocked at 113 s, double agent burned at 185 s, Gemma's answer 11/11 and released at 243 s.
