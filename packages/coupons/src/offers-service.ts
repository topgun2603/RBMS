import { AppError, conflict, notFound } from "@rbms/core";
import type { Db, DbOrTx } from "@rbms/db";
import { and, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { CODE_RE, istDayEnd, istDayStart, normalizeCode, type CouponRule, type CouponUsage } from "./logic";
import { offerLabel, offersForProduct, priceCartOffers, type CartPricing, type OfferRule, type PricingLine } from "./offers";
import {
  COUPON_CHANNELS,
  couponRedemptions,
  coupons,
  OFFER_APPLIES_TO,
  OFFER_KINDS,
  offerRedemptions,
  offers,
  REDEMPTION_REF_TYPES,
  type BundleConfig,
  type OfferConfig,
  type OfferKind,
  type OfferRow,
  type RedemptionRefType,
} from "./schema";

export const MAX_OFFER_PAISE = 2_000_000_000;

/**
 * Which products are in which collections (catalogue). Only asked when a live offer is scoped to collections.
 * Returns productId → collection ids (of `collectionIds`).
 */
export interface CollectionMembershipPort {
  membership(tenantId: string, collectionIds: string[], productIds: string[]): Promise<Record<string, string[]>>;
}

export interface OffersDeps {
  db: Db;
  collections?: CollectionMembershipPort;
  now?: () => Date;
}

// ------------------------------------------------------------------ DTOs

export interface Offer {
  id: string;
  kind: OfferKind;
  name: string;
  description: string | null;
  slug: string | null;
  imageUrl: string | null;
  appliesTo: OfferRow["appliesTo"];
  targetIds: string[];
  config: OfferConfig;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  channels: string[];
  stackable: boolean;
  combinesWithCoupons: boolean;
  active: boolean;
  /** English summary ("Buy 2 get 1 free"). */
  label: string;
  usedCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** What the storefront shows (no limits or usage). */
export interface PublicOffer {
  id: string;
  kind: OfferKind;
  name: string;
  description: string | null;
  slug: string | null;
  imageUrl: string | null;
  label: string;
  config: OfferConfig;
  appliesTo: OfferRow["appliesTo"];
  endsAt: Date | null;
}

const toOffer = (r: OfferRow, usedCount = 0): Offer => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  description: r.description,
  slug: r.slug,
  imageUrl: r.imageUrl,
  appliesTo: r.appliesTo,
  targetIds: r.targetIds,
  config: r.config,
  startsAt: r.startsAt,
  endsAt: r.endsAt,
  usageLimit: r.usageLimit,
  perCustomerLimit: r.perCustomerLimit,
  channels: r.channels,
  stackable: r.stackable,
  combinesWithCoupons: r.combinesWithCoupons,
  active: r.active,
  label: offerLabel(r),
  usedCount,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

export const toPublicOffer = (r: OfferRow): PublicOffer => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  description: r.description,
  slug: r.slug,
  imageUrl: r.imageUrl,
  label: offerLabel(r),
  config: r.config,
  appliesTo: r.appliesTo,
  endsAt: r.endsAt,
});

// ------------------------------------------------------------------ validation

const opt = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), s.nullable().optional());
const money = z.number().int("Amounts are whole paise").min(0).max(MAX_OFFER_PAISE);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
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

const qty = z.number().int("Whole units only").min(1).max(99);
const bxgySchema = z.object({ buyQty: qty, getQty: qty, getPercent: z.number().int().min(1).max(100).default(100), maxApplications: opt(z.number().int().min(1).max(99)) });
const tierSchema = z.object({ min: z.number().int().min(1).max(MAX_OFFER_PAISE), type: z.enum(["percent", "flat"]), value: z.number().int().min(1).max(MAX_OFFER_PAISE) });
const tieredSchema = z.object({
  basis: z.enum(["qty", "amount"]),
  tiers: z
    .array(tierSchema)
    .min(1, "Add at least one tier")
    .max(10)
    .transform((t) => [...t].sort((a, b) => a.min - b.min)),
});
const giftSchema = z.object({ minAmount: money.min(1, "Set the spend that unlocks the gift"), giftProductId: z.string().uuid(), giftVariantId: z.string().uuid(), giftQty: qty.default(1) });
const bundleItemSchema = z.object({ productId: z.string().uuid(), variantId: opt(z.string().uuid()).transform((v) => v ?? null), qty: qty.default(1) });
const bundleSchema = z.object({
  items: z.array(bundleItemSchema).min(2, "A bundle needs at least two items").max(8),
  priceType: z.enum(["fixed", "percent"]),
  value: z.number().int().min(1).max(MAX_OFFER_PAISE),
});

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "bundle";

