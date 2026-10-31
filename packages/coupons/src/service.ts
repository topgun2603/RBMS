import {
  AppError,
  conflict,
  defineSort,
  facetCounts,
  listFilter,
  listQuerySchema as baseListQuerySchema,
  notFound,
  runList,
  searchAny,
  type ListPage,
} from "@rbms/core";
import type { Db, DbOrTx } from "@rbms/db";
import { and, count, desc, eq, inArray, isNotNull, not, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  CODE_RE,
  evaluateCoupon,
  istDayEnd,
  istDayStart,
  normalizeCode,
  REASON_MESSAGES,
  type CouponEvaluation,
  type CouponReason,
  type CouponRule,
  type EvaluationContext,
} from "./logic";
import type { CartPricing } from "./offers";
import { OffersService, type CollectionMembershipPort, type PriceCartInput } from "./offers-service";
import {
  COUPON_APPLIES_TO,
  COUPON_CHANNELS,
  COUPON_TYPES,
  couponRedemptions,
  coupons,
  REDEMPTION_REF_TYPES,
  REDEMPTION_STATUSES,
  type CouponRedemptionRow,
  type CouponRow,
  type RedemptionRefType,
} from "./schema";

/** Money columns are Postgres `integer` (paise). */
export const MAX_PAISE = 2_000_000_000;

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}
export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };

export interface CouponsDeps {
  db: Db;
  log?: LoggerPort;
  /** Catalogue collections, for offers scoped to collections. Without it those offers match nothing. */
  collections?: CollectionMembershipPort;
  /** Clock override for tests. */
  now?: () => Date;
}

// ------------------------------------------------------------------ DTOs

export interface ListResult<T> {
  items: T[];
  total: number;
}

export interface Coupon {
  id: string;
  code: string;
  description: string | null;
  type: CouponRow["type"];
  value: number;
  maxDiscount: number | null;
  minOrder: number;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  firstOrderOnly: boolean;
  appliesTo: CouponRow["appliesTo"];
  targetIds: string[];
  channels: string[];
  active: boolean;
  /** Active redemptions. */
  usedCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Redemption {
  id: string;
  couponId: string;
  refType: RedemptionRefType;
  refId: string;
  customerKey: string | null;
  amount: number;
  status: CouponRedemptionRow["status"];
  createdAt: Date;
}

export interface RedeemResult {
  redemptionId: string;
  couponId: string;
  /** false when this ref had already redeemed the coupon (idempotent repeat). */
  created: boolean;
}

// ------------------------------------------------------------------ validation

const opt = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), s.nullable().optional());

const money = z.number().int("Amounts are whole paise").min(0).max(MAX_PAISE);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" (an IST day: start or end of it) or an ISO date-time, or a Date. */
const when = (edge: "start" | "end") =>
  z.union([z.date(), z.string().trim()]).transform((v, ctx) => {
    if (v instanceof Date) return v;
    const d = DATE_RE.test(v) ? (edge === "start" ? istDayStart(v) : istDayEnd(v)) : new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Use a YYYY-MM-DD date or an ISO date-time" });
      return z.NEVER;
    }
    return d;
  });

const codeSchema = z
  .string()
  .transform(normalizeCode)
  .refine((c) => CODE_RE.test(c), "Codes are 3–32 letters, digits, '-' or '_'");

