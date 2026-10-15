import { AppError, badRequest, conflict, notFound, type FeatureGatePort } from "@srirealtime/core";
import type { Db, DbOrTx } from "@srirealtime/db";
import { and, asc, eq, inArray, ne, notInArray } from "drizzle-orm";
import { z } from "zod";
import { BRANCHES_FEATURE_KEYS } from "./features";
import {
  BRANCH_CODE_PATTERN,
  checkGstState,
  daysBetween,
  deactivateProblem,
  DEFAULT_BRANCH_CODE,
  DEFAULT_BRANCH_NAME,
  isValidDate,
  monthToDate,
  normalizeCode,
  prefixProblem,
  sanitizePrefix,
  suggestPrefix,
  usableBranches,
  type Assignment,
  type BranchAccess,
  type BranchLite,
} from "./logic";
import { noopLogger, type LocationsPort, type LoggerPort, type MembersPort, type ShopProfilePort, type SummaryPort } from "./ports";
import { branches, branchUsers, type BranchRow } from "./schema";

export interface BranchesDeps {
  db: Db;
  /** Seeds the default branch (name, GSTIN, address, state, phone, bill prefix). */
  profile?: ShopProfilePort;
  /** Links/creates inventory locations. Without it branches have no stock location unless one is given by id. */
  locations?: LocationsPort;
  /** Per-branch numbers for `GET /summary` (503 without it). */
  summary?: SummaryPort;
  members?: MembersPort;
  /** Is `multi-branch` on for the shop? Used by the context hook; without it the hook treats the feature as on. */
  featureGate?: FeatureGatePort;
  log?: LoggerPort;
  /** Cache lifetime of the context hook's branch and assignment lookups (default 30 s). */
  cacheTtlMs?: number;
  now?: () => Date;
}

export interface Branch {
  id: string;
  name: string;
  code: string;
  address: string | null;
  city: string | null;
  pincode: string | null;
  phone: string | null;
  gstin: string | null;
  stateCode: string | null;
  stockLocationId: string | null;
  invoicePrefix: string;
  active: boolean;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** A branch in a "my branches" list. `isHome` = the user's default branch. */
export interface MyBranch extends Branch {
  isHome: boolean;
}

export interface BranchUser {
  userId: string;
  branchId: string;
  isDefault: boolean;
}

/** Seller fields of a branch for its bills (invoices merges them over the shop's seller profile). */
export interface BranchSeller {
  branchId: string;
  code: string;
  name: string;
  gstin: string | null;
  stateCode: string | null;
  address: string | null;
  city: string | null;
  pincode: string | null;
  phone: string | null;
  invoicePrefix: string;
  stockLocationId: string | null;
}

export interface BranchSummaryRow {
  branchId: string;
  name: string;
  code: string;
  active: boolean;
  isDefault: boolean;
  sales: number;
  bills: number;
  /** Null when the branch has no stock location. */
  stockValue: number | null;
}

export interface BranchSummary {
  from: string;
  to: string;
  items: BranchSummaryRow[];
  total: number;
  /** All branches together. */
  consolidated: { sales: number; bills: number; stockValue: number };
}

export interface ListResult<T> {
  items: T[];
  total: number;
}

// ------------------------------------------------------------------ validation

/** Empty strings become null; undefined stays undefined (PATCH: "leave as is"). */
const opt = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), s.nullable().optional());

const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(BRANCH_CODE_PATTERN, "Code: up to 16 letters, digits, - or _");
const prefix = z
  .string()
  .trim()
  .toUpperCase()
  .superRefine((p, c) => {
    const problem = prefixProblem(p);
    if (problem) c.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });
const uuid = z.string().uuid();
const phone = z.string().trim().max(30);
const pincode = z.string().trim().regex(/^\d{6}$/, "Enter a 6-digit PIN code");

