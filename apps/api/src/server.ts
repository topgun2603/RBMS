import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import { AppError, emptyContext, type SrModule } from "@srirealtime/core";
import type { ErrorReporter } from "@srirealtime/monitoring";
import Fastify, {
  LogController,
  type FastifyBaseLogger,
  type FastifyInstance,
  type onResponseAsyncHookHandler,
  type preHandlerAsyncHookHandler,
} from "fastify";
import { ZodError } from "zod";
import { httpMetrics, OPS_PATHS, registerOpsRoutes, type OpsOptions } from "./ops";

export interface ServerOptions {
  corsOrigins: Array<string | RegExp>;
  /** Shared with the modules so every log line goes through one pino instance. Omit for silent tests. */
  loggerInstance?: FastifyBaseLogger;
  /** Hooks that fill req.ctx, run in order on every request (tenancy first, then auth). */
  contextHooks: Array<(app: FastifyInstance) => void>;
  /** Global preHandler hooks run after the context hooks, e.g. the features check of `config.feature`. */
  preHandlers?: preHandlerAsyncHookHandler[];
  /** Global onResponse hooks, e.g. the audit log of successful mutating requests. They must never throw. */
  onResponse?: onResponseAsyncHookHandler[];
  modules: SrModule[];
  /** Annotates module routes while they are registered (e.g. host-side `config.permission`), then checks every rule matched. */
  routeRules?: { register(app: FastifyInstance): void; assertAllMatched(): void };
  /**
   * Sees every route as it is registered (the developer module's OpenAPI listing). Registered after `routeRules` (so
   * host-attached `config.permission` is visible) and before the modules mount.
   */
  routeCollector?: { register(app: FastifyInstance): void };
  /** 5xx errors are reported here (with request id, tenant id, route); 4xx never are. */
  errorReporter?: ErrorReporter;
  /** `/ready`, `/version`, `/metrics` and the request metrics (docs/ops.md). Without it only `/health` is served. */
  ops?: OpsOptions;
}

/** A caller-supplied request id is kept when it looks like one (load balancer, other service); otherwise a UUID. */
const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;
export const requestIdFor = (header: string | string[] | undefined) =>
  typeof header === "string" && REQUEST_ID.test(header) ? header : randomUUID();

const OPS = new Set<string>(OPS_PATHS);

export async function buildServer(opts: ServerOptions) {
  const base = {
    trustProxy: true,
    genReqId: (req: { headers: Record<string, string | string[] | undefined> }) => requestIdFor(req.headers["x-request-id"]),
    // One structured line per request is logged in onResponse below (with tenant, user and route).
    logController: new LogController({ disableRequestLogging: true }),
  };
  const app = opts.loggerInstance ? Fastify({ ...base, loggerInstance: opts.loggerInstance }) : Fastify({ ...base, logger: false });

  await app.register(cors, { origin: opts.corsOrigins, credentials: true, exposedHeaders: ["x-request-id"] });

  app.decorateRequest("ctx", null as never);
  app.addHook("onRequest", async (req, reply) => {
    reply.header("x-request-id", req.id);
    req.ctx = emptyContext();
    req.ctx.ip = req.ip;
    req.ctx.userAgent = req.headers["user-agent"] ?? null;
    const lang = req.headers["accept-language"]?.split(",")[0]?.slice(0, 2);
    if (lang) req.ctx.locale = lang;
  });

  if (opts.ops) app.addHook("onResponse", httpMetrics(opts.ops.metrics));
  app.addHook("onResponse", async (req, reply) => {
    const route = req.routeOptions?.url;
    const line = {
      method: req.method,
      route: route ?? "unmatched",
      // Path only: query strings may carry tokens.
      path: req.url.split("?")[0],
      statusCode: reply.statusCode,
      ms: Math.round(reply.elapsedTime * 10) / 10,
      tenantId: req.ctx?.tenant?.id,
      userId: req.ctx?.user?.id,
    };
    if (route && OPS.has(route)) req.log.debug(line, "request");
    else if (reply.statusCode >= 500) req.log.error(line, "request");
    else req.log.info(line, "request");
  });

  app.setErrorHandler((err, req, reply) => {
    const report = () =>
      opts.errorReporter?.capture(err, {
        requestId: req.id,
        tenantId: req.ctx?.tenant?.id ?? null,
        userId: req.ctx?.user?.id ?? null,
        route: req.routeOptions?.url,
        method: req.method,
        url: req.url,
        headers: req.headers,
      });
    if (err instanceof AppError) {
      if (err.status >= 500) {
        if (opts.errorReporter) report();
        else req.log.error(err);
      }
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: { code: "invalid_input", message: "Invalid input", details: err.issues } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.status(status).send({ error: { code: "bad_request", message: (err as Error).message } });
    }
    if (opts.errorReporter) report();
    else req.log.error(err);
    return reply.status(500).send({ error: { code: "internal", message: "Something went wrong", requestId: req.id } });
  });

  if (opts.ops) registerOpsRoutes(app, opts.ops);
  else app.get("/health", async () => ({ ok: true }));

  // The tenancy/auth pipeline, the global preHandlers and the modules live in one encapsulated context, so the
  // ops routes above never wait on (or fail because of) the database.
  await app.register(async (api) => {
    for (const hook of opts.contextHooks) hook(api);
    for (const handler of opts.preHandlers ?? []) api.addHook("preHandler", handler);
    for (const handler of opts.onResponse ?? []) api.addHook("onResponse", handler);

    opts.routeRules?.register(api);
    opts.routeCollector?.register(api);
    for (const m of opts.modules) {
      if (m.routes) await api.register(async (scoped) => m.routes!(scoped), { prefix: `/v1/${m.id}` });
    }
    opts.routeRules?.assertAllMatched();
  });

  return app;
}