export const offerInputSchema = z
  .object({
    kind: z.enum(OFFER_KINDS),
    name: z.string().trim().min(1, "Give the offer a name").max(120),
    description: opt(z.string().trim().max(500)),
    slug: opt(z.string().trim().toLowerCase().max(60).regex(SLUG_RE, "Use lower-case letters, digits and dashes")),
    imageUrl: opt(z.string().trim().url().max(1000)),
    appliesTo: z.enum(OFFER_APPLIES_TO).default("all"),
    targetIds: z.array(z.string().uuid()).max(500).default([]),
    config: z.unknown(),
    startsAt: opt(when("start")),
    endsAt: opt(when("end")),
    usageLimit: opt(z.number().int().min(1).max(10_000_000)),
    perCustomerLimit: opt(z.number().int().min(1).max(10_000)),
    channels: z.array(z.enum(COUPON_CHANNELS)).min(1, "Pick at least one channel").max(COUPON_CHANNELS.length).default(["store"]),
    stackable: z.boolean().default(false),
    combinesWithCoupons: z.boolean().default(false),
    active: z.boolean().default(true),
  })
  .transform((o, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    const schema = { bxgy: bxgySchema, tiered: tieredSchema, free_gift: giftSchema, bundle: bundleSchema }[o.kind];
    const parsed = schema.safeParse(o.config ?? {});
    if (!parsed.success) {
      for (const i of parsed.error.issues) issue(["config", ...i.path], i.message);
      return z.NEVER;
    }
    const config = parsed.data as OfferConfig;
    if (o.kind === "tiered") {
      const c = config as z.output<typeof tieredSchema>;
      c.tiers.forEach((t, i) => {
        if (t.type === "percent" && t.value > 100) issue(["config", "tiers", i, "value"], "Percent must be between 1 and 100");
      });
      if (new Set(c.tiers.map((t) => t.min)).size !== c.tiers.length) issue(["config", "tiers"], "Each tier needs a different minimum");
    }
    if (o.kind === "bundle") {
      const c = config as BundleConfig;
      if (c.priceType === "percent" && c.value > 100) issue(["config", "value"], "Percent must be between 1 and 100");
    }
    const scoped = o.kind !== "bundle";
    if (scoped && o.appliesTo !== "all" && o.targetIds.length === 0) issue(["targetIds"], "Pick what this offer applies to");
    if (o.startsAt && o.endsAt && o.endsAt.getTime() <= o.startsAt.getTime()) issue(["endsAt"], "The end must be after the start");
    return {
      ...o,
      config,
      appliesTo: scoped ? o.appliesTo : ("all" as const),
      targetIds: scoped && o.appliesTo !== "all" ? [...new Set(o.targetIds)] : [],
      channels: [...new Set(o.channels)],
      description: o.description ?? null,
      slug: o.kind === "bundle" ? (o.slug ?? null) : null,
      imageUrl: o.imageUrl ?? null,
      startsAt: o.startsAt ?? null,
      endsAt: o.endsAt ?? null,
      usageLimit: o.usageLimit ?? null,
      perCustomerLimit: o.perCustomerLimit ?? null,
    };
  });
export type OfferInput = z.input<typeof offerInputSchema>;

export const offerListQuerySchema = z.object({
  kind: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter((k): k is OfferKind => (OFFER_KINDS as readonly string[]).includes(k)) : [])),
  active: z.enum(["true", "false"]).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type OfferListQuery = z.input<typeof offerListQuerySchema>;

