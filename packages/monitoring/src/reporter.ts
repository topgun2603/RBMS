import { randomBytes } from "node:crypto";
import { scrub, scrubHeaders, scrubString } from "./scrub";

/** Structurally compatible with pino and the other packages' logger ports. */
export interface LoggerPort {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/** Where an error happened. Everything here is scrubbed before it is logged or sent. */
export interface ErrorContext {
  requestId?: string;
  tenantId?: string | null;
  userId?: string | null;
  /** Route pattern, e.g. "/v1/invoices/:id". */
  route?: string;
  method?: string;
  /** Request URL (query secrets are masked). */
  url?: string;
  statusCode?: number;
  headers?: Record<string, unknown>;
  /** Free-form searchable tags, e.g. { job: "notify.send" }. */
  tags?: Record<string, string | number | boolean | undefined>;
  extra?: Record<string, unknown>;
  level?: "error" | "fatal" | "warning";
}

export interface ErrorReporter {
  readonly driver: "console" | "sentry";
  /** Records an error; never throws. Returns the event id (32 hex chars). */
  capture(err: unknown, ctx?: ErrorContext): string;
  /** Waits for in-flight sends (shutdown). Resolves false when the timeout hit first. */
  flush(timeoutMs?: number): Promise<boolean>;
}

export interface ReporterConfig {
  /** Sentry-compatible DSN (`https://<key>@<host>/<projectId>`). Unset = console driver only. */
  dsn?: string;
  environment?: string;
  /** Release / git SHA. */
  release?: string;
  serverName?: string;
  /** Per-send timeout. Default 5000 ms. */
  timeoutMs?: number;
  /** Most sends in flight at once; extra events are only logged. Default 20. */
  maxInFlight?: number;
}

export interface ReporterDeps {
  log: LoggerPort;
  config?: ReporterConfig;
  /** Injected for tests. Default global fetch. */
  fetch?: typeof fetch;
}

export interface ParsedDsn {
  publicKey: string;
  projectId: string;
  /** e.g. https://o123.ingest.sentry.io/api/456/envelope/ */
  envelopeUrl: string;
}

/** Parses a Sentry DSN; null when malformed. */
export function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.split("/").filter(Boolean).pop();
    if (!u.username || !projectId || !/^https?:$/.test(u.protocol)) return null;
    const pathPrefix = u.pathname.split("/").filter(Boolean).slice(0, -1).join("/");
    const base = `${u.protocol}//${u.host}${pathPrefix ? `/${pathPrefix}` : ""}`;
    return { publicKey: u.username, projectId, envelopeUrl: `${base}/api/${projectId}/envelope/` };
  } catch {
    return null;
  }
}

interface StackFrame {
  filename?: string;
  function?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
}

/** V8 stack → Sentry frames (oldest call first, as Sentry expects). */
export function parseStack(stack: string | undefined): StackFrame[] {
  if (!stack) return [];
  const frames: StackFrame[] = [];
  for (const line of stack.split("\n").slice(1)) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (!m) continue;
    const filename = m[2]!;
    frames.push({
      function: m[1] ?? "<anonymous>",
      filename,
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app: !filename.includes("node_modules") && !filename.startsWith("node:"),
    });
  }
  return frames.reverse();
}

const toError = (err: unknown): Error => {
  if (err instanceof Error) return err;
  return new Error(typeof err === "string" ? err : `Non-error thrown: ${safeJson(err)}`);
};

const safeJson = (v: unknown) => {
  try {
    return JSON.stringify(v)?.slice(0, 500) ?? String(v);
  } catch {
    return String(v);
  }
};

/** Tags as strings (Sentry indexes these), undefined dropped. */
function tagsOf(ctx: ErrorContext): Record<string, string> {
  const tags: Record<string, string> = {};
  const put = (k: string, v: unknown) => {
    if (v !== undefined && v !== null && v !== "") tags[k] = scrubString(String(v)).slice(0, 200);
  };
  put("request_id", ctx.requestId);
  put("tenant_id", ctx.tenantId);
  put("route", ctx.route);
  put("method", ctx.method);
  put("status_code", ctx.statusCode);
  for (const [k, v] of Object.entries(ctx.tags ?? {})) put(k, v);
  return tags;
}

