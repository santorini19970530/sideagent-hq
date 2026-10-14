// Day-1 check: managed Gemma on Vertex AI (global) with function calling via @google/genai.
// Run: GCP_PROJECT=sideagent-hq GCP_ACCESS_TOKEN=$(gcloud auth print-access-token) npx tsx gemma.ts
import { GoogleGenAI, Type } from "@google/genai";
import { OAuth2Client } from "google-auth-library";

const project = process.env.GCP_PROJECT ?? "sideagent-hq";
const model = process.env.MODEL ?? "gemma-4-26b-a4b-it-maas";
const token = process.env.GCP_ACCESS_TOKEN;

const authClient = token ? new OAuth2Client() : undefined;
authClient?.setCredentials({ access_token: token });

const ai = new GoogleGenAI({
  vertexai: true,
  project,
  location: "global",
  ...(authClient ? { googleAuthOptions: { authClient } } : {}),
});

const runTests = {
  name: "run_tests",
  description: "Run the public tests for the current job and return pass/fail counts.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      path: { type: Type.STRING, description: "Path to the solution file" },
    },
    required: ["path"],
  },
};

const started = Date.now();
const res = await ai.models.generateContent({
  model,
  contents: "You wrote your solution to solution.py. Call the tool to run the public tests on it.",
  config: { tools: [{ functionDeclarations: [runTests] }], maxOutputTokens: 256 },
});

console.log(
  JSON.stringify(
    {
      model,
      ms: Date.now() - started,
      functionCalls: res.functionCalls,
      text: res.text,
      usage: res.usageMetadata,
    },
    null,
    2,
  ),
);
