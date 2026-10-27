import {
  AppError,
  FULL_ACCESS_ROLES,
  featureDisabled,
  notFound,
  permissionsAllow,
  randomToken,
  safeEqual,
  sha256,
  type AuditEvent,
  type DeviceRef,
  type TenantRef,
} from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { and, asc, count, desc, eq, gt, gte, inArray, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import type { DisplayHostPorts } from "./display";
import {
  catalogQuery,
  pairBody,
  terminalCreateBody,
  terminalPatchBody,
  useTicketBody,
  weighTicketBody,
  weighTicketListQuery,
} from "./api-schemas";
import {
  CATALOG_DEFAULT_LIMIT,
  CATALOG_MAX_DELTA_MS,
  CATALOG_MAX_LIMIT,
  LAST_SEEN_INTERVAL_MS,
  PAIR_ATTEMPTS_PER_WINDOW,
  PAIR_WINDOW_MS,
  PAIRING_TTL_MS,
  PIN_LOCK_MS,
  PIN_MAX_FAILURES,
  PIN_RE,
  PIN_SESSION_TTL_MINUTES,
  TICKET_CODE_RE,
  assertPinAllowed,
  cursorFor,
  decodeCursor,
  decodePageToken,
  encodeCursor,
  encodePageToken,
  endOfIstDay,
  formatPairingCode,
  newPairingCode,
  newTicketCode,
  normalizePairingCode,
  pairingQr,
  pinLookup,
  priceLine,
  settingsOf,
  startOfIstDay,
  toTerminal,
  toTicket,
  type TerminalView,
  type WeighTicketView,
} from "./logic";
import {
  PLAN_LIMIT_KEY,
  POS_FEATURE_KEYS,
  POS_PERMISSION_KEYS,
  type AuditPort,
  type LoggerPort,
  type PosBillsPort,
  type PosInvoicesPort,
  type PosBranchesPort,
  type PosCatalogPort,
  type PosCategory,
  type PosConfig,
  type PosFeaturesPort,
  type PosItem,
  type PosMembersPort,
  type PosQuotaPort,
  type PosSessionsPort,
  type PosShop,
  type PosTenantsPort,
} from "./ports";
import { posPinAttempts, posStaffPins, posTerminals, posWeighTickets, type TerminalRow, type TerminalSettings } from "./schema";

export interface PosDeps {
  db: Db;
  config: PosConfig;
  sessions: PosSessionsPort;
  members: PosMembersPort;
  tenants: PosTenantsPort;
  features: PosFeaturesPort;
  catalog: PosCatalogPort;
  quota?: PosQuotaPort;
  branches?: PosBranchesPort;
  bills?: PosBillsPort;
  /** Invoices, for offline billing (number blocks and bill sync); without it those routes answer 503. */
  invoices?: PosInvoicesPort;
  /** The customer display's idle screen (shop brand, messages) and the Redis pub/sub that spreads its feed. */
  display?: DisplayHostPorts;
  audit?: AuditPort;
  log?: LoggerPort;
  now?: () => Date;
}

/** Who did it, for the audit trail. */
export interface Actor {
  userId: string | null;
  ip: string | null;
  userAgent: string | null;
}

export interface Pairing {
  code: string;
  expiresAt: Date;
  qr: string;
}

export interface PosItemPage {
  items: Omit<PosItem, "tareKg">[];
  removed: string[];
  cursor: string;
  next: string | null;
  full: boolean;
}

const STAFF_LEVELS = ["owner", "admin", "staff"];
const isStaff = (roles: readonly string[]) => roles.some((r) => STAFF_LEVELS.includes(r));

/** Postgres unique-violation constraint name (drizzle wraps driver errors in `cause`), or null. */
function uniqueViolation(err: unknown): string | null {
  for (let cur = err as { code?: string; constraint_name?: string; cause?: unknown } | undefined; cur; cur = cur.cause as typeof cur) {
    if (typeof cur !== "object") break;
    if (cur.code === "23505") return cur.constraint_name ?? "";
  }
  return null;
}

/** In-memory sliding window per key (per process). */
export class SlidingWindow {
  private readonly hits = new Map<string, number[]>();
  private calls = 0;
  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}
  hit(key: string): boolean {
    const t = this.now();
    const from = t - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((x) => x > from);
    if (++this.calls % 500 === 0) for (const [k, v] of this.hits) if (!v.some((x) => x > from)) this.hits.delete(k);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    return true;
  }
}

