import { AppError, forbidden, unauthorized } from "./errors";

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

/**
 * The shop branch a request works in (multi-branch shops, `@srirealtime/branches`). `locationId` is the branch's
 * inventory stock location, null when none is linked.
 */
export interface BranchRef {
  id: string;
  code: string;
  locationId: string | null;
}

/**
 * The paired POS terminal a request comes from (`x-device-token`, `@srirealtime/pos`). `branchId` / `locationId` are
 * the terminal's branch and its stock location (null when none).
 */
export interface DeviceRef {
  terminalId: string;
  role: "pos" | "weighing";
  branchId: string | null;
  locationId: string | null;
}

/** Per-request context. Tenancy fills `tenant`, auth fills `user`, the branches hook (after auth) fills `branch`. */
export interface RequestContext {
  tenant: TenantRef | null;
  user: UserRef | null;
  /**
   * The paired POS terminal, filled by the pos device hook (after tenancy, before auth). Undefined when that hook
   * isn't mounted, null when the request carries no device token. Treat undefined like null.
   */
  device?: DeviceRef | null;
  /**
   * Current branch, filled by the branches context hook. Undefined when that hook isn't mounted, null when the shop
   * doesn't use branches (feature `multi-branch` off or no branches yet). Treat undefined like null.
   */
  branch?: BranchRef | null;
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

/**
 * The current branch, or 400 `branch_required` when the request has none (the branches hook isn't mounted, the
 * shop has `multi-branch` off, or it has no branches yet). See `RequestContext.branch`.
 */
export function requireBranch(ctx: RequestContext): BranchRef {
  if (!ctx.branch) throw new AppError(400, "branch_required", "Choose a branch for this action");
  return ctx.branch;
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
