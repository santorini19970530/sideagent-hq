import { OAuth2Client } from "google-auth-library";
import { createMiddleware } from "hono/factory";
import { HqError } from "./errors.ts";

/** The claims HQ checks on a Google-signed OIDC token. */
export interface IdTokenClaims {
  email?: string;
  email_verified?: boolean;
}

/** Checks a Google OIDC token's signature, expiry and audience; null when it fails any. */
export interface IdTokenVerifier {
  verify(token: string, audience: string | string[]): Promise<IdTokenClaims | null>;
}

export function createGoogleIdTokenVerifier(client = new OAuth2Client()): IdTokenVerifier {
  return {
    async verify(idToken, audience) {
      try {
        const ticket = await client.verifyIdToken({ idToken, audience });
        return ticket.getPayload() ?? null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Admits only requests carrying a Google OIDC token for `audience`, issued to the service
 * account `email` (Cloud Tasks, Pub/Sub push). 401 without a valid token, 403 for another
 * account.
 */
export function requireGoogleOidc(
  verifier: IdTokenVerifier,
  audience: string | string[],
  email: string,
) {
  return createMiddleware(async (c, next) => {
    const token = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "")?.[1];
    const claims = token ? await verifier.verify(token, audience) : null;
    if (!claims) {
      throw new HqError(
        "unauthorized",
        "Missing or invalid OIDC token",
        "This route only takes calls from the platform's own service accounts",
      );
    }
    if (claims.email !== email || claims.email_verified !== true) {
      throw new HqError(
        "forbidden",
        "The OIDC token is for another account",
        "This route only takes calls from the platform's own service accounts",
      );
    }
    await next();
  });
}