const fields = {
  address: opt(z.string().trim().max(500)),
  city: opt(z.string().trim().max(80)),
  pincode: opt(pincode),
  phone: opt(phone),
  gstin: opt(z.string().trim().max(20)),
  stateCode: opt(z.string().trim().max(2)),
  invoicePrefix: opt(prefix),
  stockLocationId: opt(uuid),
};

export const branchInputSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(80),
  code,
  ...fields,
  /**
   * Without `stockLocationId`: create a new inventory location for the branch (default true; needs the locations
   * port). false = the branch has no own location (stock moves use the shop's default location).
   */
  createLocation: z.boolean().default(true),
  isDefault: z.boolean().optional(),
});
export type BranchInput = z.input<typeof branchInputSchema>;

export const branchPatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  code: code.optional(),
  ...fields,
  active: z.boolean().optional(),
  /** true makes this the default branch (the previous default stays open). false is refused on the default. */
  isDefault: z.boolean().optional(),
});
export type BranchPatch = z.input<typeof branchPatchSchema>;

const boolParam = z.preprocess((v) => (v === "true" || v === "1" ? true : v === "false" || v === "0" ? false : v), z.boolean());
export const branchListQuerySchema = z.object({ includeInactive: boolParam.default(true) });
export type BranchListQuery = z.input<typeof branchListQuerySchema>;

export const addUserSchema = z.object({ userId: uuid, isDefault: z.boolean().optional() });
export type AddUserInput = z.input<typeof addUserSchema>;
export const setBranchUsersSchema = z.object({ userIds: z.array(uuid).max(500) });
export type SetBranchUsersInput = z.input<typeof setBranchUsersSchema>;
export const setUserBranchesSchema = z
  .object({ branchIds: z.array(uuid).max(200), defaultBranchId: uuid.nullable().optional() })
  .refine((v) => !v.defaultBranchId || v.branchIds.includes(v.defaultBranchId), {
    message: "The home branch must be one of the user's branches",
    path: ["defaultBranchId"],
  });
export type SetUserBranchesInput = z.input<typeof setUserBranchesSchema>;

const dateStr = z.string().refine(isValidDate, "Use a valid YYYY-MM-DD date");
export const summaryQuerySchema = z
  .object({ from: dateStr.optional(), to: dateStr.optional() })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: "`from` must be on or before `to`", path: ["from"] })
  .refine((v) => !v.from || !v.to || daysBetween(v.from, v.to) <= 366, { message: "Choose at most a year", path: ["to"] });
export type SummaryQuery = z.input<typeof summaryQuerySchema>;

// ------------------------------------------------------------------ helpers

export const toBranch = (r: BranchRow): Branch => ({
  id: r.id,
  name: r.name,
  code: r.code,
  address: r.address,
  city: r.city,
  pincode: r.pincode,
  phone: r.phone,
  gstin: r.gstin,
  stateCode: r.stateCode,
  stockLocationId: r.stockLocationId,
  invoicePrefix: r.invoicePrefix,
  active: r.active,
  isDefault: r.isDefault,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const toLite = (r: BranchRow): BranchLite => ({ id: r.id, code: r.code, locationId: r.stockLocationId, isDefault: r.isDefault });

const notConfigured = (what: string) => new AppError(503, "not_configured", `${what} is not set up`);

/** Postgres unique violation → 409 with a readable message (works with raw and drizzle-wrapped errors). */
function uniqueViolation(err: unknown): string | null {
  for (let e = err as { code?: unknown; constraint_name?: unknown; cause?: unknown } | undefined, i = 0; e && i < 4; i++) {
    if (e.code === "23505") return typeof e.constraint_name === "string" ? e.constraint_name : "";
    e = e.cause as typeof e;
  }
  return null;
}

const UNIQUE_MESSAGES: Record<string, string> = {
  branches_tenant_code_uq: "Another branch already uses this code",
  branches_tenant_prefix_uq: "Another branch already uses this bill prefix",
  branches_tenant_location_uq: "This stock location already belongs to another branch",
  branches_tenant_default_uq: "Another change to the main branch happened at the same time; try again",
  branch_users_branch_user_uq: "This user is already assigned to the branch",
  branch_users_tenant_user_default_uq: "Another change to this user's home branch happened at the same time; try again",
};

async function mapUnique<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const name = uniqueViolation(err);
    if (name !== null) throw conflict(UNIQUE_MESSAGES[name] ?? "This conflicts with another branch");
    throw err;
  }
}

