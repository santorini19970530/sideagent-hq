import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { createMiddleware } from "hono/factory";
import { HqError } from "./errors.ts";
import { findAgentByApiKey, type Agent } from "./store/agents.ts";

export type AuthEnv = { Variables: { agent: Agent } };

/** A person signed in to mission control; `uid` is their owner ID (D28). */
export interface Owner {
  uid: string;
  name: string;
}
export type OwnerEnv = { Variables: { owner: Owner } };

function bearer(header: string | undefined): string | null {
  return /^Bearer\s+(\S+)$/i.exec(header ?? "")?.[1] ?? null;
}

/** Resolves `Authorization: Bearer <api key>` to an agent. */
export function requireAgent(db: Firestore) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const apiKey = bearer(c.req.header("authorization"));
    const agent = apiKey ? await findAgentByApiKey(db, apiKey) : null;
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

/** Resolves `Authorization: Bearer <Firebase ID token>` from mission control to an owner. */
export function requireOwner(auth: Auth | null) {
  return createMiddleware<OwnerEnv>(async (c, next) => {
    if (!auth) {
      throw new HqError(
        "internal",
        "Sign-in is not configured on this HQ",
        "Run `pnpm emulators` and start HQ with FIREBASE_AUTH_EMULATOR_HOST",
      );
    }
    const token = bearer(c.req.header("authorization"));
    const decoded = token ? await auth.verifyIdToken(token, true).catch(() => null) : null;
    if (!decoded) {
      throw new HqError(
        "unauthorized",
        "Missing or invalid sign-in token",
        "Sign in to mission control again and retry",
      );
    }
    const name =
      (typeof decoded.name === "string" && decoded.name) || decoded.email || "Unnamed owner";
    c.set("owner", { uid: decoded.uid, name });
    await next();
  });
}
