import { AppError, badRequest, newId, notFound } from "@srirealtime/core";
import type { Db, DbOrTx } from "@srirealtime/db";
import { and, asc, count, desc, eq, gt, ilike, inArray, lte, notInArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { membersCsv } from "./csv";
import {
  checkRedeem,
  consumeFifo,
  earnPoints,
  expiresAtFor,
  expiringSoon,
  LOYALTY_SETTINGS_SCHEMA,
  MAX_AMOUNT_PAISE,
  multiplierFor,
  nextTier,
  planAdjust,
  planReversal,
  quoteRedemption,
  REDEEM_MESSAGES,
  resolveLoyaltySettings,
  tierFor,
  toIndianE164,
  usableBalance,
  type LotTake,
  type LoyaltySettings,
  type RedemptionQuote,
  type Tier,
} from "./logic";
import { noopLogger, type FeatureGatePort, type LoggerPort, type LoyaltySettingsPort, type ShopperPhonePort } from "./ports";
import { LEDGER_TYPES, loyaltyLedger, loyaltyMembers, type LedgerType, type LoyaltyLedgerRow, type LoyaltyMemberRow, type RefType } from "./schema";

export interface LoyaltyDeps {
  db: Db;
  /** Settings namespace `loyalty`. Without it the defaults apply and `PUT /settings` is refused. */
  settings?: LoyaltySettingsPort;
  /** Needed for the shopper's `GET /me` and shopper quotes. */
  shoppers?: ShopperPhonePort;
  /** `expireDue` skips shops with `loyalty` off when given. */
  featureGate?: FeatureGatePort;
  log?: LoggerPort;
  /** Clock override for tests. */
  now?: () => Date;
}

// ------------------------------------------------------------------ DTOs

export interface ListResult<T> {
  items: T[];
  total: number;
}

export interface Member {
  id: string;
  /** "+919876543210". */
  memberKey: string;
  name: string | null;
  pointsBalance: number;
  /** Balance × point value, paise. */
  pointsValue: number;
  lifetimeSpend: number;
  tier: string;
  joinedAt: Date;
  lastActivityAt: Date | null;
}

export interface LedgerEntry {
  id: string;
  type: LedgerType;
  points: number;
  amountPaise: number;
  remaining: number;
  refType: RefType;
  refId: string;
  expiresAt: Date | null;
  note: string | null;
  createdAt: Date;
}

export interface MemberDetail {
  member: Member;
  ledger: ListResult<LedgerEntry>;
  nextTier: { tier: Tier; spendNeeded: number } | null;
  expiringSoon: { expiresAt: Date; points: number }[];
}

export interface EarnResult {
  /** false when this ref already earned (idempotent repeat) or was already reversed. */
  created: boolean;
  skipped?: "already_earned" | "reversed";
  entryId: string | null;
  points: number;
  balance: number;
  memberId: string;
  tier: string;
}

export interface RedeemResult {
  /** false when this ref already redeemed (idempotent repeat: same points and discount returned). */
  created: boolean;
  entryId: string;
  points: number;
  /** Paise to take off the bill/order. */
  discount: number;
  balance: number;
}

export interface ReverseResult {
  /** false when there was nothing to reverse, or it was already reversed (idempotent). */
  reversed: boolean;
  alreadyReversed?: boolean;
  entryId: string | null;
  /** Net balance change. */
  points: number;
  earnReversed: number;
  restored: number;
  /** Earned points already spent, so not taken back (balance kept at ≥ 0). */
  shortfall: number;
  balance: number | null;
}

export interface QuoteResult extends RedemptionQuote {
  member: Member | null;
  /** Points this amount would earn at the member's tier (entry tier for non-members). */
  earnPreview: number;
}

export interface ExpireResult {
  members: number;
  lots: number;
  points: number;
}

export interface MeResult {
  enrolled: boolean;
  member: Member | null;
  pointValuePaise: number;
  nextTier: { tier: Tier; spendNeeded: number } | null;
  expiringSoon: { expiresAt: Date; points: number }[];
  history: LedgerEntry[];
}

// ------------------------------------------------------------------ validation

const money = z.number().int("Amounts are whole paise").min(0).max(MAX_AMOUNT_PAISE);
const refId = z.string().trim().min(1).max(100);
const phone = z
  .string()
  .trim()
  .max(30)
  .transform((v, ctx) => {
    const key = toIndianE164(v);
    if (!key) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a 10-digit Indian mobile number" });
      return z.NEVER;
    }
    return key;
  });

