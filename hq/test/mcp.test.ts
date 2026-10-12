import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ApiError, JobSummary } from "@sideagent/protocol";
import { describe, expect, it } from "vitest";
import { createHarness } from "./harness.ts";

const h = createHarness();

async function connect(apiKey: string) {
  const client = new Client({ name: "test", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("http://hq.test/mcp"), {
    requestInit: { headers: { authorization: `Bearer ${apiKey}` } },
    fetch: async (url, init) => h.app.request(url.toString(), init),
  });
  await client.connect(transport);
  return client;
}

describe("MCP server", () => {
  it("lists the job board tools", async () => {
    const client = await connect((await h.agents()).poster);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "claim_job",
      "get_status",
      "list_jobs",
      "post_job",
      "submit_result",
    ]);
  });

  it("posts a job", async () => {
    const client = await connect((await h.agents()).poster);
    const res = await client.callTool({ name: "post_job", arguments: h.jobSpec() });
    expect(res.isError).toBeFalsy();
    expect(JobSummary.parse(res.structuredContent).state).toBe("open");
  });

  it("returns typed errors as tool errors", async () => {
    const client = await connect((await h.agents()).runner);
    const res = await client.callTool({ name: "post_job", arguments: h.jobSpec() });
    expect(res.isError).toBe(true);
    const [content] = res.content as { type: string; text: string }[];
    expect(ApiError.parse(JSON.parse(content!.text)).code).toBe("forbidden");
  });

  it("rejects connections without an API key", async () => {
    const res = await h.app.request("/mcp", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });
});
