import {
  CreateAgentInput,
  type CreateAgentOutput,
  type OwnerOutput,
  type RevokeAgentOutput,
} from "@sideagent/protocol";
import type { Firestore } from "firebase-admin/firestore";
import { Hono } from "hono";
import type { OwnerEnv } from "../auth.ts";
import type { Config } from "../config.ts";
import { HqError, parseInput, readJson } from "../errors.ts";
import { accounts, balanceOf } from "../ledger/ledger.ts";
import { createAgent, revokeAgent } from "../store/agents.ts";
import { ensureOwner } from "../store/owners.ts";

/**
 * `/v1/owner` routes for mission control. Mission control reads everything else from Firestore
 * directly (read-only rules); these are its only writes.
 */
export function ownerRoutes(db: Firestore, config: Pick<Config, "STARTING_CREDITS">) {
  return (
    new Hono<OwnerEnv>()
      .post("/", async (c) => {
        const { uid, name } = c.var.owner;
        const [owner, balance] = await Promise.all([
          ensureOwner(db, uid, name, config.STARTING_CREDITS),
          balanceOf(db, accounts.owner(uid)),
        ]);
        const out: OwnerOutput = {
          owner_id: uid,
          display_name: owner.displayName,
          // The balance read may predate the grant just paid.
          balance: owner.created ? config.STARTING_CREDITS : balance,
        };
        return c.json(out);
      })
      .post("/agents", async (c) => {
        const { role } = parseInput(CreateAgentInput, await readJson(c.req.raw));
        const ownerId = c.var.owner.uid;
        if (!(await db.collection("owners").doc(ownerId).get()).exists) {
          throw new HqError(
            "not_found",
            "No owner for this account yet",
            "Call POST /v1/owner first",
          );
        }
        const { agent, apiKey } = await createAgent(db, ownerId, role);
        const out: CreateAgentOutput = { agent_id: agent.id, role: agent.role, api_key: apiKey };
        c.header("cache-control", "no-store");
        return c.json(out);
      })
      .delete("/agents/:id", async (c) => {
        const agentId = c.req.param("id");
        if (!(await revokeAgent(db, c.var.owner.uid, agentId))) {
          throw new HqError(
            "not_found",
            `No agent ${agentId}`,
            "Use an agent ID from your own list",
          );
        }
        const out: RevokeAgentOutput = { agent_id: agentId, status: "revoked" };
        return c.json(out);
      })
      // Otherwise unknown owner paths would fall through to the API-key middleware and get 401.
      .all("*", (c) => {
        throw new HqError(
          "not_found",
          `No route for ${c.req.method} ${c.req.path}`,
          "See docs/technical.md, HQ",
        );
      })
  );
}
