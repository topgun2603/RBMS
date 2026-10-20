import { packOrDefault } from "@srirealtime/verticals";
import { AppError, addDays, badRequest, conflict, notFound, randomToken, tooMany, type FeatureGatePort, type TenantRef } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { and, count, desc, eq, gt, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { addressInputSchema, addressPatchSchema, MAX_ADDRESSES, normalizeIndianMobile, pincodeSchema, PINCODE_RE } from "./address";
import { checkoutBodySchema, checkoutError, normalizeStoreSettings, validateCheckout } from "./checkout";
import {
  noopLogger,
  type AvailabilityPort,
  type BrandingPort,
  type CatalogPort,
  type CheckoutOrderAddress,
  type CouponEvaluationResult,
  type CouponPort,
  type DeliveryPort,
  type DeliveryQuote,
  type LoggerPort,
  type OrdersPort,
  type ShopperProfilePort,
  type StoreOrder,
  type StoreOrderSummary,
  type StoreSettings,
  type StoreSettingsPort,
} from "./ports";
import {
  buildPricedCart,
  clampQty,
  couponContext,
  isSellable,
  MAX_CART_LINES,
  maxQtyFor,
  mergeCartLines,
  priceLines,
  setCartLine,
  type CartDelivery,
  type PricedCart,
} from "./pricing";
import { RateLimiter } from "./ratelimit";
import {
  storeAddresses,
  storeCarts,
  storeCustomers,
  storeWishlist,
  type StoreAddressRow,
  type StoreCartRow,
  type StoreCustomerRow,
  type StoredCartLine,
} from "./schema";

export const CART_TTL_DAYS = 30;
export const CART_TOKEN_RE = /^[A-Za-z0-9_-]{24,64}$/;
export const MAX_WISHLIST = 200;
/** Checkout attempts per shopper per minute. */
export const CHECKOUT_RATE = { limit: 10, windowMs: 60_000 };
/** Used when no delivery module is wired (dev/tests): one free option, COD allowed. */
export const FALLBACK_DELIVERY: DeliveryQuote = {
  serviceable: true,
  options: [{ id: "standard", name: "Standard delivery", amount: 0, etaDays: [3, 7], codAllowed: true, codFee: 0 }],
};

/**
 * A shopper's unexpired carts. `gt()` binds `now` through the column's driver mapping; a raw sql`… > ${date}` would hand
 * postgres-js a Date for a timestamptz parameter and fail.
 */
export const liveCartsOf = (tenantId: string, customerId: string, now: Date) =>
  and(eq(storeCarts.tenantId, tenantId), eq(storeCarts.customerId, customerId), gt(storeCarts.expiresAt, now));

export interface StorefrontDeps {
  db: Db;
  catalog: CatalogPort;
  orders: OrdersPort;
  settings: StoreSettingsPort;
  branding: BrandingPort;
  /** Without it stock isn't checked (everything counts as in stock). */
  availability?: AvailabilityPort;
  /** Without it coupon codes are reported invalid (`not_found`). */
  coupons?: CouponPort;
  /** Without it a single free "Standard delivery" option is offered (FALLBACK_DELIVERY). */
  delivery?: DeliveryPort;
  /** Checks `coupons`, `payments` and `storefront.wishlist` outside the route pipeline. Without it all are on. */
  featureGate?: FeatureGatePort;
  profiles?: ShopperProfilePort;
  log?: LoggerPort;
  now?: () => Date;
}

// ------------------------------------------------------------------ DTOs

export interface StoreCustomer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  marketingOptIn: boolean;
  ordersCount: number;
  totalSpent: number;
  lastOrderAt: Date | null;
  createdAt: Date;
}

