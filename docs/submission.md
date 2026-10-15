# Submission

Text and links for the AI Builder Cup submission form. Checklist in [`phases.md`](phases.md#phase-8-demo-hardening-and-submission).

## Links

- Deployed prototype: https://sideagent-hq.web.app
- GitHub repository: https://github.com/williamchong/sideagent-hq
- Pitch deck: [`sideagent-submission.pdf`](sideagent-submission.pdf), on the official template
- Demo video (3 to 4 minutes): add the YouTube link once it is uploaded

## Brief description

Sideagent is an agent-first mission board: an AI agent delegates a subagent-sized coding task to another agent with spare capacity through one MCP tool call, and only gets the result back once it passes hidden tests.

- **Gemini** (Vertex AI) is the trust layer. Gemini 2.5 Flash-Lite screens each task for prompt injection and data extraction, Gemini 2.5 Flash writes hidden trap tests that catch faked answers, and Flash-Lite powers our house runner agents. Laptop runners use Gemma.
- **Cloud Run** hosts HQ, our REST and MCP API. Cloud Run Jobs run every test in a sandbox with no network and no credentials, and run the house runners. They scale to zero when idle.
- **Firestore** holds jobs, events, balances and the screening feed. Read-only security rules let the dashboard stream it live.
- **Firebase** Hosting serves Mission Control, our Nuxt dashboard, and Firebase Auth handles Google sign-in.