export const earnInputSchema = z.object({
  memberKey: phone,
  name: z.string().trim().max(120).nullish(),
  /** Paise actually paid (after any points discount). */
  amount: money,
  refType: z.enum(["invoice", "order"]),
  refId,
});
export type EarnInput = z.input<typeof earnInputSchema>;

export const redeemInputSchema = z.object({
  memberKey: phone,
  points: z.number().int().min(1).max(100_000_000),
  refType: z.enum(["invoice", "order"]),
  refId,
  /** Bill/order amount (paise) before the points discount; enforces `maxRedeemPercent`. Strongly recommended. */
  orderAmount: money.nullish(),
});
export type RedeemInput = z.input<typeof redeemInputSchema>;

export const quoteInputSchema = z.object({
  memberKey: phone,
  amount: money,
});

export const adjustInputSchema = z.object({
  points: z
    .number()
    .int()
    .min(-10_000_000)
    .max(10_000_000)
    .refine((n) => n !== 0, "Enter the points to add or remove"),
  reason: z.string().trim().min(3, "Give a reason").max(300),
});
export type AdjustInput = z.input<typeof adjustInputSchema>;

export const memberListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  tier: z.string().trim().max(40).optional(),
  sort: z.enum(["recent", "points", "spend", "name", "joined"]).default("recent"),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type MemberListQuery = z.input<typeof memberListQuerySchema>;

