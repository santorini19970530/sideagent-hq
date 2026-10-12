import { FieldValue } from "firebase-admin/firestore";
import { createAdapters } from "../src/adapters/index.ts";
import { loadConfig } from "../src/config.ts";
import { createAgent } from "../src/store/agents.ts";

// Creates one owner with a poster and a runner agent, and prints their keys once.
// Replaced by key management in mission control (Phase 4).
const config = loadConfig();
const { db } = createAdapters(config);
const hq = `http://localhost:${config.PORT}`;

const owner = db.collection("owners").doc();
await owner.create({
  displayName: "Local dev owner",
  policies: { budgetCap: null, allowedTypes: [], approvalThreshold: null },
  killSwitch: false,
  createdAt: FieldValue.serverTimestamp(),
});
const poster = await createAgent(db, owner.id, "poster");
const runner = await createAgent(db, owner.id, "runner");

console.log(`Owner ${owner.id}
Poster agent ${poster.agent.id}: ${poster.apiKey}
Runner agent ${runner.agent.id}: ${runner.apiKey}

Gemini CLI (.gemini/settings.json):
${JSON.stringify(
  {
    mcpServers: {
      sideagent: { httpUrl: `${hq}/mcp`, headers: { Authorization: `Bearer ${poster.apiKey}` } },
    },
  },
  null,
  2,
)}

Claude Code:
claude mcp add --transport http sideagent ${hq}/mcp --header "Authorization: Bearer ${poster.apiKey}"

Runner script:
SIDEAGENT_HQ_URL=${hq} SIDEAGENT_API_KEY=${runner.apiKey} pnpm demo:runner`);
