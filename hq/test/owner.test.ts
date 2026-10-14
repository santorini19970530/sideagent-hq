import { randomUUID } from "node:crypto";
import { ApiError, CreateAgentOutput, OwnerOutput } from "@sideagent/protocol";
import { describe, expect, it } from "vitest";
import { createHarness } from "./harness.ts";

const h = createHarness();

/** Signs up a new user on the Auth emulator started by `pnpm test` and returns their ID token. */
async function signUp(): Promise<{ uid: string; idToken: string; email: string }> {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!host) throw new Error("Run through `pnpm test`, which starts the Auth emulator");
  const email = `owner-${randomUUID()}@example.com`;
  const res = await fetch(
    `http://${host}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "password", returnSecureToken: true }),
    },
  );
  const body = (await res.json()) as { localId: string; idToken: string };
  return { uid: body.localId, idToken: body.idToken, email };
}

async function signedInOwner() {
  const user = await signUp();
  const res = await h.call(user.idToken, "POST", "/v1/owner");
  expect(res.status).toBe(200);
  return { ...user, owner: OwnerOutput.parse(res.body) };
}

describe("owner API", () => {
  it("creates the owner on first sign-in and grants starting credits once", async () => {
    const { idToken, uid, email, owner } = await signedInOwner();
    expect(owner).toEqual({
      owner_id: uid,
      display_name: email,
      balance: h.config.STARTING_CREDITS,
    });
    const again = await h.call(idToken, "POST", "/v1/owner");
    expect(OwnerOutput.parse(again.body).balance).toBe(h.config.STARTING_CREDITS);
  });

  it("creates an agent key that works, and revokes it", async () => {
    const { idToken } = await signedInOwner();
    const created = await h.call(idToken, "POST", "/v1/owner/agents", { role: "poster" });
    expect(created.status).toBe(200);
    const agent = CreateAgentOutput.parse(created.body);
    expect(agent.role).toBe("poster");

    const posted = await h.call(agent.api_key, "POST", "/v1/jobs", h.jobSpec());
    expect(posted.status).toBe(200);

    const revoked = await h.call(idToken, "DELETE", `/v1/owner/agents/${agent.agent_id}`);
    expect(revoked.body).toEqual({ agent_id: agent.agent_id, status: "revoked" });
    const after = await h.call(agent.api_key, "GET", "/v1/jobs");
    expect(after.status).toBe(401);
  });

  it("refuses to revoke another owner's agent", async () => {
    const a = await signedInOwner();
    const b = await signedInOwner();
    const created = await h.call(a.idToken, "POST", "/v1/owner/agents", { role: "runner" });
    const agent = CreateAgentOutput.parse(created.body);
    const res = await h.call(b.idToken, "DELETE", `/v1/owner/agents/${agent.agent_id}`);
    expect(res.status).toBe(404);
    expect((await h.call(agent.api_key, "GET", "/v1/jobs")).status).toBe(200);
  });

  it("needs an owner before creating agents", async () => {
    const { idToken } = await signUp();
    const res = await h.call(idToken, "POST", "/v1/owner/agents", { role: "poster" });
    expect(res.status).toBe(404);
    expect(ApiError.parse(res.body).fix_hint).toContain("POST /v1/owner");
  });

  it("rejects a missing token, a forged token and an agent API key", async () => {
    const keys = await h.agents();
    for (const token of [null, "not-a-token", keys.poster]) {
      const res = await h.app.request("/v1/owner", {
        method: "POST",
        headers: {
          origin: h.config.CONTROL_ORIGIN,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      });
      expect(res.status).toBe(401);
      expect(ApiError.parse(await res.json()).code).toBe("unauthorized");
      // So mission control can read the error.
      expect(res.headers.get("access-control-allow-origin")).toBe(h.config.CONTROL_ORIGIN);
    }
  });

  it("returns 404 for unknown owner paths", async () => {
    const { idToken } = await signedInOwner();
    const res = await h.call(idToken, "GET", "/v1/owner/nope");
    expect(res.status).toBe(404);
  });

  it("answers CORS preflight for mission control's origin", async () => {
    const res = await h.app.request("/v1/owner/agents", {
      method: "OPTIONS",
      headers: {
        origin: h.config.CONTROL_ORIGIN,
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(h.config.CONTROL_ORIGIN);
  });
});