const pricingLineSchema = z.object({
  variantId: z.string().uuid(),
  productId: z.string().uuid(),
  categoryId: opt(z.string().uuid()),
  unitPrice: money,
  qty: z.number().min(0).max(100_000),
  amount: money.optional(),
});

export const priceCartSchema = z.object({
  channel: z.string().trim().min(1).max(32),
  lines: z.array(pricingLineSchema).max(500),
  shipping: money.optional(),
  couponCode: opt(z.string().trim().max(64)),
  customerKey: opt(z.string().trim().max(200)),
  isFirstOrder: z.boolean().optional(),
});
export type PriceCartInput = z.input<typeof priceCartSchema>;

const refSchema = z.object({ refType: z.enum(REDEMPTION_REF_TYPES), refId: z.string().uuid() });

/** 409 offer_invalid — an offer ran out between the cart and placing the order. */
export const offerError = (offerId: string, reason: "usage_limit" | "customer_limit" | "inactive") =>
  new AppError(409, "offer_invalid", reason === "inactive" ? "An offer in your cart has ended. Review your cart and try again." : "An offer in your cart has been fully used. Review your cart and try again.", { offerId, reason });

const usedSql = sql<number>`(select count(*)::int from ${offerRedemptions} where ${offerRedemptions.offerId} = ${offers.id} and ${offerRedemptions.status} = 'active')`;

function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && i < 4; e = (e as { cause?: unknown }).cause, i++) if ((e as { code?: unknown }).code === "23505") return true;
  return false;
}

function stripUndefined(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined));
}

/** Automatic offers and bundles: staff CRUD, cart pricing (with the coupon), storefront views and usage limits. */
export class OffersService {
  private readonly db: Db;
  private readonly now: () => Date;

  constructor(private readonly deps: OffersDeps) {
    this.db = deps.db;
    this.now = deps.now ?? (() => new Date());
  }

  // ================================================================ CRUD

