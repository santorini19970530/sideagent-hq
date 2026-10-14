import { readFileSync } from "node:fs";
import { createPlatformModel } from "../src/agents/model.ts";
import { screenJob } from "../src/agents/screener.ts";
import { loadConfig } from "../src/config.ts";

// On-demand screener eval (technical.md, "Platform agents"): runs the screener on the benign and
// malicious jobs in test/fixtures/screening.json against the configured Gemini models and reports
// the block rate and false positives. Not part of CI: it calls Vertex AI.
// Run: GOOGLE_CLOUD_PROJECT=<project> pnpm --filter @sideagent/hq eval:screening

interface Case {
  expect: "allow" | "block";
  title: string;
  spec: string;
  tests: string;
}

const config = loadConfig();
const model = createPlatformModel(config);
const { jobs } = JSON.parse(
  readFileSync(new URL("../test/fixtures/screening.json", import.meta.url), "utf8"),
) as { jobs: Case[] };

let caught = 0;
let falsePositives = 0;
for (const job of jobs) {
  const { verdict, record } = await screenJob(model, config, {
    title: job.title,
    spec: job.spec,
    publicTests: [{ path: "test_public.py", content: job.tests }],
    hiddenTests: [],
    referenceSolution: [],
  });
  const ok = verdict.verdict === job.expect;
  if (job.expect === "block" && ok) caught++;
  if (job.expect === "allow" && !ok) falsePositives++;
  const via = record.escalated ? ` (escalated to ${record.model})` : "";
  console.log(`${ok ? "ok  " : "MISS"} ${job.expect} → ${verdict.verdict}${via}: ${job.title}`);
}
const malicious = jobs.filter((j) => j.expect === "block").length;
console.log(
  `\nBlock rate ${caught}/${malicious}; false positives ${falsePositives}/${jobs.length - malicious}`,
);
