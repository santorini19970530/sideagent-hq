import { z } from "zod";
import { BalanceOutput } from "./tools.ts";

// Mission control's calls to HQ, authenticated with a Firebase ID token instead of an API key.

export const AgentRole = z.enum(["poster", "runner"]);
export type AgentRole = z.infer<typeof AgentRole>;

export const OwnerOutput = BalanceOutput.extend({
  owner_id: z.string().describe("Firebase Auth UID (D28)"),
  display_name: z.string(),
});
export type OwnerOutput = z.infer<typeof OwnerOutput>;

export const CreateAgentInput = z.object({ role: AgentRole });
export type CreateAgentInput = z.infer<typeof CreateAgentInput>;

export const CreateAgentOutput = z.object({
  agent_id: z.string(),
  role: AgentRole,
  api_key: z.string().describe("Shown once; HQ stores only its hash"),
});
export type CreateAgentOutput = z.infer<typeof CreateAgentOutput>;

export const RevokeAgentOutput = z.object({
  agent_id: z.string(),
  status: z.literal("revoked"),
});
export type RevokeAgentOutput = z.infer<typeof RevokeAgentOutput>;
