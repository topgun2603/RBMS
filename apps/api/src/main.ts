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
  corsOrigins: env.CORS_ORIGINS.split(",").map((s) => s.trim()),
  contextHooks: kit.contextHooks,
  modules: kit.modules,
});

await kit.start();
await app.listen({ port: env.PORT, host: "0.0.0.0" });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    log.info({ signal }, "shutting down");
    await app.close();
    await kit.stop();
    process.exit(0);
  });
}