export interface StoreAddress {
  id: string;
  label: string | null;
  name: string;
  phone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  district: string | null;
  stateCode: string;
  pincode: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WishlistItem {
  productId: string;
  name: string;
  slug: string;
  image: string | null;
  priceMin: number;
  priceMax: number;
  mrp: number | null;
  /** Still on sale in the store. */
  available: boolean;
  addedAt: Date;
}

export interface StoreConfig {
  shop: {
    name: string;
    logoUrl: string | null;
    css: string;
    /** The shop's trade (@srirealtime/verticals pack id, never empty: the app's default when unset). */
    businessType: string;
    /** Theme variants: header, hero, card, imageRatio, buttons, density, sections, motif, headings. */
    theme: Record<string, string>;
    /** Font families to load. */
    fonts: string[];
    contactPhone: string;
    contactEmail: string;
    social: StoreSettings["social"];
  };
  open: boolean;
  closedMessage: string;
  codEnabled: boolean;
  codMaxAmount: number;
  minOrderValue: number;
  guestCheckout: false;
  policies: { shipping: string; returns: string; privacy: string; terms: string };
}

export interface CheckoutResult {
  order: { id: string; number: string; total: number; status: string; paymentStatus: string };
  accessToken: string;
  payment: { kind: "order"; ref: string } | null;
}

export interface TrackingView {
  number: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  placedAt: Date;
  timeline: { type: string; status: string | null; message: string | null; at: Date }[];
  lines: { name: string; image: string | null; qty: number; unit: string; price: number; total: number }[];
  totals: { subtotal: number; discount: number; shipping: number; codFee: number; total: number; loyalty?: { points: number; discount: number } };
  fulfillment: { carrier: string | null; trackingNumber: string | null; trackingUrl: string | null };
  shipTo: { city: string; pincode: string } | null;
  cancelReason: string | null;
}

// ------------------------------------------------------------------ validation

const lineBodySchema = z.object({
  variantId: z.string().uuid(),
  qty: z.number().int("Whole units only").min(0).max(1000),
});
const couponBodySchema = z.object({ code: z.string().trim().min(1).max(64) });
const pincodeBodySchema = z.object({ pincode: pincodeSchema });
const meBodySchema = z.object({
  name: z.string().trim().max(120).optional(),
  email: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().toLowerCase().email().max(254).nullable().optional()),
  phone: z
    .preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().nullable().optional())
    .transform((v, ctx) => {
      if (v === null || v === undefined) return v;
      const p = normalizeIndianMobile(v);
      if (!p) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a 10-digit Indian mobile number" });
        return z.NEVER;
      }
      return p;
    }),
  marketingOptIn: z.boolean().optional(),
});
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
const cancelBodySchema = z.object({ reason: z.string().trim().min(1, "Tell us why").max(500) });
const wishlistBodySchema = z.object({ productId: z.string().uuid() });
const CANCELLABLE = new Set(["placed", "confirmed"]);

export type LineBody = z.input<typeof lineBodySchema>;
export type MeBody = z.input<typeof meBodySchema>;

const toCustomer = (r: StoreCustomerRow): StoreCustomer => ({
  id: r.id,
  name: r.name,
  phone: r.phone,
  email: r.email,
  marketingOptIn: r.marketingOptIn,
  ordersCount: r.ordersCount,
  totalSpent: r.totalSpent,
  lastOrderAt: r.lastOrderAt,
  createdAt: r.createdAt,
});