interface CacheEntry<T> {
  at: number;
  value: T;
}

// ------------------------------------------------------------------ service

/** Branches of a shop, staff assignments and the lookups the context hook uses (docs/batch3.md §B3). */
export class BranchesService {
  private readonly db: Db;
  private readonly log: LoggerPort;
  private readonly now: () => Date;
  private readonly ttl: number;
  private readonly branchCache = new Map<string, CacheEntry<BranchRow[]>>();
  private readonly userCache = new Map<string, CacheEntry<Assignment[]>>();

  constructor(private readonly deps: BranchesDeps) {
    this.db = deps.db;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
    this.ttl = deps.cacheTtlMs ?? 30_000;
  }

  // ================================================================ directory (context hook)

  /** Is `multi-branch` on for the shop? True when no feature gate is wired. */
  async featureOn(tenantId: string): Promise<boolean> {
    if (!this.deps.featureGate) return true;
    return this.deps.featureGate.isEnabled(tenantId, BRANCHES_FEATURE_KEYS.base);
  }

  /** The shop's open branches (cached for `cacheTtlMs`; writes through this service invalidate). */
  async activeBranches(tenantId: string): Promise<BranchLite[]> {
    return (await this.cachedRows(tenantId)).filter((r) => r.active).map(toLite);
  }

  /** The user's branch assignments (cached like `activeBranches`). */
  async assignments(tenantId: string, userId: string): Promise<Assignment[]> {
    const key = `${tenantId}:${userId}`;
    const hit = this.userCache.get(key);
    if (hit && this.now().getTime() - hit.at < this.ttl) return hit.value;
    const rows = await this.db
      .select({ branchId: branchUsers.branchId, isDefault: branchUsers.isDefault })
      .from(branchUsers)
      .where(and(eq(branchUsers.tenantId, tenantId), eq(branchUsers.userId, userId)));
    this.userCache.set(key, { at: this.now().getTime(), value: rows });
    return rows;
  }

  /** Drops cached lookups of a tenant (all tenants without an argument). */
  invalidate(tenantId?: string): void {
    if (!tenantId) {
      this.branchCache.clear();
      this.userCache.clear();
      return;
    }
    this.branchCache.delete(tenantId);
    for (const k of [...this.userCache.keys()]) if (k.startsWith(`${tenantId}:`)) this.userCache.delete(k);
  }

  private async cachedRows(tenantId: string): Promise<BranchRow[]> {
    const hit = this.branchCache.get(tenantId);
    if (hit && this.now().getTime() - hit.at < this.ttl) return hit.value;
    const rows = await this.rows(this.db, tenantId);
    this.branchCache.set(tenantId, { at: this.now().getTime(), value: rows });
    return rows;
  }

  private rows(db: DbOrTx, tenantId: string): Promise<BranchRow[]> {
    return db.select().from(branches).where(eq(branches.tenantId, tenantId)).orderBy(asc(branches.code));
  }

  // ================================================================ default branch

