import { isSuperAdmin, type AuditEvent, type RequestContext, type RouteAuditConfig } from "@rbms/core";

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
  /** `req.auditDetail`: tenant override and before/after snapshots. */
  detail?: { tenantId?: string | null; entityId?: string | null; before?: unknown; after?: unknown };
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
 * `/v1/<module>/` by a signed-in user, unless the route sets `config.audit: false`. The tenant is `detail.tenantId`
 * when given (null = platform event), else the request's shop. Without a shop only super-admin requests and routes with an
 * explicit `config.audit` or `detail` are recorded (tenant null). Request bodies are never included; only `req.auditSummary` (clipped)
 * and the `detail.before`/`after` snapshots a route sets.
 */
export function deriveAuditEvent(info: AuditRequestInfo): AuditEvent | null {
  if (info.config === false) return null;
  const method = info.method.toUpperCase();
  if (!MUTATING_METHODS.includes(method)) return null;
  if (info.statusCode < 200 || info.statusCode >= 300) return null;
  const ctx = info.ctx;
  if (!ctx?.user) return null;
  const route = splitRoute(info.routeUrl);
  if (!route) return null;
  const cfg = info.config;
  const detail = info.detail;
  const tenantId = detail && detail.tenantId !== undefined ? detail.tenantId : (ctx.tenant?.id ?? null);
  if (!tenantId && !cfg && !detail && !isSuperAdmin(ctx)) return null;
  return {
    tenantId: tenantId || null,
    actorUserId: ctx.user.id,
    action: cfg?.action ?? defaultAction(route.moduleId, method, route.pattern),
    entityType: cfg?.entity ?? route.moduleId,
    entityId: detail?.entityId !== undefined ? clip(detail.entityId, 200) : entityIdFrom(info.params, cfg?.idParam),
    summary: clip(info.summary, MAX_SUMMARY),
    ip: ctx.ip,
    userAgent: clip(ctx.userAgent, MAX_USER_AGENT),
    ...(detail?.before !== undefined ? { before: detail.before } : {}),
    ...(detail?.after !== undefined ? { after: detail.after } : {}),
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
