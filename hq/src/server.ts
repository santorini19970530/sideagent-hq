import { serve } from "@hono/node-server";
import { createAdapters } from "./adapters/index.ts";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();
const app = createApp(config, createAdapters(config));

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`HQ listening on http://localhost:${info.port}`);
});