export const couponInputSchema = z
  .object({
    code: codeSchema,
    description: opt(z.string().trim().max(500)),
    type: z.enum(COUPON_TYPES),
    value: z.number().int().min(0).max(MAX_PAISE).default(0),
    maxDiscount: opt(money.min(1)),
    minOrder: money.default(0),
    startsAt: opt(when("start")),
    endsAt: opt(when("end")),
    usageLimit: opt(z.number().int().min(1).max(10_000_000)),
    perCustomerLimit: opt(z.number().int().min(1).max(10_000)),
    firstOrderOnly: z.boolean().default(false),
    appliesTo: z.enum(COUPON_APPLIES_TO).default("all"),
    targetIds: z.array(z.string().uuid()).max(500).default([]),
    channels: z.array(z.enum(COUPON_CHANNELS)).min(1, "Pick at least one channel").max(COUPON_CHANNELS.length).default(["store"]),
    active: z.boolean().default(true),
  })
  .superRefine((c, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (c.type === "percent" && (c.value < 1 || c.value > 100)) issue("value", "Percent must be between 1 and 100");
    if (c.type === "flat" && c.value < 1) issue("value", "Enter the discount amount in paise");
    if (c.appliesTo !== "all" && c.targetIds.length === 0) issue("targetIds", "Pick the categories or products this coupon applies to");
    if (c.startsAt && c.endsAt && c.endsAt.getTime() <= c.startsAt.getTime()) issue("endsAt", "The end must be after the start");
  })
  .transform((c) => ({
    ...c,
    value: c.type === "free_shipping" ? 0 : c.value,
    targetIds: c.appliesTo === "all" ? [] : [...new Set(c.targetIds)],
    channels: [...new Set(c.channels)],
    description: c.description ?? null,
    maxDiscount: c.maxDiscount ?? null,
    startsAt: c.startsAt ?? null,
    endsAt: c.endsAt ?? null,
    usageLimit: c.usageLimit ?? null,
    perCustomerLimit: c.perCustomerLimit ?? null,
  }));
export type CouponInput = z.input<typeof couponInputSchema>;
type ParsedCoupon = z.output<typeof couponInputSchema>;

/**
 * Where a coupon stands now, in this order of precedence: switched off, ended, not started yet, fully used, live.
 * Mirrors `couponState` in orders-ui (lib/coupons.ts).
 */
export const COUPON_STATUSES = ["active", "scheduled", "expired", "used_up", "off"] as const;
export type CouponStatus = (typeof COUPON_STATUSES)[number];

/** GET /v1/coupons: paged (50 by default, up to 200 for the pickers), sorted, filtered by status/type/on-off and `q`. */
export const listQuerySchema = baseListQuerySchema({ defaultLimit: 50, maxLimit: 200 }).extend({
  /** Derived status (multi): `status=active,scheduled`. */
  status: listFilter.oneOf(COUPON_STATUSES),
  type: listFilter.oneOf(COUPON_TYPES),
  /** The on/off switch (older callers). */
  active: z.enum(["true", "false"]).optional(),
});
export type CouponListQuery = z.input<typeof listQuerySchema>;
export type CouponListParams = z.output<typeof listQuerySchema>;

