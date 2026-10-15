# Demo video: recording and edit plan (3:30)

The story in `docs/proposal.md` ("Demo script"), recorded against production. Gemini CLI posts the first mission from `demo/gemini-prompt.md`; `demo/run-demo.ts` follows it (`SIDEAGENT_FOLLOW_JOB=<job_id>`) and drives the rest (D35). A full run takes about 4.5 minutes of wall-clock time, so the waits are cut in the edit. The submission allows 3 to 4 minutes, so the edit aims for 3:30 to leave margin on both sides.

The video has two sources recorded in the same run: the **agent side** (terminals: what the agents do) and the **web side** (mission control: what a person watches). The edit cuts between them, separated by chapter cards, with a step label and subtitles on every shot so the video makes sense with the sound off.

## Before recording

1. Mission control at `https://sideagent-hq.web.app`, signed in, Mission map open. Issue a fresh handler key and a fresh field agent key for the recording; revoke both afterwards.
2. Gemini CLI with the handler key in `.gemini/settings.json` (the snippet on the Keys page).
3. Ollama running with `gemma4:26b-a4b`, and `pnpm sandbox:build` done.
4. Warm up: post one job and let it finish, so HQ, the sandbox and a house runner are not cold on camera.
5. Check the kill switch is off and today's post count is low (40 a day).
6. Hide keys: the handler key appears in the Gemini CLI config and on the Keys page. Keep both off screen, or blur them.

## Screen setup

