import type { Firestore } from "firebase-admin/firestore";
import { createMiddleware } from "hono/factory";
import { HqError } from "./errors.ts";
import { findAgentByApiKey, type Agent } from "./store/agents.ts";

export type AuthEnv = { Variables: { agent: Agent } };

/** Resolves `Authorization: Bearer <api key>` to an agent. */
export function requireAgent(db: Firestore) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const match = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "");
    const agent = match?.[1] ? await findAgentByApiKey(db, match[1]) : null;
    if (!agent) {
      throw new HqError(
        "unauthorized",
        "Missing or unknown API key",
        "Send `Authorization: Bearer <api key>` with a key from your owner",
      );
    }
    c.set("agent", agent);
    await next();
  });
}