  async list(tenantId: string, query: OfferListQuery = {}): Promise<{ items: Offer[]; total: number }> {
    const p = offerListQuerySchema.parse(query);
    const where = and(
      eq(offers.tenantId, tenantId),
      p.kind.length ? inArray(offers.kind, p.kind) : undefined,
      p.active ? eq(offers.active, p.active === "true") : undefined,
      p.q ? sql`${offers.name} ilike ${`%${p.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`}` : undefined,
    );
    const [rows, [c]] = await Promise.all([
      this.db.select({ row: offers, used: usedSql }).from(offers).where(where).orderBy(desc(offers.createdAt), desc(offers.id)).limit(p.limit).offset(p.offset),
      this.db.select({ total: count() }).from(offers).where(where),
    ]);
    return { items: rows.map((r) => toOffer(r.row, Number(r.used ?? 0))), total: c?.total ?? 0 };
  }

  private async row(db: DbOrTx, tenantId: string, id: string): Promise<OfferRow> {
    z.string().uuid().parse(id);
    const [row] = await db
      .select()
      .from(offers)
      .where(and(eq(offers.tenantId, tenantId), eq(offers.id, id)))
      .limit(1);
    if (!row) throw notFound("Offer");
    return row;
  }

  private async usedCount(tenantId: string, offerId: string): Promise<number> {
    const [r] = await this.db
      .select({ n: count() })
      .from(offerRedemptions)
      .where(and(eq(offerRedemptions.tenantId, tenantId), eq(offerRedemptions.offerId, offerId), eq(offerRedemptions.status, "active")));
    return r?.n ?? 0;
  }

  async get(tenantId: string, id: string): Promise<Offer> {
    const row = await this.row(this.db, tenantId, id);
    return toOffer(row, await this.usedCount(tenantId, id));
  }

  /** A free slug for a bundle ("diwali-combo", "diwali-combo-2", …). */
  private async freeSlug(tenantId: string, wanted: string, exceptId?: string): Promise<string> {
    const base = slugify(wanted);
    const taken = new Set(
      (
        await this.db
          .select({ id: offers.id, slug: offers.slug })
          .from(offers)
          .where(and(eq(offers.tenantId, tenantId), sql`${offers.slug} like ${`${base}%`}`))
      )
        .filter((r) => r.id !== exceptId)
        .map((r) => r.slug),
    );
    if (!taken.has(base)) return base;
    for (let i = 2; i < 1000; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
    return `${base}-${Date.now().toString(36)}`;
  }

  async create(tenantId: string, input: OfferInput): Promise<Offer> {
    const b = offerInputSchema.parse(input);
    const slug = b.kind === "bundle" ? await this.freeSlug(tenantId, b.slug ?? b.name) : null;
    try {
      const [row] = await this.db
        .insert(offers)
        .values({ tenantId, ...b, slug })
        .returning();
      return toOffer(row!, 0);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("Another bundle already uses this web address");
      throw err;
    }
  }

  /** PATCH: the stored offer merged with `input` must still be valid. `kind` can't change. */
  async update(tenantId: string, id: string, input: Partial<OfferInput>): Promise<Offer> {
    const existing = await this.row(this.db, tenantId, id);
    const merged = { ...existing, ...stripUndefined(input as Record<string, unknown>), kind: existing.kind };
    const b = offerInputSchema.parse(merged);
    let slug = existing.slug;
    if (b.kind === "bundle" && (!slug || (b.slug && b.slug !== existing.slug))) slug = await this.freeSlug(tenantId, b.slug ?? b.name, id);
    try {
      const [row] = await this.db
        .update(offers)
        .set({ ...b, slug, updatedAt: this.now() })
        .where(and(eq(offers.tenantId, tenantId), eq(offers.id, id)))
        .returning();
      if (!row) throw notFound("Offer");
      return toOffer(row, await this.usedCount(tenantId, id));
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("Another bundle already uses this web address");
      throw err;
    }
  }

  /** Deletes an unused offer; used ones keep their history (switch them off: 409). */
  async remove(tenantId: string, id: string): Promise<void> {
    await this.row(this.db, tenantId, id);
    const [used] = await this.db
      .select({ n: count() })
      .from(offerRedemptions)
      .where(and(eq(offerRedemptions.tenantId, tenantId), eq(offerRedemptions.offerId, id)));
    if ((used?.n ?? 0) > 0) throw conflict("This offer has been used; switch it off instead of deleting it");
    await this.db.delete(offers).where(and(eq(offers.tenantId, tenantId), eq(offers.id, id)));
  }

  // ================================================================ live offers

  /** Switched-on offers on a channel inside their dates (usage limits are checked by pricing). */
  async liveRows(tenantId: string, channel: string, kinds?: OfferKind[]): Promise<OfferRow[]> {
    const now = this.now().toISOString();
    return this.db
      .select()
      .from(offers)
      .where(
        and(
          eq(offers.tenantId, tenantId),
          eq(offers.active, true),
          sql`${channel} = any(${offers.channels})`,
          sql`(${offers.startsAt} is null or ${offers.startsAt} <= ${now}::timestamptz)`,
          sql`(${offers.endsAt} is null or ${offers.endsAt} >= ${now}::timestamptz)`,
          kinds?.length ? inArray(offers.kind, kinds) : undefined,
        ),
      )
      .orderBy(desc(offers.createdAt), desc(offers.id));
  }

  private async usageMap(tenantId: string, rows: OfferRow[], customerKey: string | null): Promise<Map<string, CouponUsage>> {
    const limited = rows.filter((r) => r.usageLimit !== null || r.perCustomerLimit !== null).map((r) => r.id);
    const out = new Map<string, CouponUsage>();
    if (!limited.length) return out;
    const res = await this.db
      .select({
        offerId: offerRedemptions.offerId,
        total: sql<number>`count(*)::int`,
        byCustomer: customerKey ? sql<number>`count(*) filter (where ${offerRedemptions.customerKey} = ${customerKey})::int` : sql<number>`0`,
      })
      .from(offerRedemptions)
      .where(and(eq(offerRedemptions.tenantId, tenantId), inArray(offerRedemptions.offerId, limited), eq(offerRedemptions.status, "active")))
      .groupBy(offerRedemptions.offerId);
    for (const r of res) out.set(r.offerId, { total: Number(r.total), byCustomer: Number(r.byCustomer) });
    for (const id of limited) if (!out.has(id)) out.set(id, { total: 0, byCustomer: 0 });
    return out;
  }

  private async withCollections(tenantId: string, rows: OfferRow[], lines: PricingLine[]): Promise<PricingLine[]> {
    const cols = [...new Set(rows.filter((r) => r.appliesTo === "collections").flatMap((r) => r.targetIds))];
    if (!cols.length || !this.deps.collections || !lines.length) return lines;
    const m = await this.deps.collections.membership(tenantId, cols, [...new Set(lines.map((l) => l.productId))]);
    return lines.map((l) => ({ ...l, collectionIds: m[l.productId] ?? [] }));
  }

  private async couponState(tenantId: string, code: string, customerKey: string | null): Promise<{ code: string; rule: CouponRule | null; usage: CouponUsage }> {
    const c = normalizeCode(code);
    const [row] = CODE_RE.test(c)
      ? await this.db
          .select()
          .from(coupons)
          .where(and(eq(coupons.tenantId, tenantId), eq(coupons.code, c)))
          .limit(1)
      : [];
    if (!row) return { code: c, rule: null, usage: { total: 0, byCustomer: 0 } };
    const [u] = await this.db
      .select({
        total: sql<number>`count(*) filter (where ${couponRedemptions.status} = 'active')::int`,
        byCustomer: customerKey
          ? sql<number>`count(*) filter (where ${couponRedemptions.status} = 'active' and ${couponRedemptions.customerKey} = ${customerKey})::int`
          : sql<number>`0`,
      })
      .from(couponRedemptions)
      .where(and(eq(couponRedemptions.tenantId, tenantId), eq(couponRedemptions.couponId, row.id)));
    return { code: c, rule: row, usage: { total: Number(u?.total ?? 0), byCustomer: Number(u?.byCustomer ?? 0) } };
  }

  /**
   * Prices a cart or order: live automatic offers plus the coupon (if any), best for the customer (see
   * `priceCartOffers`). The single source of truth for the storefront cart and order placement.
   */
  async priceCart(tenantId: string, input: PriceCartInput): Promise<CartPricing> {
    const b = priceCartSchema.parse(input);
    const customerKey = b.customerKey ?? null;
    const rows = b.lines.length ? await this.liveRows(tenantId, b.channel) : [];
    const [usage, lines, coupon] = await Promise.all([
      this.usageMap(tenantId, rows, customerKey),
      this.withCollections(tenantId, rows, b.lines.map((l) => ({ ...l, categoryId: l.categoryId ?? null }))),
      b.couponCode ? this.couponState(tenantId, b.couponCode, customerKey) : Promise.resolve(null),
    ]);
    return priceCartOffers({
      channel: b.channel,
      lines,
      shipping: b.shipping,
      now: this.now(),
      offers: rows as OfferRule[],
      offerUsage: usage,
      customerKey,
      isFirstOrder: b.isFirstOrder,
      coupon,
    });
  }

  // ================================================================ storefront views

  /** Live store offers that concern a product (scope, bundles with it, gift of it). */
  async forProduct(tenantId: string, p: { productId: string; categoryId?: string | null }): Promise<PublicOffer[]> {
    const rows = await this.liveRows(tenantId, "store");
    if (!rows.length) return [];
    const cols = [...new Set(rows.filter((r) => r.appliesTo === "collections").flatMap((r) => r.targetIds))];
    const collectionIds = cols.length && this.deps.collections ? ((await this.deps.collections.membership(tenantId, cols, [p.productId]))[p.productId] ?? []) : [];
    return offersForProduct(rows as (OfferRow & OfferRule)[], { ...p, collectionIds }).map(toPublicOffer);
  }

  /** Live store bundles (newest first), optionally only those with `productId`. */
  async bundles(tenantId: string, opts: { productId?: string; limit?: number } = {}): Promise<PublicOffer[]> {
    const rows = await this.liveRows(tenantId, "store", ["bundle"]);
    const list = opts.productId ? rows.filter((r) => (r.config as BundleConfig).items.some((it) => it.productId === opts.productId)) : rows;
    return list.slice(0, Math.min(Math.max(opts.limit ?? 50, 1), 100)).map(toPublicOffer);
  }

  /** A live store bundle by id or slug (404 otherwise). */
  async bundle(tenantId: string, idOrSlug: string): Promise<PublicOffer> {
    const rows = await this.liveRows(tenantId, "store", ["bundle"]);
    const r = rows.find((x) => x.id === idOrSlug || x.slug === idOrSlug);
    if (!r) throw notFound("Bundle");
    return toPublicOffer(r);
  }

  // ================================================================ usage

  /**
   * Records the offers an order used (idempotent per offer + ref). Race-safe: the offer rows are locked while their
   * active redemptions are counted against the limits. Throws 409 offer_invalid `{ offerId, reason }`.
   */
  async redeem(
    tenantId: string,
    ref: { refType: RedemptionRefType; refId: string },
    customerKey: string | null | undefined,
    used: { offerId: string; amount: number }[],
  ): Promise<{ redeemed: number }> {
    const r = refSchema.parse(ref);
    const key = customerKey?.trim() || null;
    const list = used.filter((u) => z.string().uuid().safeParse(u.offerId).success);
    if (!list.length) return { redeemed: 0 };
    return this.db.transaction(async (tx) => {
      const ids = [...new Set(list.map((u) => u.offerId))].sort();
      const locked = await tx
        .select()
        .from(offers)
        .where(and(eq(offers.tenantId, tenantId), inArray(offers.id, ids)))
        .orderBy(offers.id)
        .for("update");
      const byId = new Map(locked.map((o) => [o.id, o]));
      let redeemed = 0;
      for (const u of list) {
        const o = byId.get(u.offerId);
        if (!o) throw offerError(u.offerId, "inactive");
        const [existing] = await tx
          .select()
          .from(offerRedemptions)
          .where(and(eq(offerRedemptions.offerId, o.id), eq(offerRedemptions.refType, r.refType), eq(offerRedemptions.refId, r.refId)))
          .limit(1);
        if (existing?.status === "active") continue;
        if (o.usageLimit !== null || o.perCustomerLimit !== null) {
          const [c] = await tx
            .select({
              total: sql<number>`count(*)::int`,
              byCustomer: key ? sql<number>`count(*) filter (where ${offerRedemptions.customerKey} = ${key})::int` : sql<number>`0`,
            })
            .from(offerRedemptions)
            .where(and(eq(offerRedemptions.offerId, o.id), eq(offerRedemptions.status, "active")));
          if (o.usageLimit !== null && Number(c?.total ?? 0) >= o.usageLimit) throw offerError(o.id, "usage_limit");
          if (o.perCustomerLimit !== null && key && Number(c?.byCustomer ?? 0) >= o.perCustomerLimit) throw offerError(o.id, "customer_limit");
        }
        const amount = Math.max(0, Math.min(Math.round(u.amount), MAX_OFFER_PAISE));
        if (existing) await tx.update(offerRedemptions).set({ status: "active", amount, customerKey: key }).where(eq(offerRedemptions.id, existing.id));
        else await tx.insert(offerRedemptions).values({ offerId: o.id, tenantId, refType: r.refType, refId: r.refId, customerKey: key, amount });
        redeemed++;
      }
      return { redeemed };
    });
  }

  /** Frees a ref's offer redemptions (order cancelled). Idempotent. */
  async release(tenantId: string, refType: RedemptionRefType, refId: string): Promise<{ released: number }> {
    const r = refSchema.parse({ refType, refId });
    const conds: SQL[] = [eq(offerRedemptions.tenantId, tenantId), eq(offerRedemptions.refType, r.refType), eq(offerRedemptions.refId, r.refId), eq(offerRedemptions.status, "active")];
    const rows = await this.db
      .update(offerRedemptions)
      .set({ status: "released" })
      .where(and(...conds))
      .returning({ id: offerRedemptions.id });
    return { released: rows.length };
  }
}
