import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  type AuditPort,
  type PermissionDef,
  type TenantRef,
} from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { and, asc, desc, eq } from "drizzle-orm";
import type { LoggerPort, MembershipPort, MembershipRecord, QuotaPort, UserDirectoryPort } from "./ports";
import { tenantRoles, type TenantRole } from "./schema";
import {
  BUILTIN_ROLES,
  BUILTIN_TEMPLATE_HASHES,
  builtinRoleSyncs,
  groupPermissions,
  levelOf,
  membershipRoles,
  PERMISSION_PATTERN_RE,
  resolvePermissions,
  ROLE_KEY_RE,
  roleKeysOf,
  type Level,
} from "./templates";

export interface StaffDeps {
  db: Db;
  /** Every mounted module's permissions (read lazily), e.g. `() => modules.flatMap((m) => m.permissions ?? [])`. */
  registry: () => PermissionDef[];
  memberships: MembershipPort;
  users: UserDirectoryPort;
  /** Plan limit `staff`; when absent invites are unlimited. */
  quota?: QuotaPort;
  /** Records role and member changes with before/after. */
  audit?: AuditPort;
  log?: LoggerPort;
  /** Permission cache TTL, default 60 s. */
  cacheTtlMs?: number;
}

/** Who is acting, for access rules and audit entries. */
export interface Actor {
  userId: string;
  /** The actor's base level in the tenant; null for super-admins acting without a membership. */
  level: Level | null;
  superAdmin?: boolean;
  ip?: string | null;
  userAgent?: string | null;
}

export interface RoleInput {
  key: string;
  name: string;
  description?: string;
  permissions: string[];
}

export interface StaffMember {
  userId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  level: Level | null;
  roles: string[];
  roleKeys: string[];
  active: boolean;
  lastActive: Date | null;
  joinedAt: Date;
}

const MAX_CACHE_ENTRIES = 10_000;
/** Levels the staff API may assign (owners are managed through tenancy). */
export const ASSIGNABLE_LEVELS = ["admin", "staff", "member"] as const;
export type AssignableLevel = (typeof ASSIGNABLE_LEVELS)[number];

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/** Validates role permission patterns (well-formed, unique, at most 200). */
export function validatePermissions(perms: readonly string[]): string[] {
  const cleaned = [...new Set(perms.map((p) => p.trim()).filter(Boolean))];
  const bad = cleaned.find((p) => !PERMISSION_PATTERN_RE.test(p));
  if (bad) throw badRequest(`Invalid permission: ${bad}`, { permission: bad });
  if (cleaned.length > 200) throw badRequest("Too many permissions");
  return cleaned.sort();
}

export function validateRoleKey(key: string): string {
  if (!ROLE_KEY_RE.test(key)) throw badRequest("Role key must be 2–32 lowercase letters, digits or hyphens, starting with a letter");
  return key;
}

/**
 * Access rules for changing a member through the staff API:
 * - only owners (or super-admins) touch owners;
 * - only owners/admins grant or change the admin level; staff with `staff.manage` handle staff/member levels only;
 * - non-admins cannot change their own membership.
 */
export function assertCanManage(actor: Actor, target: { userId: string; level: Level | null } | null, newLevel?: Level | null) {
  if (actor.superAdmin || actor.level === "owner") return;
  if (target?.level === "owner" || newLevel === "owner") throw forbidden("Only an owner can change an owner");
  if (actor.level === "admin") return;
  if (target && target.userId === actor.userId) throw forbidden("You can't change your own access");
  if (target?.level === "admin" || newLevel === "admin") throw forbidden("Only an owner or admin can manage admins");
}

export class StaffService {
  private readonly db: Db;
  private readonly ttl: number;
  /** tenant → role key → permissions */
  private readonly roleCache = new Map<string, { map: Map<string, string[]>; expires: number }>();
  /** `${tenant}|${roles}` → permissions */
  private readonly permCache = new Map<string, { perms: string[]; expires: number }>();
  private readonly seeded = new Set<string>();

  constructor(private readonly deps: StaffDeps) {
    this.db = deps.db;
    this.ttl = deps.cacheTtlMs ?? 60_000;
  }

  /** True when an AuditPort is wired: the service records member/role changes itself. */
  get recordsAudit(): boolean {
    return !!this.deps.audit;
  }

  // ---------------------------------------------------------------- resolver

