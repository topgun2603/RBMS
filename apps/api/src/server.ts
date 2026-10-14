import cors from "@fastify/cors";
import { AppError, emptyContext, type SrModule } from "@srirealtime/core";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { ZodError } from "zod";

export interface ServerOptions {
  corsOrigins: string[];
  /** Shared with the modules so every log line goes through one pino instance. Omit for silent tests. */
  loggerInstance?: FastifyBaseLogger;
  /** Hooks that fill req.ctx, run in order on every request (tenancy first, then auth). */
  contextHooks: Array<(app: FastifyInstance) => void>;
  modules: SrModule[];
}

export async function buildServer(opts: ServerOptions) {
  const app = opts.loggerInstance
    ? Fastify({ loggerInstance: opts.loggerInstance, trustProxy: true })
    : Fastify({ logger: false, trustProxy: true });

  await app.register(cors, { origin: opts.corsOrigins, credentials: true });

  app.decorateRequest("ctx", null as never);
  app.addHook("onRequest", async (req) => {
    req.ctx = emptyContext();
    req.ctx.ip = req.ip;
    req.ctx.userAgent = req.headers["user-agent"] ?? null;
    const lang = req.headers["accept-language"]?.split(",")[0]?.slice(0, 2);
    if (lang) req.ctx.locale = lang;
  });
  for (const hook of opts.contextHooks) hook(app);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: { code: "invalid_input", message: "Invalid input", details: err.issues } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.status(status).send({ error: { code: "bad_request", message: (err as Error).message } });
    }
    req.log.error(err);
    return reply.status(500).send({ error: { code: "internal", message: "Something went wrong" } });
  });

  app.get("/health", async () => ({ ok: true }));

  for (const m of opts.modules) {
    if (m.routes) await app.register(async (scoped) => m.routes!(scoped), { prefix: `/v1/${m.id}` });
  }

  return app;
}