export const redemptionsQuerySchema = z.object({
  status: z.enum(REDEMPTION_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type RedemptionsQuery = z.input<typeof redemptionsQuerySchema>;

const evalLine = z.object({
  productId: opt(z.string().uuid()),
  categoryId: opt(z.string().uuid()),
  amount: money,
});

export const evaluationContextSchema = z.object({
  channel: z.string().trim().min(1).max(32),
  subtotal: money,
  shipping: money.optional(),
  lines: z.array(evalLine).max(500).optional(),
  customerKey: opt(z.string().trim().max(200)),
  isFirstOrder: z.boolean().optional(),
});

/** Body of the public checkout preview (channel is always "store"). */
export const publicValidateSchema = z.object({
  code: z.string().trim().min(1).max(64),
  subtotal: money,
  shipping: money.optional(),
  lines: z.array(evalLine).max(500).optional(),
  customerKey: opt(z.string().trim().max(200)),
});
export type PublicValidateInput = z.input<typeof publicValidateSchema>;

const refSchema = z.object({ refType: z.enum(REDEMPTION_REF_TYPES), refId: z.string().uuid() });


/** 409 coupon_invalid `{ reason }` — what redeem throws when the coupon can't be used any more. */
export const couponError = (reason: CouponReason) => new AppError(409, "coupon_invalid", REASON_MESSAGES[reason], { reason });

function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && i < 4; e = (e as { cause?: unknown }).cause, i++) {
    if ((e as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

const toCoupon = (r: CouponRow, usedCount = 0): Coupon => ({
  id: r.id,
  code: r.code,
  description: r.description,
  type: r.type,
  value: r.value,
  maxDiscount: r.maxDiscount,
  minOrder: r.minOrder,
  startsAt: r.startsAt,
  endsAt: r.endsAt,
  usageLimit: r.usageLimit,
  perCustomerLimit: r.perCustomerLimit,
  firstOrderOnly: r.firstOrderOnly,
  appliesTo: r.appliesTo,
  targetIds: r.targetIds,
  channels: r.channels,
  active: r.active,
  usedCount,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const toRedemption = (r: CouponRedemptionRow): Redemption => ({
  id: r.id,
  couponId: r.couponId,
  refType: r.refType,
  refId: r.refId,
  customerKey: r.customerKey,
  amount: r.amount,
  status: r.status,
  createdAt: r.createdAt,
});

const asRule = (r: CouponRow): CouponRule => r;

/** Active redemptions per coupon (correlated count used in lists). */
const usedCountSql = sql<number>`(select count(*)::int from ${couponRedemptions} where ${couponRedemptions.couponId} = ${coupons.id} and ${couponRedemptions.status} = 'active')`;

/** `now` bound as an ISO string (postgres-js mis-serialises raw Dates inside sql``). */
const nowSql = (now: Date) => sql`${now.toISOString()}::timestamptz`;

/** The pieces of the derived status, as SQL conditions (all assume nothing about `active`). */
function statusParts(now: Date) {
  const n = nowSql(now);
  const ended = and(isNotNull(coupons.endsAt), sql`${coupons.endsAt} < ${n}`)!;
  const notStarted = and(isNotNull(coupons.startsAt), sql`${coupons.startsAt} > ${n}`)!;
  const usedUp = and(isNotNull(coupons.usageLimit), sql`${usedCountSql} >= ${coupons.usageLimit}`)!;
  return { n, ended, notStarted, usedUp };
}

/** WHERE condition for one derived status (same precedence as `couponStatusSql`). */
export function couponStatusCondition(status: CouponStatus, now: Date): SQL {
  const { ended, notStarted, usedUp } = statusParts(now);
  const on = eq(coupons.active, true);
  switch (status) {
    case "off":
      return eq(coupons.active, false);
    case "expired":
      return and(on, ended)!;
    case "scheduled":
      return and(on, not(ended), notStarted)!;
    case "used_up":
      return and(on, not(ended), not(notStarted), usedUp)!;
    case "active":
      return and(on, not(ended), not(notStarted), not(usedUp))!;
  }
}

/** The derived status as one CASE expression (facet counts). */
export function couponStatusSql(now: Date): SQL<CouponStatus> {
  const { ended, notStarted, usedUp } = statusParts(now);
  return sql<CouponStatus>`case when ${eq(coupons.active, false)} then 'off' when ${ended} then 'expired' when ${notStarted} then 'scheduled' when ${usedUp} then 'used_up' else 'active' end`;
}

export const COUPON_SORT = defineSort(
  {
    code: coupons.code,
    uses: usedCountSql,
    ends: coupons.endsAt,
    created: coupons.createdAt,
  },
  { default: "-created", tieBreaker: coupons.id },
);

/** WHERE of the staff list; without `status` for the status facet counts. */
export function couponListConditions(tenantId: string, p: CouponListParams, now: Date, withStatus = true): SQL | undefined {
  return and(
    eq(coupons.tenantId, tenantId),
    withStatus && p.status?.length ? or(...p.status.map((s) => couponStatusCondition(s, now))) : undefined,
    p.type?.length ? inArray(coupons.type, p.type) : undefined,
    p.active ? eq(coupons.active, p.active === "true") : undefined,
    searchAny(p.q, [coupons.code, coupons.description]),
  );
}

/** `SELECT … FOR UPDATE` on the coupon row: serialises concurrent redemptions of one coupon until the tx ends. */
export function lockCouponStatement(db: DbOrTx, tenantId: string, code: string) {
  return db
    .select()
    .from(coupons)
    .where(and(eq(coupons.tenantId, tenantId), eq(coupons.code, code)))
    .for("update");
}

export class CouponsService {
  private readonly db: Db;
  private readonly log: LoggerPort;
  private readonly now: () => Date;
  /** Automatic offers and bundles (same tables module). */
  readonly offers: OffersService;

  constructor(deps: CouponsDeps) {
    this.db = deps.db;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
    this.offers = new OffersService({ db: deps.db, collections: deps.collections, now: this.now });
  }

  /** Cart / order pricing with automatic offers and the coupon (orders' and the storefront's `priceCart`). */
  priceCart(tenantId: string, input: PriceCartInput): Promise<CartPricing> {
    return this.offers.priceCart(tenantId, input);
  }

  /** Records the automatic offers an order used (409 offer_invalid when one ran out). */
  redeemOffers(tenantId: string, ref: { refType: RedemptionRefType; refId: string }, customerKey: string | null | undefined, used: { offerId: string; amount: number }[]) {
    return this.offers.redeem(tenantId, ref, customerKey, used);
  }

  // ================================================================ CRUD

  async list(tenantId: string, query: CouponListQuery = {}): Promise<ListPage<Coupon>> {
    const p = listQuerySchema.parse(query);
    const order = COUPON_SORT.orderBy(p.sort);
    const now = this.now();
    const where = couponListConditions(tenantId, p, now);
    const status = couponStatusSql(now);
    const [page, byStatus] = await Promise.all([
      runList(p, {
        rows: () =>
          this.db
            .select({ row: coupons, used: usedCountSql })
            .from(coupons)
            .where(where)
            .orderBy(...order)
            .limit(p.limit)
            .offset(p.offset),
        count: () => this.db.select({ total: count() }).from(coupons).where(where),
        map: (r) => toCoupon(r.row, Number(r.used ?? 0)),
      }),
      this.db.select({ key: status, n: count() }).from(coupons).where(couponListConditions(tenantId, p, now, false))
        // By position: the CASE binds `now` as parameters, so repeating it in GROUP BY would not match the SELECT.
        .groupBy(sql`1`),
    ]);
    return { ...page, facets: { status: facetCounts(byStatus) } };
  }

  private async row(db: DbOrTx, tenantId: string, id: string): Promise<CouponRow> {
    const [row] = await db
      .select()
      .from(coupons)
      .where(and(eq(coupons.tenantId, tenantId), eq(coupons.id, id)))
      .limit(1);
    if (!row) throw notFound("Coupon");
    return row;
  }

  private async usedCount(tenantId: string, couponId: string): Promise<number> {
    const [r] = await this.db
      .select({ n: count() })
      .from(couponRedemptions)
      .where(
        and(eq(couponRedemptions.tenantId, tenantId), eq(couponRedemptions.couponId, couponId), eq(couponRedemptions.status, "active")),
      );
    return r?.n ?? 0;
  }

  async get(tenantId: string, id: string): Promise<Coupon> {
    z.string().uuid().parse(id);
    const row = await this.row(this.db, tenantId, id);
    return toCoupon(row, await this.usedCount(tenantId, id));
  }

  async getByCode(tenantId: string, code: string): Promise<CouponRow | null> {
    const c = normalizeCode(code);
    if (!CODE_RE.test(c)) return null;
    const [row] = await this.db
      .select()
      .from(coupons)
      .where(and(eq(coupons.tenantId, tenantId), eq(coupons.code, c)))
      .limit(1);
    return row ?? null;
  }

  private async assertCodeFree(tenantId: string, code: string, exceptId?: string) {
    const existing = await this.getByCode(tenantId, code);
    if (existing && existing.id !== exceptId) throw conflict(`A coupon with code ${code} already exists`);
  }

  async create(tenantId: string, input: CouponInput): Promise<Coupon> {
    const b = couponInputSchema.parse(input);
    await this.assertCodeFree(tenantId, b.code);
    try {
      const [row] = await this.db
        .insert(coupons)
        .values({ tenantId, ...b })
        .returning();
      this.log.info({ tenantId, couponId: row!.id, code: row!.code }, "coupon created");
      return toCoupon(row!, 0);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict(`A coupon with code ${b.code} already exists`);
      throw err;
    }
  }

  /** PATCH: the stored coupon merged with `input` must still be a valid coupon. */
  async update(tenantId: string, id: string, input: Partial<CouponInput>): Promise<Coupon> {
    z.string().uuid().parse(id);
    const existing = await this.row(this.db, tenantId, id);
    const merged: Record<string, unknown> = { ...existing, ...stripUndefined(input as Record<string, unknown>) };
    const b: ParsedCoupon = couponInputSchema.parse(merged);
    if (b.code !== existing.code) await this.assertCodeFree(tenantId, b.code, id);
    try {
      const [row] = await this.db
        .update(coupons)
        .set({ ...b, updatedAt: this.now() })
        .where(and(eq(coupons.tenantId, tenantId), eq(coupons.id, id)))
        .returning();
      if (!row) throw notFound("Coupon");
      return toCoupon(row, await this.usedCount(tenantId, id));
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict(`A coupon with code ${b.code} already exists`);
      throw err;
    }
  }

  /** Deletes an unused coupon. Used coupons keep their history: switch them off instead (409). */
  async remove(tenantId: string, id: string): Promise<void> {
    z.string().uuid().parse(id);
    await this.row(this.db, tenantId, id);
    const [used] = await this.db
      .select({ n: count() })
      .from(couponRedemptions)
      .where(and(eq(couponRedemptions.tenantId, tenantId), eq(couponRedemptions.couponId, id)));
    if ((used?.n ?? 0) > 0) throw conflict("This coupon has been used; switch it off instead of deleting it");
    await this.db.delete(coupons).where(and(eq(coupons.tenantId, tenantId), eq(coupons.id, id)));
  }

  async redemptions(tenantId: string, couponId: string, query: RedemptionsQuery = {}): Promise<ListResult<Redemption>> {
    z.string().uuid().parse(couponId);
    const p = redemptionsQuerySchema.parse(query);
    await this.row(this.db, tenantId, couponId);
    const conds: (SQL | undefined)[] = [eq(couponRedemptions.tenantId, tenantId), eq(couponRedemptions.couponId, couponId)];
    if (p.status) conds.push(eq(couponRedemptions.status, p.status));
    const where = and(...conds);
    const [rows, [counted]] = await Promise.all([
      this.db.select().from(couponRedemptions).where(where).orderBy(desc(couponRedemptions.createdAt)).limit(p.limit).offset(p.offset),
      this.db.select({ total: count() }).from(couponRedemptions).where(where),
    ]);
    return { items: rows.map(toRedemption), total: counted?.total ?? 0 };
  }

  // ================================================================ evaluation and redemption

  private async usage(db: DbOrTx, tenantId: string, couponId: string, customerKey: string | null | undefined) {
    const key = customerKey ?? null;
    const [r] = await db
      .select({
        total: sql<number>`count(*) filter (where ${couponRedemptions.status} = 'active')::int`,
        byCustomer: key
          ? sql<number>`count(*) filter (where ${couponRedemptions.status} = 'active' and ${couponRedemptions.customerKey} = ${key})::int`
          : sql<number>`0`,
      })
      .from(couponRedemptions)
      .where(and(eq(couponRedemptions.tenantId, tenantId), eq(couponRedemptions.couponId, couponId)));
    return { total: Number(r?.total ?? 0), byCustomer: Number(r?.byCustomer ?? 0) };
  }

  /** Whether `code` can be used in this cart, and the discount. Never throws for an unusable code. */
  async evaluate(tenantId: string, code: string, ctx: EvaluationContext): Promise<CouponEvaluation> {
    const c = evaluationContextSchema.parse(ctx) as EvaluationContext;
    const row = await this.getByCode(tenantId, code);
    if (!row) return evaluateCoupon(null, c, { total: 0, byCustomer: 0 }, this.now());
    const usage = await this.usage(this.db, tenantId, row.id, c.customerKey);
    return evaluateCoupon(asRule(row), c, usage, this.now());
  }

  /** Checkout preview for the storefront (channel "store"). */
  async validatePublic(tenantId: string, input: PublicValidateInput): Promise<CouponEvaluation> {
    const b = publicValidateSchema.parse(input);
    return this.evaluate(tenantId, b.code, {
      channel: "store",
      subtotal: b.subtotal,
      shipping: b.shipping,
      lines: b.lines,
      customerKey: b.customerKey ?? null,
    });
  }

  /**
   * Records that `ref` used the coupon. Race-safe: the coupon row is locked (`SELECT … FOR UPDATE`) while the active
   * redemptions are counted against `usage_limit` and `per_customer_limit`, so concurrent checkouts can't exceed them.
   * Idempotent per (coupon, ref): repeating it returns the existing redemption. Throws 409 coupon_invalid `{ reason }`.
   */
  async redeem(
    tenantId: string,
    code: string,
    ref: { refType: RedemptionRefType; refId: string },
    customerKey: string | null | undefined,
    amount: number,
  ): Promise<RedeemResult> {
    const r = refSchema.parse(ref);
    const amt = money.parse(amount);
    const key = customerKey?.trim() || null;
    const c = normalizeCode(code);
    if (!CODE_RE.test(c)) throw couponError("not_found");
    return this.db.transaction(async (tx) => {
      const [coupon] = await lockCouponStatement(tx, tenantId, c);
      if (!coupon) throw couponError("not_found");
      const [existing] = await tx
        .select()
        .from(couponRedemptions)
        .where(
          and(
            eq(couponRedemptions.couponId, coupon.id),
            eq(couponRedemptions.refType, r.refType),
            eq(couponRedemptions.refId, r.refId),
          ),
        )
        .limit(1);
      if (existing?.status === "active") return { redemptionId: existing.id, couponId: coupon.id, created: false };
      if (!coupon.active) throw couponError("inactive");
      const usage = await this.usage(tx, tenantId, coupon.id, key);
      if (coupon.usageLimit !== null && usage.total >= coupon.usageLimit) throw couponError("usage_limit");
      if (coupon.perCustomerLimit !== null && key && usage.byCustomer >= coupon.perCustomerLimit) throw couponError("customer_limit");
      if (existing) {
        await tx
          .update(couponRedemptions)
          .set({ status: "active", amount: amt, customerKey: key })
          .where(eq(couponRedemptions.id, existing.id));
        return { redemptionId: existing.id, couponId: coupon.id, created: true };
      }
      const [inserted] = await tx
        .insert(couponRedemptions)
        .values({ couponId: coupon.id, tenantId, refType: r.refType, refId: r.refId, customerKey: key, amount: amt })
        .returning({ id: couponRedemptions.id });
      this.log.info({ tenantId, couponId: coupon.id, ...r }, "coupon redeemed");
      return { redemptionId: inserted!.id, couponId: coupon.id, created: true };
    });
  }

  /** Frees the coupon and offer redemptions of a ref (order cancelled). Idempotent. */
  async release(tenantId: string, refType: RedemptionRefType, refId: string): Promise<{ released: number }> {
    const r = refSchema.parse({ refType, refId });
    const offersReleased = (await this.offers.release(tenantId, r.refType, r.refId)).released;
    const rows = await this.db
      .update(couponRedemptions)
      .set({ status: "released" })
      .where(
        and(
          eq(couponRedemptions.tenantId, tenantId),
          eq(couponRedemptions.refType, r.refType),
          eq(couponRedemptions.refId, r.refId),
          eq(couponRedemptions.status, "active"),
        ),
      )
      .returning({ id: couponRedemptions.id });
    return { released: rows.length + offersReleased };
  }
}

function stripUndefined(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined));
}

