import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildOpenApi } from "@srirealtime/developer";
import { pino } from "pino";
import { env } from "../env";
import { createKit } from "../kit";
import { buildServer } from "../server";

/**
 * Writes the API document (OpenAPI 3.1) without starting the server or touching the database: every module's routes
 * are registered, collected and turned into JSON. `--typed` keeps only operations that declare `config.schema`
 * (`documented(...)`): the input for the generated mobile client (docs/market-plan.md, M0).
 *
 *   pnpm --filter @srirealtime/api openapi                      → apps/api/openapi.json
 *   pnpm --filter @srirealtime/api openapi -- --typed out.json
 */
const args = process.argv.slice(2);
const typedOnly = args.includes("--typed");
const out = resolve(args.find((a) => !a.startsWith("--")) ?? "openapi.json");

const log = pino({ level: "warn" });
const kit = createKit({ ...env, REDIS_URL: "memory" }, log);
const app = await buildServer({
  corsOrigins: [],
  contextHooks: kit.contextHooks,
  preHandlers: kit.preHandlers,
  onResponse: kit.onResponse,
  onSend: kit.onSend,
  modules: kit.modules,
  routeRules: kit.routeRules,
  routeCollector: kit.routeCollector,
});

try {
  await app.ready();
  const doc = buildOpenApi(kit.routeCollector.routes(), { hidePrefixes: ["/v1/admin/"] });
  if (typedOnly) {
    for (const [path, ops] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(ops)) if (!(op as Record<string, unknown>)["x-typed"]) delete ops[method];
      if (!Object.keys(ops).length) delete doc.paths[path];
    }
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
  const count = Object.values(doc.paths).reduce((n, ops) => n + Object.keys(ops).length, 0);
  console.log(`openapi: ${count} operations${typedOnly ? " (typed only)" : ""} → ${out}`);
} finally {
  await app.close();
  await kit.stop();
}
