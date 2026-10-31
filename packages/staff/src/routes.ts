import { isSuperAdmin, requirePermission, requireTenant, type RequestContext } from "@rbms/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DISCOUNT_SCOPES, type DiscountLimitService } from "./discount";
import { ASSIGNABLE_LEVELS, type Actor, type StaffService } from "./service";
import { levelOf, ROLE_KEY_RE } from "./templates";

const roleKey = z.string().trim().regex(ROLE_KEY_RE, "Invalid role key");
const roleKeys = z.array(roleKey).max(20);
const permissions = z.array(z.string().trim().min(1).max(100)).max(200);

const inviteBody = z.object({
  /** Phone number or email. */
  target: z.string().trim().min(3).max(254),
  roleKeys: roleKeys.default([]),
  level: z.enum(ASSIGNABLE_LEVELS).optional(),
});
const memberPatch = z.object({
  roleKeys: roleKeys.optional(),
  level: z.enum(ASSIGNABLE_LEVELS).optional(),
  active: z.boolean().optional(),
});
const roleBody = z.object({
  key: roleKey,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  permissions: permissions.default([]),
});
const rolePatch = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).optional(),
  permissions: permissions.optional(),
});
const userIdParam = z.object({ userId: z.string().uuid() });
const keyParam = z.object({ key: roleKey });

/** Staff routes: feature `staff`, permission `staff.manage` (owners/admins always hold it). */
const cfg = { config: { feature: "staff", permission: "staff.manage" } } as const;

function actorOf(ctx: RequestContext): Actor {
  const user = requirePermission(ctx, "staff.manage");
  return {
    userId: user.id,
    level: levelOf(user.tenantRoles),
    superAdmin: isSuperAdmin(ctx),
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  };
}

/** Routes under /v1/staff. */
export function staffRoutes(service: StaffService, discounts?: DiscountLimitService) {
  // With an AuditPort the service records these changes itself (with before/after); otherwise the host hook does.
  const mut = (action: string, entity: string, idParam?: string) => ({
    config: { ...cfg.config, audit: service.recordsAudit ? (false as const) : { action, entity, idParam } },
  });
  return async (app: FastifyInstance) => {
    // ---- members
    app.get("/members", cfg, async (req) => {
      actorOf(req.ctx);
      const tenant = requireTenant(req.ctx);
      const items = await service.listMembers(tenant.id);
      return { items, total: items.length };
    });

    app.post("/invites", mut("staff.member.invite", "member"), async (req) => {
      const actor = actorOf(req.ctx);
      const tenant = requireTenant(req.ctx);
      const body = inviteBody.parse(req.body);
      return service.invite(tenant, body, actor);
    });

    app.patch("/members/:userId", mut("staff.member.update", "member", "userId"), async (req) => {
      const actor = actorOf(req.ctx);
      const tenant = requireTenant(req.ctx);
      const { userId } = userIdParam.parse(req.params);
      const body = memberPatch.parse(req.body);
      return service.updateMember(tenant, userId, body, actor);
    });

    app.delete("/members/:userId", mut("staff.member.remove", "member", "userId"), async (req) => {
      const actor = actorOf(req.ctx);
      const tenant = requireTenant(req.ctx);
      const { userId } = userIdParam.parse(req.params);
      await service.removeMember(tenant, userId, actor);
      return { ok: true };
    });

    // ---- roles
    app.get("/roles", cfg, async (req) => {
      actorOf(req.ctx);
      const tenant = requireTenant(req.ctx);
      const items = await service.listRoles(tenant.id);
      return { items, total: items.length };
    });

    app.post("/roles", mut("staff.role.create", "role"), async (req) => {
      const actor = actorOf(req.ctx);
      const tenant = requireTenant(req.ctx);
      return service.createRole(tenant.id, roleBody.parse(req.body), actor);
    });

    app.patch("/roles/:key", mut("staff.role.update", "role", "key"), async (req) => {
      const actor = actorOf(req.ctx);
      const tenant = requireTenant(req.ctx);
      const { key } = keyParam.parse(req.params);
      return service.updateRole(tenant.id, key, rolePatch.parse(req.body), actor);
    });

    app.delete("/roles/:key", mut("staff.role.delete", "role", "key"), async (req) => {
      const actor = actorOf(req.ctx);
      const tenant = requireTenant(req.ctx);
      const { key } = keyParam.parse(req.params);
      await service.deleteRole(tenant.id, key, actor);
      return { ok: true };
    });

    // ---- discount limits (per role or member; above the limit a manager approves with their PIN)
    if (discounts) {
      app.get("/discount-limits", cfg, async (req) => {
        actorOf(req.ctx);
        return discounts.list(requireTenant(req.ctx).id);
      });
      app.put("/discount-limits", mut("staff.discount_limit.set", "discount_limit"), async (req) => {
        const actor = actorOf(req.ctx);
        return discounts.set(requireTenant(req.ctx).id, req.body, actor);
      });
      app.delete("/discount-limits/:scope/:subject", mut("staff.discount_limit.remove", "discount_limit"), async (req) => {
        const actor = actorOf(req.ctx);
        const { scope, subject } = z.object({ scope: z.enum(DISCOUNT_SCOPES), subject: z.string().min(1).max(64) }).parse(req.params);
        await discounts.remove(requireTenant(req.ctx).id, scope, subject, actor);
        return { ok: true };
      });
    }

    // ---- registry
    app.get("/permissions", cfg, async (req) => {
      actorOf(req.ctx);
      requireTenant(req.ctx);
      return { items: service.permissionGroups() };
    });
  };
}