  /**
   * The shop's default branch, created lazily ("Main", code MAIN) from the billing seller profile (GSTIN, address,
   * state, phone, bill prefix) and linked to the inventory default location. Safe under concurrent calls.
   */
  async ensureDefault(tenantId: string): Promise<Branch> {
    const existing = await this.defaultRow(this.db, tenantId);
    if (existing) return toBranch(existing);

    const [profile, location, all] = await Promise.all([
      this.deps.profile?.get(tenantId).catch((err: unknown) => {
        this.log.warn({ err, tenantId }, "branches: seller profile lookup failed; default branch starts empty");
        return null;
      }),
      this.deps.locations?.defaultLocation(tenantId),
      this.rows(this.db, tenantId),
    ]);
    const gst = checkGstState(profile?.gstin, profile?.stateCode);
    const takenCodes = new Set(all.map((r) => r.code));
    const takenPrefixes = all.map((r) => r.invoicePrefix);
    let branchCode = DEFAULT_BRANCH_CODE;
    for (let n = 2; takenCodes.has(branchCode); n++) branchCode = `${DEFAULT_BRANCH_CODE}${n}`;
    const wanted = sanitizePrefix(profile?.invoicePrefix);
    const invoicePrefix = takenPrefixes.includes(wanted) ? suggestPrefix(wanted, takenPrefixes) : wanted;
    const locationTaken = location && all.some((r) => r.stockLocationId === location.id);

    await this.db
      .insert(branches)
      .values({
        tenantId,
        name: DEFAULT_BRANCH_NAME,
        code: branchCode,
        address: profile?.address?.trim() || null,
        city: profile?.city?.trim() || null,
        pincode: profile?.pincode?.trim() || null,
        phone: profile?.phone?.trim() || null,
        gstin: gst.ok ? gst.gstin : null,
        stateCode: gst.ok ? gst.stateCode : null,
        stockLocationId: location && !locationTaken ? location.id : null,
        invoicePrefix,
        isDefault: true,
        active: true,
      })
      .onConflictDoNothing();
    this.invalidate(tenantId);
    const row = await this.defaultRow(this.db, tenantId);
    if (!row) throw conflict("Could not create the main branch; try again");
    this.log.info({ tenantId, branchId: row.id }, "branches: default branch ready");
    return toBranch(row);
  }

  private async defaultRow(db: DbOrTx, tenantId: string): Promise<BranchRow | null> {
    const [row] = await db
      .select()
      .from(branches)
      .where(and(eq(branches.tenantId, tenantId), eq(branches.isDefault, true)))
      .limit(1);
    return row ?? null;
  }

  // ================================================================ CRUD