const pairingInvalid = () => new AppError(400, "pairing_code_invalid", "This pairing code is wrong or has expired");
const notPaired = () => new AppError(401, "device_not_paired", "This device is not paired with a terminal");
const ticketNotFound = () => new AppError(404, "ticket_not_found", "Weigh ticket not found");
const ticketUsed = () => new AppError(409, "ticket_used", "This weigh ticket has already been billed");
const ticketCancelled = () => new AppError(409, "ticket_cancelled", "This weigh ticket was cancelled");
const ticketExpired = () => new AppError(410, "ticket_expired", "This weigh ticket has expired (tickets are valid on the day they are weighed)");

/**
 * POS terminals (docs/pos-terminals.md): terminals and pairing, the device token, staff PINs and PIN sessions, the
 * catalogue sync and weigh tickets. Every query on a tenant table filters by tenant.
 */
export class PosService {
  private readonly db: Db;
  private readonly now: () => Date;
  readonly pairLimiter: SlidingWindow;

  constructor(private readonly deps: PosDeps) {
    this.db = deps.db;
    this.now = deps.now ?? (() => new Date());
    this.pairLimiter = new SlidingWindow(PAIR_ATTEMPTS_PER_WINDOW, PAIR_WINDOW_MS, () => this.now().getTime());
  }

  private async record(actor: Actor, e: Omit<AuditEvent, "actorUserId" | "ip" | "userAgent">) {
    if (!this.deps.audit) return;
    await this.deps.audit.record({ ...e, actorUserId: actor.userId, ip: actor.ip, userAgent: actor.userAgent }).catch(() => undefined);
  }

  // ================================================================ terminals

  private async terminalRow(tenantId: string, id: string): Promise<TerminalRow> {
    const [row] = await this.db
      .select()
      .from(posTerminals)
      .where(and(eq(posTerminals.tenantId, tenantId), eq(posTerminals.id, id), isNull(posTerminals.deletedAt)))
      .limit(1);
    if (!row) throw new AppError(404, "terminal_not_found", "Terminal not found");
    return row;
  }

  async listTerminals(tenant: TenantRef): Promise<{ items: TerminalView[]; total: number; limit: number | null }> {
    const rows = await this.db
      .select()
      .from(posTerminals)
      .where(and(eq(posTerminals.tenantId, tenant.id), isNull(posTerminals.deletedAt)))
      .orderBy(asc(posTerminals.createdAt), asc(posTerminals.id));
    const now = this.now();
    const limit = this.deps.quota ? await this.deps.quota.limit(tenant, PLAN_LIMIT_KEY) : -1;
    return { items: rows.map((r) => toTerminal(r, now)), total: rows.length, limit: limit < 0 ? null : limit };
  }

