import { forbidden, unauthorized } from "./errors";

export interface TenantRef {
  id: string;
  slug: string;
  planId: string | null;
  /** Which product/app the tenant belongs to, e.g. "BL" (billing), "EC" (ecommerce). Null = none. */
  appId: string | null;
}

export interface UserRef {
  id: string;
  sessionId: string;
  /** Platform-wide roles, e.g. "superadmin". */
  platformRoles: string[];
  /** Roles inside the current tenant, e.g. "owner", "admin", "staff", "member". */
  tenantRoles: string[];
  /**
   * Permission patterns in the current tenant (`"*"`, `"invoices.*"`, `"invoices.cancel"`), filled by auth from the
   * member's roles; `[]` without a tenant. Optional in the type so older hand-built contexts (tests) stay valid —
   * treat a missing value as `[]`. Check with `hasPermission` / `requirePermission`.
   */
  permissions?: string[];
}

/** Per-request context. Tenancy fills `tenant`, auth fills `user`. */
export interface RequestContext {
  tenant: TenantRef | null;
  user: UserRef | null;
  locale: string;
  ip: string | null;
  userAgent: string | null;
}

export const emptyContext = (): RequestContext => ({
  tenant: null,
  user: null,
  locale: "en",
  ip: null,
  userAgent: null,
});

export function requireUser(ctx: RequestContext): UserRef {
  if (!ctx.user) throw unauthorized();
  return ctx.user;
}

export function requireTenant(ctx: RequestContext): TenantRef {
  if (!ctx.tenant) throw forbidden("This action needs a tenant");
  return ctx.tenant;
}

export const isSuperAdmin = (ctx: RequestContext) => ctx.user?.platformRoles.includes("superadmin") ?? false;

/** Passes if the user holds any of `roles` in the current tenant, or is a super-admin. */
export function requireRole(ctx: RequestContext, ...roles: string[]): UserRef {
  const user = requireUser(ctx);
  if (isSuperAdmin(ctx)) return user;
  requireTenant(ctx);
  if (!roles.some((r) => user.tenantRoles.includes(r))) throw forbidden();
  return user;
}

export function requireSuperAdmin(ctx: RequestContext): UserRef {
  const user = requireUser(ctx);
  if (!isSuperAdmin(ctx)) throw forbidden();
  return user;
}