  /**
   * auth's PermissionResolverPort. Owner/admin/member resolve without a query; staff need the tenant's roles
   * (one query, cached per tenant and per tenant+roles for 60 s).
   */
  async permissionsFor(tenantId: string, roles: string[]): Promise<string[]> {
    if (levelOf(roles) !== "staff") return resolvePermissions(roles, new Map());
    const key = `${tenantId}|${[...roles].sort().join(",")}`;
    const now = Date.now();
    const hit = this.permCache.get(key);
    if (hit && hit.expires > now) return hit.perms;
    const perms = resolvePermissions(roles, await this.roleMap(tenantId));
    if (this.permCache.size >= MAX_CACHE_ENTRIES) this.permCache.clear();
    this.permCache.set(key, { perms, expires: now + this.ttl });
    return perms;
  }

  /** Drops cached permissions for one tenant, or all. */
  invalidate(tenantId?: string) {
    if (!tenantId) {
      this.roleCache.clear();
      this.permCache.clear();
      return;
    }
    this.roleCache.delete(tenantId);
    const prefix = `${tenantId}|`;
    for (const k of this.permCache.keys()) if (k.startsWith(prefix)) this.permCache.delete(k);
  }

  private async roleMap(tenantId: string): Promise<Map<string, string[]>> {
    const now = Date.now();
    const hit = this.roleCache.get(tenantId);
    if (hit && hit.expires > now) return hit.map;
    // Stale built-ins (older templates the owner never edited) are brought up to date before they resolve.
    try {
      await this.ensureSeeded(tenantId);
    } catch (err) {
      this.deps.log?.error({ err, tenantId }, "staff: seeding built-in roles failed");
    }
    const rows = await this.db
      .select({ key: tenantRoles.key, permissions: tenantRoles.permissions })
      .from(tenantRoles)
      .where(eq(tenantRoles.tenantId, tenantId));
    // Built-ins not seeded yet resolve from the templates (resolvePermissions falls back to them).
    const map = new Map(rows.map((r) => [r.key, r.permissions]));
    if (this.roleCache.size >= MAX_CACHE_ENTRIES) this.roleCache.clear();
    this.roleCache.set(tenantId, { map, expires: now + this.ttl });
    return map;
  }

  // ---------------------------------------------------------------- registry

  registry(): PermissionDef[] {
    return this.deps.registry();
  }

  /** `GET /permissions`: the registry grouped by module. */
  permissionGroups() {
    return groupPermissions(this.registry());
  }

  // ---------------------------------------------------------------- roles

  /**
   * Once per process per tenant (idempotent): inserts missing built-in roles and brings built-ins the owner hasn't
   * edited up to the current templates (`builtinRoleSyncs`); owner-edited built-ins are left alone.
   */
  async ensureSeeded(tenantId: string): Promise<void> {
    if (this.seeded.has(tenantId)) return;
    await this.db
      .insert(tenantRoles)
      .values(BUILTIN_ROLES.map((r) => ({ tenantId, ...r, builtin: true, templateHash: BUILTIN_TEMPLATE_HASHES.get(r.key)! })))
      .onConflictDoNothing({ target: [tenantRoles.tenantId, tenantRoles.key] });
    const rows = await this.db
      .select({ key: tenantRoles.key, permissions: tenantRoles.permissions, builtin: tenantRoles.builtin, templateHash: tenantRoles.templateHash })
      .from(tenantRoles)
      .where(and(eq(tenantRoles.tenantId, tenantId), eq(tenantRoles.builtin, true)));
    const syncs = builtinRoleSyncs(rows);
    for (const s of syncs) {
      await this.db
        .update(tenantRoles)
        .set(s.permissions ? { permissions: s.permissions, templateHash: s.templateHash } : { templateHash: s.templateHash })
        .where(and(eq(tenantRoles.tenantId, tenantId), eq(tenantRoles.key, s.key), eq(tenantRoles.builtin, true)));
    }
    const updated = syncs.filter((s) => s.permissions).map((s) => s.key);
    if (updated.length) {
      this.invalidate(tenantId);
      this.deps.log?.info({ tenantId, roles: updated }, "staff: built-in roles updated to the current templates");
    }
    this.seeded.add(tenantId);
  }

  async listRoles(tenantId: string): Promise<TenantRole[]> {
    await this.ensureSeeded(tenantId);
    return this.db
      .select()
      .from(tenantRoles)
      .where(eq(tenantRoles.tenantId, tenantId))
      .orderBy(desc(tenantRoles.builtin), asc(tenantRoles.name));
  }

  async getRole(tenantId: string, key: string): Promise<TenantRole | null> {
    await this.ensureSeeded(tenantId);
    const [row] = await this.db
      .select()
      .from(tenantRoles)
      .where(and(eq(tenantRoles.tenantId, tenantId), eq(tenantRoles.key, key)))
      .limit(1);
    return row ?? null;
  }

