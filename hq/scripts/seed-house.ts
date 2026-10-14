import { loadConfig } from "../src/config.ts";
import { createAgent } from "../src/store/agents.ts";
import { createFirestore } from "../src/store/firestore.ts";
import { createOwner } from "../src/store/owners.ts";

// Creates the house runner's and the demo double agent's owners and runner agents, and prints
// only `{"honest":"sk_...","double_agent":"sk_..."}` on stdout, for deploy.sh to store in
// Secret Manager. Uses whatever Firestore the environment names: the emulator when
// FIRESTORE_EMULATOR_HOST is set, else the real GCP_PROJECT. Each run makes new owners and keys.
const config = loadConfig();
const db = createFirestore(config);

const houseOwnerId = await createOwner(db, "House runners", config.STARTING_CREDITS);
const honest = await createAgent(db, houseOwnerId, "runner");
const doubleOwnerId = await createOwner(db, "Double agents", config.STARTING_CREDITS);
const double = await createAgent(db, doubleOwnerId, "runner");

console.error(`House runner agent ${honest.agent.id}, double agent ${double.agent.id}`);
process.stdout.write(`${JSON.stringify({ honest: honest.apiKey, double_agent: double.apiKey })}\n`);
await db.terminate();
