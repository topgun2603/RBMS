import {
  badRequest,
  documented,
  forbidden,
  isSuperAdmin,
  notFound,
  requireRole,
  requireSuperAdmin,
  requireTenant,
  requireUser,
  tooMany,
  type RequestContext,
} from "@srirealtime/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { CUSTOM_DOMAIN_FEATURE, shouldForceVerify } from "./domains";
import { TENANT_STATUSES } from "./schema";
import type { TenantListQuery } from "./list";
import { publicTenant, type TenancyService } from "./service";

/** `publicTenant` as JSON, for the API document and the mobile client. */
export const publicTenantSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  appId: z.string().nullable(),
  status: z.enum(TENANT_STATUSES),
});
const mineResponse = z.object({ items: z.array(z.object({ tenant: publicTenantSchema, roles: z.array(z.string()) })) });

/** Base levels and `role:<key>` custom roles; the service validates the combination (normalizeMemberRoles). */
const role = z.string().regex(/^(role:)?[a-z][a-z0-9_-]{0,31}$/, "Invalid role");
const roles = z.array(role).min(1).max(21);
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
const statusBody = z.object({ status: z.enum(TENANT_STATUSES) });
const appBody = z.object({ appId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,32}$/, "Invalid app id").nullable() });
const planBody = z.object({ planId: z.string().min(1).max(64).nullable() });
const domainBody = z.object({ domain: z.string().trim().min(4).max(253) });
const slugQuery = z.object({
  slug: z.string().max(80).default(""),
  city: z.string().trim().max(60).optional(),
  area: z.string().trim().max(60).optional(),
});
/** Super-admins may pass `force: true` to mark a domain verified without the DNS check. */
const verifyBody = z.object({ force: z.boolean().optional() });

/** Domain routes belong to the `custom-domain` feature. */
const DOMAINS = { config: { feature: CUSTOM_DOMAIN_FEATURE } };

const isOwner = (ctx: RequestContext) => isSuperAdmin(ctx) || (ctx.user?.tenantRoles.includes("owner") ?? false);

/** Audit config of the member routes (the host hook records them under the shop). */
const member = (action: string) => ({ config: { audit: { action, entity: "member", idParam: "userId" } } });
/** Super-admin tenant routes: recorded under the target shop (`auditDetail.tenantId`), not the caller's. */
const platform = (action: string) => ({ config: { audit: { action, entity: "tenant", idParam: "id" } } });

