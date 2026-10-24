import { AppError, FULL_ACCESS_ROLES, isSuperAdmin, type BranchRef, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { chooseBranch, type Assignment, type BranchAccess, type BranchLite } from "./logic";
import { noopLogger, type LoggerPort } from "./ports";

/** What the hook reads (BranchesService satisfies it, with caching). */
export interface BranchDirectory {
  featureOn(tenantId: string): Promise<boolean>;
  activeBranches(tenantId: string): Promise<BranchLite[]>;
  assignments(tenantId: string, userId: string): Promise<Assignment[]>;
}

export const BRANCH_HEADER = "x-branch";

export interface BranchHookOptions {
  log?: LoggerPort;
  /**
   * Requests whose header problem (unknown, closed or not allowed branch) falls back to the normal choice instead
   * of failing, so a client holding a stale `x-branch` can still load its branch list. Default: `GET /v1/branches/mine`.
   */
  lenient?: (method: string, url: string) => boolean;
}

const defaultLenient = (method: string, url: string) => method === "GET" && /^\/v1\/branches\/mine(?:[?#]|$)/.test(url);

/** How the signed-in user may use branches (see `BranchAccess`). */
export function accessFor(ctx: RequestContext, assignments: Assignment[]): BranchAccess {
  const user = ctx.user;
  if (!user || (!isSuperAdmin(ctx) && user.tenantRoles.length === 0)) return { kind: "public" };
  if (isSuperAdmin(ctx) || user.tenantRoles.some((r) => FULL_ACCESS_ROLES.includes(r))) return { kind: "all", assignments };
  return { kind: "assigned", assignments };
}

const toRef = (b: BranchLite): BranchRef => ({ id: b.id, code: b.code, locationId: b.locationId });

/**
 * Computes `ctx.branch` for one request. Null without a tenant, when `multi-branch` is off or the shop has no
 * branches yet. Throws 404 `branch_not_found` / 403 `branch_forbidden` for a bad `x-branch` header (unless lenient).
 */
export async function resolveRequestBranch(
  directory: BranchDirectory,
  ctx: RequestContext,
  header: string | null | undefined,
  opts: { lenient?: boolean } = {},
): Promise<BranchRef | null> {
  const tenant = ctx.tenant;
  if (!tenant) return null;
  if (!(await directory.featureOn(tenant.id))) return null;
  const active = await directory.activeBranches(tenant.id);
  if (active.length === 0) return null;
  // A paired POS terminal works in its own branch (docs/pos-terminals.md), whatever the header says.
  const terminalBranch = ctx.device?.branchId ? active.find((b) => b.id === ctx.device!.branchId) : undefined;
  if (terminalBranch) return toRef(terminalBranch);
  const signedIn = ctx.user && (isSuperAdmin(ctx) || ctx.user.tenantRoles.length > 0);
  const assignments = signedIn ? await directory.assignments(tenant.id, ctx.user!.id) : [];
  const access = accessFor(ctx, assignments);
  let choice = chooseBranch(active, access, header);
  if (!choice.ok && opts.lenient) choice = chooseBranch(active, access, null);
  if (!choice.ok) {
    if (choice.error === "not_found") {
      throw new AppError(404, "branch_not_found", "This branch doesn't exist or is closed", { branch: choice.header });
    }
    throw new AppError(403, "branch_forbidden", "You are not assigned to this branch", { branch: choice.header });
  }
  return choice.branch ? toRef(choice.branch) : null;
}

/**
 * Fills `req.ctx.branch` from the `x-branch` header (branch code or id) or the user's home/only branch.
 * MUST be registered AFTER the tenancy and auth context hooks (it reads `ctx.tenant` and `ctx.user`):
 * `contextHooks: [tenancy.contextHook, auth.contextHook, branches.contextHook]`.
 */
export function branchContextHook(directory: BranchDirectory, options: BranchHookOptions = {}) {
  const log = options.log ?? noopLogger;
  const lenient = options.lenient ?? defaultLenient;
  return (app: FastifyInstance) => {
    app.addHook("onRequest", async (req) => {
      const raw = req.headers[BRANCH_HEADER];
      const header = Array.isArray(raw) ? raw[0] : raw;
      try {
        req.ctx.branch = await resolveRequestBranch(directory, req.ctx, header, { lenient: lenient(req.method, req.url) });
      } catch (err) {
        if (err instanceof AppError) throw err;
        log.error({ err, tenantId: req.ctx.tenant?.id }, "branches: branch lookup failed");
        throw err;
      }
    });
  };
}
