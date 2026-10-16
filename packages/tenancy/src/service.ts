import { badRequest, conflict, forbidden, notFound, type TenantRef } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { and, arrayContains, asc, count, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import {
  tenantDomains,
  tenantMemberships,
  tenants,
  type Tenant,
  type TenantDomain,
  type TenantMembership,
  type TenantStatus,
} from "./schema";
import {
  DEFAULT_CNAME_TARGET,
  domainInstructions,
  newVerificationToken,
  type DomainCheck,
  type DomainInstructions,
  type DomainVerifier,
} from "./domains";
import { normalizeMemberRoles } from "./roles";
import { isPlatformHost, isValidDomain, normalizeHost, slugCandidates, slugFromHost, validateSlug } from "./slug";

export interface TenancyDeps {
  db: Db;
  /** e.g. "srikit.com" in production, "localhost" in development. */
  rootDomain: string;
  /** Called after a tenant's plan changes (wire to plans.service.invalidate). */
  onPlanChange?: (tenantId: string, planId: string | null) => void | Promise<void>;
  /** Called after a tenant's app changes (wire to features.service.invalidate). */
  onAppChange?: (tenantId: string, appId: string | null) => void | Promise<void>;
  /**
   * Optional DNS check for custom domains (apps/api: node:dns/promises). `txt` = the `_srikit-verify.<domain>` TXT
   * record holds `token` (this verifies the domain); `cname` = the domain points at `cnameTarget` (guidance only).
   * When set, owners/admins can verify their own domains and `verifyPending()` works; when absent, only a
   * super-admin can mark a domain verified.
   */
  domainVerifier?: DomainVerifier;
  /** CNAME target shown in the DNS instructions (env CNAME_TARGET), default "stores.srikit.in". */
  cnameTarget?: string;
  /**
   * Turns a phone number or email into a user id, creating the user if needed (wire to auth).
   * Enables inviting members by `target` instead of `userId`.
   */
  resolveMemberTarget?: (target: string) => Promise<string>;
  /** Cache TTL for resolve(), default 60s. */
  cacheTtlMs?: number;
  /** Runs after every new tenant (see `onTenantCreated`); more can be added with `service.onTenantCreated`. */
  onTenantCreated?: TenantCreatedHook[];
  /** A hook threw: the tenant stays created and the remaining hooks still run. Default: rethrown after all ran. */
  onHookError?: (err: unknown, hook: string, tenant: Tenant) => void;
}

export interface CreateTenantInput {
  slug: string;
  name: string;
  ownerUserId: string;
  planId?: string | null;
  appId?: string | null;
  /** Extra details for the on-tenant-created hooks (e.g. sign-up's state, GSTIN, plan). */
  details?: Record<string, unknown>;
}

/** What the on-tenant-created hooks receive. */
export interface TenantCreatedEvent {
  tenant: Tenant;
  ownerUserId: string;
  details: Record<string, unknown>;
}

/** Seeds a new tenant (settings, branding, subscription…). Hooks run in order, after the tenant row is committed. */
export interface TenantCreatedHook {
  name: string;
  run(e: TenantCreatedEvent): Promise<void> | void;
}

export interface SlugAvailability {
  slug: string;
  available: boolean;
  /** Why not: "taken", or the validation message. */
  reason?: string;
  code?: "taken" | "length" | "format" | "reserved";
  suggestions: string[];
}

export interface ResolveInput {
  host: string | null | undefined;
  headerSlug?: string | null;
}

export interface TenantWithRoles {
  tenant: Tenant;
  roles: string[];
}

interface CacheEntry {
  tenant: Tenant | null;
  expires: number;
}

const MAX_CACHE_ENTRIES = 10_000;

export const toTenantRef = (t: Tenant): TenantRef => ({ id: t.id, slug: t.slug, planId: t.planId, appId: t.appId ?? null });

/** Public view of a tenant, safe to show to anyone who can reach its host. */
export const publicTenant = (t: Tenant) => ({ id: t.id, slug: t.slug, name: t.name, appId: t.appId, status: t.status });

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export class TenancyService {
  private readonly db: Db;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttl: number;

  private readonly createdHooks: TenantCreatedHook[];

  constructor(private readonly deps: TenancyDeps) {
    this.db = deps.db;
    this.ttl = deps.cacheTtlMs ?? 60_000;
    this.createdHooks = [...(deps.onTenantCreated ?? [])];
  }

  /** Adds an on-tenant-created hook (runs after the ones registered before it). */
  onTenantCreated(hook: TenantCreatedHook) {
    if (this.createdHooks.some((h) => h.name === hook.name)) throw new Error(`Tenant hook "${hook.name}" is already registered`);
    this.createdHooks.push(hook);
  }

  /** Names of the registered on-tenant-created hooks, in run order. */
  get tenantCreatedHooks(): string[] {
    return this.createdHooks.map((h) => h.name);
  }

  private async runCreatedHooks(tenant: Tenant, input: CreateTenantInput) {
    const event: TenantCreatedEvent = { tenant, ownerUserId: input.ownerUserId, details: input.details ?? {} };
    const errors: unknown[] = [];
    for (const hook of this.createdHooks) {
      try {
        await hook.run(event);
      } catch (err) {
        if (this.deps.onHookError) this.deps.onHookError(err, hook.name, tenant);
        else errors.push(err);
      }
    }
    if (errors.length) throw errors[0];
  }

  // ---------------------------------------------------------------- slugs

  /**
   * Whether a shop address is free (`GET /slug-available`), with up to 4 free suggestions (city/area, "-shop",
   * numbers) when it is taken or invalid.
   */
  async slugAvailable(raw: string, opts: { city?: string | null } = {}): Promise<SlugAvailability> {
    const slug = (raw ?? "").trim().toLowerCase();
    const check = validateSlug(slug);
    const taken = check.ok ? Boolean(await this.getBySlug(slug)) : false;
    if (check.ok && !taken) return { slug, available: true, suggestions: [] };
    const candidates = slugCandidates(slug || "shop", { city: opts.city });
    const used = candidates.length
      ? new Set((await this.db.select({ slug: tenants.slug }).from(tenants).where(inArray(tenants.slug, candidates))).map((r) => r.slug))
      : new Set<string>();
    const suggestions = candidates.filter((c) => !used.has(c)).slice(0, 4);
    return check.ok
      ? { slug, available: false, code: "taken", reason: "That address is already taken", suggestions }
      : { slug, available: false, code: check.code, reason: check.reason, suggestions };
  }

  get rootDomain() {
    return this.deps.rootDomain;
  }

  get canSelfVerifyDomains() {
    return !!this.deps.domainVerifier;
  }

  // ---------------------------------------------------------------- tenants

  async create(input: CreateTenantInput): Promise<Tenant> {
    const check = validateSlug(input.slug);
    if (!check.ok) throw badRequest(check.reason);
    const name = input.name.trim();
    if (!name) throw badRequest("Name is required");
    if (await this.getBySlug(input.slug)) throw conflict("That address is already taken");

    let tenant: Tenant;
    try {
      tenant = await this.db.transaction(async (tx) => {
        const [t] = await tx
          .insert(tenants)
          .values({ slug: input.slug, name, planId: input.planId ?? null, appId: input.appId ?? null })
          .returning();
        await tx.insert(tenantMemberships).values({ tenantId: t!.id, userId: input.ownerUserId, roles: ["owner"] });
        return t!;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("That address is already taken");
      throw err;
    }
    this.invalidate();
    // Hooks may change the tenant (plan, metadata): return the row as they left it.
    await this.runCreatedHooks(tenant, input);
    return (await this.getById(tenant.id)) ?? tenant;
  }

  async getById(id: string): Promise<Tenant | null> {
    const [t] = await this.db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    return t ?? null;
  }

  /** Many tenants at once; unknown ids are left out. */
  async getByIds(ids: string[]): Promise<Tenant[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    return this.db.select().from(tenants).where(inArray(tenants.id, unique));
  }

  async getBySlug(slug: string): Promise<Tenant | null> {
    const [t] = await this.db.select().from(tenants).where(eq(tenants.slug, slug.toLowerCase())).limit(1);
    return t ?? null;
  }

  private async getByVerifiedDomain(host: string): Promise<Tenant | null> {
    const [row] = await this.db
      .select({ tenant: tenants })
      .from(tenantDomains)
      .innerJoin(tenants, eq(tenants.id, tenantDomains.tenantId))
      .where(and(eq(tenantDomains.domain, host), eq(tenantDomains.verified, true)))
      .limit(1);
    return row?.tenant ?? null;
  }

  /**
   * Finds the tenant for a request. The `x-tenant` header wins, then a subdomain of the root domain,
   * then a verified custom domain. Throws forbidden for suspended tenants. Cached for 60s.
   */
  async resolve(input: ResolveInput): Promise<TenantRef | null> {
    const headerSlug = input.headerSlug?.trim().toLowerCase() || null;
    const host = input.host ? normalizeHost(input.host) : "";
    const key = `${host}|${headerSlug ?? ""}`;

    const now = Date.now();
    let entry = this.cache.get(key);
    if (!entry || entry.expires <= now) {
      entry = { tenant: await this.lookup(host, headerSlug), expires: now + this.ttl };
      if (this.cache.size >= MAX_CACHE_ENTRIES) this.cache.clear();
      this.cache.set(key, entry);
    }

    if (!entry.tenant) return null;
    if (entry.tenant.status === "suspended") throw forbidden("Tenant suspended");
    return toTenantRef(entry.tenant);
  }

  private async lookup(host: string, headerSlug: string | null): Promise<Tenant | null> {
    if (headerSlug) return validateSlug(headerSlug).ok ? this.getBySlug(headerSlug) : null;
    if (!host) return null;
    const slug = slugFromHost(host, this.deps.rootDomain);
    if (slug) return this.getBySlug(slug);
    if (isPlatformHost(host, this.deps.rootDomain)) return null;
    return this.getByVerifiedDomain(host);
  }

  /** Drops cached resolve() results for one tenant, or everything when no id is given. */
  invalidate(tenantId?: string) {
    if (!tenantId) return this.cache.clear();
    for (const [k, v] of this.cache) if (!v.tenant || v.tenant.id === tenantId) this.cache.delete(k);
  }

  async update(tenantId: string, patch: { name?: string; metadata?: Record<string, unknown> }): Promise<Tenant> {
    const set: Partial<typeof tenants.$inferInsert> = {};
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw badRequest("Name is required");
      set.name = name;
    }
    if (patch.metadata !== undefined) set.metadata = patch.metadata;
    if (Object.keys(set).length === 0) {
      const t = await this.getById(tenantId);
      if (!t) throw notFound("Tenant");
      return t;
    }
    const [t] = await this.db.update(tenants).set(set).where(eq(tenants.id, tenantId)).returning();
    if (!t) throw notFound("Tenant");
    this.invalidate(tenantId);
    return t;
  }

  async setPlan(tenantId: string, planId: string | null): Promise<Tenant> {
    const [t] = await this.db.update(tenants).set({ planId }).where(eq(tenants.id, tenantId)).returning();
    if (!t) throw notFound("Tenant");
    this.invalidate(tenantId);
    await this.deps.onPlanChange?.(tenantId, planId);
    return t;
  }

  /** Moves a tenant to another app (product), e.g. "BL" or "EC"; null = no app. */
  async setApp(tenantId: string, appId: string | null): Promise<Tenant> {
    const [t] = await this.db.update(tenants).set({ appId }).where(eq(tenants.id, tenantId)).returning();
    if (!t) throw notFound("Tenant");
    this.invalidate(tenantId);
    await this.deps.onAppChange?.(tenantId, appId);
    return t;
  }

  /** The TenantRef for a tenant id (uncached; null when missing). */
  async getRef(tenantId: string): Promise<TenantRef | null> {
    const t = await this.getById(tenantId);
    return t ? toTenantRef(t) : null;
  }

  /** Number of tenants per app id (tenants without an app are left out). */
  async countByApp(): Promise<Record<string, number>> {
    const rows = await this.db.select({ appId: tenants.appId, n: count() }).from(tenants).groupBy(tenants.appId);
    return Object.fromEntries(rows.filter((r) => r.appId).map((r) => [r.appId!, r.n]));
  }

  async setStatus(tenantId: string, status: TenantStatus): Promise<Tenant> {
    const [t] = await this.db.update(tenants).set({ status }).where(eq(tenants.id, tenantId)).returning();
    if (!t) throw notFound("Tenant");
    this.invalidate(tenantId);
    return t;
  }

  /** Super-admin listing with optional search on slug/name. */
  async list(opts: { q?: string; limit?: number; offset?: number } = {}): Promise<{ items: Tenant[]; total: number }> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    const q = opts.q?.trim();
    const where = q
      ? or(ilike(tenants.slug, `%${escapeLike(q)}%`), ilike(tenants.name, `%${escapeLike(q)}%`))
      : undefined;
    const [items, totals] = await Promise.all([
      this.db.select().from(tenants).where(where).orderBy(asc(tenants.createdAt)).limit(limit).offset(offset),
      this.db.select({ n: count() }).from(tenants).where(where),
    ]);
    return { items, total: totals[0]?.n ?? 0 };
  }

  // ---------------------------------------------------------------- domains

  async listDomains(tenantId: string): Promise<TenantDomain[]> {
    return this.db.select().from(tenantDomains).where(eq(tenantDomains.tenantId, tenantId)).orderBy(asc(tenantDomains.domain));
  }

  async addDomain(tenantId: string, domain: string): Promise<TenantDomain> {
    const d = normalizeHost(domain);
    if (!isValidDomain(d)) throw badRequest("Enter a valid domain, e.g. shop.example.com");
    if (isPlatformHost(d, this.deps.rootDomain)) throw badRequest("Use your subdomain instead of adding a platform domain");
    try {
      const [row] = await this.db
        .insert(tenantDomains)
        .values({ tenantId, domain: d, verificationToken: newVerificationToken() })
        .returning();
      return row!;
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("That domain is already in use");
      throw err;
    }
  }

  async removeDomain(tenantId: string, domainId: string): Promise<void> {
    const rows = await this.db
      .delete(tenantDomains)
      .where(and(eq(tenantDomains.tenantId, tenantId), eq(tenantDomains.id, domainId)))
      .returning({ id: tenantDomains.id });
    if (rows.length === 0) throw notFound("Domain");
    this.invalidate(tenantId);
  }

  async getDomain(tenantId: string, domainId: string): Promise<TenantDomain> {
    const [row] = await this.db
      .select()
      .from(tenantDomains)
      .where(and(eq(tenantDomains.tenantId, tenantId), eq(tenantDomains.id, domainId)))
      .limit(1);
    if (!row) throw notFound("Domain");
    return row;
  }

  /** Gives rows added before tokens existed a verification token. */
  private async withToken(row: TenantDomain): Promise<TenantDomain & { verificationToken: string }> {
    if (row.verificationToken) return row as TenantDomain & { verificationToken: string };
    const token = newVerificationToken();
    const [updated] = await this.db
      .update(tenantDomains)
      .set({ verificationToken: token })
      .where(and(eq(tenantDomains.id, row.id), isNull(tenantDomains.verificationToken)))
      .returning();
    if (updated?.verificationToken) return updated as TenantDomain & { verificationToken: string };
    // Someone else set it concurrently: read it back.
    const [again] = await this.db.select().from(tenantDomains).where(eq(tenantDomains.id, row.id)).limit(1);
    return { ...(again ?? row), verificationToken: again?.verificationToken ?? token };
  }

  /** The DNS records to add for a domain (TXT for verification, CNAME for routing). */
  async domainInstructions(tenantId: string, domainId: string): Promise<DomainInstructions> {
    const row = await this.withToken(await this.getDomain(tenantId, domainId));
    return domainInstructions(row, this.deps.cnameTarget ?? DEFAULT_CNAME_TARGET);
  }

  /** Runs the DNS check; lookup failures count as "not found". */
  private async check(row: TenantDomain & { verificationToken: string }): Promise<DomainCheck> {
    try {
      const r = await this.deps.domainVerifier!(row.domain, { token: row.verificationToken });
      return { txt: r.txt === true, cname: r.cname === true };
    } catch {
      return { txt: false, cname: false };
    }
  }

  private async markChecked(row: TenantDomain, verified: boolean): Promise<TenantDomain> {
    const now = new Date();
    const [updated] = await this.db
      .update(tenantDomains)
      .set(verified ? { verified: true, verifiedAt: row.verifiedAt ?? now, checkedAt: now } : { checkedAt: now })
      .where(and(eq(tenantDomains.tenantId, row.tenantId), eq(tenantDomains.id, row.id)))
      .returning();
    if (verified) this.invalidate();
    return updated ?? row;
  }

  /**
   * Marks a domain verified. Without `force`, the `domainVerifier` must find the TXT record
   * (`_srikit-verify.<domain>` = token) first; a miss throws 400 with `{ txt, cname }` details.
   * Pass `force` (super-admin) to skip the check.
   */
  async verifyDomain(tenantId: string, domainId: string, opts: { force?: boolean } = {}): Promise<TenantDomain> {
    const found = await this.getDomain(tenantId, domainId);
    if (opts.force) return this.markChecked(found, true);
    if (!this.deps.domainVerifier) throw forbidden("Domain verification is done by the platform team");
    const row = await this.withToken(found);
    const result = await this.check(row);
    await this.markChecked(row, result.txt);
    if (!result.txt) {
      throw badRequest("We couldn't find the TXT record for this domain yet. DNS changes can take a few hours.", result);
    }
    return this.getDomain(tenantId, domainId);
  }

  /**
   * Job `tenancy.domains.verify` (every 30 min): checks every unverified domain and verifies those whose TXT record
   * is in place. No-op without a `domainVerifier`.
   */
  async verifyPending(opts: { limit?: number } = {}): Promise<{ checked: number; verified: number }> {
    if (!this.deps.domainVerifier) return { checked: 0, verified: 0 };
    const pending = await this.db
      .select()
      .from(tenantDomains)
      .where(eq(tenantDomains.verified, false))
      .orderBy(sql`${tenantDomains.checkedAt} asc nulls first`, asc(tenantDomains.createdAt))
      .limit(Math.min(Math.max(opts.limit ?? 200, 1), 1000));
    let verified = 0;
    for (const found of pending) {
      try {
        const row = await this.withToken(found);
        const result = await this.check(row);
        await this.markChecked(row, result.txt);
        if (result.txt) verified++;
      } catch {
        // One bad row must not stop the job; it is retried on the next run.
      }
    }
    return { checked: pending.length, verified };
  }

  // ---------------------------------------------------------------- memberships

  /** Active roles of `userId` in `tenantId`; empty when not a member. This is auth's MembershipLookup port. */
  async rolesFor(tenantId: string, userId: string): Promise<string[]> {
    const [m] = await this.db
      .select({ roles: tenantMemberships.roles })
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.tenantId, tenantId),
          eq(tenantMemberships.userId, userId),
          eq(tenantMemberships.status, "active"),
        ),
      )
      .limit(1);
    return m?.roles ?? [];
  }

  async getMember(tenantId: string, userId: string): Promise<TenantMembership | null> {
    const [m] = await this.db
      .select()
      .from(tenantMemberships)
      .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, userId)))
      .limit(1);
    return m ?? null;
  }

  /**
   * Adds a member, or reactivates an existing one with the given roles. Roles are validated by
   * `normalizeMemberRoles` (one base level + optional `role:<key>` entries).
   */
  async addMember(tenantId: string, userId: string, roles: string[] = ["member"]): Promise<TenantMembership> {
    const r = normalizeMemberRoles(roles);
    const [m] = await this.db
      .insert(tenantMemberships)
      .values({ tenantId, userId, roles: r })
      .onConflictDoUpdate({
        target: [tenantMemberships.tenantId, tenantMemberships.userId],
        set: { roles: r, status: "active", updatedAt: new Date() },
      })
      .returning();
    return m!;
  }

  /** Replaces a member's roles (validated like `addMember`). Keeps at least one owner. */
  async updateRoles(tenantId: string, userId: string, roles: string[]): Promise<TenantMembership> {
    const r = normalizeMemberRoles(roles);
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(tenantMemberships)
        .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, userId)))
        .for("update")
        .limit(1);
      if (!current) throw notFound("Member");
      if (current.roles.includes("owner") && !r.includes("owner") && (await this.ownerCount(tx, tenantId)) <= 1) {
        throw badRequest("A tenant needs at least one owner");
      }
      const [m] = await tx
        .update(tenantMemberships)
        .set({ roles: r })
        .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, userId)))
        .returning();
      return m!;
    });
  }

  /** Alias of `updateRoles` (the staff module's MembershipPort name). */
  setMemberRoles(tenantId: string, userId: string, roles: string[]): Promise<TenantMembership> {
    return this.updateRoles(tenantId, userId, roles);
  }

  /** Activates or deactivates a member (inactive members get no roles in `rolesFor`). Keeps one active owner. */
  async setMemberStatus(tenantId: string, userId: string, status: "active" | "inactive"): Promise<TenantMembership> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(tenantMemberships)
        .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, userId)))
        .for("update")
        .limit(1);
      if (!current) throw notFound("Member");
      if (
        status === "inactive" &&
        current.status === "active" &&
        current.roles.includes("owner") &&
        (await this.ownerCount(tx, tenantId)) <= 1
      ) {
        throw badRequest("A tenant needs at least one owner");
      }
      const [m] = await tx
        .update(tenantMemberships)
        .set({ status })
        .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, userId)))
        .returning();
      return m!;
    });
  }

  async removeMember(tenantId: string, userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(tenantMemberships)
        .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, userId)))
        .for("update")
        .limit(1);
      if (!current) throw notFound("Member");
      if (current.roles.includes("owner") && (await this.ownerCount(tx, tenantId)) <= 1) {
        throw badRequest("Cannot remove the last owner");
      }
      await tx
        .delete(tenantMemberships)
        .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, userId)));
    });
  }

  private async ownerCount(db: Pick<Db, "select">, tenantId: string): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.tenantId, tenantId),
          eq(tenantMemberships.status, "active"),
          arrayContains(tenantMemberships.roles, ["owner"]),
        ),
      );
    return row?.n ?? 0;
  }

  /**
   * Staff seats per tenant, the plan's `staff` usage: active memberships that are not owners (admins, staff and
   * members). Inactive members free their seat; there are no pending invites (an invite adds an active membership).
   * One tenant when `tenantId` is given, else every tenant with at least one seat.
   */
  async seatCounts(tenantId?: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ tenantId: tenantMemberships.tenantId, n: count() })
      .from(tenantMemberships)
      .where(
        and(
          tenantId ? eq(tenantMemberships.tenantId, tenantId) : undefined,
          eq(tenantMemberships.status, "active"),
          sql`not (${tenantMemberships.roles} @> array['owner']::text[])`,
        ),
      )
      .groupBy(tenantMemberships.tenantId);
    return new Map(rows.map((r) => [r.tenantId, r.n]));
  }

  async listMembers(tenantId: string): Promise<TenantMembership[]> {
    return this.db
      .select()
      .from(tenantMemberships)
      .where(eq(tenantMemberships.tenantId, tenantId))
      .orderBy(asc(tenantMemberships.createdAt));
  }

  /** Every active tenant membership of a user, with the tenant. Used for a "switch workspace" list. */
  async tenantsForUser(userId: string): Promise<TenantWithRoles[]> {
    const rows = await this.db
      .select({ tenant: tenants, roles: tenantMemberships.roles })
      .from(tenantMemberships)
      .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
      .where(and(eq(tenantMemberships.userId, userId), eq(tenantMemberships.status, "active")))
      .orderBy(asc(tenants.name));
    return rows;
  }
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
