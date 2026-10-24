import { LOG_REDACT_PATHS } from "@srirealtime/monitoring";
import { pino } from "pino";
import { env } from "./env";
import { createKit } from "./kit";
import { buildServer } from "./server";

const log = pino({
  level: env.LOG_LEVEL ?? (env.NODE_ENV === "development" ? "debug" : "info"),
  transport: env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
  base: { service: "api", ...(env.GIT_SHA ? { sha: env.GIT_SHA.slice(0, 12) } : {}) },
  // Auth headers, cookies, OTPs, tokens and secrets never reach the logs (docs/ops.md).
  redact: { paths: LOG_REDACT_PATHS, censor: "[Filtered]" },
});

const kit = createKit(env, log);
const app = await buildServer({
  loggerInstance: log,
  corsOrigins: env.CORS_ORIGINS.split(",").map((s) => corsOrigin(s.trim())),
  contextHooks: kit.contextHooks,
  preHandlers: kit.preHandlers,
  onResponse: kit.onResponse,
  onSend: kit.onSend,
  modules: kit.modules,
  routeRules: kit.routeRules,
  routeCollector: kit.routeCollector,
  errorReporter: kit.monitoring.reporter,
  ops: kit.ops,
});

// Crashes are reported before the process exits; behaviour is otherwise unchanged (exit 1).
process.on("uncaughtExceptionMonitor", (err) => kit.monitoring.reporter.capture(err, { level: "fatal", tags: { kind: "uncaughtException" } }));
process.on("unhandledRejection", (reason) => {
  kit.monitoring.reporter.capture(reason, { level: "fatal", tags: { kind: "unhandledRejection" } });
  void kit.monitoring.reporter.flush(2000).finally(() => process.exit(1));
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
