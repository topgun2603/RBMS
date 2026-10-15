import type { AuditEvent, RequestContext, RouteAuditConfig } from "@srirealtime/core";

export const MUTATING_METHODS: readonly string[] = ["POST", "PUT", "PATCH", "DELETE"];
export const MAX_SUMMARY = 500;
export const MAX_USER_AGENT = 500;

/** What the onResponse hook knows about a finished request. */
export interface AuditRequestInfo {
  method: string;
  /** Route pattern incl. prefix, e.g. "/v1/invoices/:id/cancel" (Fastify `req.routeOptions.url`). */
  routeUrl: string | undefined;
  params: unknown;
  statusCode: number;
  config: RouteAuditConfig | undefined;
  ctx: RequestContext | null | undefined;
  summary?: string;
}

/** "/v1/invoices/:id/cancel" → { moduleId: "invoices", pattern: "/:id/cancel" }; null outside `/v1/<id>`. */
export function splitRoute(url: string | undefined): { moduleId: string; pattern: string } | null {
  const m = url ? /^\/v1\/([^/?#]+)(\/[^?#]*)?$/.exec(url) : null;
  if (!m) return null;
  return { moduleId: m[1]!, pattern: m[2] && m[2] !== "/" ? m[2] : "/" };
}

/** Default action: `<moduleId>.<method> <routePattern>`, e.g. "invoices.post /:id/cancel". */
export const defaultAction = (moduleId: string, method: string, pattern: string) =>
  `${moduleId}.${method.toLowerCase()} ${pattern}`;

const clip = (s: string | null | undefined, max: number) => (s ? (s.length > max ? s.slice(0, max) : s) : null);

function entityIdFrom(params: unknown, idParam: string | undefined): string | null {
  if (!params || typeof params !== "object") return null;
  const p = params as Record<string, unknown>;
  const pick = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).slice(0, 200) : null);
  if (idParam) return pick(p[idParam]);
  if (p.id !== undefined) return pick(p.id);
  const first = Object.keys(p).find((k) => k !== "*");
  return first ? pick(p[first]) : null;
}

/**
 * The audit event for a finished request, or null when it isn't recorded. Recorded: 2xx POST/PUT/PATCH/DELETE under
 * `/v1/<module>/` by a signed-in user with a tenant, unless the route sets `config.audit: false`.
 * Request bodies are never included; only `req.auditSummary` (clipped).
 */
export function deriveAuditEvent(info: AuditRequestInfo): AuditEvent | null {
  if (info.config === false) return null;
  const method = info.method.toUpperCase();
  if (!MUTATING_METHODS.includes(method)) return null;
  if (info.statusCode < 200 || info.statusCode >= 300) return null;
  const ctx = info.ctx;
  if (!ctx?.user || !ctx.tenant) return null;
  const route = splitRoute(info.routeUrl);
  if (!route) return null;
  const cfg = info.config;
  return {
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: cfg?.action ?? defaultAction(route.moduleId, method, route.pattern),
    entityType: cfg?.entity ?? route.moduleId,
    entityId: entityIdFrom(info.params, cfg?.idParam),
    summary: clip(info.summary, MAX_SUMMARY),
    ip: ctx.ip,
    userAgent: clip(ctx.userAgent, MAX_USER_AGENT),
  };
}

/** `YYYY-MM-DD` (IST) → the instant that day starts. */
export function istDayStart(day: string): Date {
  return new Date(`${day}T00:00:00+05:30`);
}

/** `YYYY-MM-DD` (IST) → the instant the next day starts (exclusive upper bound). */
export function istDayEnd(day: string): Date {
  return new Date(istDayStart(day).getTime() + 86_400_000);
}
