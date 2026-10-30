import { createRedisWindowCounter } from "@rbms/jobs";
import { LOG_REDACT_PATHS } from "@rbms/monitoring";
import { pino } from "pino";
import { env } from "./env";
import { createKit } from "./kit";
import { buildServer } from "./server";
import { DEFAULT_RATE_LIMIT } from "./http-guard";

const log = pino({
  level: env.LOG_LEVEL ?? (env.NODE_ENV === "development" ? "debug" : "info"),
  transport: env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
  base: { service: "api", ...(env.GIT_SHA ? { sha: env.GIT_SHA.slice(0, 12) } : {}) },
  // Auth headers, cookies, OTPs, tokens and secrets never reach the logs (docs/ops.md).
  redact: { paths: LOG_REDACT_PATHS, censor: "[Filtered]" },
});

const kit = createKit(env, log);
// Rate-limit counters are shared through Redis (all API instances); in-memory when REDIS_URL=memory.
const scale = env.NODE_ENV === "production" ? 1 : 10;
const rateCounter = env.REDIS_URL === "memory" ? null : createRedisWindowCounter(env.REDIS_URL);
const app = await buildServer({
  loggerInstance: log,
  corsOrigins: env.CORS_ORIGINS.split(",").map((s) => corsOrigin(s.trim())),
  contextHooks: kit.contextHooks,
  preHandlers: kit.preHandlers,
  onResponse: kit.onResponse,
  onSend: kit.onSend,
  preSerialization: kit.preSerialization,
  modules: kit.modules,
  routeRules: kit.routeRules,
  routeCollector: kit.routeCollector,
  errorReporter: kit.monitoring.reporter,
  ops: kit.ops,
  rateLimit: {
    ...DEFAULT_RATE_LIMIT,
    enabled: env.RATE_LIMIT_ENABLED,
    windowMs: env.RATE_LIMIT_WINDOW_SECONDS * 1000,
    // Production defaults from DEFAULT_RATE_LIMIT; 10x looser in development (one machine, every app, e2e).
    ipMax: env.RATE_LIMIT_IP_MAX ?? DEFAULT_RATE_LIMIT.ipMax * scale,
    userMax: env.RATE_LIMIT_USER_MAX ?? DEFAULT_RATE_LIMIT.userMax * scale,
    tenantMax: env.RATE_LIMIT_TENANT_MAX ?? DEFAULT_RATE_LIMIT.tenantMax * scale,
    authMax: env.RATE_LIMIT_AUTH_MAX ?? DEFAULT_RATE_LIMIT.authMax * scale,
    counter: rateCounter ?? undefined,
  },
  security: { hsts: env.NODE_ENV === "production" },
  bodyLimit: env.BODY_LIMIT_BYTES,
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
    await rateCounter?.close().catch(() => undefined);
    await kit.stop();
    process.exit(0);
  });
}
