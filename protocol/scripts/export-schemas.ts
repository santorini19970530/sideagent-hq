import { mkdir, writeFile } from "node:fs/promises";
import { exportedSchemas } from "../src/json-schema.ts";

const outDir = new URL("../schemas/", import.meta.url);
await mkdir(outDir, { recursive: true });
for (const [name, schema] of Object.entries(exportedSchemas())) {
  await writeFile(new URL(`${name}.json`, outDir), JSON.stringify(schema, null, 2) + "\n");
  console.log(`wrote schemas/${name}.json`);
}
