import { apiError } from "@sideagent/protocol";
import { Hono } from "hono";
import type { Adapters } from "./adapters/index.ts";

export function createApp(_adapters: Adapters) {
  const app = new Hono();

  app.get("/healthz", (c) => c.json({ ok: true }));

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
    console.error(err);
    return c.json(
      apiError("internal", "Internal error", "Retry later; if it persists, report it"),
      500,
    );
  });

  return app;
}
