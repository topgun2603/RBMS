import {
  badRequest,
  forbidden,
  isSuperAdmin,
  notFound,
  requireRole,
  requireSuperAdmin,
  requireTenant,
  requireUser,
  type RequestContext,
} from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { TENANT_STATUSES } from "./schema";
import { publicTenant, type TenancyService } from "./service";

const role = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/, "Invalid role");
const roles = z.array(role).min(1).max(10);
const uuidParam = (name: string) => z.object({ [name]: z.string().uuid() });

const createTenantBody = z.object({
  slug: z.string().trim().toLowerCase(),
  name: z.string().trim().min(1).max(120),
  appId: z.string().trim().min(1).max(32).optional(),
});
const updateTenantBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  metadata: z.record(z.unknown()).optional(),
});
const addMemberBody = z
  .object({
    userId: z.string().uuid().optional(),
    /** Phone number or email; needs `resolveMemberTarget`. */
    target: z.string().trim().min(3).max(254).optional(),
    roles: roles.default(["member"]),
  })
  .refine((b) => Boolean(b.userId) !== Boolean(b.target), { message: "Give either userId or target" });
const rolesBody = z.object({ roles });
const listQuery = z.object({
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const statusBody = z.object({ status: z.enum(TENANT_STATUSES) });
const appBody = z.object({ appId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,32}$/, "Invalid app id").nullable() });
const planBody = z.object({ planId: z.string().min(1).max(64).nullable() });
const domainBody = z.object({ domain: z.string().trim().min(4).max(253) });

const isOwner = (ctx: RequestContext) => isSuperAdmin(ctx) || (ctx.user?.tenantRoles.includes("owner") ?? false);

/**
 * Routes under /v1/tenancy.
 *
 * Members are added by `userId`, or by phone/email `target` when apps/api wires `resolveMemberTarget`
 * (auth looks up or creates the user).
 */
export function tenancyRoutes(
  service: TenancyService,
  opts: { resolveMemberTarget?: (target: string) => Promise<string> } = {},
) {
  return async (app: FastifyInstance) => {
    // ---- tenants
    app.post("/tenants", async (req) => {
      const user = requireUser(req.ctx);
      const body = createTenantBody.parse(req.body);
      const tenant = await service.create({ ...body, ownerUserId: user.id });
      return publicTenant(tenant);
    });

    app.get("/current", async (req) => {
      const ref = requireTenant(req.ctx);
      const tenant = await service.getById(ref.id);
      if (!tenant) throw notFound("Tenant");
      return publicTenant(tenant);
    });

    app.patch("/current", async (req) => {
      requireRole(req.ctx, "owner", "admin");
      const tenant = requireTenant(req.ctx);
      const body = updateTenantBody.parse(req.body);
      return publicTenant(await service.update(tenant.id, body));
    });

    app.get("/mine", async (req) => {
      const user = requireUser(req.ctx);
      const rows = await service.tenantsForUser(user.id);
      return { items: rows.map((r) => ({ tenant: publicTenant(r.tenant), roles: r.roles })) };
    });

    // ---- members
    app.get("/members", async (req) => {
      requireRole(req.ctx, "owner", "admin");
      const tenant = requireTenant(req.ctx);
      return { items: await service.listMembers(tenant.id) };
    });

    app.post("/members", async (req) => {
      requireRole(req.ctx, "owner", "admin");
      const tenant = requireTenant(req.ctx);
      const body = addMemberBody.parse(req.body);
      if (body.roles.includes("owner") && !isOwner(req.ctx)) throw forbidden("Only an owner can add owners");
      let userId = body.userId;
      if (!userId) {
        if (!opts.resolveMemberTarget) throw badRequest("Inviting by phone or email is not enabled");
        userId = await opts.resolveMemberTarget(body.target!);
      }
      const existing = await service.getMember(tenant.id, userId);
      if (existing?.roles.includes("owner") && !isOwner(req.ctx)) throw forbidden("Only an owner can change an owner");
      return service.addMember(tenant.id, userId, body.roles);
    });

    app.patch("/members/:userId", async (req) => {
      requireRole(req.ctx, "owner", "admin");
      const tenant = requireTenant(req.ctx);
      const { userId } = uuidParam("userId").parse(req.params) as { userId: string };
      const body = rolesBody.parse(req.body);
      const existing = await service.getMember(tenant.id, userId);
      if (!existing) throw notFound("Member");
      const touchesOwner = body.roles.includes("owner") || existing.roles.includes("owner");
      if (touchesOwner && !isOwner(req.ctx)) throw forbidden("Only an owner can grant or change the owner role");
      return service.updateRoles(tenant.id, userId, body.roles);
    });

    app.delete("/members/:userId", async (req) => {
      const user = requireUser(req.ctx);
      const tenant = requireTenant(req.ctx);
      const { userId } = uuidParam("userId").parse(req.params) as { userId: string };
      // Anyone may leave; removing someone else needs owner/admin, and only owners can remove owners.
      if (userId !== user.id) {
        requireRole(req.ctx, "owner", "admin");
        const existing = await service.getMember(tenant.id, userId);
        if (existing?.roles.includes("owner") && !isOwner(req.ctx)) throw forbidden("Only an owner can remove an owner");
      }
      await service.removeMember(tenant.id, userId);
      return { ok: true };
    });

    // ---- domains
    app.get("/domains", async (req) => {
      requireRole(req.ctx, "owner", "admin");
      const tenant = requireTenant(req.ctx);
      return { items: await service.listDomains(tenant.id) };
    });

    app.post("/domains", async (req) => {
      requireRole(req.ctx, "owner", "admin");
      const tenant = requireTenant(req.ctx);
      const body = domainBody.parse(req.body);
      return service.addDomain(tenant.id, body.domain);
    });

    app.post("/domains/:id/verify", async (req) => {
      requireRole(req.ctx, "owner", "admin");
      const tenant = requireTenant(req.ctx);
      const { id } = uuidParam("id").parse(req.params) as { id: string };
      const force = isSuperAdmin(req.ctx);
      if (!force && !service.canSelfVerifyDomains) throw forbidden("Domain verification is done by the platform team");
      return service.verifyDomain(tenant.id, id, { force });
    });

    app.delete("/domains/:id", async (req) => {
      requireRole(req.ctx, "owner", "admin");
      const tenant = requireTenant(req.ctx);
      const { id } = uuidParam("id").parse(req.params) as { id: string };
      await service.removeDomain(tenant.id, id);
      return { ok: true };
    });

    // ---- super-admin
    app.get("/tenants", async (req) => {
      requireSuperAdmin(req.ctx);
      const q = listQuery.parse(req.query);
      return service.list(q);
    });

    app.patch("/tenants/:id/status", async (req) => {
      requireSuperAdmin(req.ctx);
      const { id } = uuidParam("id").parse(req.params) as { id: string };
      const { status } = statusBody.parse(req.body);
      return service.setStatus(id, status);
    });

    app.patch("/tenants/:id/plan", async (req) => {
      requireSuperAdmin(req.ctx);
      const { id } = uuidParam("id").parse(req.params) as { id: string };
      const { planId } = planBody.parse(req.body);
      if (planId !== null && !/^[a-z0-9][a-z0-9_-]*$/.test(planId)) throw badRequest("Invalid plan id");
      return service.setPlan(id, planId);
    });

    app.patch("/tenants/:id/app", async (req) => {
      requireSuperAdmin(req.ctx);
      const { id } = uuidParam("id").parse(req.params) as { id: string };
      const { appId } = appBody.parse(req.body);
      return service.setApp(id, appId);
    });
  };
}