  /** Non-deleted terminals of a shop (the plan usage source). */
  async countTerminals(tenantId?: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ tenantId: posTerminals.tenantId, n: count() })
      .from(posTerminals)
      .where(tenantId ? and(eq(posTerminals.tenantId, tenantId), isNull(posTerminals.deletedAt)) : isNull(posTerminals.deletedAt))
      .groupBy(posTerminals.tenantId);
    return new Map(rows.map((r) => [r.tenantId, r.n]));
  }

  private async branchLocation(tenantId: string, branchId: string | null | undefined): Promise<{ branchId: string | null; locationId: string | null }> {
    if (!branchId) return { branchId: null, locationId: null };
    if (!this.deps.branches) return { branchId, locationId: null };
    const b = await this.deps.branches.get(tenantId, branchId);
    if (!b) throw new AppError(404, "branch_not_found", "This branch doesn't exist or is closed", { branch: branchId });
    return { branchId: b.id, locationId: b.locationId };
  }

  private nameTaken(err: unknown): never {
    if (uniqueViolation(err) !== null) throw new AppError(409, "terminal_name_taken", "Another terminal already has this name");
    throw err;
  }

  /** A new pairing code for the terminal (the old one stops working; a paired device keeps working). */
  private async issuePairing(tenantId: string, id: string): Promise<Pairing> {
    for (let attempt = 0; ; attempt++) {
      const code = newPairingCode();
      const expiresAt = new Date(this.now().getTime() + PAIRING_TTL_MS);
      try {
        const res = await this.db
          .update(posTerminals)
          .set({ pairingCodeHash: sha256(code), pairingExpiresAt: expiresAt })
          .where(and(eq(posTerminals.tenantId, tenantId), eq(posTerminals.id, id), isNull(posTerminals.deletedAt)))
          .returning({ id: posTerminals.id });
        if (!res.length) throw new AppError(404, "terminal_not_found", "Terminal not found");
        return { code: formatPairingCode(code), expiresAt, qr: pairingQr(this.deps.config.apiOrigin, code) };
      } catch (err) {
        if (attempt < 3 && uniqueViolation(err) !== null) continue;
        throw err;
      }
    }
  }

  async createTerminal(tenant: TenantRef, input: unknown, actor: Actor): Promise<{ terminal: TerminalView; pairing: Pairing }> {
    const p = terminalCreateBody.parse(input);
    const where = await this.branchLocation(tenant.id, p.branchId);
    await this.deps.quota?.consume(tenant, PLAN_LIMIT_KEY, 1);
    let row: TerminalRow;
    try {
      [row] = (await this.db
        .insert(posTerminals)
        .values({ tenantId: tenant.id, name: p.name, role: p.role, ...where, settings: settingsOf(p.settings) })
        .returning()) as [TerminalRow];
    } catch (err) {
      await this.deps.quota?.release(tenant, PLAN_LIMIT_KEY, 1).catch(() => undefined);
      this.nameTaken(err);
    }
    const pairing = await this.issuePairing(tenant.id, row.id);
    await this.record(actor, { tenantId: tenant.id, action: "pos.terminal.create", entityType: "pos_terminal", entityId: row.id, summary: `Terminal "${row.name}" (${row.role}) added` });
    return { terminal: toTerminal(await this.terminalRow(tenant.id, row.id), this.now()), pairing };
  }

  async updateTerminal(tenantId: string, id: string, input: unknown, actor: Actor): Promise<TerminalView> {
    const p = terminalPatchBody.parse(input);
    const cur = await this.terminalRow(tenantId, id);
    const set: Partial<typeof posTerminals.$inferInsert> = {};
    if (p.name !== undefined) set.name = p.name;
    if (p.role !== undefined) set.role = p.role;
    if (p.branchId !== undefined) Object.assign(set, await this.branchLocation(tenantId, p.branchId));
    if (p.settings !== undefined) set.settings = settingsOf({ ...settingsOf(cur.settings), ...p.settings } as TerminalSettings);
    if (Object.keys(set).length === 0) return toTerminal(cur, this.now());
    let row: TerminalRow | undefined;
    try {
      [row] = await this.db
        .update(posTerminals)
        .set(set)
        .where(and(eq(posTerminals.tenantId, tenantId), eq(posTerminals.id, id), isNull(posTerminals.deletedAt)))
        .returning();
    } catch (err) {
      this.nameTaken(err);
    }
    if (!row) throw new AppError(404, "terminal_not_found", "Terminal not found");
    await this.record(actor, { tenantId, action: "pos.terminal.update", entityType: "pos_terminal", entityId: id, summary: `Terminal "${row.name}" changed`, before: { name: cur.name, role: cur.role, branchId: cur.branchId }, after: { name: row.name, role: row.role, branchId: row.branchId } });
    return toTerminal(row, this.now());
  }

  async newPairingCode(tenantId: string, id: string, actor: Actor): Promise<Pairing> {
    const row = await this.terminalRow(tenantId, id);
    const pairing = await this.issuePairing(tenantId, id);
    await this.record(actor, { tenantId, action: "pos.terminal.pairing_code", entityType: "pos_terminal", entityId: id, summary: `New pairing code for "${row.name}"` });
    return pairing;
  }

  /** Forgets the paired device: its token stops working and its PIN sessions end. */
  private async clearDevice(tenantId: string, id: string, extra: Partial<typeof posTerminals.$inferInsert> = {}): Promise<TerminalRow | null> {
    const [row] = await this.db
      .update(posTerminals)
      .set({ deviceTokenHash: null, device: null, pairedAt: null, ...extra })
      .where(and(eq(posTerminals.tenantId, tenantId), eq(posTerminals.id, id), isNull(posTerminals.deletedAt)))
      .returning();
    await this.deps.sessions.revokeTerminal(id);
    return row ?? null;
  }

  async unpairTerminal(tenantId: string, id: string, actor: Actor): Promise<TerminalView> {
    const cur = await this.terminalRow(tenantId, id);
    const row = await this.clearDevice(tenantId, id);
    if (!row) throw new AppError(404, "terminal_not_found", "Terminal not found");
    await this.record(actor, { tenantId, action: "pos.terminal.unpair", entityType: "pos_terminal", entityId: id, summary: `Device unpaired from "${cur.name}"` });
    return toTerminal(row, this.now());
  }

  async deleteTerminal(tenant: TenantRef, id: string, actor: Actor): Promise<{ ok: true }> {
    const cur = await this.terminalRow(tenant.id, id);
    const row = await this.clearDevice(tenant.id, id, { deletedAt: this.now(), pairingCodeHash: null, pairingExpiresAt: null });
    if (!row) throw new AppError(404, "terminal_not_found", "Terminal not found");
    await this.deps.quota?.release(tenant, PLAN_LIMIT_KEY, 1).catch((err: unknown) => this.deps.log?.error({ err, tenantId: tenant.id }, "pos: quota release failed"));
    await this.record(actor, { tenantId: tenant.id, action: "pos.terminal.delete", entityType: "pos_terminal", entityId: id, summary: `Terminal "${cur.name}" removed` });
    return { ok: true };
  }

  // ================================================================ pairing and the device

  /** Redeems a pairing code (public). 429 `too_many_attempts` past the per-IP limit, 400 `pairing_code_invalid`. */
  async pair(input: unknown, actor: Actor): Promise<{ deviceToken: string; terminal: TerminalView; shop: PosShop }> {
    if (!this.pairLimiter.hit(actor.ip ?? "-")) {
      throw new AppError(429, "too_many_attempts", "Too many pairing attempts. Try again in a few minutes", { retryAfterSeconds: Math.ceil(PAIR_WINDOW_MS / 1000) });
    }
    const p = pairBody.parse(input);
    const code = normalizePairingCode(p.code);
    if (!code) throw pairingInvalid();
    const hash = sha256(code);
    const now = this.now();
    const [found] = await this.db
      .select()
      .from(posTerminals)
      .where(and(eq(posTerminals.pairingCodeHash, hash), isNull(posTerminals.deletedAt)))
      .limit(1);
    if (!found || !found.pairingCodeHash || !safeEqual(found.pairingCodeHash, hash) || !found.pairingExpiresAt || found.pairingExpiresAt <= now) throw pairingInvalid();
    if (!(await this.deps.features.isEnabled(found.tenantId, POS_FEATURE_KEYS.terminals))) throw featureDisabled(POS_FEATURE_KEYS.terminals, "shop");
    const token = randomToken(32);
    const device = { platform: p.device.platform, model: p.device.model ?? null, appVersion: p.device.appVersion ?? null, name: p.device.name ?? null };
    const [row] = await this.db
      .update(posTerminals)
      .set({ deviceTokenHash: sha256(token), device, pairedAt: now, lastSeenAt: now, pairingCodeHash: null, pairingExpiresAt: null })
      .where(and(eq(posTerminals.id, found.id), eq(posTerminals.pairingCodeHash, hash), isNull(posTerminals.deletedAt)))
      .returning();
    if (!row) throw pairingInvalid();
    // A new device replaces the old one: the old token no longer matches; its PIN sessions end and the lockout resets.
    await this.deps.sessions.revokeTerminal(row.id);
    await this.db.delete(posPinAttempts).where(eq(posPinAttempts.terminalId, row.id));
    const shop = await this.deps.tenants.shop(row.tenantId);
    if (!shop) throw pairingInvalid();
    await this.record(actor, { tenantId: row.tenantId, action: "pos.device.pair", entityType: "pos_terminal", entityId: row.id, summary: `Device paired to "${row.name}" (${device.platform}${device.model ? `, ${device.model}` : ""})` });
    return { deviceToken: token, terminal: toTerminal(row, now), shop };
  }

  /** The terminal of a device token (any shop), or null. Touches `last_seen_at` at most once a minute. */
  async deviceFor(token: string): Promise<TerminalRow | null> {
    if (!token || token.length > 200) return null;
    const hash = sha256(token);
    const [row] = await this.db
      .select()
      .from(posTerminals)
      .where(and(eq(posTerminals.deviceTokenHash, hash), isNull(posTerminals.deletedAt)))
      .limit(1);
    if (!row || !row.deviceTokenHash || !safeEqual(row.deviceTokenHash, hash)) return null;
    const now = this.now();
    if (!row.lastSeenAt || now.getTime() - row.lastSeenAt.getTime() >= LAST_SEEN_INTERVAL_MS) {
      await this.db
        .update(posTerminals)
        .set({ lastSeenAt: now })
        .where(and(eq(posTerminals.tenantId, row.tenantId), eq(posTerminals.id, row.id)))
        .catch((err: unknown) => this.deps.log?.warn({ err }, "pos: last_seen_at update failed"));
      row.lastSeenAt = now;
    }
    return row;
  }

  async deviceInfo(tenantId: string, device: DeviceRef): Promise<{ terminal: TerminalView; shop: PosShop; features: string[] }> {
    const row = await this.terminalRow(tenantId, device.terminalId).catch(() => {
      throw notPaired();
    });
    const [shop, features] = await Promise.all([this.deps.tenants.shop(tenantId), this.deps.features.enabled(tenantId)]);
    if (!shop) throw notPaired();
    return { terminal: toTerminal(row, this.now()), shop, features };
  }

  /** The device forgets itself. */
  async deviceUnpair(tenantId: string, device: DeviceRef, actor: Actor): Promise<{ ok: true }> {
    const row = await this.clearDevice(tenantId, device.terminalId);
    await this.record(actor, { tenantId, action: "pos.device.unpair", entityType: "pos_terminal", entityId: device.terminalId, summary: `Device unpaired itself from "${row?.name ?? ""}"` });
    return { ok: true };
  }

  // ================================================================ staff PINs

  private lookupOf(tenantId: string, pin: string) {
    return pinLookup(this.deps.config.pinKey, tenantId, pin);
  }

  /** Active staff members (owner / admin / staff) with names. */
  private async staffMembers(tenantId: string): Promise<{ userId: string; name: string | null }[]> {
    const members = (await this.deps.members.list(tenantId)).filter((m) => isStaff(m.roles));
    if (!members.length) return [];
    const users = new Map((await this.deps.members.users(members.map((m) => m.userId))).map((u) => [u.id, u.name]));
    return members
      .filter((m) => users.has(m.userId))
      .map((m) => ({ userId: m.userId, name: users.get(m.userId) ?? null }))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "") || a.userId.localeCompare(b.userId));
  }

  private async pinRows(tenantId: string) {
    return new Map(
      (await this.db.select({ userId: posStaffPins.userId, updatedAt: posStaffPins.updatedAt }).from(posStaffPins).where(eq(posStaffPins.tenantId, tenantId))).map((r) => [
        r.userId,
        r.updatedAt,
      ]),
    );
  }

  /** Names for the lock screen (no PINs). */
  async staffForLock(tenantId: string): Promise<{ items: { userId: string; name: string | null; hasPin: boolean }[] }> {
    const [staff, pins] = await Promise.all([this.staffMembers(tenantId), this.pinRows(tenantId)]);
    return { items: staff.map((s) => ({ ...s, hasPin: pins.has(s.userId) })) };
  }

  async listPins(tenantId: string): Promise<{ items: { userId: string; name: string | null; hasPin: boolean; updatedAt: Date | null }[] }> {
    const [staff, pins] = await Promise.all([this.staffMembers(tenantId), this.pinRows(tenantId)]);
    return { items: staff.map((s) => ({ ...s, hasPin: pins.has(s.userId), updatedAt: pins.get(s.userId) ?? null })) };
  }

  /** Sets a member's PIN. 400 `pin_weak`, 409 `pin_taken` (never says who), 404 for a non-member. */
  async setPin(tenantId: string, userId: string, pin: unknown, actor: Actor): Promise<{ ok: true }> {
    const p = assertPinAllowed(pin);
    if (!isStaff(await this.deps.members.rolesFor(tenantId, userId))) throw new AppError(404, "member_not_found", "This person is not on the shop's team");
    const lookup = this.lookupOf(tenantId, p);
    try {
      await this.db
        .insert(posStaffPins)
        .values({ tenantId, userId, pinLookup: lookup, updatedAt: this.now() })
        .onConflictDoUpdate({ target: [posStaffPins.tenantId, posStaffPins.userId], set: { pinLookup: lookup, updatedAt: this.now() } });
    } catch (err) {
      if (uniqueViolation(err) !== null) throw new AppError(409, "pin_taken", "This PIN is already in use in this shop. Choose another");
      throw err;
    }
    const own = actor.userId === userId;
    await this.record(actor, { tenantId, action: own ? "pos.pin.set" : "pos.pin.reset", entityType: "user", entityId: userId, summary: own ? "Set own POS PIN" : "Reset a staff member's POS PIN" });
    return { ok: true };
  }

  async deletePin(tenantId: string, userId: string, actor: Actor): Promise<{ ok: true }> {
    await this.db.delete(posStaffPins).where(and(eq(posStaffPins.tenantId, tenantId), eq(posStaffPins.userId, userId)));
    await this.record(actor, { tenantId, action: "pos.pin.delete", entityType: "user", entityId: userId, summary: actor.userId === userId ? "Removed own POS PIN" : "Removed a staff member's POS PIN" });
    return { ok: true };
  }

  /**
   * Who owns this staff PIN in this shop (a manager approving a discount at someone else's counter). Null for an
   * unknown PIN or a member who is no longer active. The caller rate-limits wrong guesses and checks the permission.
   */
  async memberForPin(tenantId: string, pin: unknown): Promise<{ userId: string; name: string | null; roles: string[]; permissions: string[] } | null> {
    const p = typeof pin === "string" ? pin.trim() : "";
    if (!PIN_RE.test(p)) return null;
    const lookup = this.lookupOf(tenantId, p);
    const [row] = await this.db.select().from(posStaffPins).where(and(eq(posStaffPins.tenantId, tenantId), eq(posStaffPins.pinLookup, lookup))).limit(1);
    if (!row || !safeEqual(row.pinLookup, lookup)) return null;
    const roles = await this.deps.members.rolesFor(tenantId, row.userId);
    if (!isStaff(roles)) return null;
    const [user] = await this.deps.members.users([row.userId]);
    if (!user) return null;
    return { userId: row.userId, name: user.name, roles, permissions: await this.deps.members.permissionsFor(tenantId, roles) };
  }

  // ================================================================ PIN sessions

  private async lockState(terminalId: string): Promise<{ failures: number; lockedUntil: Date | null }> {
    const [row] = await this.db.select().from(posPinAttempts).where(eq(posPinAttempts.terminalId, terminalId)).limit(1);
    return { failures: row?.failures ?? 0, lockedUntil: row?.lockedUntil ?? null };
  }

  private locked(until: Date, now: Date) {
    return new AppError(429, "pin_locked", "Too many wrong PINs. This terminal is locked for a few minutes", {
      retryAfterSeconds: Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000)),
    });
  }

  /** One more wrong PIN on the terminal: 401 `pin_invalid` `{ remaining }`, or 429 `pin_locked` on the fifth in a row. */
  private async wrongPin(tenantId: string, device: DeviceRef, actor: Actor): Promise<never> {
    const now = this.now();
    const t = posPinAttempts;
    const [row] = await this.db
      .insert(t)
      .values({ terminalId: device.terminalId, failures: 1, lockedUntil: null, updatedAt: now })
      .onConflictDoUpdate({
        target: t.terminalId,
        set: {
          // A lock that has run out starts the count again.
          failures: sql`case when ${t.lockedUntil} is not null and ${t.lockedUntil} <= ${now.toISOString()}::timestamptz then 1 else ${t.failures} + 1 end`,
          lockedUntil: sql`case when ${t.lockedUntil} is not null and ${t.lockedUntil} <= ${now.toISOString()}::timestamptz then null else ${t.lockedUntil} end`,
          updatedAt: now,
        },
      })
      .returning({ failures: t.failures });
    const failures = row?.failures ?? 1;
    if (failures >= PIN_MAX_FAILURES) {
      const until = new Date(now.getTime() + PIN_LOCK_MS);
      await this.db.update(t).set({ failures: 0, lockedUntil: until, updatedAt: now }).where(eq(t.terminalId, device.terminalId));
      await this.record(actor, { tenantId, action: "pos.pin.locked", entityType: "pos_terminal", entityId: device.terminalId, summary: `${PIN_MAX_FAILURES} wrong PINs in a row: terminal locked for ${PIN_LOCK_MS / 60_000} minutes` });
      throw this.locked(until, now);
    }
    throw new AppError(401, "pin_invalid", "Wrong PIN", { remaining: PIN_MAX_FAILURES - failures });
  }

  /**
   * Unlocks a paired terminal with a staff PIN: a 12 h session bound to the terminal. 429 `pin_locked` while locked,
   * 401 `pin_invalid`, 403 `pin_not_allowed` for a member without a POS permission for this terminal's role.
   */
  async pinLogin(tenant: TenantRef, device: DeviceRef, pin: unknown, actor: Actor) {
    const now = this.now();
    const lock = await this.lockState(device.terminalId);
    if (lock.lockedUntil && lock.lockedUntil > now) throw this.locked(lock.lockedUntil, now);
    const p = typeof pin === "string" ? pin.trim() : "";
    const lookup = PIN_RE.test(p) ? this.lookupOf(tenant.id, p) : null;
    const [row] = lookup
      ? await this.db
          .select()
          .from(posStaffPins)
          .where(and(eq(posStaffPins.tenantId, tenant.id), eq(posStaffPins.pinLookup, lookup)))
          .limit(1)
      : [];
    if (!row || !lookup || !safeEqual(row.pinLookup, lookup)) return this.wrongPin(tenant.id, device, actor);
    // A correct PIN resets the count.
    await this.db.delete(posPinAttempts).where(eq(posPinAttempts.terminalId, device.terminalId));

    const roles = await this.deps.members.rolesFor(tenant.id, row.userId);
    const [user] = isStaff(roles) ? await this.deps.members.users([row.userId]) : [];
    const permissions = user ? await this.deps.members.permissionsFor(tenant.id, roles) : [];
    const need = device.role === "weighing" ? POS_PERMISSION_KEYS.weigh : "invoices.create";
    const allowed = Boolean(user) && (roles.some((r) => FULL_ACCESS_ROLES.includes(r)) || permissionsAllow(permissions, need));
    if (!user || !allowed) {
      await this.record({ ...actor, userId: row.userId }, { tenantId: tenant.id, action: "pos.session.refused", entityType: "pos_terminal", entityId: device.terminalId, summary: "PIN correct but the member may not use this terminal" });
      throw new AppError(403, "pin_not_allowed", "You can't use this terminal. Ask the owner for access");
    }
    const s = await this.deps.sessions.create(row.userId, { terminalId: device.terminalId, ttlMinutes: PIN_SESSION_TTL_MINUTES, ip: actor.ip, userAgent: actor.userAgent });
    await this.record({ ...actor, userId: row.userId }, { tenantId: tenant.id, action: "pos.session.create", entityType: "pos_terminal", entityId: device.terminalId, summary: "Unlocked the terminal with a PIN" });
    return { token: s.token, expiresAt: s.expiresAt, user: { id: user.id, name: user.name }, permissions, tenantRoles: roles };
  }

  /** Ends the PIN session the request carries (it must be one of this terminal's). */
  async lock(tenantId: string, device: DeviceRef, sessionId: string, actor: Actor): Promise<{ ok: true }> {
    const ok = await this.deps.sessions.revokeOne(sessionId, device.terminalId);
    if (!ok) throw new AppError(400, "not_a_pin_session", "This request doesn't carry a PIN session of this terminal");
    await this.record(actor, { tenantId, action: "pos.session.lock", entityType: "pos_terminal", entityId: device.terminalId, summary: "Locked the terminal" });
    return { ok: true };
  }

  // ================================================================ catalogue

  /** One page of the POS catalogue sync (docs/pos-terminals.md "Catalogue for the POS"). */
  async catalog(tenantId: string, query: z.input<typeof catalogQuery>): Promise<PosItemPage> {
    const q = catalogQuery.parse(query ?? {});
    const now = this.now();
    const limit = Math.min(q.limit ?? CATALOG_DEFAULT_LIMIT, CATALOG_MAX_LIMIT);
    let since: number | null;
    let cursor: number;
    let afterId: string | null = null;
    if (q.after) {
      const t = decodePageToken(q.after);
      ({ s: since, c: cursor, a: afterId } = t);
    } else {
      const s = decodeCursor(q.since);
      since = s !== null && now.getTime() - s <= CATALOG_MAX_DELTA_MS && s <= now.getTime() ? s : null;
      cursor = cursorFor(now);
    }
    const [rows, catalogueOn] = await Promise.all([
      this.deps.catalog.rows(tenantId, { since: since === null ? null : new Date(since), afterId, limit: limit + 1 }),
      this.deps.features.isEnabled(tenantId, "catalogue"),
    ]);
    const page = rows.slice(0, limit);
    const items: PosItemPage["items"] = [];
    const removed: string[] = [];
    for (const r of page) {
      if (!r.item) {
        removed.push(r.id);
        continue;
      }
      const { tareKg: _tare, ...item } = r.item;
      items.push(catalogueOn ? item : { ...item, productId: null });
    }
    const last = page[page.length - 1];
    return {
      items,
      removed,
      cursor: encodeCursor(cursor),
      next: rows.length > limit && last ? encodePageToken({ c: cursor, s: since, a: last.id }) : null,
      full: since === null,
    };
  }

  categories(tenantId: string): Promise<PosCategory[]> {
    return this.deps.catalog.categories(tenantId);
  }

  // ================================================================ weigh tickets

  async createTicket(tenantId: string, device: DeviceRef, userId: string, input: unknown): Promise<WeighTicketView> {
    if (device.role !== "weighing") throw new AppError(403, "weighing_terminal_required", "Weigh tickets are made on a weighing terminal");
    const p = weighTicketBody.parse(input);
    const items = new Map((await this.deps.catalog.items(tenantId, [...new Set(p.lines.map((l) => l.itemId))])).map((i) => [i.itemId, i]));
    const lines = p.lines.map((l, i) => priceLine(items.get(l.itemId), l, i));
    const total = lines.reduce((s, l) => s + l.amount, 0);
    const now = this.now();
    for (let attempt = 0; ; attempt++) {
      try {
        const [row] = await this.db
          .insert(posWeighTickets)
          .values({ tenantId, terminalId: device.terminalId, code: newTicketCode(), status: "open", lines, total, note: p.note || null, createdBy: userId, createdAt: now, expiresAt: endOfIstDay(now) })
          .returning();
        return toTicket(row!);
      } catch (err) {
        if (attempt < 3 && uniqueViolation(err) !== null) continue;
        throw err;
      }
    }
  }

  /** Today's tickets of the terminal (or of every terminal when `terminalId` is null). */
  async listTickets(tenantId: string, terminalId: string | null, query: unknown): Promise<{ items: WeighTicketView[]; total: number }> {
    const q = weighTicketListQuery.parse(query ?? {});
    const t = posWeighTickets;
    const where = and(
      eq(t.tenantId, tenantId),
      terminalId ? eq(t.terminalId, terminalId) : undefined,
      gte(t.createdAt, startOfIstDay(this.now())),
      q.status ? eq(t.status, q.status) : undefined,
    );
    const [rows, [c]] = await Promise.all([
      this.db.select().from(t).where(where).orderBy(desc(t.createdAt), desc(t.id)).limit(q.limit ?? 50),
      this.db.select({ n: count() }).from(t).where(where),
    ]);
    return { items: rows.map(toTicket), total: c?.n ?? 0 };
  }

  private async ticketBy(tenantId: string, cond: { id?: string; code?: string }) {
    const t = posWeighTickets;
    const [row] = await this.db
      .select()
      .from(t)
      .where(and(eq(t.tenantId, tenantId), cond.id ? eq(t.id, cond.id) : eq(t.code, cond.code!)))
      .limit(1);
    return row ?? null;
  }

  private assertUsable(row: { status: string; expiresAt: Date }) {
    if (row.status === "used") throw ticketUsed();
    if (row.status === "cancelled") throw ticketCancelled();
    if (row.expiresAt <= this.now()) throw ticketExpired();
  }

  /** A ticket to scan at the POS: 404 `ticket_not_found`, 409 `ticket_used` / `ticket_cancelled`, 410 `ticket_expired`. */
  async ticketByCode(tenantId: string, code: string): Promise<WeighTicketView> {
    const c = code.trim().toUpperCase();
    const row = TICKET_CODE_RE.test(c) ? await this.ticketBy(tenantId, { code: c }) : null;
    if (!row) throw ticketNotFound();
    this.assertUsable(row);
    return toTicket(row);
  }

  /** For the counter resolver: the ticket with this code in any state (the client reads `status` / `expiresAt`), or null. */
  async findTicketCode(tenantId: string, code: string): Promise<WeighTicketView | null> {
    const c = code.trim().toUpperCase();
    if (!TICKET_CODE_RE.test(c)) return null;
    const row = await this.ticketBy(tenantId, { code: c });
    return row ? toTicket(row) : null;
  }

  /** Marks a ticket billed. Repeating it with the same bill answers the same ticket; another bill gets 409. */
  async useTicket(tenantId: string, id: string, input: unknown): Promise<WeighTicketView> {
    const { invoiceId } = useTicketBody.parse(input);
    if (this.deps.bills && !(await this.deps.bills.exists(tenantId, invoiceId))) throw new AppError(404, "invoice_not_found", "Bill not found");
    const t = posWeighTickets;
    const now = this.now();
    const [row] = await this.db
      .update(t)
      .set({ status: "used", usedInvoiceId: invoiceId, usedAt: now })
      .where(and(eq(t.tenantId, tenantId), eq(t.id, id), eq(t.status, "open"), gt(t.expiresAt, now)))
      .returning();
    if (row) return toTicket(row);
    const cur = await this.ticketBy(tenantId, { id });
    if (!cur) throw ticketNotFound();
    if (cur.status === "used" && cur.usedInvoiceId === invoiceId) return toTicket(cur);
    this.assertUsable(cur);
    throw ticketUsed();
  }

  async cancelTicket(tenantId: string, id: string): Promise<WeighTicketView> {
    const t = posWeighTickets;
    const [row] = await this.db
      .update(t)
      .set({ status: "cancelled" })
      .where(and(eq(t.tenantId, tenantId), eq(t.id, id), eq(t.status, "open")))
      .returning();
    if (row) return toTicket(row);
    const cur = await this.ticketBy(tenantId, { id });
    if (!cur) throw ticketNotFound();
    if (cur.status === "used") throw ticketUsed();
    return toTicket(cur);
  }

  /** The bill was cancelled: tickets used by it are open again. Returns how many. */
  async reopenForInvoice(tenantId: string, invoiceId: string): Promise<number> {
    const t = posWeighTickets;
    const res = await this.db
      .update(t)
      .set({ status: "open", usedInvoiceId: null, usedAt: null })
      .where(and(eq(t.tenantId, tenantId), eq(t.usedInvoiceId, invoiceId), eq(t.status, "used")))
      .returning({ id: t.id });
    return res.length;
  }

  /** Several tickets by id (tests, tools). */
  async ticketsByIds(tenantId: string, ids: string[]): Promise<WeighTicketView[]> {
    if (!ids.length) return [];
    return (await this.db.select().from(posWeighTickets).where(and(eq(posWeighTickets.tenantId, tenantId), inArray(posWeighTickets.id, ids)))).map(toTicket);
  }
}