export const ledgerQuerySchema = z.object({
  type: z.enum(LEDGER_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type LedgerQuery = z.input<typeof ledgerQuerySchema>;

export const settingsPatchSchema = LOYALTY_SETTINGS_SCHEMA.partial().strict();

// ------------------------------------------------------------------ helpers

/** 409 loyalty_redeem `{ reason, maxPoints }`: the redemption can't go through. */
export const redeemError = (reason: string, message: string, maxPoints = 0) =>
  new AppError(409, "loyalty_redeem", message, { reason, maxPoints });

const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;

const toMember = (r: LoyaltyMemberRow, s: Pick<LoyaltySettings, "pointValuePaise">): Member => ({
  id: r.id,
  memberKey: r.memberKey,
  name: r.name,
  pointsBalance: r.pointsBalance,
  pointsValue: r.pointsBalance * s.pointValuePaise,
  lifetimeSpend: r.lifetimeSpend,
  tier: r.tier,
  joinedAt: r.joinedAt,
  lastActivityAt: r.lastActivityAt,
});

const toEntry = (r: LoyaltyLedgerRow): LedgerEntry => ({
  id: r.id,
  type: r.type,
  points: r.points,
  amountPaise: r.amountPaise,
  remaining: r.remaining,
  refType: r.refType,
  refId: r.refId,
  expiresAt: r.expiresAt,
  note: r.note,
  createdAt: r.createdAt,
});

/** `SELECT … FOR UPDATE` on a member row: serialises every balance change of that member until the tx ends. */
export function lockMemberStatement(db: DbOrTx, tenantId: string, memberKey: string) {
  return db
    .select()
    .from(loyaltyMembers)
    .where(and(eq(loyaltyMembers.tenantId, tenantId), eq(loyaltyMembers.memberKey, memberKey)))
    .for("update");
}

export function lockMemberByIdStatement(db: DbOrTx, tenantId: string, memberId: string) {
  return db
    .select()
    .from(loyaltyMembers)
    .where(and(eq(loyaltyMembers.tenantId, tenantId), eq(loyaltyMembers.id, memberId)))
    .for("update");
}

/** The member's lots with unused points, locked (call with the member row already locked). */
export function openLotsStatement(db: DbOrTx, tenantId: string, memberId: string) {
  return db
    .select()
    .from(loyaltyLedger)
    .where(and(eq(loyaltyLedger.tenantId, tenantId), eq(loyaltyLedger.memberId, memberId), gt(loyaltyLedger.remaining, 0)))
    .for("update");
}

/** (tenant, member) pairs with due lots: what the expiry job works through. */
export function dueMembersStatement(db: DbOrTx, now: Date, skipTenants: readonly string[], limit: number) {
  const conds: (SQL | undefined)[] = [gt(loyaltyLedger.remaining, 0), lte(loyaltyLedger.expiresAt, now)];
  if (skipTenants.length) conds.push(notInArray(loyaltyLedger.tenantId, [...skipTenants]));
  return db
    .selectDistinct({ tenantId: loyaltyLedger.tenantId, memberId: loyaltyLedger.memberId })
    .from(loyaltyLedger)
    .where(and(...conds))
    .limit(limit);
}

/**
 * Loyalty points (docs/batch3.md §A5). Every balance change runs in one transaction holding the member row lock
 * (`SELECT … FOR UPDATE`), keeps `points_balance` equal to the sum of the member's open lots, and is idempotent per
 * (ref_type, ref_id, type) through the ledger's unique key.
 */
export class LoyaltyService {
  private readonly db: Db;
  private readonly log: LoggerPort;
  private readonly now: () => Date;

  constructor(private readonly deps: LoyaltyDeps) {
    this.db = deps.db;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
  }

  // ================================================================ settings

  async getSettings(tenantId: string): Promise<LoyaltySettings> {
    if (!this.deps.settings) return resolveLoyaltySettings(null);
    return resolveLoyaltySettings(await this.deps.settings.get(tenantId));
  }

  /** Validates a patch (the merged result must be valid as a whole) and stores it on the tenant layer. */
  async updateSettings(tenantId: string, patch: unknown): Promise<LoyaltySettings> {
    const port = this.deps.settings;
    if (!port?.set) throw badRequest("Loyalty settings can't be changed here");
    const p = settingsPatchSchema.parse(patch ?? {});
    const merged = LOYALTY_SETTINGS_SCHEMA.parse({ ...(await this.getSettings(tenantId)), ...p });
    await port.set(tenantId, p);
    return merged;
  }

  // ================================================================ lookups

  /** The member with this mobile number (any format), or null. */
  async findMember(tenantId: string, phoneNumber: string): Promise<Member | null> {
    const key = toIndianE164(phoneNumber);
    if (!key) return null;
    const [row] = await this.db
      .select()
      .from(loyaltyMembers)
      .where(and(eq(loyaltyMembers.tenantId, tenantId), eq(loyaltyMembers.memberKey, key)))
      .limit(1);
    return row ? toMember(row, await this.getSettings(tenantId)) : null;
  }

  private async lotsOf(db: DbOrTx, tenantId: string, memberId: string) {
    return db
      .select({ id: loyaltyLedger.id, remaining: loyaltyLedger.remaining, expiresAt: loyaltyLedger.expiresAt, createdAt: loyaltyLedger.createdAt })
      .from(loyaltyLedger)
      .where(and(eq(loyaltyLedger.tenantId, tenantId), eq(loyaltyLedger.memberId, memberId), gt(loyaltyLedger.remaining, 0)));
  }

  /** Builds the member list conditions (exported for tests). */
  listConditions(tenantId: string, p: z.output<typeof memberListQuerySchema>): SQL | undefined {
    const conds: (SQL | undefined)[] = [eq(loyaltyMembers.tenantId, tenantId)];
    if (p.tier) conds.push(eq(loyaltyMembers.tier, p.tier));
    if (p.q) {
      const digits = p.q.replace(/\D/g, "");
      const byName = ilike(loyaltyMembers.name, likePattern(p.q));
      // Phone search on the digits (keys are "+91…", so a typed "91…" still matches); a leading 0 is dropped.
      const local = digits.replace(/^0+/, "");
      conds.push(local.length >= 3 ? or(byName, ilike(loyaltyMembers.memberKey, likePattern(local))) : byName);
    }
    return and(...conds);
  }

  private static order(sort: z.output<typeof memberListQuerySchema>["sort"]) {
    switch (sort) {
      case "points":
        return [desc(loyaltyMembers.pointsBalance), asc(loyaltyMembers.id)];
      case "spend":
        return [desc(loyaltyMembers.lifetimeSpend), asc(loyaltyMembers.id)];
      case "name":
        return [asc(loyaltyMembers.name), asc(loyaltyMembers.id)];
      case "joined":
        return [desc(loyaltyMembers.joinedAt), asc(loyaltyMembers.id)];
      default:
        return [sql`${loyaltyMembers.lastActivityAt} desc nulls last`, desc(loyaltyMembers.joinedAt), asc(loyaltyMembers.id)];
    }
  }

  async list(tenantId: string, query: MemberListQuery = {}): Promise<ListResult<Member>> {
    const p = memberListQuerySchema.parse(query);
    const where = this.listConditions(tenantId, p);
    const [settings, rows, [counted]] = await Promise.all([
      this.getSettings(tenantId),
      this.db
        .select()
        .from(loyaltyMembers)
        .where(where)
        .orderBy(...LoyaltyService.order(p.sort))
        .limit(p.limit)
        .offset(p.offset),
      this.db.select({ total: count() }).from(loyaltyMembers).where(where),
    ]);
    return { items: rows.map((r) => toMember(r, settings)), total: counted?.total ?? 0 };
  }

  /** CSV of the members matching the filters (up to 10,000 rows). */
  async exportCsv(tenantId: string, query: MemberListQuery = {}): Promise<string> {
    const p = memberListQuerySchema.parse({ ...query, limit: 500, offset: 0 });
    const items: Member[] = [];
    for (let offset = 0; offset < 10_000; offset += 500) {
      const page = await this.list(tenantId, { ...p, offset });
      items.push(...page.items);
      if (page.items.length < 500) break;
    }
    return membersCsv(items);
  }

  async ledger(tenantId: string, memberId: string, query: LedgerQuery = {}): Promise<ListResult<LedgerEntry>> {
    const p = ledgerQuerySchema.parse(query);
    const conds: (SQL | undefined)[] = [eq(loyaltyLedger.tenantId, tenantId), eq(loyaltyLedger.memberId, memberId)];
    if (p.type) conds.push(eq(loyaltyLedger.type, p.type));
    const where = and(...conds);
    const [rows, [counted]] = await Promise.all([
      this.db.select().from(loyaltyLedger).where(where).orderBy(desc(loyaltyLedger.createdAt), desc(loyaltyLedger.id)).limit(p.limit).offset(p.offset),
      this.db.select({ total: count() }).from(loyaltyLedger).where(where),
    ]);
    return { items: rows.map(toEntry), total: counted?.total ?? 0 };
  }

  async get(tenantId: string, memberId: string, query: LedgerQuery = {}): Promise<MemberDetail> {
    z.string().uuid().parse(memberId);
    const [row] = await this.db
      .select()
      .from(loyaltyMembers)
      .where(and(eq(loyaltyMembers.tenantId, tenantId), eq(loyaltyMembers.id, memberId)))
      .limit(1);
    if (!row) throw notFound("Loyalty member");
    const [settings, ledger, lots] = await Promise.all([
      this.getSettings(tenantId),
      this.ledger(tenantId, memberId, query),
      this.lotsOf(this.db, tenantId, memberId),
    ]);
    return {
      member: toMember(row, settings),
      ledger,
      nextTier: nextTier(row.lifetimeSpend, settings.tiers),
      expiringSoon: expiringSoon(lots, this.now(), 60),
    };
  }

  /** The signed-in shopper's points (store `GET /me`). Not enrolled until their first purchase earns. */
  async me(tenantId: string, userId: string): Promise<MeResult> {
    const settings = await this.getSettings(tenantId);
    const key = await this.shopperKey(tenantId, userId);
    const empty: MeResult = {
      enrolled: false,
      member: null,
      pointValuePaise: settings.pointValuePaise,
      nextTier: nextTier(0, settings.tiers),
      expiringSoon: [],
      history: [],
    };
    if (!key) return empty;
    const [row] = await this.db
      .select()
      .from(loyaltyMembers)
      .where(and(eq(loyaltyMembers.tenantId, tenantId), eq(loyaltyMembers.memberKey, key)))
      .limit(1);
    if (!row) return empty;
    const now = this.now();
    const [history, lots] = await Promise.all([this.ledger(tenantId, row.id, { limit: 30 }), this.lotsOf(this.db, tenantId, row.id)]);
    // Points past expiry but not yet written off by the job are not shown as usable.
    const usable = Math.min(row.pointsBalance, usableBalance(lots, now));
    return {
      enrolled: true,
      member: toMember({ ...row, pointsBalance: usable }, settings),
      pointValuePaise: settings.pointValuePaise,
      nextTier: nextTier(row.lifetimeSpend, settings.tiers),
      expiringSoon: expiringSoon(lots, now, 60),
      history: history.items,
    };
  }

  /** The shopper's normalised mobile, or null (no port, no phone, or not an Indian mobile). */
  async shopperKey(tenantId: string, userId: string): Promise<string | null> {
    if (!this.deps.shoppers) return null;
    return toIndianE164(await this.deps.shoppers.phone(tenantId, userId));
  }

  // ================================================================ quote

  /**
   * What the member could redeem on a bill/order of `amount` paise, plus what it would earn. Read-only; never throws
   * for a non-member (zero balance, reason `no_points`).
   */
  async quote(tenantId: string, memberKey: string, amount: number): Promise<QuoteResult> {
    const b = quoteInputSchema.parse({ memberKey, amount });
    const settings = await this.getSettings(tenantId);
    const [row] = await this.db
      .select()
      .from(loyaltyMembers)
      .where(and(eq(loyaltyMembers.tenantId, tenantId), eq(loyaltyMembers.memberKey, b.memberKey)))
      .limit(1);
    const balance = row ? Math.min(row.pointsBalance, usableBalance(await this.lotsOf(this.db, tenantId, row.id), this.now())) : 0;
    const q = quoteRedemption({ balance, orderAmount: b.amount, settings });
    const multiplier = row ? multiplierFor(row.tier, row.lifetimeSpend, settings.tiers) : tierFor(0, settings.tiers).multiplier;
    return {
      ...q,
      member: row ? toMember({ ...row, pointsBalance: balance }, settings) : null,
      earnPreview: earnPoints(b.amount, settings.earnPer100, multiplier),
    };
  }

  // ================================================================ balance changes

  /** Writes off the member's due lots (inside a tx holding the member lock). Returns the points expired. */
  private async expireMemberTx(tx: DbOrTx, member: LoyaltyMemberRow, now: Date): Promise<{ lots: number; points: number }> {
    const due = await tx
      .select()
      .from(loyaltyLedger)
      .where(
        and(
          eq(loyaltyLedger.tenantId, member.tenantId),
          eq(loyaltyLedger.memberId, member.id),
          gt(loyaltyLedger.remaining, 0),
          lte(loyaltyLedger.expiresAt, now),
        ),
      )
      .for("update");
    let points = 0;
    for (const lot of due) {
      await tx
        .insert(loyaltyLedger)
        .values({
          tenantId: member.tenantId,
          memberId: member.id,
          type: "expire",
          points: -lot.remaining,
          refType: "lot",
          refId: lot.id,
          createdAt: now,
        })
        .onConflictDoNothing();
      await tx.update(loyaltyLedger).set({ remaining: 0 }).where(eq(loyaltyLedger.id, lot.id));
      points += lot.remaining;
    }
    if (points > 0) {
      await tx
        .update(loyaltyMembers)
        .set({ pointsBalance: sql`greatest(${loyaltyMembers.pointsBalance} - ${points}, 0)`, updatedAt: now })
        .where(eq(loyaltyMembers.id, member.id));
      member.pointsBalance = Math.max(0, member.pointsBalance - points);
    }
    return { lots: due.length, points };
  }

  private async applyTakes(tx: DbOrTx, takes: readonly LotTake[]) {
    for (const t of takes) {
      await tx
        .update(loyaltyLedger)
        .set({ remaining: sql`${loyaltyLedger.remaining} - ${t.points}` })
        .where(eq(loyaltyLedger.id, t.id));
    }
  }

  private async refEntries(db: DbOrTx, tenantId: string, refType: string, ref: string) {
    return db
      .select()
      .from(loyaltyLedger)
      .where(and(eq(loyaltyLedger.tenantId, tenantId), eq(loyaltyLedger.refType, refType as RefType), eq(loyaltyLedger.refId, ref)));
  }

  /**
   * Points for a paid bill / delivered (or paid) order. Creates the member on first purchase. The multiplier is the
   * member's tier *before* this purchase; lifetime spend and tier update after. Idempotent per (refType, refId): a
   * repeat returns `created: false`, and a ref that was already reversed (cancelled first) earns nothing.
   */
  async earn(tenantId: string, input: EarnInput): Promise<EarnResult> {
    const b = earnInputSchema.parse(input);
    const settings = await this.getSettings(tenantId);
    const now = this.now();
    return this.db.transaction(async (tx) => {
      await tx
        .insert(loyaltyMembers)
        .values({ tenantId, memberKey: b.memberKey, name: b.name || null, tier: tierFor(0, settings.tiers).name, joinedAt: now })
        .onConflictDoNothing();
      const [member] = await lockMemberStatement(tx, tenantId, b.memberKey);
      if (!member) throw new AppError(500, "loyalty_member_missing", "Could not create the loyalty member");
      const existing = await this.refEntries(tx, tenantId, b.refType, b.refId);
      const done = existing.find((e) => e.type === "earn");
      const reversed = existing.find((e) => e.type === "reverse");
      if (done || reversed) {
        return {
          created: false,
          skipped: done ? "already_earned" : "reversed",
          entryId: done?.id ?? null,
          points: done?.points ?? 0,
          balance: member.pointsBalance,
          memberId: member.id,
          tier: member.tier,
        } satisfies EarnResult;
      }
      const multiplier = multiplierFor(member.tier, member.lifetimeSpend, settings.tiers);
      const points = earnPoints(b.amount, settings.earnPer100, multiplier);
      const [entry] = await tx
        .insert(loyaltyLedger)
        .values({
          tenantId,
          memberId: member.id,
          type: "earn",
          points,
          amountPaise: b.amount,
          remaining: points,
          refType: b.refType,
          refId: b.refId,
          expiresAt: points > 0 ? expiresAtFor(now, settings.expiryMonths) : null,
          createdAt: now,
        })
        .onConflictDoNothing()
        .returning();
      if (!entry) {
        // Same ref earned concurrently for another member (different phone): the first one wins.
        const [other] = await this.refEntries(tx, tenantId, b.refType, b.refId);
        return {
          created: false,
          skipped: "already_earned",
          entryId: other?.id ?? null,
          points: other?.points ?? 0,
          balance: member.pointsBalance,
          memberId: member.id,
          tier: member.tier,
        } satisfies EarnResult;
      }
      const spend = member.lifetimeSpend + b.amount;
      const tier = tierFor(spend, settings.tiers).name;
      await tx
        .update(loyaltyMembers)
        .set({
          pointsBalance: sql`${loyaltyMembers.pointsBalance} + ${points}`,
          lifetimeSpend: spend,
          tier,
          lastActivityAt: now,
          updatedAt: now,
          ...(b.name && !member.name ? { name: b.name } : {}),
        })
        .where(eq(loyaltyMembers.id, member.id));
      if (tier !== member.tier) this.log.info({ tenantId, memberId: member.id, from: member.tier, to: tier }, "loyalty tier changed");
      return {
        created: true,
        entryId: entry.id,
        points,
        balance: member.pointsBalance + points,
        memberId: member.id,
        tier,
      } satisfies EarnResult;
    });
  }

  /**
   * Uses points on a bill/order and returns the discount (paise). Atomic: the member row is locked, due lots are
   * written off first, then the balance, minimum and percent cap are checked and the points taken FIFO. Idempotent
   * per (refType, refId). Throws 409 `loyalty_redeem` `{ reason, maxPoints }`.
   */
  async redeem(tenantId: string, input: RedeemInput): Promise<RedeemResult> {
    const b = redeemInputSchema.parse(input);
    const settings = await this.getSettings(tenantId);
    const now = this.now();
    return this.db.transaction(async (tx) => {
      const [member] = await lockMemberStatement(tx, tenantId, b.memberKey);
      if (!member) throw redeemError("no_points", REDEEM_MESSAGES.no_points);
      const existing = await this.refEntries(tx, tenantId, b.refType, b.refId);
      const done = existing.find((e) => e.type === "redeem");
      if (done) {
        return { created: false, entryId: done.id, points: -done.points, discount: done.amountPaise, balance: member.pointsBalance };
      }
      if (existing.some((e) => e.type === "reverse")) throw redeemError("reversed", "This bill/order was already cancelled");
      await this.expireMemberTx(tx, member, now);
      const lots = await openLotsStatement(tx, tenantId, member.id);
      const balance = Math.min(member.pointsBalance, usableBalance(lots, now));
      const check = checkRedeem({ points: b.points, balance, orderAmount: b.orderAmount ?? null, settings });
      if (!check.ok) throw redeemError(check.reason, check.message, check.maxPoints);
      const { takes, shortfall } = consumeFifo(lots, check.points, now);
      if (shortfall > 0) throw redeemError("below_min", REDEEM_MESSAGES.below_min, balance);
      await this.applyTakes(tx, takes);
      const [entry] = await tx
        .insert(loyaltyLedger)
        .values({
          tenantId,
          memberId: member.id,
          type: "redeem",
          points: -check.points,
          amountPaise: check.discount,
          refType: b.refType,
          refId: b.refId,
          createdAt: now,
        })
        .returning();
      await tx
        .update(loyaltyMembers)
        .set({ pointsBalance: sql`${loyaltyMembers.pointsBalance} - ${check.points}`, lastActivityAt: now, updatedAt: now })
        .where(eq(loyaltyMembers.id, member.id));
      this.log.info({ tenantId, memberId: member.id, points: check.points, refType: b.refType, refId: b.refId }, "loyalty points redeemed");
      return { created: true, entryId: entry!.id, points: check.points, discount: check.discount, balance: member.pointsBalance - check.points };
    });
  }

  /**
   * Undoes a bill/order (cancelled, refunded, returned): gives back the points it redeemed and takes back the points
   * it earned, in one `reverse` entry (see `planReversal` for the rule — the balance never goes negative; what can't be
   * taken back is logged and noted). Idempotent: a second call returns `alreadyReversed`. Once reversed, a later earn
   * for the ref is refused. A ref with no loyalty entries yet has nothing to reverse (no marker is written), so the
   * kit must not fire the earn hook for a bill/order that is already cancelled.
   */
  async reverse(tenantId: string, refType: "invoice" | "order", refIdValue: string): Promise<ReverseResult> {
    const rt = z.enum(["invoice", "order"]).parse(refType);
    const rid = refId.parse(refIdValue);
    const settings = await this.getSettings(tenantId);
    const now = this.now();
    const nothing = (alreadyReversed: boolean, entry?: LoyaltyLedgerRow, balance: number | null = null): ReverseResult => ({
      reversed: false,
      ...(alreadyReversed ? { alreadyReversed } : {}),
      entryId: entry?.id ?? null,
      points: 0,
      earnReversed: 0,
      restored: 0,
      shortfall: 0,
      balance,
    });
    const first = await this.refEntries(this.db, tenantId, rt, rid);
    const anchor = first.find((e) => e.type === "earn") ?? first.find((e) => e.type === "redeem");
    if (!anchor) return nothing(first.some((e) => e.type === "reverse"), first.find((e) => e.type === "reverse"));
    return this.db.transaction(async (tx) => {
      const [member] = await lockMemberByIdStatement(tx, tenantId, anchor.memberId);
      if (!member) return nothing(false);
      const entries = await this.refEntries(tx, tenantId, rt, rid);
      const prior = entries.find((e) => e.type === "reverse");
      if (prior) return nothing(true, prior, member.pointsBalance);
      const earn = entries.find((e) => e.type === "earn" && e.memberId === member.id) ?? null;
      const redeem = entries.find((e) => e.type === "redeem" && e.memberId === member.id) ?? null;
      const foreign = entries.filter((e) => (e.type === "earn" || e.type === "redeem") && e.memberId !== member.id);
      if (foreign.length) {
        this.log.error({ tenantId, refType: rt, refId: rid, entries: foreign.map((e) => e.id) }, "loyalty reverse: ref used by two members; only the first is reversed");
      }
      await this.expireMemberTx(tx, member, now);
      const lots = await openLotsStatement(tx, tenantId, member.id);
      const plan = planReversal({
        earn: earn ? { id: earn.id, points: earn.points, amountPaise: earn.amountPaise } : null,
        redeem: redeem ? { points: -redeem.points } : null,
        lots,
      });
      await this.applyTakes(tx, plan.takes);
      const note =
        plan.shortfall > 0
          ? `Took back ${plan.earnReversed} of ${earn?.points ?? 0} earned points; ${plan.shortfall} were already used`
          : null;
      if (plan.shortfall > 0) {
        this.log.warn({ tenantId, memberId: member.id, refType: rt, refId: rid, shortfall: plan.shortfall }, "loyalty reverse clamped: earned points already used");
      }
      const [entry] = await tx
        .insert(loyaltyLedger)
        .values({
          tenantId,
          memberId: member.id,
          type: "reverse",
          points: plan.points,
          amountPaise: earn?.amountPaise ?? 0,
          remaining: plan.restoredRemaining,
          // Given-back points expire as if earned when they were redeemed (never later than a fresh earn then).
          expiresAt: plan.restoredRemaining > 0 && redeem ? expiresAtFor(redeem.createdAt, settings.expiryMonths) : null,
          refType: rt,
          refId: rid,
          note,
          createdAt: now,
        })
        .onConflictDoNothing()
        .returning();
      if (!entry) throw new AppError(409, "conflict", "This bill/order is being reversed already, try again");
      const spend = Math.max(0, member.lifetimeSpend + plan.spendDelta);
      await tx
        .update(loyaltyMembers)
        .set({
          pointsBalance: sql`greatest(${loyaltyMembers.pointsBalance} + ${plan.points}, 0)`,
          lifetimeSpend: spend,
          tier: tierFor(spend, settings.tiers).name,
          lastActivityAt: now,
          updatedAt: now,
        })
        .where(eq(loyaltyMembers.id, member.id));
      return {
        reversed: true,
        entryId: entry.id,
        points: plan.points,
        earnReversed: plan.earnReversed,
        restored: plan.restored,
        shortfall: plan.shortfall,
        balance: Math.max(0, member.pointsBalance + plan.points),
      };
    });
  }

  /**
   * Staff adjustment with a reason. Added points are a new lot (expiry as a fresh earn); removed points come off
   * FIFO and can't exceed the usable balance (409).
   */
  async adjust(tenantId: string, memberId: string, input: AdjustInput, userId: string | null): Promise<{ member: Member; entry: LedgerEntry }> {
    z.string().uuid().parse(memberId);
    const b = adjustInputSchema.parse(input);
    const settings = await this.getSettings(tenantId);
    const now = this.now();
    return this.db.transaction(async (tx) => {
      const [member] = await lockMemberByIdStatement(tx, tenantId, memberId);
      if (!member) throw notFound("Loyalty member");
      await this.expireMemberTx(tx, member, now);
      const lots = await openLotsStatement(tx, tenantId, member.id);
      const plan = planAdjust(b.points, lots, now);
      if (!plan) {
        throw new AppError(409, "loyalty_insufficient", `Only ${usableBalance(lots, now)} points are available to remove`, {
          available: usableBalance(lots, now),
        });
      }
      await this.applyTakes(tx, plan.takes);
      const [entry] = await tx
        .insert(loyaltyLedger)
        .values({
          tenantId,
          memberId: member.id,
          type: "adjust",
          points: b.points,
          remaining: b.points > 0 ? b.points : 0,
          expiresAt: b.points > 0 ? expiresAtFor(now, settings.expiryMonths) : null,
          refType: "manual",
          refId: newId(),
          note: b.reason,
          createdBy: userId && z.string().uuid().safeParse(userId).success ? userId : null,
          createdAt: now,
        })
        .returning();
      const [updated] = await tx
        .update(loyaltyMembers)
        .set({ pointsBalance: sql`${loyaltyMembers.pointsBalance} + ${b.points}`, lastActivityAt: now, updatedAt: now })
        .where(eq(loyaltyMembers.id, member.id))
        .returning();
      this.log.info({ tenantId, memberId, points: b.points, userId }, "loyalty points adjusted");
      return { member: toMember(updated!, settings), entry: toEntry(entry!) };
    });
  }

  /**
   * Expiry job (run daily, e.g. 00:05 IST; lots expire at IST month ends so the 1st of the month does the work).
   * Writes one `expire` entry per due lot (idempotent: ref = the lot). Shops with `loyalty` off are skipped when a
   * feature gate is given.
   */
  async expireDue(now: Date = this.now(), opts: { batch?: number; maxMembers?: number } = {}): Promise<ExpireResult> {
    const batch = opts.batch ?? 200;
    const maxMembers = opts.maxMembers ?? 50_000;
    const skip: string[] = [];
    const checked = new Map<string, boolean>();
    const result: ExpireResult = { members: 0, lots: 0, points: 0 };
    while (result.members < maxMembers) {
      const pairs = await dueMembersStatement(this.db, now, skip, batch);
      if (pairs.length === 0) break;
      let progressed = false;
      for (const { tenantId, memberId } of pairs) {
        if (!checked.has(tenantId)) {
          const on = this.deps.featureGate ? await this.deps.featureGate.isEnabled(tenantId, "loyalty").catch(() => false) : true;
          checked.set(tenantId, on);
          if (!on) skip.push(tenantId);
        }
        if (!checked.get(tenantId)) continue;
        try {
          const r = await this.db.transaction(async (tx) => {
            const [member] = await lockMemberByIdStatement(tx, tenantId, memberId);
            return member ? this.expireMemberTx(tx, member, now) : { lots: 0, points: 0 };
          });
          result.members++;
          result.lots += r.lots;
          result.points += r.points;
          progressed = true;
        } catch (err) {
          this.log.error({ err, tenantId, memberId }, "loyalty expiry failed for member");
          skip.push(tenantId);
        }
      }
      if (!progressed && pairs.every((p) => skip.includes(p.tenantId))) continue;
      if (!progressed) break;
    }
    if (result.points > 0) this.log.info({ ...result }, "loyalty points expired");
    return result;
  }

  /** Ledger entries of one ref (for the integration: show "points earned / used" on a bill or order). */
  async forRef(tenantId: string, refType: "invoice" | "order", ref: string): Promise<LedgerEntry[]> {
    const rows = await this.db
      .select()
      .from(loyaltyLedger)
      .where(and(eq(loyaltyLedger.tenantId, tenantId), eq(loyaltyLedger.refType, refType), inArray(loyaltyLedger.type, ["earn", "redeem", "reverse"]), eq(loyaltyLedger.refId, ref)));
    return rows.map(toEntry);
  }
}