const fmtRoles = (roles: readonly string[] | null) => (roles ? `[${roles.join(", ")}]` : "none");
/** Old → new roles for the audit entry (`entityId` for POST /members, which has no :userId). */
function rolesChanged(req: FastifyRequest, before: string[] | null, after: string[] | null, entityId?: string) {
  req.auditSummary = `Roles ${fmtRoles(before)} → ${fmtRoles(after)}`;
  req.auditDetail = { ...(entityId ? { entityId } : {}), before: before ? { roles: before } : null, after: after ? { roles: after } : null };
}
function tenantChanged(req: FastifyRequest, tenantId: string, field: string, before: unknown, after: unknown) {
  req.auditSummary = `${field}: ${String(before ?? "none")} → ${String(after ?? "none")}`;
  req.auditDetail = { tenantId, before: { [field]: before ?? null }, after: { [field]: after ?? null } };
}

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
  // Public slug check: 60 a minute per IP (in-memory, per instance).
  const slugHits = new Map<string, number[]>();
  const slugLimited = (ip: string | null) => {
    const key = ip ?? "unknown";
    const now = Date.now();
    const recent = (slugHits.get(key) ?? []).filter((t) => now - t < 60_000);
    recent.push(now);
    slugHits.set(key, recent);
    if (slugHits.size > 20_000) slugHits.clear();
    return recent.length > 60;
  };

  return async (app: FastifyInstance) => {
    // ---- public: sign-up's live address check
    app.get("/slug-available", async (req) => {
      if (slugLimited(req.ctx.ip)) throw tooMany("Too many checks, please wait a minute");
      const q = slugQuery.parse(req.query ?? {});
      return service.slugAvailable(q.slug, { city: q.city ?? q.area ?? null });
    });

    // ---- tenants
    app.post("/tenants", async (req) => {
      const user = requireUser(req.ctx);
      const body = createTenantBody.parse(req.body);
      const tenant = await service.create({ ...body, ownerUserId: user.id });
      return publicTenant(tenant);
    });

    app.get("/current", documented({ response: publicTenantSchema }), async (req) => {
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

    app.get("/mine", documented({ response: mineResponse }), async (req) => {
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

    app.post("/members", member("tenancy.member.add"), async (req) => {
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
      const added = await service.addMember(tenant.id, userId, body.roles);
      rolesChanged(req, existing?.roles ?? null, added.roles, userId);
      return added;
    });

    app.patch("/members/:userId", member("tenancy.member.roles"), async (req) => {
      requireRole(req.ctx, "owner", "admin");
      const tenant = requireTenant(req.ctx);
      const { userId } = uuidParam("userId").parse(req.params) as { userId: string };
      const body = rolesBody.parse(req.body);
      const existing = await service.getMember(tenant.id, userId);
      if (!existing) throw notFound("Member");
      const touchesOwner = body.roles.includes("owner") || existing.roles.includes("owner");
      if (touchesOwner && !isOwner(req.ctx)) throw forbidden("Only an owner can grant or change the owner role");
      const updated = await service.updateRoles(tenant.id, userId, body.roles);
      rolesChanged(req, existing.roles, updated.roles);
      return updated;
    });

    app.delete("/members/:userId", member("tenancy.member.remove"), async (req) => {
      const user = requireUser(req.ctx);
      const tenant = requireTenant(req.ctx);
      const { userId } = uuidParam("userId").parse(req.params) as { userId: string };
      // Anyone may leave; removing someone else needs owner/admin, and only owners can remove owners.
      if (userId !== user.id) requireRole(req.ctx, "owner", "admin");
      const existing = await service.getMember(tenant.id, userId);
      if (userId !== user.id && existing?.roles.includes("owner") && !isOwner(req.ctx)) throw forbidden("Only an owner can remove an owner");
      await service.removeMember(tenant.id, userId);
      if (existing) rolesChanged(req, existing.roles, null);
      if (userId === user.id) req.auditSummary = "Left the shop";
      return { ok: true };
    });

    // ---- domains
    app.get("/domains", DOMAINS, async (req) => {
      requireRole(req.ctx, "owner", "admin");
      const tenant = requireTenant(req.ctx);
      return { items: await service.listDomains(tenant.id) };
    });

    app.post("/domains", DOMAINS, async (req) => {
      requireRole(req.ctx, "owner", "admin");
      const tenant = requireTenant(req.ctx);
      const body = domainBody.parse(req.body);
      return service.addDomain(tenant.id, body.domain);
    });

    app.get("/domains/:id/instructions", DOMAINS, async (req) => {
      requireRole(req.ctx, "owner", "admin");
      const tenant = requireTenant(req.ctx);
      const { id } = uuidParam("id").parse(req.params) as { id: string };
      return service.domainInstructions(tenant.id, id);
    });

    app.post("/domains/:id/verify", DOMAINS, async (req) => {
      requireRole(req.ctx, "owner", "admin");
      const tenant = requireTenant(req.ctx);
      const { id } = uuidParam("id").parse(req.params) as { id: string };
      const requested = verifyBody.parse(req.body ?? {}).force;
      const force = shouldForceVerify({ superAdmin: isSuperAdmin(req.ctx), requested, canSelfVerify: service.canSelfVerifyDomains });
      if (!force && !service.canSelfVerifyDomains) throw forbidden("Domain verification is done by the platform team");
      return service.verifyDomain(tenant.id, id, { force });
    });

    app.delete("/domains/:id", DOMAINS, async (req) => {
      requireRole(req.ctx, "owner", "admin");
      const tenant = requireTenant(req.ctx);
      const { id } = uuidParam("id").parse(req.params) as { id: string };
      await service.removeDomain(tenant.id, id);
      return { ok: true };
    });

    // ---- super-admin
    app.get("/tenants", async (req) => {
      requireSuperAdmin(req.ctx);
      return service.list(req.query as TenantListQuery);
    });

    app.patch("/tenants/:id/status", platform("tenancy.tenant.status"), async (req) => {
      requireSuperAdmin(req.ctx);
      const { id } = uuidParam("id").parse(req.params) as { id: string };
      const { status } = statusBody.parse(req.body);
      const before = await service.getById(id);
      const t = await service.setStatus(id, status);
      tenantChanged(req, id, "status", before?.status ?? null, t.status);
      return t;
    });

    app.patch("/tenants/:id/plan", platform("tenancy.tenant.plan"), async (req) => {
      requireSuperAdmin(req.ctx);
      const { id } = uuidParam("id").parse(req.params) as { id: string };
      const { planId } = planBody.parse(req.body);
      if (planId !== null && !/^[a-z0-9][a-z0-9_-]*$/.test(planId)) throw badRequest("Invalid plan id");
      const before = await service.getById(id);
      const t = await service.setPlan(id, planId);
      tenantChanged(req, id, "planId", before?.planId ?? null, t.planId);
      return t;
    });

    app.patch("/tenants/:id/app", platform("tenancy.tenant.app"), async (req) => {
      requireSuperAdmin(req.ctx);
      const { id } = uuidParam("id").parse(req.params) as { id: string };
      const { appId } = appBody.parse(req.body);
      const before = await service.getById(id);
      const t = await service.setApp(id, appId);
      tenantChanged(req, id, "appId", before?.appId ?? null, t.appId);
      return t;
    });
  };
}