const toAddress = (r: StoreAddressRow): StoreAddress => ({
  id: r.id,
  label: r.label,
  name: r.name,
  phone: r.phone,
  line1: r.line1,
  line2: r.line2,
  landmark: r.landmark,
  city: r.city,
  district: r.district,
  stateCode: r.stateCode,
  pincode: r.pincode,
  isDefault: r.isDefault,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

export class StorefrontService {
  private readonly db: Db;
  private readonly log: LoggerPort;
  private readonly now: () => Date;
  private readonly checkoutLimiter: RateLimiter;

  constructor(private readonly deps: StorefrontDeps) {
    this.db = deps.db;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
    this.checkoutLimiter = new RateLimiter(CHECKOUT_RATE.limit, CHECKOUT_RATE.windowMs, () => this.now().getTime());
  }

  private async featureOn(tenantId: string, key: string): Promise<boolean> {
    if (!this.deps.featureGate) return true;
    try {
      return await this.deps.featureGate.isEnabled(tenantId, key);
    } catch (err) {
      this.log.warn({ err, tenantId, key }, "storefront: feature check failed");
      return false;
    }
  }

  private async storeSettings(tenantId: string): Promise<StoreSettings> {
    return normalizeStoreSettings(await this.deps.settings.get(tenantId));
  }

  // ================================================================ config

  async config(tenant: TenantRef): Promise<StoreConfig> {
    const [s, b] = await Promise.all([this.storeSettings(tenant.id), this.deps.branding.get(tenant.id)]);
    return {
      shop: {
        name: b.name || tenant.slug,
        logoUrl: b.logoUrl,
        css: b.css,
        businessType: packOrDefault(s.businessType, tenant.appId).id,
        theme: b.theme ?? {},
        fonts: b.fonts ?? [],
        contactPhone: s.contactPhone,
        contactEmail: s.contactEmail,
        social: s.social,
      },
      open: s.open,
      closedMessage: s.closedMessage,
      codEnabled: s.codEnabled,
      codMaxAmount: s.codMaxAmount,
      minOrderValue: s.minOrderValue,
      guestCheckout: false,
      policies: {
        shipping: s.policies.shipping ?? "",
        returns: s.policies.returns ?? "",
        privacy: s.policies.privacy ?? "",
        terms: s.policies.terms ?? "",
      },
    };
  }

  // ================================================================ customers

  /** The shopper's store-customer row, created on first use (prefilled from the user's profile when wired). */
  async ensureCustomer(tenantId: string, userId: string): Promise<StoreCustomerRow> {
    const find = async () => {
      const [r] = await this.db
        .select()
        .from(storeCustomers)
        .where(and(eq(storeCustomers.tenantId, tenantId), eq(storeCustomers.userId, userId)))
        .limit(1);
      return r;
    };
    const existing = await find();
    if (existing) return existing;
    let profile: Awaited<ReturnType<ShopperProfilePort["get"]>> = null;
    try {
      profile = (await this.deps.profiles?.get(userId)) ?? null;
    } catch (err) {
      this.log.warn({ err, userId }, "storefront: profile lookup failed");
    }
    await this.db
      .insert(storeCustomers)
      .values({
        tenantId,
        userId,
        name: profile?.name?.trim().slice(0, 120) ?? "",
        phone: normalizeIndianMobile(profile?.phone) ?? null,
        email: profile?.email?.trim().toLowerCase() || null,
      })
      .onConflictDoNothing();
    const created = await find();
    if (!created) throw new AppError(500, "internal", "Could not create the store customer");
    return created;
  }

  async me(tenantId: string, userId: string): Promise<{ customer: StoreCustomer; counts: { orders: number; wishlist: number } }> {
    const c = await this.ensureCustomer(tenantId, userId);
    const [orders, [wl]] = await Promise.all([
      this.deps.orders.listForCustomer(tenantId, c.id, { limit: 1, offset: 0 }),
      this.db
        .select({ n: count() })
        .from(storeWishlist)
        .where(and(eq(storeWishlist.tenantId, tenantId), eq(storeWishlist.customerId, c.id))),
    ]);
    return { customer: toCustomer(c), counts: { orders: orders.total, wishlist: wl?.n ?? 0 } };
  }

  async updateMe(tenantId: string, userId: string, body: unknown): Promise<StoreCustomer> {
    const b = meBodySchema.parse(body ?? {});
    const c = await this.ensureCustomer(tenantId, userId);
    const patch: Partial<typeof storeCustomers.$inferInsert> = {};
    if (b.name !== undefined) patch.name = b.name;
    if (b.email !== undefined) patch.email = b.email;
    if (b.phone !== undefined) patch.phone = b.phone;
    if (b.marketingOptIn !== undefined) patch.marketingOptIn = b.marketingOptIn;
    if (!Object.keys(patch).length) return toCustomer(c);
    const [r] = await this.db
      .update(storeCustomers)
      .set({ ...patch, updatedAt: this.now() })
      .where(and(eq(storeCustomers.tenantId, tenantId), eq(storeCustomers.id, c.id)))
      .returning();
    return toCustomer(r!);
  }

  /** Adds a paid order's amount to the shopper's total spent. Call from the orders payment hook (online paid, COD collected). */
  async recordPaid(tenantId: string, customerId: string, amount: number): Promise<void> {
    if (!Number.isFinite(amount) || amount <= 0) return;
    await this.db
      .update(storeCustomers)
      .set({ totalSpent: sql`${storeCustomers.totalSpent} + ${Math.round(amount)}`, updatedAt: this.now() })
      .where(and(eq(storeCustomers.tenantId, tenantId), eq(storeCustomers.id, customerId)));
  }

  // ================================================================ addresses

  private async addressRows(tenantId: string, customerId: string): Promise<StoreAddressRow[]> {
    return this.db
      .select()
      .from(storeAddresses)
      .where(and(eq(storeAddresses.tenantId, tenantId), eq(storeAddresses.customerId, customerId)))
      .orderBy(desc(storeAddresses.isDefault), desc(storeAddresses.updatedAt));
  }

  private async addressRow(tenantId: string, customerId: string, id: string): Promise<StoreAddressRow> {
    const [r] = await this.db
      .select()
      .from(storeAddresses)
      .where(and(eq(storeAddresses.tenantId, tenantId), eq(storeAddresses.customerId, customerId), eq(storeAddresses.id, id)))
      .limit(1);
    if (!r) throw notFound("Address");
    return r;
  }

  async listAddresses(tenantId: string, userId: string): Promise<{ items: StoreAddress[]; total: number }> {
    const c = await this.ensureCustomer(tenantId, userId);
    const rows = await this.addressRows(tenantId, c.id);
    return { items: rows.map(toAddress), total: rows.length };
  }

  async createAddress(tenantId: string, userId: string, body: unknown): Promise<StoreAddress> {
    const raw = (body ?? {}) as { isDefault?: unknown };
    const a = addressInputSchema.parse(body ?? {});
    const c = await this.ensureCustomer(tenantId, userId);
    return this.db.transaction(async (tx) => {
      const [n] = await tx
        .select({ n: count() })
        .from(storeAddresses)
        .where(and(eq(storeAddresses.tenantId, tenantId), eq(storeAddresses.customerId, c.id)));
      const existing = n?.n ?? 0;
      if (existing >= MAX_ADDRESSES) throw badRequest(`You can save up to ${MAX_ADDRESSES} addresses`);
      const makeDefault = existing === 0 || raw.isDefault === true;
      if (makeDefault) {
        await tx
          .update(storeAddresses)
          .set({ isDefault: false })
          .where(and(eq(storeAddresses.tenantId, tenantId), eq(storeAddresses.customerId, c.id)));
      }
      const [r] = await tx
        .insert(storeAddresses)
        .values({ tenantId, customerId: c.id, ...a, label: a.label ?? null, isDefault: makeDefault })
        .returning();
      return toAddress(r!);
    });
  }

  async updateAddress(tenantId: string, userId: string, id: string, body: unknown): Promise<StoreAddress> {
    const p = addressPatchSchema.parse(body ?? {});
    const c = await this.ensureCustomer(tenantId, userId);
    await this.addressRow(tenantId, c.id, id);
    const patch = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined));
    if (!Object.keys(patch).length) return toAddress(await this.addressRow(tenantId, c.id, id));
    const [r] = await this.db
      .update(storeAddresses)
      .set({ ...patch, updatedAt: this.now() })
      .where(and(eq(storeAddresses.tenantId, tenantId), eq(storeAddresses.customerId, c.id), eq(storeAddresses.id, id)))
      .returning();
    return toAddress(r!);
  }

  async deleteAddress(tenantId: string, userId: string, id: string): Promise<{ ok: true }> {
    const c = await this.ensureCustomer(tenantId, userId);
    const row = await this.addressRow(tenantId, c.id, id);
    await this.db.transaction(async (tx) => {
      await tx.delete(storeAddresses).where(and(eq(storeAddresses.tenantId, tenantId), eq(storeAddresses.id, id)));
      if (!row.isDefault) return;
      // Promote the most recently used address.
      const [next] = await tx
        .select({ id: storeAddresses.id })
        .from(storeAddresses)
        .where(and(eq(storeAddresses.tenantId, tenantId), eq(storeAddresses.customerId, c.id)))
        .orderBy(desc(storeAddresses.updatedAt))
        .limit(1);
      if (next) await tx.update(storeAddresses).set({ isDefault: true }).where(and(eq(storeAddresses.tenantId, tenantId), eq(storeAddresses.id, next.id)));
    });
    return { ok: true };
  }

  async setDefaultAddress(tenantId: string, userId: string, id: string): Promise<StoreAddress> {
    const c = await this.ensureCustomer(tenantId, userId);
    await this.addressRow(tenantId, c.id, id);
    return this.db.transaction(async (tx) => {
      await tx
        .update(storeAddresses)
        .set({ isDefault: false })
        .where(and(eq(storeAddresses.tenantId, tenantId), eq(storeAddresses.customerId, c.id), ne(storeAddresses.id, id)));
      const [r] = await tx
        .update(storeAddresses)
        .set({ isDefault: true, updatedAt: this.now() })
        .where(and(eq(storeAddresses.tenantId, tenantId), eq(storeAddresses.id, id)))
        .returning();
      return toAddress(r!);
    });
  }

  // ================================================================ carts

  private async newCart(tenantId: string, customerId: string | null, lines: StoredCartLine[] = []): Promise<StoreCartRow> {
    const now = this.now();
    const [r] = await this.db
      .insert(storeCarts)
      .values({ tenantId, token: randomToken(18), customerId, lines, createdAt: now, updatedAt: now, expiresAt: addDays(now, CART_TTL_DAYS) })
      .returning();
    return r!;
  }

  /** The cart for `token` in this shop (404 when unknown or expired); extends its expiry when last touched > 1 h ago. */
  private async cartRow(tenantId: string, token: string): Promise<StoreCartRow> {
    if (!CART_TOKEN_RE.test(token)) throw notFound("Cart");
    const [r] = await this.db
      .select()
      .from(storeCarts)
      .where(and(eq(storeCarts.tenantId, tenantId), eq(storeCarts.token, token)))
      .limit(1);
    const now = this.now();
    if (!r || r.expiresAt.getTime() <= now.getTime()) throw notFound("Cart");
    if (now.getTime() - r.updatedAt.getTime() > 3_600_000) {
      const expiresAt = addDays(now, CART_TTL_DAYS);
      await this.db.update(storeCarts).set({ updatedAt: now, expiresAt }).where(eq(storeCarts.id, r.id));
      return { ...r, updatedAt: now, expiresAt };
    }
    return r;
  }

  private async saveCart(row: StoreCartRow, patch: Partial<Pick<StoreCartRow, "lines" | "couponCode" | "pincode" | "customerId">>): Promise<StoreCartRow> {
    const now = this.now();
    const [r] = await this.db
      .update(storeCarts)
      .set({ ...patch, updatedAt: now, expiresAt: addDays(now, CART_TTL_DAYS) })
      .where(and(eq(storeCarts.tenantId, row.tenantId), eq(storeCarts.id, row.id)))
      .returning();
    return r!;
  }

  /** The shopper's newest live cart, if any. */
  private async shopperCart(tenantId: string, customerId: string): Promise<StoreCartRow | null> {
    const [r] = await this.db
      .select()
      .from(storeCarts)
      .where(liveCartsOf(tenantId, customerId, this.now()))
      .orderBy(desc(storeCarts.updatedAt))
      .limit(1);
    return r ?? null;
  }

  private async evaluateCoupon(
    tenantId: string,
    code: string,
    ctx: ReturnType<typeof couponContext>,
    customer: StoreCustomerRow | null,
  ): Promise<CouponEvaluationResult | null> {
    if (ctx.subtotal <= 0) return null;
    if (!this.deps.coupons || !(await this.featureOn(tenantId, "coupons"))) return { valid: false, reason: "not_found" };
    try {
      return await this.deps.coupons.evaluate(tenantId, code, {
        channel: "store",
        subtotal: ctx.subtotal,
        lines: ctx.lines,
        customerKey: customer ? `acct:${customer.id}` : null,
        isFirstOrder: customer ? customer.ordersCount === 0 : undefined,
      });
    } catch (err) {
      this.log.warn({ err, tenantId, code }, "storefront: coupon evaluation failed");
      return { valid: false, reason: "not_found" };
    }
  }

  private async quote(
    tenantId: string,
    input: { pincode: string; stateCode?: string; weightGrams: number; subtotal: number; cod: boolean },
  ): Promise<DeliveryQuote | null> {
    if (!this.deps.delivery) return FALLBACK_DELIVERY;
    try {
      return await this.deps.delivery.quote(tenantId, input);
    } catch (err) {
      this.log.warn({ err, tenantId, pincode: input.pincode }, "storefront: delivery quote failed");
      return null;
    }
  }

  /** Prices a stored cart against the live catalogue, stock, coupon and (with a pincode) delivery. */
  private async price(
    row: StoreCartRow,
    opts: { pincode?: string | null; requested?: Map<string, number>; customer?: StoreCustomerRow | null; withDelivery?: boolean } = {},
  ): Promise<PricedCart> {
    const tenantId = row.tenantId;
    const ids = [...new Set(row.lines.map((l) => l.variantId))];
    const [variants, availability] = ids.length
      ? await Promise.all([this.deps.catalog.getVariants(tenantId, ids), this.deps.availability?.availability(tenantId, ids) ?? Promise.resolve([])])
      : [[], []];
    const priced = priceLines(row.lines, variants, availability, { requested: opts.requested });

    let customer = opts.customer ?? null;
    if (!customer && row.customerId && row.couponCode) {
      const [c] = await this.db
        .select()
        .from(storeCustomers)
        .where(and(eq(storeCustomers.tenantId, tenantId), eq(storeCustomers.id, row.customerId)))
        .limit(1);
      customer = c ?? null;
    }
    const ctx = couponContext(priced.calcs);
    const coupon = row.couponCode ? { code: row.couponCode, result: await this.evaluateCoupon(tenantId, row.couponCode, ctx, customer) } : null;

    const pincode = opts.pincode !== undefined && opts.pincode !== null && PINCODE_RE.test(opts.pincode) ? opts.pincode : row.pincode;
    let delivery: CartDelivery | null = null;
    let deliveryFailed = false;
    const draft = buildPricedCart({ token: row.token, priced, coupon, pincode, delivery: null });
    if (pincode && opts.withDelivery !== false && draft.itemCount > 0) {
      const q = await this.quote(tenantId, { pincode, weightGrams: draft.weightGrams, subtotal: draft.total, cod: false });
      if (q) delivery = { serviceable: q.serviceable, options: q.options };
      else deliveryFailed = true;
    }
    return buildPricedCart({ token: row.token, priced, coupon, pincode, delivery, deliveryFailed });
  }

  /** New cart; a signed-in shopper gets their existing live cart back instead. */
  async createCart(tenantId: string, userId: string | null): Promise<{ token: string }> {
    if (userId) {
      const c = await this.ensureCustomer(tenantId, userId);
      const existing = await this.shopperCart(tenantId, c.id);
      if (existing) return { token: existing.token };
      return { token: (await this.newCart(tenantId, c.id)).token };
    }
    return { token: (await this.newCart(tenantId, null)).token };
  }

  async getCart(tenantId: string, token: string, query: { pincode?: string } = {}): Promise<PricedCart> {
    const row = await this.cartRow(tenantId, token);
    return this.price(row, { pincode: query.pincode ?? null });
  }

  /** Sets a line's quantity (0 removes), capped at 99 and by what's in stock; refuses items that can't be sold. */
  async setLine(tenantId: string, token: string, body: unknown): Promise<PricedCart> {
    const b = lineBodySchema.parse(body ?? {});
    const row = await this.cartRow(tenantId, token);
    const wanted = clampQty(b.qty);
    if (wanted === 0) return this.price(await this.saveCart(row, { lines: setCartLine(row.lines, { variantId: b.variantId, qty: 0 }) }));

    const [variants, availability] = await Promise.all([
      this.deps.catalog.getVariants(tenantId, [b.variantId]),
      this.deps.availability?.availability(tenantId, [b.variantId]) ?? Promise.resolve([]),
    ]);
    const v = variants.find((x) => x.id === b.variantId);
    if (!v || !isSellable(v)) throw new AppError(404, "not_found", "This item isn't available");
    const max = maxQtyFor(v, availability.find((a) => a.itemId === v.id));
    if (max <= 0) throw new AppError(409, "out_of_stock", "This item is out of stock", { variantId: v.id });
    const isNew = !row.lines.some((l) => l.variantId === v.id);
    if (isNew && row.lines.length >= MAX_CART_LINES) throw badRequest(`A cart can hold up to ${MAX_CART_LINES} different items`);
    const qty = Math.min(wanted, max);
    const saved = await this.saveCart(row, { lines: setCartLine(row.lines, { variantId: v.id, qty, price: v.price }) });
    return this.price(saved, { requested: new Map([[v.id, wanted]]) });
  }

  async applyCoupon(tenantId: string, token: string, body: unknown): Promise<PricedCart> {
    const b = couponBodySchema.parse(body ?? {});
    const row = await this.cartRow(tenantId, token);
    return this.price(await this.saveCart(row, { couponCode: b.code.toUpperCase() }));
  }

  async removeCoupon(tenantId: string, token: string): Promise<PricedCart> {
    const row = await this.cartRow(tenantId, token);
    return this.price(await this.saveCart(row, { couponCode: null }));
  }

  async setPincode(tenantId: string, token: string, body: unknown): Promise<PricedCart> {
    const b = pincodeBodySchema.parse(body ?? {});
    const row = await this.cartRow(tenantId, token);
    return this.price(await this.saveCart(row, { pincode: b.pincode }));
  }

  /**
   * Moves an anonymous cart into the shopper's: quantities of the same item are summed (capped at 99). Without a
   * shopper cart the anonymous one simply becomes theirs. Returns the shopper's cart (its token may differ).
   */
  async mergeCart(tenantId: string, userId: string, token: string): Promise<PricedCart> {
    const c = await this.ensureCustomer(tenantId, userId);
    const anon = await this.cartRow(tenantId, token);
    if (anon.customerId === c.id) return this.price(anon, { customer: c });
    if (anon.customerId) throw notFound("Cart");
    const mine = await this.shopperCart(tenantId, c.id);
    if (!mine) return this.price(await this.saveCart(anon, { customerId: c.id }), { customer: c });
    const merged = await this.db.transaction(async (tx) => {
      const now = this.now();
      const [r] = await tx
        .update(storeCarts)
        .set({
          lines: mergeCartLines(mine.lines, anon.lines),
          couponCode: mine.couponCode ?? anon.couponCode,
          pincode: mine.pincode ?? anon.pincode,
          updatedAt: now,
          expiresAt: addDays(now, CART_TTL_DAYS),
        })
        .where(and(eq(storeCarts.tenantId, tenantId), eq(storeCarts.id, mine.id)))
        .returning();
      await tx.delete(storeCarts).where(and(eq(storeCarts.tenantId, tenantId), eq(storeCarts.id, anon.id)));
      return r!;
    });
    return this.price(merged, { customer: c });
  }

  /** Deletes expired carts (all shops). For a daily job. */
  async purgeExpiredCarts(): Promise<{ deleted: number }> {
    const rows = await this.db.delete(storeCarts).where(lt(storeCarts.expiresAt, this.now())).returning({ id: storeCarts.id });
    return { deleted: rows.length };
  }

  // ================================================================ checkout

  async checkout(tenant: TenantRef, userId: string, body: unknown): Promise<CheckoutResult> {
    const tenantId = tenant.id;
    if (!this.checkoutLimiter.hit(`${tenantId}:${userId}`)) throw tooMany("Too many checkout attempts — wait a minute and try again");
    const b = checkoutBodySchema.parse(body ?? {});
    const customer = await this.ensureCustomer(tenantId, userId);
    const row = await this.cartRow(tenantId, b.cartToken);
    if (row.customerId && row.customerId !== customer.id) throw notFound("Cart");

    let rawAddress: unknown = b.address;
    if (b.addressId) {
      const a = await this.addressRow(tenantId, customer.id, b.addressId);
      rawAddress = { ...toAddress(a) };
    }
    const settings = await this.storeSettings(tenantId);
    const cart = await this.price(row, { customer, withDelivery: false });
    const addr = addressInputSchema.safeParse(rawAddress ?? {});
    const quote = addr.success
      ? await this.quote(tenantId, {
          pincode: addr.data.pincode,
          stateCode: addr.data.stateCode,
          weightGrams: cart.weightGrams,
          subtotal: cart.total,
          cod: b.paymentMethod === "cod",
        })
      : null;
    const check = validateCheckout({
      settings,
      cart,
      address: rawAddress,
      deliveryOptionId: b.deliveryOptionId,
      quote,
      paymentMethod: b.paymentMethod,
      onlinePaymentsEnabled: b.paymentMethod === "online" ? await this.featureOn(tenantId, "payments") : true,
    });
    if (!check.ok) throw checkoutError(check.issues);
    const { plan } = check;

    const shippingAddress: CheckoutOrderAddress = {
      name: plan.address.name,
      phone: plan.address.phone,
      line1: plan.address.line1,
      line2: plan.address.line2 ?? null,
      landmark: plan.address.landmark ?? null,
      city: plan.address.city,
      district: plan.address.district ?? null,
      stateCode: plan.address.stateCode,
      pincode: plan.address.pincode,
      country: "IN",
    };
    const order = await this.deps.orders.createFromCheckout(tenant, {
      customer: {
        name: customer.name || plan.address.name,
        phone: customer.phone || plan.address.phone,
        email: customer.email,
        accountId: customer.id,
      },
      shippingAddress,
      lines: cart.lines.map((l) => ({ variantId: l.variantId, qty: l.qty })),
      couponCode: cart.coupon?.valid ? cart.coupon.code : null,
      paymentMethod: b.paymentMethod,
      shipping: plan.shipping,
      codFee: plan.codFee,
      customerNote: b.customerNote ?? null,
      ...(b.loyaltyPoints ? { loyaltyPoints: b.loyaltyPoints } : {}),
    });

    await this.afterOrder(row, customer, plan.address);
    return {
      order: { id: order.id, number: order.number, total: order.total, status: order.status, paymentStatus: order.paymentStatus },
      accessToken: order.accessToken,
      payment: b.paymentMethod === "online" ? { kind: "order", ref: order.accessToken } : null,
    };
  }

  /** Clears the cart and bumps the shopper's order stats (best effort: the order is already placed). */
  private async afterOrder(cart: StoreCartRow, customer: StoreCustomerRow, address: { name: string; phone: string }) {
    const now = this.now();
    try {
      await this.saveCart(cart, { lines: [], couponCode: null, customerId: customer.id });
      await this.db
        .update(storeCustomers)
        .set({
          ordersCount: sql`${storeCustomers.ordersCount} + 1`,
          lastOrderAt: now,
          ...(customer.name ? {} : { name: address.name }),
          ...(customer.phone ? {} : { phone: address.phone }),
          updatedAt: now,
        })
        .where(and(eq(storeCustomers.tenantId, cart.tenantId), eq(storeCustomers.id, customer.id)));
    } catch (err) {
      this.log.error({ err, tenantId: cart.tenantId, cartId: cart.id }, "storefront: post-checkout update failed");
    }
  }

  // ================================================================ orders

  async listOrders(tenantId: string, userId: string, query: unknown): Promise<{ items: StoreOrderSummary[]; total: number }> {
    const q = listQuerySchema.parse(query ?? {});
    const c = await this.ensureCustomer(tenantId, userId);
    return this.deps.orders.listForCustomer(tenantId, c.id, q);
  }

  async getOrder(tenantId: string, userId: string, orderId: string): Promise<StoreOrder> {
    const c = await this.ensureCustomer(tenantId, userId);
    return this.deps.orders.getForCustomer(tenantId, c.id, orderId);
  }

  /** Only placed or confirmed orders (409 not_cancellable otherwise). */
  async cancelOrder(tenantId: string, userId: string, orderId: string, body: unknown): Promise<StoreOrder> {
    const b = cancelBodySchema.parse(body ?? {});
    const c = await this.ensureCustomer(tenantId, userId);
    const order = await this.deps.orders.getForCustomer(tenantId, c.id, orderId);
    if (!CANCELLABLE.has(order.status)) {
      throw new AppError(409, "not_cancellable", "This order can't be cancelled any more — contact the shop", { status: order.status });
    }
    return this.deps.orders.cancelForCustomer(tenantId, c.id, orderId, b.reason);
  }

  /** Public order page by access token: status timeline, lines, totals, tracking; only city/pincode of the address. */
  async track(tenantId: string, accessToken: string): Promise<TrackingView> {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(accessToken)) throw notFound("Order");
    const o = await this.deps.orders.getByToken(accessToken, tenantId);
    const timeline = o.events
      .filter((e) => e.type === "status" || e.type === "fulfillment")
      .map((e) => ({ type: e.type, status: e.toStatus, message: e.type === "fulfillment" ? e.message : null, at: e.createdAt }));
    if (!timeline.some((e) => e.type === "status")) timeline.unshift({ type: "status", status: "placed", message: null, at: o.placedAt });
    return {
      number: o.number,
      status: o.status,
      paymentStatus: o.paymentStatus,
      paymentMethod: o.paymentMethod,
      placedAt: o.placedAt,
      timeline,
      lines: o.lines.map((l) => ({ name: l.name, image: l.image, qty: l.qty, unit: l.unit, price: l.price, total: l.total })),
      totals: {
        subtotal: o.totals.subtotal,
        discount: o.totals.discount,
        shipping: o.totals.shipping,
        codFee: o.totals.codFee ?? 0,
        total: o.totals.total,
        ...(o.totals.loyalty ? { loyalty: o.totals.loyalty } : {}),
      },
      fulfillment: {
        carrier: o.fulfillment.carrier ?? null,
        trackingNumber: o.fulfillment.trackingNumber ?? null,
        trackingUrl: o.fulfillment.trackingUrl ?? null,
      },
      shipTo: o.shippingAddress ? { city: o.shippingAddress.city, pincode: o.shippingAddress.pincode } : null,
      cancelReason: o.cancelReason,
    };
  }

  // ================================================================ wishlist

  async listWishlist(tenantId: string, userId: string): Promise<{ items: WishlistItem[]; total: number }> {
    const c = await this.ensureCustomer(tenantId, userId);
    const rows = await this.db
      .select()
      .from(storeWishlist)
      .where(and(eq(storeWishlist.tenantId, tenantId), eq(storeWishlist.customerId, c.id)))
      .orderBy(desc(storeWishlist.createdAt));
    if (!rows.length) return { items: [], total: 0 };
    const products = new Map((await this.deps.catalog.getProducts(tenantId, rows.map((r) => r.productId))).map((p) => [p.id, p]));
    const items: WishlistItem[] = [];
    for (const r of rows) {
      const p = products.get(r.productId);
      if (!p) continue; // deleted product: hide it
      items.push({
        productId: p.id,
        name: p.name,
        slug: p.slug,
        image: p.image,
        priceMin: p.priceMin,
        priceMax: p.priceMax,
        mrp: p.mrp,
        available: p.status === "active" && p.channels.includes("store"),
        addedAt: r.createdAt,
      });
    }
    return { items, total: items.length };
  }

  async addWishlist(tenantId: string, userId: string, body: unknown): Promise<{ items: WishlistItem[]; total: number }> {
    const b = wishlistBodySchema.parse(body ?? {});
    const c = await this.ensureCustomer(tenantId, userId);
    const [p] = await this.deps.catalog.getProducts(tenantId, [b.productId]);
    if (!p || p.status !== "active" || !p.channels.includes("store")) throw notFound("Product");
    const [n] = await this.db
      .select({ n: count() })
      .from(storeWishlist)
      .where(and(eq(storeWishlist.tenantId, tenantId), eq(storeWishlist.customerId, c.id)));
    if ((n?.n ?? 0) >= MAX_WISHLIST) throw conflict(`Your wishlist can hold up to ${MAX_WISHLIST} products`);
    await this.db.insert(storeWishlist).values({ tenantId, customerId: c.id, productId: p.id }).onConflictDoNothing();
    return this.listWishlist(tenantId, userId);
  }

  async removeWishlist(tenantId: string, userId: string, productId: string): Promise<{ ok: true }> {
    const c = await this.ensureCustomer(tenantId, userId);
    await this.db
      .delete(storeWishlist)
      .where(and(eq(storeWishlist.tenantId, tenantId), eq(storeWishlist.customerId, c.id), eq(storeWishlist.productId, productId)));
    return { ok: true };
  }
}