  async createRole(tenantId: string, input: RoleInput, actor?: Actor): Promise<TenantRole> {
    const key = validateRoleKey(input.key);
    const name = input.name.trim();
    if (!name) throw badRequest("Name is required");
    await this.ensureSeeded(tenantId);
    try {
      const [row] = await this.db
        .insert(tenantRoles)
        .values({
          tenantId,
          key,
          name,
          description: input.description?.trim() ?? "",
          permissions: validatePermissions(input.permissions),
          builtin: false,
        })
        .returning();
      this.invalidate(tenantId);
      await this.audit(tenantId, actor, "staff.role.create", key, `Role ${name} created`, undefined, row);
      return row!;
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("A role with that key already exists");
      throw err;
    }
  }

  /** Built-in roles are editable too. */
  async updateRole(
    tenantId: string,
    key: string,
    patch: { name?: string; description?: string; permissions?: string[] },
    actor?: Actor,
  ): Promise<TenantRole> {
    const before = await this.getRole(tenantId, key);
    if (!before) throw notFound("Role");
    const set: Partial<typeof tenantRoles.$inferInsert> = {};
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw badRequest("Name is required");
      set.name = name;
    }
    if (patch.description !== undefined) set.description = patch.description.trim();
    if (patch.permissions !== undefined) set.permissions = validatePermissions(patch.permissions);
    if (Object.keys(set).length === 0) return before;
    const [row] = await this.db
      .update(tenantRoles)
      .set(set)
      .where(and(eq(tenantRoles.tenantId, tenantId), eq(tenantRoles.key, key)))
      .returning();
    this.invalidate(tenantId);
    await this.audit(tenantId, actor, "staff.role.update", key, `Role ${row!.name} updated`, before, row);
    return row!;
  }

  /** Deletes a custom role and removes it from every member. Built-in roles cannot be deleted. */
  async deleteRole(tenantId: string, key: string, actor?: Actor): Promise<void> {
    const role = await this.getRole(tenantId, key);
    if (!role) throw notFound("Role");
    if (role.builtin) throw badRequest("Built-in roles can't be deleted; edit their permissions instead");
    await this.db.delete(tenantRoles).where(and(eq(tenantRoles.tenantId, tenantId), eq(tenantRoles.key, key)));
    const entry = `role:${key}`;
    for (const m of await this.deps.memberships.listMembers(tenantId)) {
      if (m.roles.includes(entry)) await this.deps.memberships.updateRoles(tenantId, m.userId, m.roles.filter((r) => r !== entry));
    }
    this.invalidate(tenantId);
    await this.audit(tenantId, actor, "staff.role.delete", key, `Role ${role.name} deleted`, role, undefined);
  }

  private async assertRoleKeys(tenantId: string, keys: readonly string[]) {
    if (keys.length === 0) return;
    const known = new Set((await this.listRoles(tenantId)).map((r) => r.key));
    const unknown = keys.find((k) => !known.has(k));
    if (unknown) throw badRequest(`Unknown role: ${unknown}`, { roleKey: unknown });
  }

  // ---------------------------------------------------------------- members

  async listMembers(tenantId: string): Promise<StaffMember[]> {
    const members = await this.deps.memberships.listMembers(tenantId);
    const users = await this.deps.users.getUsers(members.map((m) => m.userId));
    const byId = new Map(users.map((u) => [u.id, u]));
    return members.map((m) => toStaffMember(m, byId.get(m.userId)));
  }

  private async member(tenantId: string, userId: string): Promise<StaffMember> {
    const m = await this.deps.memberships.getMember(tenantId, userId);
    if (!m) throw notFound("Member");
    const [u] = await this.deps.users.getUsers([userId]);
    return toStaffMember(m, u);
  }

  /**
   * Invites by phone/email: finds or creates the user, adds them as `level` (default staff) with the given custom
   * roles, and consumes one `staff` plan unit for a new active member (released again if adding fails).
   */
  async invite(
    tenant: TenantRef,
    input: { target: string; roleKeys?: string[]; level?: AssignableLevel },
    actor: Actor,
  ): Promise<StaffMember> {
    const level = input.level ?? "staff";
    const roleKeys = (input.roleKeys ?? []).map(validateRoleKey);
    assertCanManage(actor, null, level);
    await this.assertRoleKeys(tenant.id, roleKeys);
    const { id: userId } = await this.deps.users.findOrCreateByTarget(input.target);
    const existing = await this.deps.memberships.getMember(tenant.id, userId);
    if (existing?.status === "active") throw conflict("This person is already a member");
    if (existing) assertCanManage(actor, { userId, level: levelOf(existing.roles) }, level);

    await this.deps.quota?.consume(tenant, "staff", 1);
    try {
      await this.deps.memberships.addMember(tenant.id, userId, membershipRoles(level, roleKeys));
    } catch (err) {
      await this.releaseQuota(tenant);
      throw err;
    }
    this.invalidate(tenant.id);
    const member = await this.member(tenant.id, userId);
    await this.audit(tenant.id, actor, "staff.member.invite", userId, `Invited ${maskTarget(input.target)} as ${level}`, existing ?? undefined, {
      roles: member.roles,
    });
    return member;
  }

  /** Changes a member's custom roles, level and/or active flag. */
  async updateMember(
    tenant: TenantRef,
    userId: string,
    patch: { roleKeys?: string[]; level?: AssignableLevel; active?: boolean },
    actor: Actor,
  ): Promise<StaffMember> {
    const current = await this.deps.memberships.getMember(tenant.id, userId);
    if (!current) throw notFound("Member");
    const currentLevel = levelOf(current.roles);
    assertCanManage(actor, { userId, level: currentLevel }, patch.level);

    const roleKeys = patch.roleKeys?.map(validateRoleKey);
    if (roleKeys) await this.assertRoleKeys(tenant.id, roleKeys);
    const level: Level = patch.level ?? currentLevel ?? "member";
    const nextRoles = membershipRoles(level, roleKeys ?? roleKeysOf(current.roles));
    const rolesChanged = nextRoles.join(",") !== membershipRoles(currentLevel ?? "member", roleKeysOf(current.roles)).join(",");
    if (rolesChanged) await this.deps.memberships.updateRoles(tenant.id, userId, nextRoles);

    if (patch.active !== undefined && patch.active !== (current.status === "active")) {
      if (!this.deps.memberships.setMemberStatus) throw badRequest("Deactivating members is not enabled");
      const counts = currentLevel !== "owner";
      if (patch.active && counts) await this.deps.quota?.consume(tenant, "staff", 1);
      try {
        await this.deps.memberships.setMemberStatus(tenant.id, userId, patch.active ? "active" : "inactive");
      } catch (err) {
        if (patch.active && counts) await this.releaseQuota(tenant);
        throw err;
      }
      if (!patch.active && counts) await this.releaseQuota(tenant);
    }
    this.invalidate(tenant.id);
    const after = await this.member(tenant.id, userId);
    await this.audit(tenant.id, actor, "staff.member.update", userId, `Access changed for ${after.name ?? userId}`, {
      roles: current.roles,
      active: current.status === "active",
    }, { roles: after.roles, active: after.active });
    return after;
  }

  async removeMember(tenant: TenantRef, userId: string, actor: Actor): Promise<void> {
    const current = await this.deps.memberships.getMember(tenant.id, userId);
    if (!current) throw notFound("Member");
    const level = levelOf(current.roles);
    if (userId !== actor.userId) assertCanManage(actor, { userId, level });
    await this.deps.memberships.removeMember(tenant.id, userId);
    if (current.status === "active" && level !== "owner") await this.releaseQuota(tenant);
    this.invalidate(tenant.id);
    await this.audit(tenant.id, actor, "staff.member.remove", userId, "Member removed", { roles: current.roles }, undefined);
  }

  private async releaseQuota(tenant: TenantRef) {
    try {
      await this.deps.quota?.release(tenant, "staff", 1);
    } catch (err) {
      this.deps.log?.error({ err, tenantId: tenant.id }, "staff: quota release failed");
    }
  }

  private async audit(
    tenantId: string,
    actor: Actor | undefined,
    action: string,
    entityId: string,
    summary: string,
    before: unknown,
    after: unknown,
  ) {
    if (!this.deps.audit) return;
    try {
      await this.deps.audit.record({
        tenantId,
        actorUserId: actor?.userId ?? null,
        action,
        entityType: action.startsWith("staff.role") ? "role" : "member",
        entityId,
        summary,
        before,
        after,
        ip: actor?.ip ?? null,
        userAgent: actor?.userAgent ?? null,
      });
    } catch (err) {
      this.deps.log?.error({ err, tenantId, action }, "staff: audit failed");
    }
  }
}

function toStaffMember(
  m: MembershipRecord,
  u: { name: string | null; phone: string | null; email: string | null; lastLoginAt: Date | null } | undefined,
): StaffMember {
  return {
    userId: m.userId,
    name: u?.name ?? null,
    phone: u?.phone ?? null,
    email: u?.email ?? null,
    level: levelOf(m.roles),
    roles: m.roles,
    roleKeys: roleKeysOf(m.roles),
    active: m.status === "active",
    lastActive: u?.lastLoginAt ?? null,
    joinedAt: m.createdAt,
  };
}

/** Phone/email shown in audit summaries without the full value. */
function maskTarget(t: string): string {
  const s = t.trim();
  const at = s.indexOf("@");
  if (at > 0) return `${s[0]}***${s.slice(at)}`;
  return s.length > 4 ? `***${s.slice(-4)}` : "***";
}
