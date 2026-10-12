import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { apiError } from "@sideagent/protocol";
import { Hono } from "hono";
import type { Adapters } from "./adapters/index.ts";
import { jobRoutes } from "./api/jobs.ts";
import { requireAgent, type AuthEnv } from "./auth.ts";
import type { Config } from "./config.ts";
import { HqError } from "./errors.ts";
import { createJobService } from "./jobs/service.ts";
import { createMcpServer } from "./mcp/server.ts";

export interface AppOptions {
  /** Clock override for tests. */
  now?: () => Date;
}

export function createApp(config: Config, adapters: Adapters, { now }: AppOptions = {}) {
  const jobs = createJobService({ ...adapters, config, now });
  const app = new Hono<AuthEnv>();

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.use("/v1/*", requireAgent(adapters.db));
  app.route("/v1", jobRoutes(jobs));

  app.all("/mcp", requireAgent(adapters.db), async (c) => {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await createMcpServer(jobs, c.var.agent).connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  app.notFound((c) =>
    c.json(
      apiError(
        "not_found",
        `No route for ${c.req.method} ${c.req.path}`,
        "Check the path; the API lives under /v1 and MCP under /mcp",
      ),
      404,
    ),
  );

  app.onError((err, c) => {
    if (err instanceof HqError) return c.json(err.body, err.status);
    console.error(err);
    return c.json(
      apiError("internal", "Internal error", "Retry later; if it persists, report it"),
      500,
    );
  });

  return app;
}