  async list(tenantId: string, query: BranchListQuery = {}): Promise<ListResult<Branch>> {
    const { includeInactive } = branchListQuerySchema.parse(query);
    await this.ensureDefault(tenantId);
    const rows = (await this.rows(this.db, tenantId)).filter((r) => includeInactive || r.active);
    rows.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || Number(b.active) - Number(a.active) || a.code.localeCompare(b.code));
    return { items: rows.map(toBranch), total: rows.length };
  }

  async get(tenantId: string, id: string): Promise<Branch> {
    return toBranch(await this.row(this.db, tenantId, id));
  }

  private async row(db: DbOrTx, tenantId: string, id: string): Promise<BranchRow> {
    const [row] = await db
      .select()
      .from(branches)
      .where(and(eq(branches.tenantId, tenantId), eq(branches.id, id)))
      .limit(1);
    if (!row) throw notFound("Branch");
    return row;
  }

  /** Seller details of a branch for its bills (invoices integration). */
  async seller(tenantId: string, id: string): Promise<BranchSeller> {
    const r = await this.row(this.db, tenantId, id);
    return {
      branchId: r.id,
      code: r.code,
      name: r.name,
      gstin: r.gstin,
      stateCode: r.stateCode,
      address: r.address,
      city: r.city,
      pincode: r.pincode,
      phone: r.phone,
      invoicePrefix: r.invoicePrefix,
      stockLocationId: r.stockLocationId,
    };
  }

  async create(tenantId: string, input: BranchInput): Promise<Branch> {
    const p = branchInputSchema.parse(input);
    await this.ensureDefault(tenantId);
    const all = await this.rows(this.db, tenantId);

    if (all.some((r) => r.code === p.code)) throw conflict("Another branch already uses this code");
    const gst = checkGstState(p.gstin, p.stateCode);
    if (!gst.ok) throw badRequest(gst.message, { field: gst.field });
    const invoicePrefix = p.invoicePrefix ?? suggestPrefix(p.code, all.map((r) => r.invoicePrefix));
    if (all.some((r) => r.invoicePrefix === invoicePrefix)) throw conflict("Another branch already uses this bill prefix");

    let stockLocationId: string | null = null;
    if (p.stockLocationId) {
      stockLocationId = await this.checkLocation(tenantId, p.stockLocationId, all, null);
    } else if (p.createLocation && this.deps.locations) {
      const loc = await this.deps.locations.createLocation(tenantId, { name: p.name, code: p.code, address: p.address ?? null });
      stockLocationId = loc.id;
    }

    const created = await mapUnique(() =>
      this.db.transaction(async (tx) => {
        if (p.isDefault) await tx.update(branches).set({ isDefault: false }).where(and(eq(branches.tenantId, tenantId), eq(branches.isDefault, true)));
        const [row] = await tx
          .insert(branches)
          .values({
            tenantId,
            name: p.name,
            code: p.code,
            address: p.address ?? null,
            city: p.city ?? null,
            pincode: p.pincode ?? null,
            phone: p.phone ?? null,
            gstin: gst.gstin,
            stateCode: gst.stateCode,
            stockLocationId,
            invoicePrefix,
            active: true,
            isDefault: p.isDefault ?? false,
          })
          .returning();
        return row!;
      }),
    );
    this.invalidate(tenantId);
    return toBranch(created);
  }

  /** The location must exist, be active and not belong to another branch. Returns its id. */
  private async checkLocation(tenantId: string, locationId: string, all: BranchRow[], selfId: string | null): Promise<string> {
    if (!this.deps.locations) throw notConfigured("Stock locations");
    const loc = await this.deps.locations.getLocation(tenantId, locationId);
    if (!loc) throw badRequest("Stock location not found", { field: "stockLocationId" });
    if (!loc.active) throw badRequest("This stock location is closed", { field: "stockLocationId" });
    if (all.some((r) => r.stockLocationId === loc.id && r.id !== selfId)) {
      throw conflict("This stock location already belongs to another branch");
    }
    return loc.id;
  }

  async update(tenantId: string, id: string, patch: BranchPatch): Promise<Branch> {
    const p = branchPatchSchema.parse(patch);
    const all = await this.rows(this.db, tenantId);
    const cur = all.find((r) => r.id === id);
    if (!cur) throw notFound("Branch");

    const set: Partial<typeof branches.$inferInsert> = {};
    if (p.name !== undefined) set.name = p.name;
    if (p.code !== undefined && p.code !== cur.code) {
      if (all.some((r) => r.code === p.code && r.id !== id)) throw conflict("Another branch already uses this code");
      set.code = p.code;
    }
    for (const k of ["address", "city", "pincode", "phone"] as const) if (p[k] !== undefined) set[k] = p[k];

    if (p.gstin !== undefined || p.stateCode !== undefined) {
      const gstin = p.gstin === undefined ? cur.gstin : p.gstin;
      // A new GSTIN without a state takes its state from the GSTIN.
      const state = p.stateCode !== undefined ? p.stateCode : p.gstin ? null : cur.stateCode;
      const gst = checkGstState(gstin, state);
      if (!gst.ok) throw badRequest(gst.message, { field: gst.field });
      set.gstin = gst.gstin;
      set.stateCode = gst.stateCode;
    }
    if (p.invoicePrefix !== undefined) {
      const next = p.invoicePrefix ?? suggestPrefix(set.code ?? cur.code, all.filter((r) => r.id !== id).map((r) => r.invoicePrefix));
      if (all.some((r) => r.invoicePrefix === next && r.id !== id)) throw conflict("Another branch already uses this bill prefix");
      set.invoicePrefix = next;
    }
    if (p.stockLocationId !== undefined) {
      set.stockLocationId = p.stockLocationId === null ? null : await this.checkLocation(tenantId, p.stockLocationId, all, id);
    }

    const active = p.active ?? cur.active;
    if (p.active === false && cur.active) {
      const problem = deactivateProblem(cur, all.filter((r) => r.active).length);
      if (problem) throw badRequest(problem);
    }
    if (p.active !== undefined) set.active = p.active;
    if (p.isDefault === false && cur.isDefault) {
      throw badRequest("A shop always has a main branch. Make another branch the main branch instead.");
    }
    const makeDefault = p.isDefault === true && !cur.isDefault;
    if (makeDefault && !active) throw badRequest("Open the branch before making it the main branch");

    const updated = await mapUnique(() =>
      this.db.transaction(async (tx) => {
        if (makeDefault) {
          await tx.update(branches).set({ isDefault: false }).where(and(eq(branches.tenantId, tenantId), eq(branches.isDefault, true)));
          set.isDefault = true;
        }
        if (Object.keys(set).length === 0) return cur;
        const [row] = await tx
          .update(branches)
          .set(set)
          .where(and(eq(branches.tenantId, tenantId), eq(branches.id, id)))
          .returning();
        return row!;
      }),
    );
    this.invalidate(tenantId);
    return toBranch(updated);
  }

  /** Closes a branch (never deleted: bills point at it). Not the default branch, never the last open one. */
  async deactivate(tenantId: string, id: string): Promise<Branch> {
    return this.update(tenantId, id, { active: false });
  }

  // ================================================================ users

  async listUsers(tenantId: string, branchId: string): Promise<ListResult<BranchUser>> {
    await this.row(this.db, tenantId, branchId);
    const rows = await this.db
      .select({ userId: branchUsers.userId, branchId: branchUsers.branchId, isDefault: branchUsers.isDefault })
      .from(branchUsers)
      .where(and(eq(branchUsers.tenantId, tenantId), eq(branchUsers.branchId, branchId)))
      .orderBy(asc(branchUsers.createdAt));
    return { items: rows, total: rows.length };
  }

  private async assertMembers(tenantId: string, userIds: string[]): Promise<void> {
    if (!this.deps.members) return;
    for (const userId of new Set(userIds)) {
      if (!(await this.deps.members.isMember(tenantId, userId))) {
        throw badRequest("This person is not a member of the shop", { userId });
      }
    }
  }

  /** Assigns a user to a branch (idempotent). Their first branch, or `isDefault: true`, becomes their home branch. */
  async addUser(tenantId: string, branchId: string, input: AddUserInput): Promise<BranchUser> {
    const p = addUserSchema.parse(input);
    const branch = await this.row(this.db, tenantId, branchId);
    if (!branch.active) throw badRequest("This branch is closed");
    await this.assertMembers(tenantId, [p.userId]);
    await mapUnique(() =>
      this.db.transaction(async (tx) => {
        await tx.insert(branchUsers).values({ tenantId, branchId, userId: p.userId, isDefault: false }).onConflictDoNothing();
        if (p.isDefault) await this.setHome(tx, tenantId, p.userId, branchId);
        await this.fixHome(tx, tenantId, p.userId);
      }),
    );
    this.invalidate(tenantId);
    const [row] = await this.db
      .select({ userId: branchUsers.userId, branchId: branchUsers.branchId, isDefault: branchUsers.isDefault })
      .from(branchUsers)
      .where(and(eq(branchUsers.tenantId, tenantId), eq(branchUsers.branchId, branchId), eq(branchUsers.userId, p.userId)));
    return row!;
  }

  /** Replaces the branch's staff list with `userIds`. */
  async setBranchUsers(tenantId: string, branchId: string, input: SetBranchUsersInput): Promise<ListResult<BranchUser>> {
    const { userIds } = setBranchUsersSchema.parse(input);
    const branch = await this.row(this.db, tenantId, branchId);
    if (!branch.active && userIds.length > 0) throw badRequest("This branch is closed");
    const wanted = [...new Set(userIds)];
    await this.assertMembers(tenantId, wanted);
    const before = await this.db
      .select({ userId: branchUsers.userId })
      .from(branchUsers)
      .where(and(eq(branchUsers.tenantId, tenantId), eq(branchUsers.branchId, branchId)));
    const touched = new Set([...before.map((r) => r.userId), ...wanted]);
    await mapUnique(() =>
      this.db.transaction(async (tx) => {
        const scope = and(eq(branchUsers.tenantId, tenantId), eq(branchUsers.branchId, branchId));
        await tx.delete(branchUsers).where(wanted.length > 0 ? and(scope, notInArray(branchUsers.userId, wanted)) : scope);
        if (wanted.length > 0) {
          await tx
            .insert(branchUsers)
            .values(wanted.map((userId) => ({ tenantId, branchId, userId, isDefault: false })))
            .onConflictDoNothing();
        }
        for (const userId of touched) await this.fixHome(tx, tenantId, userId);
      }),
    );
    this.invalidate(tenantId);
    return this.listUsers(tenantId, branchId);
  }

  async removeUser(tenantId: string, branchId: string, userId: string): Promise<void> {
    await this.row(this.db, tenantId, branchId);
    await this.db.transaction(async (tx) => {
      await tx
        .delete(branchUsers)
        .where(and(eq(branchUsers.tenantId, tenantId), eq(branchUsers.branchId, branchId), eq(branchUsers.userId, userId)));
      await this.fixHome(tx, tenantId, userId);
    });
    this.invalidate(tenantId);
  }

  /** A user's branch assignments. */
  async userBranches(tenantId: string, userId: string): Promise<ListResult<BranchUser>> {
    const rows = await this.db
      .select({ userId: branchUsers.userId, branchId: branchUsers.branchId, isDefault: branchUsers.isDefault })
      .from(branchUsers)
      .where(and(eq(branchUsers.tenantId, tenantId), eq(branchUsers.userId, userId)))
      .orderBy(asc(branchUsers.createdAt));
    return { items: rows, total: rows.length };
  }

  /** Replaces a user's branches (and home branch; default: kept if still assigned, else their first branch). */
  async setUserBranches(tenantId: string, userId: string, input: SetUserBranchesInput): Promise<ListResult<BranchUser>> {
    const p = setUserBranchesSchema.parse(input);
    const ids = [...new Set(p.branchIds)];
    if (ids.length > 0) {
      const found = await this.db
        .select({ id: branches.id, active: branches.active })
        .from(branches)
        .where(and(eq(branches.tenantId, tenantId), inArray(branches.id, ids)));
      if (found.length !== ids.length) throw notFound("Branch");
      if (found.some((b) => !b.active)) throw badRequest("One of these branches is closed");
      await this.assertMembers(tenantId, [userId]);
    }
    await mapUnique(() =>
      this.db.transaction(async (tx) => {
        const scope = and(eq(branchUsers.tenantId, tenantId), eq(branchUsers.userId, userId));
        await tx.delete(branchUsers).where(ids.length > 0 ? and(scope, notInArray(branchUsers.branchId, ids)) : scope);
        if (ids.length > 0) {
          await tx
            .insert(branchUsers)
            .values(ids.map((branchId) => ({ tenantId, branchId, userId, isDefault: false })))
            .onConflictDoNothing();
        }
        if (p.defaultBranchId) await this.setHome(tx, tenantId, userId, p.defaultBranchId);
        await this.fixHome(tx, tenantId, userId);
      }),
    );
    this.invalidate(tenantId);
    return this.userBranches(tenantId, userId);
  }

  private async setHome(tx: DbOrTx, tenantId: string, userId: string, branchId: string): Promise<void> {
    const scope = and(eq(branchUsers.tenantId, tenantId), eq(branchUsers.userId, userId));
    await tx.update(branchUsers).set({ isDefault: false }).where(and(scope, ne(branchUsers.branchId, branchId), eq(branchUsers.isDefault, true)));
    await tx.update(branchUsers).set({ isDefault: true }).where(and(scope, eq(branchUsers.branchId, branchId)));
  }

  /** Keeps exactly one home branch for a user who has any assignment (the earliest one when none is marked). */
  private async fixHome(tx: DbOrTx, tenantId: string, userId: string): Promise<void> {
    const rows = await tx
      .select({ id: branchUsers.id, isDefault: branchUsers.isDefault })
      .from(branchUsers)
      .where(and(eq(branchUsers.tenantId, tenantId), eq(branchUsers.userId, userId)))
      .orderBy(asc(branchUsers.createdAt), asc(branchUsers.id));
    if (rows.length === 0 || rows.some((r) => r.isDefault)) return;
    await tx.update(branchUsers).set({ isDefault: true }).where(eq(branchUsers.id, rows[0]!.id));
  }

  // ================================================================ mine + summary

  /**
   * Branches the user can work in (open ones only): every branch for owners/admins, else their assigned branches
   * (the default branch when none are assigned). Creates the default branch on first use.
   */
  async mine(
    tenantId: string,
    user: { userId: string; fullAccess: boolean },
    currentBranchId: string | null = null,
  ): Promise<{ items: MyBranch[]; total: number; defaultBranchId: string; currentBranchId: string | null }> {
    const def = await this.ensureDefault(tenantId);
    const [rows, assignments] = await Promise.all([this.cachedRows(tenantId), this.assignments(tenantId, user.userId)]);
    const active = rows.filter((r) => r.active);
    const access: BranchAccess = user.fullAccess ? { kind: "all", assignments } : { kind: "assigned", assignments };
    const usable = new Set(usableBranches(active.map(toLite), access).map((b) => b.id));
    const homeId = assignments.find((a) => a.isDefault)?.branchId ?? null;
    const items = active
      .filter((r) => usable.has(r.id))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.code.localeCompare(b.code))
      .map((r) => ({ ...toBranch(r), isHome: r.id === homeId }));
    return { items, total: items.length, defaultBranchId: def.id, currentBranchId };
  }

  /**
   * Per-branch sales, bill count and stock value for `from..to` (IST dates, inclusive; default month to date).
   * Bills without a branch count for the default branch. Closed branches are listed only when they sold something.
   */
  async summary(tenantId: string, query: SummaryQuery = {}): Promise<BranchSummary> {
    const q = summaryQuerySchema.parse(query);
    const port = this.deps.summary;
    if (!port) throw notConfigured("Branch summary");
    const range = monthToDate(this.now());
    const from = q.from ?? range.from;
    const to = q.to ?? range.to;
    if (from > to) throw badRequest("`from` must be on or before `to`", { field: "from" });
    const def = await this.ensureDefault(tenantId);
    const rows = await this.rows(this.db, tenantId);

    const sales = await port.sales(tenantId, { from, to });
    const byBranch = new Map<string, { sales: number; bills: number }>();
    for (const s of sales) {
      const id = s.branchId ?? def.id;
      const acc = byBranch.get(id) ?? { sales: 0, bills: 0 };
      acc.sales += s.sales;
      acc.bills += s.bills;
      byBranch.set(id, acc);
    }
    const shown = rows.filter((r) => r.active || (byBranch.get(r.id)?.bills ?? 0) > 0);
    const items: BranchSummaryRow[] = await Promise.all(
      shown.map(async (r) => ({
        branchId: r.id,
        name: r.name,
        code: r.code,
        active: r.active,
        isDefault: r.isDefault,
        sales: byBranch.get(r.id)?.sales ?? 0,
        bills: byBranch.get(r.id)?.bills ?? 0,
        stockValue: r.stockLocationId && r.active ? await port.stockValue(tenantId, r.stockLocationId) : null,
      })),
    );
    items.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.sales - a.sales || a.code.localeCompare(b.code));
    const consolidated = items.reduce(
      (acc, r) => ({ sales: acc.sales + r.sales, bills: acc.bills + r.bills, stockValue: acc.stockValue + (r.stockValue ?? 0) }),
      { sales: 0, bills: 0, stockValue: 0 },
    );
    return { from, to, items, total: items.length, consolidated };
  }
}