/** The scrubbed Sentry event for an error. Exported for tests. */
export function buildEvent(err: unknown, ctx: ErrorContext, cfg: ReporterConfig, eventId: string, now = new Date()) {
  const e = toError(err);
  const chain: Error[] = [];
  for (let cur: unknown = e; cur instanceof Error && chain.length < 5; cur = (cur as { cause?: unknown }).cause) chain.push(cur);
  return {
    event_id: eventId,
    timestamp: now.getTime() / 1000,
    platform: "node",
    level: ctx.level ?? "error",
    logger: "srikit",
    environment: cfg.environment,
    release: cfg.release,
    server_name: cfg.serverName,
    tags: tagsOf(ctx),
    user: ctx.userId ? { id: ctx.userId } : undefined,
    request:
      ctx.method || ctx.url
        ? { method: ctx.method, url: ctx.url ? scrubString(ctx.url) : undefined, headers: scrubHeaders(ctx.headers) }
        : undefined,
    exception: {
      values: chain
        .map((x) => ({
          type: x.name,
          value: scrubString(x.message ?? ""),
          stacktrace: { frames: parseStack(x.stack ? scrubString(x.stack) : undefined) },
        }))
        .reverse(),
    },
    extra: ctx.extra ? scrub(ctx.extra) : undefined,
  };
}

/** Sentry envelope (newline-delimited JSON): header, item header, event. */
export function buildEnvelope(event: { event_id: string }, dsn: string, now = new Date()): string {
  return [
    JSON.stringify({ event_id: event.event_id, sent_at: now.toISOString(), dsn }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");
}

const newEventId = () => randomBytes(16).toString("hex");

/**
 * The error reporter. Every captured error is logged (scrubbed) through `log` — the console driver. When a DSN is
 * configured it is also POSTed as a Sentry envelope (plain HTTP, no SDK): fire-and-forget with a timeout; a failed
 * send is logged as a warning and never affects the caller.
 */
export function createErrorReporter(deps: ReporterDeps): ErrorReporter {
  const cfg = deps.config ?? {};
  const log = deps.log;
  const dsn = cfg.dsn ? parseDsn(cfg.dsn) : null;
  if (cfg.dsn && !dsn) log.warn({}, "monitoring: SENTRY_DSN is malformed; using the console driver only");
  const doFetch = deps.fetch ?? globalThis.fetch;
  const inFlight = new Set<Promise<void>>();
  const maxInFlight = cfg.maxInFlight ?? 20;
  const timeoutMs = cfg.timeoutMs ?? 5000;

  const send = (event: ReturnType<typeof buildEvent>) => {
    if (!dsn) return;
    if (inFlight.size >= maxInFlight) {
      log.warn({ eventId: event.event_id }, "monitoring: too many error reports in flight; dropped");
      return;
    }
    const body = buildEnvelope(event, cfg.dsn!);
    const p = (async () => {
      try {
        const res = await doFetch(dsn.envelopeUrl, {
          method: "POST",
          headers: {
            "content-type": "application/x-sentry-envelope",
            "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=srikit-monitoring/0.1`,
          },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) log.warn({ eventId: event.event_id, status: res.status }, "monitoring: error report rejected");
      } catch (err) {
        log.warn({ eventId: event.event_id, reason: (err as Error)?.name }, "monitoring: error report not sent");
      }
    })();
    inFlight.add(p);
    void p.finally(() => inFlight.delete(p));
  };

  return {
    driver: dsn ? "sentry" : "console",
    capture(err, ctx = {}) {
      const eventId = newEventId();
      try {
        const event = buildEvent(err, ctx, cfg, eventId);
        const top = event.exception.values[event.exception.values.length - 1];
        log.error(
          {
            eventId,
            err: { type: top?.type, message: top?.value, stack: toError(err).stack ? scrubString(toError(err).stack!) : undefined },
            ...event.tags,
            userId: ctx.userId ?? undefined,
            extra: event.extra,
          },
          `error captured: ${top?.value ?? "unknown"}`,
        );
        send(event);
      } catch (e) {
        // The reporter must never be the reason a request or job fails.
        log.warn({ reason: (e as Error)?.message }, "monitoring: capture failed");
      }
      return eventId;
    },
    async flush(ms = 2000) {
      if (inFlight.size === 0) return true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<boolean>((r) => (timer = setTimeout(() => r(false), ms)));
      const done = Promise.allSettled([...inFlight]).then(() => true);
      const out = await Promise.race([done, timeout]);
      clearTimeout(timer);
      return out;
    },
  };
}
