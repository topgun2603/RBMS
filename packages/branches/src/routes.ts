import { FULL_ACCESS_ROLES, isSuperAdmin, requirePermission, requireRole, requireTenant, requireUser, type RequestContext } from "@rbms/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BRANCHES_FEATURE_KEYS, BRANCHES_PERMISSION_KEYS } from "./features";
import type {
  AddUserInput,
  BranchesService,
  BranchInput,
  BranchListQuery,
  BranchPatch,
  SetBranchUsersInput,
  SetUserBranchesInput,
  SummaryQuery,
} from "./service";

const ID = "/:id([0-9a-fA-F-]{36})";
const idParam = z.object({ id: z.string().uuid() });
const userParam = z.object({ userId: z.string().uuid() });
const idUserParam = z.object({ id: z.string().uuid(), userId: z.string().uuid() });
const body = (req: { body: unknown }) => (req.body ?? {}) as Record<string, unknown>;
const query = (req: { query: unknown }) => (req.query ?? {}) as Record<string, string | undefined>;
const tid = (req: { ctx: RequestContext }) => requireTenant(req.ctx).id;

const feature = BRANCHES_FEATURE_KEYS.base;
const manage = BRANCHES_PERMISSION_KEYS.manage;
const READ = { config: { feature, audit: false as const } };
const MANAGE_READ = { config: { feature, permission: manage, audit: false as const } };
const write = (action: string, entity: string, idParamName?: string) => ({
  config: { feature, permission: manage, audit: { action, entity, ...(idParamName ? { idParam: idParamName } : {}) } },
});

const STAFF_ROLES = ["owner", "admin", "staff"];
const fullAccess = (ctx: RequestContext) =>
  isSuperAdmin(ctx) || (ctx.user?.tenantRoles ?? []).some((r) => FULL_ACCESS_ROLES.includes(r));

/**
 * Routes under /v1/branches (feature `multi-branch`; owner, admin or staff):
 * - `GET /mine` — branches the user can work in, the shop default and the request's current branch (any staff);
 * - with `branches.manage`: `GET /` (`includeInactive`), `POST /`, `GET|PATCH|DELETE /:id` (DELETE closes),
 *   `GET|PUT|POST /:id/users`, `DELETE /:id/users/:userId`, `GET|PUT /users/:userId`, `GET /summary?from&to`.
 */
export function branchesRoutes(service: BranchesService) {
  return async (app: FastifyInstance) => {
    app.addHook("preHandler", async (req) => {
      requireRole(req.ctx, ...STAFF_ROLES);
      requireTenant(req.ctx);
    });
    const can = (req: { ctx: RequestContext }) => requirePermission(req.ctx, manage);

    app.get("/mine", READ, async (req) => {
      const user = requireUser(req.ctx);
      return service.mine(tid(req), { userId: user.id, fullAccess: fullAccess(req.ctx) }, req.ctx.branch?.id ?? null);
    });

    app.get("/", MANAGE_READ, async (req) => {
      can(req);
      return service.list(tid(req), query(req) as BranchListQuery);
    });
    app.get("/summary", MANAGE_READ, async (req) => {
      can(req);
      return service.summary(tid(req), query(req) as SummaryQuery);
    });
    app.post("/", write("branches.create", "branch"), async (req) => {
      can(req);
      const created = await service.create(tid(req), body(req) as BranchInput);
      req.auditSummary = `${created.code} ${created.name}`;
      return created;
    });
    app.get(ID, MANAGE_READ, async (req) => {
      can(req);
      return service.get(tid(req), idParam.parse(req.params).id);
    });
    app.patch(ID, write("branches.update", "branch", "id"), async (req) => {
      can(req);
      return service.update(tid(req), idParam.parse(req.params).id, body(req) as BranchPatch);
    });
    app.delete(ID, write("branches.deactivate", "branch", "id"), async (req) => {
      can(req);
      return service.deactivate(tid(req), idParam.parse(req.params).id);
    });

    // ---- staff assignments
    app.get(`${ID}/users`, MANAGE_READ, async (req) => {
      can(req);
      return service.listUsers(tid(req), idParam.parse(req.params).id);
    });
    app.put(`${ID}/users`, write("branches.users.set", "branch", "id"), async (req) => {
      can(req);
      return service.setBranchUsers(tid(req), idParam.parse(req.params).id, body(req) as SetBranchUsersInput);
    });
    app.post(`${ID}/users`, write("branches.users.add", "branch", "id"), async (req) => {
      can(req);
      return service.addUser(tid(req), idParam.parse(req.params).id, body(req) as AddUserInput);
    });
    app.delete(`${ID}/users/:userId`, write("branches.users.remove", "branch", "id"), async (req) => {
      can(req);
      const p = idUserParam.parse(req.params);
      await service.removeUser(tid(req), p.id, p.userId);
      return { ok: true };
    });
    app.get("/users/:userId", MANAGE_READ, async (req) => {
      can(req);
      return service.userBranches(tid(req), userParam.parse(req.params).userId);
    });
    app.put("/users/:userId", write("branches.users.set", "user", "userId"), async (req) => {
      can(req);
      return service.setUserBranches(tid(req), userParam.parse(req.params).userId, body(req) as SetUserBranchesInput);
    });
  };
}
