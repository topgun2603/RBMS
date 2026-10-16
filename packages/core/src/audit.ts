import type { RequestContext } from "./context";

/** One entry of the audit trail (see @srirealtime/audit). Never put request bodies or secrets in it. */
export interface AuditEvent {
  /** The shop it concerns; null for platform events (super-admin actions, sign-ins outside a shop). */
  tenantId: string | null;
  /** Who did it; null for system actions (jobs, webhooks). */
  actorUserId: string | null;
  /** e.g. "invoice.cancel", or the host default `<moduleId>.<method> <routePattern>`. */
  action: string;
  /** e.g. "invoice". */
  entityType: string;
  entityId?: string | null;
  /** Short human-readable note, e.g. "INV-0042 cancelled: duplicate". */
  summary?: string | null;
  /** Snapshot before / after an important change (keep small; no secrets). */
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

/** Records audit events. Implemented by the audit module; `record` never throws. */
export interface AuditPort {
  record(e: AuditEvent): Promise<void>;
}

/** The actor fields of an audit event, taken from a request context (tenant null when the request has none). */
export function auditActor(ctx: RequestContext): Pick<AuditEvent, "tenantId" | "actorUserId" | "ip" | "userAgent"> {
  return {
    tenantId: ctx.tenant?.id ?? null,
    actorUserId: ctx.user?.id ?? null,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  };
}
