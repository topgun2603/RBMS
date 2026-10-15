import { pino } from "pino";
import { env } from "./env";
import { createKit } from "./kit";
import { buildServer } from "./server";

const log = pino({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  transport: env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
});

const kit = createKit(env, log);
const app = await buildServer({
  loggerInstance: log,
  corsOrigins: env.CORS_ORIGINS.split(",").map((s) => corsOrigin(s.trim())),
  contextHooks: kit.contextHooks,
  preHandlers: kit.preHandlers,
  onResponse: kit.onResponse,
  modules: kit.modules,
  routeRules: kit.routeRules,
});

await kit.start();
await app.listen({ port: env.PORT, host: "0.0.0.0" });

/** "http://*.localhost:3001" → a RegExp matching one subdomain label; other entries stay exact strings. */
function corsOrigin(entry: string): string | RegExp {
  if (!entry.includes("*.")) return entry;
  const escaped = entry.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace("*\\.", "[a-z0-9-]+\\.");
  return new RegExp(`^${escaped}$`);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    log.info({ signal }, "shutting down");
    await app.close();
    await kit.stop();
    process.exit(0);
  });
}