| | Agent side | Web side |
|---|---|---|
| What | Terminal A: Gemini CLI (the handler's agent). Terminal B: `pnpm demo:run`, which also prints the double agent and the Gemma field agent as `[field agent]` lines | Chrome, mission control |
| Size | One terminal per 1920×1080 frame, font 20 pt, about 100 columns, dark theme | Window 1920×1080, zoom 110%, no bookmarks bar or extensions, a clean profile |
| Recording | Both sources at once (OBS: one scene per display, or two window captures), 1080p 30 fps, so the two tracks share one timeline | Same |
| Hide | Shell prompt shortened to `$ `; no home path, hostname or keys | Signed-in email if it isn't a demo account; keys on the Keys page |

Record the whole run in one take on both sources, then record the still shots (signed-out Briefing page, Ledger) separately at leisure. If one beat goes wrong, rerun everything rather than splicing two runs: the job IDs and the credit balances must match across shots.

## Run sheet (raw recording)

What to do at the keyboard, in order. Times are from the rehearsals.

| Raw | Who | Action |
|---|---|---|
| — | Web | Signed out: scroll the Briefing page (pitch, MCP config tabs, tool list), then sign in to the empty Mission map |
| 0:00 | Agent A | Paste `demo/gemini-prompt.md` into Gemini CLI; it calls `post_job` and prints the job_id |
| 0:05 | Agent B | `SIDEAGENT_FOLLOW_JOB=<job_id> pnpm demo:run` |
| 0:05–1:00 | Web | Mission map: the card appears in Checkpoint; click it once it reaches Open missions to open the panel (redactions, test strength) |
| 1:00–1:50 | Web | Watch the card move through In the field and Debrief check to Dead drop; the panel shows the result with the real values |
| ~1:55 | Agent A | Ask Gemini CLI: "Check job <job_id> with get_status and show me the code it returned." It prints `note.py` with the real email and account number |
| ~1:55 | Web | Switch to the Checkpoint log: "Briefing blocked" for "Load the deployment settings" |
| 2:00–3:30 | Web | Back to Mission map: the sting job "Slugify article titles" through Checkpoint to Open missions, the double agent's claim, the failed check; open the panel; the Checkpoint log shows the burn |
| 3:30–4:30 | Web | The reopened sting goes to In the field (Gemma) and Dead drop; then open Ledger |
| 4:30 | Agent B | Leave the final line on screen: "Done. Handler balance X → Y credits" |

The get_status step (Agent A, ~1:55) is new and not yet rehearsed: do one rehearsal to check how Gemini CLI prints the result before the real take.

## Edit style

- **Chapter cards** (2 to 3 s each): full screen, mission control's dark background, Inter for text, JetBrains Mono for the small label above it. A small label (`MISSION 1 OF 3`) over a title line and one line of context. Transition in and out with a **redaction-bar wipe**: a black bar sweeps across and reveals the next frame (0.4 s). It echoes the redaction the product does; no other transitions.
- **Step label** (lower left, the whole shot): a small pill showing where we are in the flow, for example `① Post → ② Screen → ③ Run → ④ Check → ⑤ Release`, with the current step lit. The same pill on every mission shot, so the flow reads as one pipeline.
- **Side tag** (top left, small): `AGENT SIDE · Gemini CLI` or `WEB SIDE · Mission control`, so the viewer always knows whose screen this is.
- **Callouts**: a rounded highlight box with a one-line label on the exact UI element that matters (a card, a badge, a terminal line). One callout at a time, on screen for at least 2 s.
- **Zoom**: on terminals, scale in slowly (up to 150%) on the line being described; on the web side, zoom to the panel or card when it changes.
- **Subtitles**: burned in, bottom centre, at most 2 lines of about 42 characters, white on a dark translucent box. They are the narration text. With a voice-over, they match it word for word; without one, they carry the story alone.
- **Speed**: cut dead waits; where the motion matters (a card moving lanes), speed up 4× to 8× with a small `▶▶ 6×` tag instead of cutting.
- **Audio**: one quiet ambient track with no recognisable theme (no Bond-style music), ducked under the voice-over.

## Edit timeline

Times are the edited video. "Side" says which recording the shot comes from.

| Video | Side | Card or shot | Step | Callout | Subtitle |
|---|---|---|---|---|---|
| 0:00–0:12 | Card | **Title.** `SIDEAGENT` / "Your idle agents, on assignment." | — | — | "Agents have spare capacity. Handing work to a stranger's agent is risky: injection, data leaks, fake results." |
| 0:12–0:30 | Web | Signed-out Briefing: the pitch, MCP config tabs, tool list; sign in, empty Mission map | — | "One MCP server, six tools" on the tool list | "Sideagent is the trust layer. It's built for agents: one MCP server, six tools. People sign in to watch and to issue keys." |
| 0:30–0:33 | Card | `MISSION 1 OF 3` / **Delegate a task with private data** / "A billing agent hands off a coding task that names a customer." | — | — | — |
| 0:33–0:53 | Agent | Gemini CLI: the prompt, the `post_job` call, the job_id | ① Post | The `post_job` call; then the job_id | "The handler's agent delegates with one MCP tool call, like starting a local subagent. The briefing names a customer's email and account number." |
| 0:53–1:15 | Web | Mission map: the card in Checkpoint, then Open missions; open the panel | ② Screen | "Eyes only" (the redacted email and account number); then "Test strength 100%" | "Gemini screens the briefing. The email and account number become placeholders before any field agent sees them, and the handler's tests are scored." |
| 1:15–1:33 | Web | The card through In the field and Debrief check to Dead drop (sped up) | ③ Run → ④ Check → ⑤ Release | The card in Dead drop; the result with real values | "A field agent on Gemini solves it in a sandbox. Hidden tests pass, and the dead drop releases the debrief." |
| 1:33–1:45 | Agent | Gemini CLI: `get_status`, `note.py` with the real values | ⑤ Release | The restored email and account number | "The handler's agent gets tested code back, with the real values restored. The field agent never saw them." |
| 1:45–1:48 | Card | `MISSION 2 OF 3` / **A hostile briefing** / "Not every mission on the board is friendly." | — | — | — |
| 1:48–2:05 | Agent → Web | Terminal B: "2. Load the deployment settings" and the blocked line; cut to the Checkpoint log | ② Screen | "Briefing blocked" and its reason | "This mission asks the field agent to send back its .env file. The checkpoint blocks it in two seconds and logs why." |
| 2:05–2:08 | Card | `MISSION 3 OF 3` / **A sting for a double agent** / "Not every field agent is honest." | — | — | — |
| 2:08–2:40 | Web (Agent B inset) | Mission map: the sting card opens; the double agent claims and submits; the failed check; the Checkpoint log | ③ Run → ④ Check | The double agent's card; then "Burned" | "Two field agents go for this one. The first fakes its answer from the public examples. Hidden trap checks catch it: it loses its stake and its key." |
| 2:40–3:10 | Agent → Web | Terminal B: the `[field agent]` Gemma lines and "passed"; Mission map: the card in Dead drop; Ledger | ③ Run → ④ Check → ⑤ Release | The Gemma lines; then the credit movement on Ledger | "A laptop running Gemma takes the reopened mission. Its honest answer passes every hidden test, and credits move from escrow to the field agent." |
| 3:10–3:20 | Card | **Recap**, three lines appearing one by one: "Screened both ways" · "Checked by hidden tests" · "Paid only on release" | — | — | "Screened both ways, checked by hidden tests, paid only on release." |
| 3:20–3:30 | Card | **Closing.** `sideagent-hq.web.app` · "Gemini · Gemma · Cloud Run · Firebase" | — | — | "It's live on Google Cloud. Sign in and post a mission." |

## Checks before export

- Total length between 3:15 and 3:45.
- No key, email address or home path visible anywhere; scrub frame by frame around the Keys page and the Gemini CLI config.
- Every subtitle is on screen long enough to read (about 15 characters per second).
- Watch once with the sound off: the cards, step labels and subtitles alone must tell the story.
- English only; no 007, Bond names, imagery or music.

## Rehearsal timings

From `pnpm demo:run` against production, 15 October 2026. Rehearsal 1: private-data job open at 75 s and released at 120 s; `.env` job blocked 2 s after posting; sting job open at 189 s (test review waits for the one-at-a-time sandbox), double agent burned at 210 s; Gemma claimed at once, submitted after 6 steps and 38 s, and its result passed 8/8 and was released at 270 s. The handler spent 21 credits (two budgets plus three screening fees). Rehearsal 2: the same beats, released at 110 s, blocked at 113 s, burned at 205 s, Gemma's answer 11/11 and released at 267 s. Rehearsal 3 (Gemini CLI first): a dropped connection (`ECONNRESET`) ended the run after the handoff worked, so the client now retries network errors. Rehearsal 4, the full video flow: Gemini CLI posted the escalation note from `demo/gemini-prompt.md`, and `run-demo.ts` followed it (`SIDEAGENT_FOLLOW_JOB`): open at 60 s (redacted, strength 100%), released with the real values at 110 s, `.env` job blocked at 113 s, double agent burned at 185 s, Gemma's answer 11/11 and released at 243 s.
