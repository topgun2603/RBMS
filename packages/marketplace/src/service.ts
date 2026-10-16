import { AppError, badRequest, conflict, forbidden, newId, notFound, type FeatureGatePort } from "@srirealtime/core";
import type { Db, DbOrTx } from "@srirealtime/db";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { createSecretBox, type SecretBox } from "./crypto";
import { MARKETPLACE_FEATURE, PAYOUTS_FEATURE } from "./features";
import {
  canDecideReview,
  canSetVendorStatus,
  effectiveCommissionBps,
  istDateOf,
  istMidnight,
  LEDGER_REF,
  LEDGER_TYPES,
  ledgerBalance,
  maskPayoutAccount,
  orderAdvanceTarget,
  PAYOUT_ACCOUNT_STATUSES,
  PAYOUT_STATUSES,
  payoutAccountSchema,
  pickVendor,
  planFulfilment,
  planPayouts,
  planVendorOrderUpdate,
  PRODUCT_REVIEW_STATUSES,
  reversalEntries,
  reviewAfterEvent,
  saleEntries,
  SETTLEMENT_STATUSES,
  SLUG_RE,
  slugify,
  splitOrder,
  uniqueSlug,
  VENDOR_KYC_STATUSES,
  VENDOR_STATUSES,
  VENDOR_USER_ROLES,
  type FulfilmentAction,
  type LedgerBalance,
  type ListingEventType,
  type LedgerDraft,
  type LedgerType,
  type MaskedPayoutAccount,
  type PayoutAccount,
  type PayoutAccountStatus,
  type PayoutCandidate,
  type PayoutSkipReason,
  type PayoutStatus,
  type ProductReviewStatus,
  type SettlementStatus,
  type VendorKycStatus,
  type VendorMembership,
  type VendorOrderLine,
  type VendorStatus,
  type VendorUserRole,
} from "./logic";
import { ManualPayoutDriver, MockPayoutDriver, RouteTransferDriver, type PayoutDriver, type PayoutOutcome } from "./payouts";
import {
  noopLogger,
  ORDER_STATUSES,
  type KycStatusPort,
  type ListingPort,
  type LoggerPort,
  type MarketplaceSettingsPort,
  type NotifierPort,
  type OrderActionsPort,
  type OrderSourcePort,
  type OrderStatus,
  type ShopContactsPort,
  type StockLevel,
  type StockPort,
  type TransferPort,
  type VendorProduct,
  type VendorProductsPort,
  type VendorVariant,
} from "./ports";
import {
  vendorLedger,
  vendorOrders,
  vendorPayouts,
  vendorProductReviews,
  vendors,
  vendorUsers,
  type VendorAddress,
  type VendorLedgerRow,
  type VendorOrderRow,
  type VendorPayoutRow,
  type VendorProductReviewRow,
  type VendorRow,
} from "./schema";
import { resolveSettings, type MarketplaceSettings, type PayoutProvider } from "./settings";

export interface MarketplaceConfig {
  /** Any length; a 32-byte AES key is derived with sha256 (may be the secret payments uses). */
  encryptionKey: string;
  /** Development: allow the `mock` payout provider (paid at once, no money moves). */
  allowMock: boolean;
}

export interface MarketplaceDeps {
  db: Db;
  config: MarketplaceConfig;
  settings: MarketplaceSettingsPort;
  /** Orders with each line's seller. Without it `syncOrder` does nothing. */
  orders?: OrderSourcePort;
  /** Seller product counts/lists (catalogue). Without it counts are null and lists empty. */
  products?: VendorProductsPort;
  /** Razorpay Route transfers. Needed for the `razorpayRoute` payout provider. */
  transfers?: TransferPort;
  /** Seller KYC from the kyc module; without it the vendor row's `kycStatus` (set by staff) is used. */
  kyc?: KycStatusPort;
  notifier?: NotifierPort;
  /** Publishes approved seller products (catalogue). Needed to approve product reviews. */
  listings?: ListingPort;
  /** Inventory for the seller stock routes (with `products.variants`). */
  stock?: StockPort;
  /** Moves the whole order when every seller part is packed/shipped (orders). Without it only the seller part moves. */
  orderActions?: OrderActionsPort;
  /** Shop owners/admins to tell when a seller packs or ships. */
  shopContacts?: ShopContactsPort;
  /** Checks `marketplace` / `marketplace.payouts` outside the request pipeline (order hooks, jobs). Absent = on. */
  featureGate?: FeatureGatePort;
  log?: LoggerPort;
  now?: () => Date;
  /** Tests: fixed drivers per provider. */
  drivers?: Partial<Record<PayoutProvider, PayoutDriver>>;
}

// ------------------------------------------------------------------ DTOs

export interface ListResult<T> {
  items: T[];
  total: number;
}

export interface Vendor {
  id: string;
  name: string;
  slug: string;
  status: VendorStatus;
  kycStatus: VendorKycStatus;
  /** The seller's own rate; null = shop default. */
  commissionBps: number | null;
  effectiveCommissionBps: number;
  description: string | null;
  logoUrl: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  gstin: string | null;
  address: VendorAddress | null;
  payoutAccount: MaskedPayoutAccount | null;
  payoutAccountStatus: PayoutAccountStatus;
  notes: string | null;
  /** The seller's own stock location; null = the shop's default location. */
  stockLocationId: string | null;
  approvedAt: Date | null;
  suspendedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface VendorUser {
  userId: string;
  role: VendorUserRole;
  createdAt: Date;
}

export interface VendorDetail extends Vendor {
  users: VendorUser[];
  balance: LedgerBalance;
  /** Null when the catalogue isn't connected. */
  productCount: number | null;
}

/** What a seller sees about themselves (no staff notes). */
export type VendorSelf = Omit<Vendor, "notes"> & { role: VendorUserRole; balance: LedgerBalance; productCount: number | null };

export interface VendorOrder {
  id: string;
  orderId: string;
  orderNumber: string;
  vendorId: string;
  vendorName?: string;
  lines: VendorOrderLine[];
  subtotal: number;
  discount: number;
  shippingShare: number;
  commissionBps: number;
  commission: number;
  net: number;
  status: OrderStatus;
  settlementStatus: SettlementStatus;
  placedAt: Date;
  deliveredAt: Date | null;
  eligibleAt: Date | null;
  settledAt: Date | null;
  payoutId: string | null;
  /** The seller's own packed / shipped marks (the order status may lag on split orders). */
  packedAt: Date | null;
  shippedAt: Date | null;
  carrier: string | null;
  trackingNumber: string | null;
}

export interface ProductReview {
  id: string;
  vendorId: string;
  vendorName?: string;
  productId: string;
  productName: string;
  productImage: string | null;
  status: ProductReviewStatus;
  reason: string | null;
  /** Re-review of a live product the seller changed after approval (it stays live meanwhile). */
  changedAfterApproval: boolean;
  /** What changed: name, description, images, price, variants, gst. */
  changedFields: string[];
  submittedAt: Date;
  reviewedAt: Date | null;
}

/** One variant of a seller's product with its stock at the seller's location. */
export interface VendorStockItem extends VendorVariant {
  qty: number;
  reserved: number;
  available: number;
  track: boolean;
  stockStatus: string;
}

export interface LedgerEntry {
  id: string;
  vendorId: string;
  vendorName?: string;
  type: LedgerType;
  amount: number;
  refType: string | null;
  refId: string | null;
  note: string | null;
  createdAt: Date;
}

export interface Payout {
  id: string;
  vendorId: string;
  vendorName?: string;
  amount: number;
  status: PayoutStatus;
  provider: PayoutProvider;
  providerRef: string | null;
  attempts: number;
  error: string | null;
  periodFrom: Date | null;
  periodTo: Date;
  createdAt: Date;
  paidAt: Date | null;
}

export interface PayoutRunResult {
  until: Date;
  /** Sales that became payable during this run. */
  released: number;
  created: Payout[];
  skipped: { vendorId: string; vendorName: string; reason: PayoutSkipReason; balance: number }[];
}

/** A seller as the storefront shows it ("Sold by …" links): active sellers only, no contact or payout data. */
export interface PublicSellerCard {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
}

export interface PublicSellers {
  items: PublicSellerCard[];
  /** productId → seller id, for the requested products sold by an active seller (shop products are left out). */
  products: Record<string, string>;
}

/** Most ids per lookup (`ids` and `productIds` each). */
export const PUBLIC_SELLERS_MAX = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface PublicVendor {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  productCount: number | null;
  products: ListResult<VendorProduct>;
}

// ------------------------------------------------------------------ input

const opt = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), s.nullable().optional());
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const addressSchema = z.object({
  line1: z.string().trim().min(1).max(200),
  line2: opt(z.string().trim().max(200)),
  city: z.string().trim().min(1).max(80),
  district: opt(z.string().trim().max(80)),
  stateCode: z.string().trim().regex(/^[0-9]{2}$/, "Invalid state code"),
  pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/, "Invalid PIN code"),
});

/** Indian mobiles become +91XXXXXXXXXX; anything else is kept as typed. */
export function normalizePhone(v: string): string {
  const d = v.replace(/[^0-9+]/g, "");
  const digits = d.replace(/\D/g, "");
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;
  if (/^0[6-9]\d{9}$/.test(digits)) return `+91${digits.slice(1)}`;
  return v.trim();
}

const profileFields = {
  name: z.string().trim().min(2).max(120),
  description: opt(z.string().trim().max(2000)),
  logoUrl: opt(z.string().trim().url().max(500)),
  contactName: opt(z.string().trim().max(120)),
  contactPhone: opt(z.string().trim().max(20).transform(normalizePhone)),
  contactEmail: opt(z.string().trim().email().max(200)),
  gstin: opt(
    z
      .string()
      .trim()
      .transform((s) => s.toUpperCase())
      .refine((s) => GSTIN_RE.test(s), "Invalid GSTIN"),
  ),
  address: addressSchema.nullable().optional(),
};

const bpsSchema = z.number().int().min(0).max(10_000);
const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(SLUG_RE, "Use 1–60 lowercase letters, digits and hyphens");

export const vendorInputSchema = z.object({
  ...profileFields,
  slug: slugSchema.optional(),
  commissionBps: bpsSchema.nullable().optional(),
  status: z.enum(["pending", "active"]).default("active"),
  /** Signed-in user who becomes the seller's owner. */
  ownerUserId: z.string().uuid().optional(),
  notes: opt(z.string().trim().max(2000)),
});
export type VendorInput = z.input<typeof vendorInputSchema>;

export const vendorPatchSchema = z
  .object({
    ...profileFields,
    slug: slugSchema,
    commissionBps: bpsSchema.nullable(),
    kycStatus: z.enum(VENDOR_KYC_STATUSES),
    payoutAccountStatus: z.enum(PAYOUT_ACCOUNT_STATUSES),
    notes: opt(z.string().trim().max(2000)),
    stockLocationId: z.string().uuid().nullable(),
  })
  .partial();
export type VendorPatch = z.input<typeof vendorPatchSchema>;

export const profilePatchSchema = z.object(profileFields).partial();
export type ProfilePatch = z.input<typeof profilePatchSchema>;

export const applySchema = z.object({
  ...profileFields,
  contactName: z.string().trim().min(2).max(120),
  contactPhone: z.string().trim().min(10).max(20).transform(normalizePhone),
});
export type ApplyInput = z.input<typeof applySchema>;

export const vendorUserSchema = z.object({ userId: z.string().uuid(), role: z.enum(VENDOR_USER_ROLES).default("staff") });
export const adjustmentSchema = z.object({
  amount: z
    .number()
    .int()
    .min(-100_000_000)
    .max(100_000_000)
    .refine((n) => n !== 0, "Amount can't be zero"),
  note: z.string().trim().min(3).max(500),
});
export type AdjustmentInput = z.input<typeof adjustmentSchema>;

export const markPaidSchema = z.object({ reference: z.string().trim().min(1).max(120) });

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const page = {
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
};

export const vendorListQuery = z.object({ q: z.string().trim().max(100).optional(), status: z.enum(VENDOR_STATUSES).optional(), ...page });
export const vendorOrderListQuery = z.object({
  vendorId: z.string().uuid().optional(),
  orderId: z.string().uuid().optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  settlementStatus: z.enum(SETTLEMENT_STATUSES).optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  ...page,
});
export const ledgerListQuery = z.object({
  vendorId: z.string().uuid().optional(),
  type: z.enum(LEDGER_TYPES).optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  ...page,
});
export const payoutListQuery = z.object({
  vendorId: z.string().uuid().optional(),
  status: z.enum(PAYOUT_STATUSES).optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  ...page,
});
export const runPayoutsSchema = z.object({
  /** Last IST day whose payable sales are included (default today). */
  until: dateStr.optional(),
  vendorId: z.string().uuid().optional(),
});

const idList = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? v : [v]).flatMap((x) => x.split(",")).map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(z.string().uuid()).max(200));

export const reviewListQuery = z.object({
  status: z.enum(PRODUCT_REVIEW_STATUSES).optional(),
  vendorId: z.string().uuid().optional(),
  productIds: idList.optional(),
  ...page,
});
export const rejectReviewSchema = z.object({ reason: z.string().trim().min(3, "Tell the seller what to change").max(500) });
export const stockQuery = z.object({ productIds: idList.optional() });
export const stockAdjustSchema = z
  .object({
    mode: z.enum(["set", "add", "remove"]),
    qty: z.number().min(0).max(10_000_000),
    reason: z.string().trim().min(3, "Give a reason").max(200),
  })
  .superRefine((b, ctx) => {
    if (b.mode !== "set" && b.qty <= 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["qty"], message: "Quantity must be more than 0" });
  });
export const shipSchema = z.object({
  carrier: opt(z.string().trim().max(60)),
  trackingNumber: z.string().trim().min(3, "Enter the tracking number").max(80),
});

export type VendorListQuery = z.input<typeof vendorListQuery>;
export type ReviewListQuery = z.input<typeof reviewListQuery>;
export type StockAdjustInput = z.input<typeof stockAdjustSchema>;
export type ShipInput = z.input<typeof shipSchema>;
export type VendorOrderListQuery = z.input<typeof vendorOrderListQuery>;
export type LedgerListQuery = z.input<typeof ledgerListQuery>;
export type PayoutListQuery = z.input<typeof payoutListQuery>;

// ------------------------------------------------------------------ mapping

const DAY_MS = 86_400_000;
const sumAmount = sql<number>`coalesce(sum(${vendorLedger.amount}), 0)`.mapWith(Number);

/** IST date range → [start, end) instants. */
function istRange(from?: string, to?: string): { start: Date | null; end: Date | null } {
  return {
    start: from ? istMidnight(from) : null,
    end: to ? new Date(istMidnight(to).getTime() + DAY_MS) : null,
  };
}

const toVendorOrder = (r: VendorOrderRow, vendorName?: string): VendorOrder => ({
  id: r.id,
  orderId: r.orderId,
  orderNumber: r.orderNumber,
  vendorId: r.vendorId,
  ...(vendorName !== undefined ? { vendorName } : {}),
  lines: r.lines,
  subtotal: r.subtotal,
  discount: r.discount,
  shippingShare: r.shippingShare,
  commissionBps: r.commissionBps,
  commission: r.commission,
  net: r.net,
  status: r.status,
  settlementStatus: r.settlementStatus,
  placedAt: r.placedAt,
  deliveredAt: r.deliveredAt,
  eligibleAt: r.eligibleAt,
  settledAt: r.settledAt,
  payoutId: r.payoutId,
  packedAt: r.packedAt ?? null,
  shippedAt: r.shippedAt ?? null,
  carrier: r.carrier ?? null,
  trackingNumber: r.trackingNumber ?? null,
});

const toReview = (r: VendorProductReviewRow, vendorName?: string): ProductReview => ({
  id: r.id,
  vendorId: r.vendorId,
  ...(vendorName !== undefined ? { vendorName } : {}),
  productId: r.productId,
  productName: r.productName,
  productImage: r.productImage,
  status: r.status,
  reason: r.reason,
  changedAfterApproval: r.changedAfterApproval ?? false,
  changedFields: r.changedFields ?? [],
  submittedAt: r.submittedAt,
  reviewedAt: r.reviewedAt,
});

const toLedgerEntry = (r: VendorLedgerRow, vendorName?: string): LedgerEntry => ({
  id: r.id,
  vendorId: r.vendorId,
  ...(vendorName !== undefined ? { vendorName } : {}),
  type: r.type,
  amount: r.amount,
  refType: r.refType,
  refId: r.refId,
  note: r.note,
  createdAt: r.createdAt,
});

const toPayout = (r: VendorPayoutRow, vendorName?: string): Payout => ({
  id: r.id,
  vendorId: r.vendorId,
  ...(vendorName !== undefined ? { vendorName } : {}),
  amount: r.amount,
  status: r.status,
  provider: r.provider,
  providerRef: r.providerRef,
  attempts: r.attempts,
  error: r.error,
  periodFrom: r.periodFrom,
  periodTo: r.periodTo,
  createdAt: r.createdAt,
  paidAt: r.paidAt,
});

export const moneyText = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const withLevel = (v: VendorVariant, l: StockLevel | undefined): VendorStockItem => ({
  ...v,
  qty: l?.qty ?? 0,
  reserved: l?.reserved ?? 0,
  available: l?.available ?? 0,
  track: l?.track ?? true,
  stockStatus: l?.status ?? "out",
});

const isUniqueViolation = (err: unknown) => (err as { code?: string } | null)?.code === "23505";

/** Kyc module statuses → the vendor row's vocabulary. */
const kycColumn = (s: string | null | undefined): VendorKycStatus =>
  s === "verified" || s === "failed" || s === "pending" ? s : s === "manual_review" ? "pending" : "none";

// ------------------------------------------------------------------ service

export class MarketplaceService {
  private readonly db: Db;
  private readonly box: SecretBox;
  private readonly log: LoggerPort;
  private readonly now: () => Date;
  readonly allowMock: boolean;

  constructor(private readonly deps: MarketplaceDeps) {
    this.db = deps.db;
    this.box = createSecretBox(deps.config.encryptionKey);
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
    this.allowMock = deps.config.allowMock;
  }

  async settings(tenantId: string): Promise<MarketplaceSettings> {
    return resolveSettings((await this.deps.settings.get(tenantId)) ?? null);
  }

  private async featureOn(tenantId: string, key: string) {
    if (!this.deps.featureGate) return true;
    try {
      return await this.deps.featureGate.isEnabled(tenantId, key);
    } catch (err) {
      this.log.warn({ err, tenantId, key }, "marketplace: feature check failed");
      return false;
    }
  }

  // ---------------------------------------------------------------- vendors (staff)

  private toVendor(r: VendorRow, defaultBps: number): Vendor {
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      status: r.status,
      kycStatus: r.kycStatus,
      commissionBps: r.commissionBps,
      effectiveCommissionBps: effectiveCommissionBps(r.commissionBps, defaultBps),
      description: r.description,
      logoUrl: r.logoUrl,
      contactName: r.contactName,
      contactPhone: r.contactPhone,
      contactEmail: r.contactEmail,
      gstin: r.gstin,
      address: r.address ?? null,
      payoutAccount: r.payoutAccountMasked ?? null,
      payoutAccountStatus: r.payoutAccountStatus,
      notes: r.notes,
      stockLocationId: r.stockLocationId ?? null,
      approvedAt: r.approvedAt,
      suspendedAt: r.suspendedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  private async vendorRow(db: DbOrTx, tenantId: string, id: string): Promise<VendorRow> {
    const [row] = await db
      .select()
      .from(vendors)
      .where(and(eq(vendors.tenantId, tenantId), eq(vendors.id, id)))
      .limit(1);
    if (!row) throw notFound("Seller");
    return row;
  }

  async listVendors(tenantId: string, query: VendorListQuery = {}): Promise<ListResult<Vendor> & { counts: Record<VendorStatus, number> }> {
    const q = vendorListQuery.parse(query);
    const base: SQL[] = [eq(vendors.tenantId, tenantId)];
    if (q.q) {
      const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      base.push(or(ilike(vendors.name, like), ilike(vendors.slug, like), ilike(vendors.contactPhone, like))!);
    }
    const where = q.status ? and(...base, eq(vendors.status, q.status)) : and(...base);
    const [rows, [totalRow], countRows, s] = await Promise.all([
      this.db.select().from(vendors).where(where).orderBy(desc(vendors.createdAt), asc(vendors.id)).limit(q.limit).offset(q.offset),
      this.db.select({ n: count() }).from(vendors).where(where),
      this.db.select({ status: vendors.status, n: count() }).from(vendors).where(and(...base)).groupBy(vendors.status),
      this.settings(tenantId),
    ]);
    const counts = Object.fromEntries(VENDOR_STATUSES.map((st) => [st, 0])) as Record<VendorStatus, number>;
    for (const c of countRows) counts[c.status] = Number(c.n);
    return { items: rows.map((r) => this.toVendor(r, s.defaultCommissionBps)), total: Number(totalRow?.n ?? 0), counts };
  }

  async balance(tenantId: string, vendorId: string, db: DbOrTx = this.db): Promise<LedgerBalance> {
    const rows = await db
      .select({ type: vendorLedger.type, amount: sumAmount })
      .from(vendorLedger)
      .where(and(eq(vendorLedger.tenantId, tenantId), eq(vendorLedger.vendorId, vendorId)))
      .groupBy(vendorLedger.type);
    return ledgerBalance(rows.map((r) => ({ type: r.type, amount: Number(r.amount) })));
  }

  private async productCount(tenantId: string, vendorId: string, publicOnly = false): Promise<number | null> {
    if (!this.deps.products) return null;
    try {
      return await this.deps.products.count(tenantId, vendorId, { publicOnly });
    } catch (err) {
      this.log.warn({ err, tenantId, vendorId }, "marketplace: product count failed");
      return null;
    }
  }

  async getVendor(tenantId: string, id: string): Promise<VendorDetail> {
    const row = await this.vendorRow(this.db, tenantId, id);
    const [users, balance, productCount, s] = await Promise.all([
      this.db
        .select({ userId: vendorUsers.userId, role: vendorUsers.role, createdAt: vendorUsers.createdAt })
        .from(vendorUsers)
        .where(and(eq(vendorUsers.tenantId, tenantId), eq(vendorUsers.vendorId, id)))
        .orderBy(asc(vendorUsers.createdAt)),
      this.balance(tenantId, id),
      this.productCount(tenantId, id),
      this.settings(tenantId),
    ]);
    return { ...this.toVendor(row, s.defaultCommissionBps), users, balance, productCount };
  }

  /** A free slug: `wanted` (must be unused) or one made from the name. */
  private async allocSlug(db: DbOrTx, tenantId: string, name: string, wanted?: string, exceptId?: string): Promise<string> {
    if (wanted) {
      const [hit] = await db
        .select({ id: vendors.id })
        .from(vendors)
        .where(and(eq(vendors.tenantId, tenantId), eq(vendors.slug, wanted)))
        .limit(1);
      if (hit && hit.id !== exceptId) throw conflict("Another seller already uses this web address");
      return wanted;
    }
    const base = slugify(name) ?? `seller-${newId().slice(0, 6)}`;
    const taken = await db
      .select({ slug: vendors.slug })
      .from(vendors)
      .where(and(eq(vendors.tenantId, tenantId), or(eq(vendors.slug, base), ilike(vendors.slug, `${base}-%`))));
    return uniqueSlug(base, new Set(taken.map((t) => t.slug)));
  }

  async createVendor(tenantId: string, input: VendorInput): Promise<VendorDetail> {
    const b = vendorInputSchema.parse(input);
    const now = this.now();
    const id = await this.db.transaction(async (tx) => {
      const slug = await this.allocSlug(tx, tenantId, b.name, b.slug);
      const [row] = await tx
        .insert(vendors)
        .values({
          tenantId,
          name: b.name,
          slug,
          status: b.status,
          commissionBps: b.commissionBps ?? null,
          description: b.description ?? null,
          logoUrl: b.logoUrl ?? null,
          contactName: b.contactName ?? null,
          contactPhone: b.contactPhone ?? null,
          contactEmail: b.contactEmail ?? null,
          gstin: b.gstin ?? null,
          address: b.address ?? null,
          notes: b.notes ?? null,
          approvedAt: b.status === "active" ? now : null,
        })
        .returning({ id: vendors.id });
      if (b.ownerUserId) await tx.insert(vendorUsers).values({ tenantId, vendorId: row!.id, userId: b.ownerUserId, role: "owner" });
      return row!.id;
    }).catch((err: unknown) => {
      if (isUniqueViolation(err)) throw conflict("Another seller already uses this web address");
      throw err;
    });
    return this.getVendor(tenantId, id);
  }

  async updateVendor(tenantId: string, id: string, patch: VendorPatch): Promise<VendorDetail> {
    const b = vendorPatchSchema.parse(patch);
    const row = await this.vendorRow(this.db, tenantId, id);
    if (b.payoutAccountStatus && b.payoutAccountStatus !== "none" && !row.payoutAccountEnc)
      throw badRequest("The seller has no payout account yet");
    const set: Partial<typeof vendors.$inferInsert> = {};
    for (const k of ["name", "description", "logoUrl", "contactName", "contactPhone", "contactEmail", "gstin", "address", "notes", "kycStatus", "payoutAccountStatus", "stockLocationId"] as const) {
      if (b[k] !== undefined) (set as Record<string, unknown>)[k] = b[k];
    }
    if (b.commissionBps !== undefined) set.commissionBps = b.commissionBps;
    if (b.slug && b.slug !== row.slug) set.slug = await this.allocSlug(this.db, tenantId, row.name, b.slug, id);
    if (Object.keys(set).length) {
      await this.db
        .update(vendors)
        .set(set)
        .where(and(eq(vendors.tenantId, tenantId), eq(vendors.id, id)))
        .catch((err: unknown) => {
          if (isUniqueViolation(err)) throw conflict("Another seller already uses this web address");
          throw err;
        });
    }
    return this.getVendor(tenantId, id);
  }

  /** Approve (→ active) or suspend. 409 for other moves. */
  async setVendorStatus(tenantId: string, id: string, status: "active" | "suspended"): Promise<VendorDetail> {
    const row = await this.vendorRow(this.db, tenantId, id);
    if (!canSetVendorStatus(row.status, status)) throw conflict(`A ${row.status} seller can't be made ${status}`);
    const now = this.now();
    await this.db
      .update(vendors)
      .set(status === "active" ? { status, approvedAt: row.approvedAt ?? now, suspendedAt: null } : { status, suspendedAt: now })
      .where(and(eq(vendors.tenantId, tenantId), eq(vendors.id, id), eq(vendors.status, row.status)));
    if (status === "active" && row.status === "pending") {
      await this.notifyVendor(tenantId, row, "marketplace.vendor_approved", { vendorName: row.name });
    }
    return this.getVendor(tenantId, id);
  }

  /** Only sellers that never sold anything; others are suspended instead. */
  async deleteVendor(tenantId: string, id: string): Promise<void> {
    await this.vendorRow(this.db, tenantId, id);
    const [[o], [l]] = await Promise.all([
      this.db.select({ n: count() }).from(vendorOrders).where(and(eq(vendorOrders.tenantId, tenantId), eq(vendorOrders.vendorId, id))),
      this.db.select({ n: count() }).from(vendorLedger).where(and(eq(vendorLedger.tenantId, tenantId), eq(vendorLedger.vendorId, id))),
    ]);
    if (Number(o?.n ?? 0) > 0 || Number(l?.n ?? 0) > 0) throw conflict("This seller has orders or ledger entries; suspend them instead");
    await this.db.delete(vendors).where(and(eq(vendors.tenantId, tenantId), eq(vendors.id, id)));
  }

  async addVendorUser(tenantId: string, vendorId: string, input: { userId: string; role?: VendorUserRole }): Promise<VendorDetail> {
    const b = vendorUserSchema.parse(input);
    await this.vendorRow(this.db, tenantId, vendorId);
    await this.db
      .insert(vendorUsers)
      .values({ tenantId, vendorId, userId: b.userId, role: b.role })
      .onConflictDoUpdate({ target: [vendorUsers.vendorId, vendorUsers.userId], set: { role: b.role } });
    return this.getVendor(tenantId, vendorId);
  }

  async removeVendorUser(tenantId: string, vendorId: string, userId: string): Promise<VendorDetail> {
    await this.vendorRow(this.db, tenantId, vendorId);
    const users = await this.db
      .select({ userId: vendorUsers.userId, role: vendorUsers.role })
      .from(vendorUsers)
      .where(and(eq(vendorUsers.tenantId, tenantId), eq(vendorUsers.vendorId, vendorId)));
    const target = users.find((u) => u.userId === userId);
    if (!target) throw notFound("Seller user");
    if (target.role === "owner" && users.filter((u) => u.role === "owner").length === 1)
      throw conflict("A seller needs at least one owner");
    await this.db
      .delete(vendorUsers)
      .where(and(eq(vendorUsers.tenantId, tenantId), eq(vendorUsers.vendorId, vendorId), eq(vendorUsers.userId, userId)));
    return this.getVendor(tenantId, vendorId);
  }

  /**
   * Saves the payout account encrypted. Entered by staff → verified; by the seller → pending until staff verify it
   * (a changed account can't receive money unchecked).
   */
  async setPayoutAccount(
    tenantId: string,
    vendorId: string,
    input: unknown,
    by: "staff" | "vendor",
  ): Promise<{ payoutAccount: MaskedPayoutAccount; payoutAccountStatus: PayoutAccountStatus }> {
    const account = payoutAccountSchema.parse(input);
    await this.vendorRow(this.db, tenantId, vendorId);
    const masked = maskPayoutAccount(account);
    const status: PayoutAccountStatus = by === "staff" ? "verified" : "pending";
    await this.db
      .update(vendors)
      .set({ payoutAccountEnc: this.box.encrypt(JSON.stringify(account)), payoutAccountMasked: masked, payoutAccountStatus: status })
      .where(and(eq(vendors.tenantId, tenantId), eq(vendors.id, vendorId)));
    return { payoutAccount: masked, payoutAccountStatus: status };
  }

  /** The decrypted account, or null when none / unreadable. */
  payoutAccountOf(row: Pick<VendorRow, "id" | "payoutAccountEnc">): PayoutAccount | null {
    if (!row.payoutAccountEnc) return null;
    try {
      return payoutAccountSchema.parse(JSON.parse(this.box.decrypt(row.payoutAccountEnc)));
    } catch (err) {
      this.log.error({ err, vendorId: row.id }, "marketplace: payout account unreadable");
      return null;
    }
  }

  // ---------------------------------------------------------------- vendor scoping

  async memberships(tenantId: string, userId: string): Promise<VendorMembership[]> {
    const rows = await this.db
      .select({ vendorId: vendors.id, slug: vendors.slug, name: vendors.name, role: vendorUsers.role })
      .from(vendorUsers)
      .innerJoin(vendors, eq(vendors.id, vendorUsers.vendorId))
      .where(and(eq(vendorUsers.tenantId, tenantId), eq(vendors.tenantId, tenantId), eq(vendorUsers.userId, userId)))
      .orderBy(asc(vendors.name));
    return rows;
  }

  /**
   * The seller a signed-in user acts for (`x-vendor` header = id or slug when they belong to several).
   * 403 when they aren't a member (of that seller); 400 `vendor_required` `{ vendors }` when they must choose.
   * Exported for kit: catalogue routes use it to scope product writes to the seller's products.
   */
  async resolveVendor(tenantId: string, userId: string, header?: string | null): Promise<{ vendor: VendorRow; role: VendorUserRole }> {
    const pick = pickVendor(await this.memberships(tenantId, userId), header);
    if (!pick.ok) {
      if (pick.reason === "vendor_required")
        throw new AppError(400, "vendor_required", "Choose a seller with the x-vendor header", { vendors: pick.vendors });
      throw forbidden(pick.reason === "not_a_vendor" ? "You're not a seller in this shop" : "You're not a member of this seller");
    }
    const vendor = await this.vendorRow(this.db, tenantId, pick.membership.vendorId);
    return { vendor, role: pick.membership.role };
  }

  async vendorSelf(tenantId: string, vendor: VendorRow, role: VendorUserRole): Promise<VendorSelf> {
    const [balance, productCount, s] = await Promise.all([this.balance(tenantId, vendor.id), this.productCount(tenantId, vendor.id), this.settings(tenantId)]);
    const { notes: _n, ...v } = this.toVendor(vendor, s.defaultCommissionBps);
    return { ...v, role, balance, productCount };
  }

  /** Seller edits their own profile (not slug, status, commission or KYC). Suspended sellers can't. */
  async updateProfile(tenantId: string, vendor: VendorRow, role: VendorUserRole, patch: ProfilePatch): Promise<VendorSelf> {
    if (vendor.status === "suspended") throw forbidden("This seller account is suspended");
    const b = profilePatchSchema.parse(patch);
    const set: Partial<typeof vendors.$inferInsert> = {};
    for (const k of Object.keys(b) as (keyof typeof b)[]) if (b[k] !== undefined) (set as Record<string, unknown>)[k] = b[k];
    if (Object.keys(set).length) await this.db.update(vendors).set(set).where(and(eq(vendors.tenantId, tenantId), eq(vendors.id, vendor.id)));
    return this.vendorSelf(tenantId, await this.vendorRow(this.db, tenantId, vendor.id), role);
  }

  async vendorProducts(tenantId: string, vendorId: string, q: { limit?: number; offset?: number; q?: string; publicOnly?: boolean } = {}) {
    if (!this.deps.products) return { items: [] as VendorProduct[], total: 0 };
    return this.deps.products.list(tenantId, vendorId, {
      limit: Math.min(Math.max(q.limit ?? 24, 1), 100),
      offset: Math.max(q.offset ?? 0, 0),
      ...(q.q ? { q: q.q } : {}),
      ...(q.publicOnly ? { publicOnly: true } : {}),
    });
  }

  // ---------------------------------------------------------------- public

  async publicVendor(tenantId: string, slug: string, q: { limit?: number; offset?: number } = {}): Promise<PublicVendor> {
    const [row] = await this.db
      .select()
      .from(vendors)
      .where(and(eq(vendors.tenantId, tenantId), eq(vendors.slug, slug.toLowerCase()), eq(vendors.status, "active")))
      .limit(1);
    if (!row) throw notFound("Seller");
    const [productCount, products] = await Promise.all([
      this.productCount(tenantId, row.id, true),
      this.vendorProducts(tenantId, row.id, { ...q, publicOnly: true }).catch((err: unknown) => {
        this.log.warn({ err, tenantId, vendorId: row.id }, "marketplace: seller products failed");
        return { items: [] as VendorProduct[], total: 0 };
      }),
    ]);
    return { id: row.id, name: row.name, slug: row.slug, description: row.description, logoUrl: row.logoUrl, productCount, products };
  }

  /**
   * `GET /public/sellers?ids=&productIds=`: storefront "Sold by" cards for seller ids and/or the sellers of product ids
   * (cart lines). Only active sellers of this shop; ids that aren't uuids are ignored; at most `PUBLIC_SELLERS_MAX` each.
   */
  async publicSellers(tenantId: string, q: { ids?: string[]; productIds?: string[] } = {}): Promise<PublicSellers> {
    const clean = (l: string[] | undefined) => [...new Set((l ?? []).map((s) => s.trim().toLowerCase()).filter((s) => UUID_RE.test(s)))].slice(0, PUBLIC_SELLERS_MAX);
    const ids = clean(q.ids);
    const productIds = clean(q.productIds);
    let byProduct: Record<string, string | null> = {};
    if (productIds.length && this.deps.products?.productVendors) {
      try {
        byProduct = await this.deps.products.productVendors(tenantId, productIds);
      } catch (err) {
        this.log.warn({ err, tenantId }, "marketplace: product sellers lookup failed");
      }
    }
    const wanted = [...new Set([...ids, ...Object.values(byProduct).filter((v): v is string => !!v)])];
    if (!wanted.length) return { items: [], products: {} };
    const rows = await this.db
      .select({ id: vendors.id, name: vendors.name, slug: vendors.slug, logoUrl: vendors.logoUrl })
      .from(vendors)
      .where(and(eq(vendors.tenantId, tenantId), inArray(vendors.id, wanted), eq(vendors.status, "active")));
    const active = new Set(rows.map((r) => r.id));
    const products: Record<string, string> = {};
    for (const [p, v] of Object.entries(byProduct)) if (v && active.has(v)) products[p] = v;
    return { items: rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, logoUrl: r.logoUrl ?? null })), products };
  }

  /** A signed-in user applies to sell: a pending seller with them as owner. One pending application per user. */
  async apply(tenantId: string, userId: string, input: ApplyInput): Promise<VendorSelf> {
    const s = await this.settings(tenantId);
    if (!s.acceptApplications) throw forbidden("This shop isn't accepting seller applications");
    const b = applySchema.parse(input);
    const mine = await this.db
      .select({ status: vendors.status })
      .from(vendorUsers)
      .innerJoin(vendors, eq(vendors.id, vendorUsers.vendorId))
      .where(and(eq(vendorUsers.tenantId, tenantId), eq(vendorUsers.userId, userId), eq(vendorUsers.role, "owner")));
    if (mine.some((m) => m.status === "pending")) throw conflict("You already have an application waiting for approval");
    const created = await this.createVendor(tenantId, { ...b, status: "pending", ownerUserId: userId });
    const row = await this.vendorRow(this.db, tenantId, created.id);
    return this.vendorSelf(tenantId, row, "owner");
  }

  // ---------------------------------------------------------------- orders

  /**
   * Creates the order's vendor orders (first call) and makes them follow the order's status. Idempotent: kit calls it
   * when an order is placed and on every status change. Returns the order's vendor orders.
   */
  async syncOrder(tenantId: string, orderId: string): Promise<VendorOrder[]> {
    if (!this.deps.orders) return [];
    if (!(await this.featureOn(tenantId, MARKETPLACE_FEATURE))) return [];
    const order = await this.deps.orders.getOrder(tenantId, orderId);
    if (!order) return [];
    const now = this.now();
    let rows = await this.db
      .select()
      .from(vendorOrders)
      .where(and(eq(vendorOrders.tenantId, tenantId), eq(vendorOrders.orderId, orderId)))
      .orderBy(asc(vendorOrders.createdAt));
    const vendorIds = [...new Set(order.lines.map((l) => l.vendorId).filter((v): v is string => !!v))];
    if (rows.length === 0 && vendorIds.length > 0) {
      const [s, known] = await Promise.all([
        this.settings(tenantId),
        this.db
          .select({ id: vendors.id, commissionBps: vendors.commissionBps, name: vendors.name, contactPhone: vendors.contactPhone, contactEmail: vendors.contactEmail })
          .from(vendors)
          .where(and(eq(vendors.tenantId, tenantId), inArray(vendors.id, vendorIds))),
      ]);
      const byId = new Map(known.map((v) => [v.id, v]));
      const unknown = vendorIds.filter((v) => !byId.has(v));
      if (unknown.length) this.log.warn({ tenantId, orderId, unknown }, "marketplace: order lines name unknown sellers; treated as the shop's own");
      const lines = order.lines.map((l) => (l.vendorId && byId.has(l.vendorId) ? l : { ...l, vendorId: null }));
      const split = splitOrder(lines, order.totals, (vid) => effectiveCommissionBps(byId.get(vid)?.commissionBps, s.defaultCommissionBps));
      if (split.vendors.length) {
        const inserted = await this.db
          .insert(vendorOrders)
          .values(
            split.vendors.map((v) => ({
              tenantId,
              orderId,
              orderNumber: order.number,
              vendorId: v.vendorId,
              lines: v.lines,
              subtotal: v.subtotal,
              discount: v.discount,
              shippingShare: v.shippingShare,
              commissionBps: v.commissionBps,
              commission: v.commission,
              net: v.net,
              status: "placed" as OrderStatus,
              settlementStatus: "pending" as SettlementStatus,
              placedAt: order.placedAt,
            })),
          )
          .onConflictDoNothing()
          .returning();
        for (const vo of inserted) {
          const v = byId.get(vo.vendorId);
          if (v) await this.notifyVendor(tenantId, v, "marketplace.vendor_order", { vendorName: v.name, orderNumber: order.number, amount: moneyText(vo.net) });
        }
        rows = await this.db
          .select()
          .from(vendorOrders)
          .where(and(eq(vendorOrders.tenantId, tenantId), eq(vendorOrders.orderId, orderId)))
          .orderBy(asc(vendorOrders.createdAt));
      }
    }
    if (rows.length === 0) return [];
    const windowDays = (await this.settings(tenantId)).returnWindowDays;
    const out: VendorOrderRow[] = [];
    for (const vo of rows) {
      const plan = planVendorOrderUpdate(vo, order, windowDays, now);
      if (!plan.changed) {
        out.push(vo);
        continue;
      }
      const updated = await this.db.transaction(async (tx) => {
        const [u] = await tx
          .update(vendorOrders)
          .set({ status: plan.next.status, settlementStatus: plan.next.settlementStatus, deliveredAt: plan.next.deliveredAt, eligibleAt: plan.next.eligibleAt })
          .where(and(eq(vendorOrders.tenantId, tenantId), eq(vendorOrders.id, vo.id), eq(vendorOrders.settlementStatus, vo.settlementStatus)))
          .returning();
        if (u && plan.reverseLedger) await this.postLedger(tx, tenantId, vo.vendorId, vo.id, reversalEntries(vo));
        return u;
      });
      out.push(updated ?? vo);
    }
    return out.map((r) => toVendorOrder(r));
  }

  private async postLedger(db: DbOrTx, tenantId: string, vendorId: string, refId: string, drafts: LedgerDraft[], createdBy: string | null = null) {
    if (!drafts.length) return;
    await db
      .insert(vendorLedger)
      .values(drafts.map((d) => ({ tenantId, vendorId, type: d.type, amount: d.amount, refType: d.refType, refId, note: d.note, createdBy })))
      .onConflictDoNothing();
  }

  async listVendorOrders(tenantId: string, query: VendorOrderListQuery = {}): Promise<ListResult<VendorOrder>> {
    const q = vendorOrderListQuery.parse(query);
    const conds: SQL[] = [eq(vendorOrders.tenantId, tenantId)];
    if (q.vendorId) conds.push(eq(vendorOrders.vendorId, q.vendorId));
    if (q.orderId) conds.push(eq(vendorOrders.orderId, q.orderId));
    if (q.status) conds.push(eq(vendorOrders.status, q.status));
    if (q.settlementStatus) conds.push(eq(vendorOrders.settlementStatus, q.settlementStatus));
    const { start, end } = istRange(q.from, q.to);
    if (start) conds.push(gte(vendorOrders.placedAt, start));
    if (end) conds.push(lt(vendorOrders.placedAt, end));
    const where = and(...conds);
    const [rows, [t]] = await Promise.all([
      this.db
        .select({ vo: vendorOrders, vendorName: vendors.name })
        .from(vendorOrders)
        .innerJoin(vendors, eq(vendors.id, vendorOrders.vendorId))
        .where(where)
        .orderBy(desc(vendorOrders.placedAt), asc(vendorOrders.id))
        .limit(q.limit)
        .offset(q.offset),
      this.db.select({ n: count() }).from(vendorOrders).where(where),
    ]);
    return { items: rows.map((r) => toVendorOrder(r.vo, r.vendorName)), total: Number(t?.n ?? 0) };
  }

  // ---------------------------------------------------------------- settlement

  /** Credits delivered sales whose return window ended by `at` (sale + commission entries). Returns how many. */
  async releaseEligible(tenantId: string, at: Date = this.now()): Promise<number> {
    let released = 0;
    for (;;) {
      const due = await this.db
        .select()
        .from(vendorOrders)
        .where(
          and(
            eq(vendorOrders.tenantId, tenantId),
            eq(vendorOrders.status, "delivered"),
            eq(vendorOrders.settlementStatus, "pending"),
            isNotNull(vendorOrders.eligibleAt),
            lte(vendorOrders.eligibleAt, at),
          ),
        )
        .orderBy(asc(vendorOrders.eligibleAt))
        .limit(200);
      let moved = 0;
      for (const vo of due) {
        const ok = await this.db.transaction(async (tx) => {
          const [u] = await tx
            .update(vendorOrders)
            .set({ settlementStatus: "eligible" })
            .where(and(eq(vendorOrders.tenantId, tenantId), eq(vendorOrders.id, vo.id), eq(vendorOrders.settlementStatus, "pending")))
            .returning({ id: vendorOrders.id });
          if (!u) return false;
          await this.postLedger(tx, tenantId, vo.vendorId, vo.id, saleEntries(vo));
          return true;
        });
        if (ok) moved++;
      }
      released += moved;
      if (due.length < 200 || moved === 0) return released;
    }
  }

  /** Daily job: release payable sales in every shop with the marketplace on. */
  async settleDue(at: Date = this.now()): Promise<{ tenants: number; released: number }> {
    const tenants = await this.db
      .selectDistinct({ tenantId: vendorOrders.tenantId })
      .from(vendorOrders)
      .where(and(eq(vendorOrders.status, "delivered"), eq(vendorOrders.settlementStatus, "pending"), lte(vendorOrders.eligibleAt, at)));
    let released = 0;
    let n = 0;
    for (const { tenantId } of tenants) {
      if (!(await this.featureOn(tenantId, MARKETPLACE_FEATURE))) continue;
      n++;
      try {
        released += await this.releaseEligible(tenantId, at);
      } catch (err) {
        this.log.error({ err, tenantId }, "marketplace: settlement failed");
      }
    }
    return { tenants: n, released };
  }

  // ---------------------------------------------------------------- payouts

  private driverFor(provider: PayoutProvider): PayoutDriver {
    const fixed = this.deps.drivers?.[provider];
    if (fixed) return fixed;
    if (provider === "mock") {
      if (!this.allowMock) throw badRequest("The mock payout provider is only for development");
      return new MockPayoutDriver();
    }
    if (provider === "razorpayRoute") {
      if (!this.deps.transfers) throw badRequest("Razorpay Route payouts aren't set up on this server");
      return new RouteTransferDriver(this.deps.transfers);
    }
    return new ManualPayoutDriver();
  }

  /** Current KYC per vendor (kyc module when connected, else the vendor row); the row is refreshed when it differs. */
  private async kycOf(tenantId: string, rows: VendorRow[]): Promise<Map<string, string>> {
    const out = new Map(rows.map((r) => [r.id, r.kycStatus as string]));
    if (!this.deps.kyc) return out;
    for (const r of rows) {
      try {
        const s = await this.deps.kyc.status(tenantId, "vendor", r.id);
        const col = kycColumn(s);
        out.set(r.id, col);
        if (col !== r.kycStatus)
          await this.db.update(vendors).set({ kycStatus: col }).where(and(eq(vendors.tenantId, tenantId), eq(vendors.id, r.id)));
      } catch (err) {
        this.log.warn({ err, tenantId, vendorId: r.id }, "marketplace: KYC status check failed");
      }
    }
    return out;
  }

  /**
   * Payout run: releases sales payable by `until` (end of that IST day, never later than now), then pays every seller
   * whose balance reaches the minimum (see `planPayouts`). Each payout debits the ledger at once (so a second run
   * can't pay the same money), marks the seller's eligible sales settled, and is sent through the shop's provider.
   */
  async runPayouts(tenantId: string, input: { until?: string; vendorId?: string } = {}, actorUserId: string | null = null): Promise<PayoutRunResult> {
    const b = runPayoutsSchema.parse(input);
    const s = await this.settings(tenantId);
    const driver = this.driverFor(s.payoutProvider);
    const now = this.now();
    const endOfDay = b.until ? new Date(istMidnight(b.until).getTime() + DAY_MS - 1) : now;
    const until = endOfDay.getTime() > now.getTime() ? now : endOfDay;
    const released = await this.releaseEligible(tenantId, until);

    const balanceConds: SQL[] = [eq(vendorLedger.tenantId, tenantId)];
    if (b.vendorId) balanceConds.push(eq(vendorLedger.vendorId, b.vendorId));
    const balances = await this.db
      .select({ vendorId: vendorLedger.vendorId, amount: sumAmount })
      .from(vendorLedger)
      .where(and(...balanceConds))
      .groupBy(vendorLedger.vendorId);
    const positive = balances.filter((x) => Number(x.amount) > 0);
    const rows = positive.length
      ? await this.db
          .select()
          .from(vendors)
          .where(and(eq(vendors.tenantId, tenantId), inArray(vendors.id, positive.map((p) => p.vendorId))))
      : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const kyc = s.requireKyc ? await this.kycOf(tenantId, rows.filter((r) => r.status === "active")) : new Map<string, string>();
    const candidates: PayoutCandidate[] = positive
      .filter((p) => byId.has(p.vendorId))
      .map((p) => {
        const r = byId.get(p.vendorId)!;
        return {
          vendorId: r.id,
          balance: Number(p.amount),
          vendorStatus: r.status,
          kycStatus: kyc.get(r.id) ?? r.kycStatus,
          payoutAccountStatus: r.payoutAccountStatus,
          accountType: r.payoutAccountMasked?.type ?? null,
        };
      });
    const plan = planPayouts(candidates, { minPayoutPaise: s.minPayoutPaise, requireKyc: s.requireKyc, provider: s.payoutProvider });
    const result: PayoutRunResult = {
      until,
      released,
      created: [],
      skipped: plan.skip.map((k) => ({ ...k, vendorName: byId.get(k.vendorId)?.name ?? "" })),
    };

    for (const p of plan.pay) {
      const vendor = byId.get(p.vendorId)!;
      const payout = await this.db.transaction(async (tx) => {
        await tx
          .select({ id: vendors.id })
          .from(vendors)
          .where(and(eq(vendors.tenantId, tenantId), eq(vendors.id, vendor.id)))
          .for("update");
        const [bal] = await tx
          .select({ amount: sumAmount })
          .from(vendorLedger)
          .where(and(eq(vendorLedger.tenantId, tenantId), eq(vendorLedger.vendorId, vendor.id)));
        const amount = Number(bal?.amount ?? 0);
        if (amount <= 0 || amount < Math.max(s.minPayoutPaise, 1)) return null;
        const [last] = await tx
          .select({ periodTo: vendorPayouts.periodTo })
          .from(vendorPayouts)
          .where(and(eq(vendorPayouts.tenantId, tenantId), eq(vendorPayouts.vendorId, vendor.id)))
          .orderBy(desc(vendorPayouts.createdAt))
          .limit(1);
        const [row] = await tx
          .insert(vendorPayouts)
          .values({
            tenantId,
            vendorId: vendor.id,
            amount,
            status: "pending",
            provider: driver.provider,
            periodFrom: last?.periodTo ?? null,
            periodTo: until,
            createdBy: actorUserId,
          })
          .returning();
        await tx.insert(vendorLedger).values({
          tenantId,
          vendorId: vendor.id,
          type: "payout",
          amount: -amount,
          refType: LEDGER_REF.payout,
          refId: row!.id,
          note: `Payout up to ${istDateOf(until)}`,
          createdBy: actorUserId,
        });
        await tx
          .update(vendorOrders)
          .set({ settlementStatus: "settled", settledAt: now, payoutId: row!.id })
          .where(and(eq(vendorOrders.tenantId, tenantId), eq(vendorOrders.vendorId, vendor.id), eq(vendorOrders.settlementStatus, "eligible")));
        return row!;
      });
      if (!payout) {
        result.skipped.push({ vendorId: vendor.id, vendorName: vendor.name, reason: "below_minimum", balance: 0 });
        continue;
      }
      result.created.push(await this.dispatch(tenantId, payout, vendor, driver));
    }
    return result;
  }

  /** Sends one attempt through the driver and stores the outcome. Never throws for provider failures. */
  private async dispatch(tenantId: string, payout: VendorPayoutRow, vendor: VendorRow, driver?: PayoutDriver): Promise<Payout> {
    const attempt = payout.attempts + 1;
    const account = this.payoutAccountOf(vendor);
    let outcome: PayoutOutcome;
    if (!account) outcome = { status: "failed", providerRef: null, error: "The seller has no readable payout account" };
    else {
      try {
        const d = driver ?? this.driverFor(payout.provider);
        await this.db
          .update(vendorPayouts)
          .set({ status: "processing", attempts: attempt, error: null })
          .where(and(eq(vendorPayouts.tenantId, tenantId), eq(vendorPayouts.id, payout.id)));
        outcome = await d.send({ tenantId, payoutId: payout.id, attempt, amount: payout.amount, account, vendor: { id: vendor.id, name: vendor.name } });
      } catch (err) {
        outcome = { status: "failed", providerRef: null, error: (err as Error).message || "Payout failed" };
      }
    }
    return this.storeOutcome(tenantId, { ...payout, attempts: attempt }, vendor, outcome);
  }

  private async storeOutcome(tenantId: string, payout: VendorPayoutRow, vendor: Pick<VendorRow, "id" | "name" | "contactPhone" | "contactEmail">, o: PayoutOutcome): Promise<Payout> {
    const paidAt = o.status === "paid" ? this.now() : null;
    const [row] = await this.db
      .update(vendorPayouts)
      .set({
        status: o.status,
        attempts: payout.attempts,
        providerRef: o.providerRef ?? payout.providerRef,
        error: o.status === "failed" ? (o.error ?? "Payout failed") : null,
        paidAt,
      })
      .where(and(eq(vendorPayouts.tenantId, tenantId), eq(vendorPayouts.id, payout.id)))
      .returning();
    if (o.status === "failed") this.log.warn({ tenantId, payoutId: payout.id, error: o.error }, "marketplace: payout failed");
    if (o.status === "paid")
      await this.notifyVendor(tenantId, vendor, "marketplace.payout_paid", {
        vendorName: vendor.name,
        amount: moneyText(payout.amount),
        reference: o.providerRef ?? "",
      });
    return toPayout(row ?? { ...payout, status: o.status, paidAt }, vendor.name);
  }

  private async payoutRow(tenantId: string, id: string): Promise<VendorPayoutRow> {
    const [row] = await this.db
      .select()
      .from(vendorPayouts)
      .where(and(eq(vendorPayouts.tenantId, tenantId), eq(vendorPayouts.id, id)))
      .limit(1);
    if (!row) throw notFound("Payout");
    return row;
  }

  /** Tries a failed payout again (same amount, same provider). */
  async retryPayout(tenantId: string, id: string): Promise<Payout> {
    const row = await this.payoutRow(tenantId, id);
    if (row.status !== "failed") throw conflict("Only failed payouts can be retried");
    const vendor = await this.vendorRow(this.db, tenantId, row.vendorId);
    return this.dispatch(tenantId, row, vendor);
  }

  /** Staff confirm a payout they made themselves (manual) or one stuck in processing, with the bank/UTR reference. */
  async markPayoutPaid(tenantId: string, id: string, input: { reference: string }): Promise<Payout> {
    const { reference } = markPaidSchema.parse(input);
    const row = await this.payoutRow(tenantId, id);
    if (row.status !== "processing" && row.status !== "failed") throw conflict(`A ${row.status} payout can't be marked paid`);
    const vendor = await this.vendorRow(this.db, tenantId, row.vendorId);
    return this.storeOutcome(tenantId, row, vendor, { status: "paid", providerRef: reference });
  }

  /**
   * Gives up on a failed (or manual, unpaid) payout: the amount goes back to the seller's balance and its sales
   * back to eligible, so the next run pays them.
   */
  async cancelPayout(tenantId: string, id: string, actorUserId: string | null = null): Promise<Payout> {
    const row = await this.payoutRow(tenantId, id);
    const cancellable = row.status === "failed" || row.status === "pending" || (row.status === "processing" && row.provider === "manual");
    if (!cancellable) throw conflict(`A ${row.status} payout can't be cancelled`);
    const updated = await this.db.transaction(async (tx) => {
      const [u] = await tx
        .update(vendorPayouts)
        .set({ status: "cancelled" })
        .where(and(eq(vendorPayouts.tenantId, tenantId), eq(vendorPayouts.id, id), eq(vendorPayouts.status, row.status)))
        .returning();
      if (!u) throw conflict("The payout changed meanwhile; reload and try again");
      await tx.insert(vendorLedger).values({
        tenantId,
        vendorId: row.vendorId,
        type: "payout",
        amount: row.amount,
        refType: LEDGER_REF.payoutCancelled,
        refId: row.id,
        note: "Payout cancelled; amount back in balance",
        createdBy: actorUserId,
      });
      await tx
        .update(vendorOrders)
        .set({ settlementStatus: "eligible", settledAt: null, payoutId: null })
        .where(and(eq(vendorOrders.tenantId, tenantId), eq(vendorOrders.payoutId, id), eq(vendorOrders.settlementStatus, "settled")));
      return u;
    });
    return toPayout(updated);
  }

  /** Re-checks `processing` payouts with providers that can tell (Razorpay Route). */
  async refreshPayouts(tenantId: string, id?: string): Promise<Payout[]> {
    const conds: SQL[] = [eq(vendorPayouts.tenantId, tenantId), eq(vendorPayouts.status, "processing"), isNotNull(vendorPayouts.providerRef)];
    if (id) conds.push(eq(vendorPayouts.id, id));
    const rows = await this.db.select().from(vendorPayouts).where(and(...conds)).limit(100);
    const out: Payout[] = [];
    for (const r of rows) {
      let driver: PayoutDriver;
      try {
        driver = this.driverFor(r.provider);
      } catch {
        continue;
      }
      if (!driver.check || !r.providerRef) continue;
      try {
        const o = await driver.check(tenantId, r.providerRef);
        if (o.status === "processing") continue;
        const vendor = await this.vendorRow(this.db, tenantId, r.vendorId);
        out.push(await this.storeOutcome(tenantId, r, vendor, o));
      } catch (err) {
        this.log.warn({ err, tenantId, payoutId: r.id }, "marketplace: payout status check failed");
      }
    }
    return out;
  }

  /** Job: refresh processing payouts in shops with payouts on. */
  async refreshAllPayouts(): Promise<number> {
    const tenants = await this.db
      .selectDistinct({ tenantId: vendorPayouts.tenantId })
      .from(vendorPayouts)
      .where(and(eq(vendorPayouts.status, "processing"), isNotNull(vendorPayouts.providerRef)));
    let n = 0;
    for (const { tenantId } of tenants) {
      if (!(await this.featureOn(tenantId, PAYOUTS_FEATURE))) continue;
      n += (await this.refreshPayouts(tenantId)).length;
    }
    return n;
  }

  async listPayouts(tenantId: string, query: PayoutListQuery = {}): Promise<ListResult<Payout>> {
    const q = payoutListQuery.parse(query);
    const conds: SQL[] = [eq(vendorPayouts.tenantId, tenantId)];
    if (q.vendorId) conds.push(eq(vendorPayouts.vendorId, q.vendorId));
    if (q.status) conds.push(eq(vendorPayouts.status, q.status));
    const { start, end } = istRange(q.from, q.to);
    if (start) conds.push(gte(vendorPayouts.createdAt, start));
    if (end) conds.push(lt(vendorPayouts.createdAt, end));
    const where = and(...conds);
    const [rows, [t]] = await Promise.all([
      this.db
        .select({ p: vendorPayouts, vendorName: vendors.name })
        .from(vendorPayouts)
        .innerJoin(vendors, eq(vendors.id, vendorPayouts.vendorId))
        .where(where)
        .orderBy(desc(vendorPayouts.createdAt), asc(vendorPayouts.id))
        .limit(q.limit)
        .offset(q.offset),
      this.db.select({ n: count() }).from(vendorPayouts).where(where),
    ]);
    return { items: rows.map((r) => toPayout(r.p, r.vendorName)), total: Number(t?.n ?? 0) };
  }

  // ---------------------------------------------------------------- ledger

  async listLedger(tenantId: string, query: LedgerListQuery = {}): Promise<ListResult<LedgerEntry> & { balance: LedgerBalance | null }> {
    const q = ledgerListQuery.parse(query);
    const conds: SQL[] = [eq(vendorLedger.tenantId, tenantId)];
    if (q.vendorId) conds.push(eq(vendorLedger.vendorId, q.vendorId));
    if (q.type) conds.push(eq(vendorLedger.type, q.type));
    const { start, end } = istRange(q.from, q.to);
    if (start) conds.push(gte(vendorLedger.createdAt, start));
    if (end) conds.push(lt(vendorLedger.createdAt, end));
    const where = and(...conds);
    const [rows, [t], balance] = await Promise.all([
      this.db
        .select({ e: vendorLedger, vendorName: vendors.name })
        .from(vendorLedger)
        .innerJoin(vendors, eq(vendors.id, vendorLedger.vendorId))
        .where(where)
        .orderBy(desc(vendorLedger.createdAt), desc(vendorLedger.id))
        .limit(q.limit)
        .offset(q.offset),
      this.db.select({ n: count() }).from(vendorLedger).where(where),
      q.vendorId ? this.balance(tenantId, q.vendorId) : Promise.resolve(null),
    ]);
    return { items: rows.map((r) => toLedgerEntry(r.e, r.vendorName)), total: Number(t?.n ?? 0), balance };
  }

  /** Manual credit (+) or debit (−) on a seller's ledger, e.g. a penalty or a goodwill credit. */
  async adjust(tenantId: string, vendorId: string, input: AdjustmentInput, actorUserId: string | null): Promise<LedgerEntry> {
    const b = adjustmentSchema.parse(input);
    const vendor = await this.vendorRow(this.db, tenantId, vendorId);
    const [row] = await this.db
      .insert(vendorLedger)
      .values({ tenantId, vendorId, type: "adjustment", amount: b.amount, refType: LEDGER_REF.manual, refId: null, note: b.note, createdBy: actorUserId })
      .returning();
    return toLedgerEntry(row!, vendor.name);
  }

  // ---------------------------------------------------------------- product review (catalogue ListingReviewPort)

  /** Catalogue asks before a seller's write makes their product active: review unless the shop auto-approves. */
  async needsProductReview(tenantId: string, _vendorId: string): Promise<boolean> {
    return !(await this.settings(tenantId)).autoApproveProducts;
  }

  /** Catalogue listing events → the product's review row (see `reviewAfterEvent`). */
  async onListing(
    tenantId: string,
    e: { type: ListingEventType; productId: string; vendorId: string; name: string; image: string | null; by: "vendor" | "staff"; fields?: string[] },
  ): Promise<void> {
    // Edits to live products are re-reviewed only when the shop reviews seller products at all.
    if (e.type === "changed" && (!e.fields?.length || !(await this.needsProductReview(tenantId, e.vendorId)))) return;
    const [cur] = await this.db
      .select()
      .from(vendorProductReviews)
      .where(and(eq(vendorProductReviews.tenantId, tenantId), eq(vendorProductReviews.productId, e.productId)))
      .limit(1);
    const next = reviewAfterEvent(cur?.status ?? null, e.type);
    if (!next) return;
    const now = this.now();
    const snapshot = { vendorId: e.vendorId, productName: e.name, productImage: e.image };
    const changedFields =
      e.type === "changed" ? [...new Set([...(cur?.status === "pending" && cur.changedAfterApproval ? cur.changedFields : []), ...(e.fields ?? [])])].sort() : [];
    const set =
      e.type === "changed"
        ? { status: next, ...snapshot, reason: null, submittedAt: now, reviewedAt: null, reviewedBy: null, changedAfterApproval: true, changedFields }
        : next === "pending"
          ? { status: next, ...snapshot, reason: null, submittedAt: now, reviewedAt: null, reviewedBy: null, changedAfterApproval: false, changedFields: [] }
          : next === "approved"
            ? { status: next, ...snapshot, reason: null, reviewedAt: now, changedAfterApproval: false, changedFields: [] }
            : { status: next };
    await this.db
      .insert(vendorProductReviews)
      .values({ tenantId, productId: e.productId, ...snapshot, submittedAt: now, ...set })
      .onConflictDoUpdate({ target: [vendorProductReviews.tenantId, vendorProductReviews.productId], set: { ...set, updatedAt: now } });
  }

  private async reviewRow(tenantId: string, id: string): Promise<VendorProductReviewRow> {
    const [row] = await this.db
      .select()
      .from(vendorProductReviews)
      .where(and(eq(vendorProductReviews.tenantId, tenantId), eq(vendorProductReviews.id, id)))
      .limit(1);
    if (!row) throw notFound("Product review");
    return row;
  }

  /** Review queue (staff) or a seller's own reviews (`vendorId`). Waiting ones oldest first, others newest first. */
  async listProductReviews(
    tenantId: string,
    query: ReviewListQuery = {},
  ): Promise<ListResult<ProductReview> & { counts: Record<ProductReviewStatus, number> }> {
    const q = reviewListQuery.parse(query);
    const base: SQL[] = [eq(vendorProductReviews.tenantId, tenantId)];
    if (q.vendorId) base.push(eq(vendorProductReviews.vendorId, q.vendorId));
    if (q.productIds?.length) base.push(inArray(vendorProductReviews.productId, q.productIds));
    const where = q.status ? and(...base, eq(vendorProductReviews.status, q.status)) : and(...base);
    const [rows, [t], countRows] = await Promise.all([
      this.db
        .select({ r: vendorProductReviews, vendorName: vendors.name })
        .from(vendorProductReviews)
        .innerJoin(vendors, eq(vendors.id, vendorProductReviews.vendorId))
        .where(where)
        .orderBy(q.status === "pending" ? asc(vendorProductReviews.submittedAt) : desc(vendorProductReviews.submittedAt), asc(vendorProductReviews.id))
        .limit(q.limit)
        .offset(q.offset),
      this.db.select({ n: count() }).from(vendorProductReviews).where(where),
      this.db
        .select({ status: vendorProductReviews.status, n: count() })
        .from(vendorProductReviews)
        .where(and(...base))
        .groupBy(vendorProductReviews.status),
    ]);
    const counts = Object.fromEntries(PRODUCT_REVIEW_STATUSES.map((st) => [st, 0])) as Record<ProductReviewStatus, number>;
    for (const c of countRows) counts[c.status] = Number(c.n);
    return { items: rows.map((r) => toReview(r.r, r.vendorName)), total: Number(t?.n ?? 0), counts };
  }

  /** Approve a waiting product: the catalogue makes it active (live in the store) and the seller is told. */
  async approveProductReview(tenantId: string, id: string, actorUserId: string | null): Promise<ProductReview> {
    const row = await this.reviewRow(tenantId, id);
    if (!canDecideReview(row.status)) throw conflict(`This product is already ${row.status}`);
    if (!this.deps.listings) throw badRequest("Product approval isn't available on this server");
    try {
      await this.deps.listings.publish(tenantId, row.productId);
    } catch (err) {
      if (err instanceof AppError && err.status === 404) {
        await this.db
          .update(vendorProductReviews)
          .set({ status: "withdrawn" })
          .where(and(eq(vendorProductReviews.tenantId, tenantId), eq(vendorProductReviews.id, row.id)));
        throw conflict("The seller deleted this product");
      }
      throw err;
    }
    const [u] = await this.db
      .update(vendorProductReviews)
      .set({ status: "approved", reason: null, reviewedAt: this.now(), reviewedBy: actorUserId, changedAfterApproval: false, changedFields: [] })
      .where(and(eq(vendorProductReviews.tenantId, tenantId), eq(vendorProductReviews.id, id)))
      .returning();
    const vendor = await this.vendorRow(this.db, tenantId, row.vendorId);
    await this.notifyVendor(tenantId, vendor, "marketplace.product_approved", { vendorName: vendor.name, productName: row.productName });
    return toReview(u ?? row, vendor.name);
  }

  /**
   * Reject a waiting product with a reason; it stays (or, for a re-review of a live product, goes back to) a draft the
   * seller can fix and submit again.
   */
  async rejectProductReview(tenantId: string, id: string, input: { reason?: string }, actorUserId: string | null): Promise<ProductReview> {
    const { reason } = rejectReviewSchema.parse(input ?? {});
    const row = await this.reviewRow(tenantId, id);
    if (!canDecideReview(row.status)) throw conflict(`This product is already ${row.status}`);
    if (row.changedAfterApproval) {
      if (!this.deps.listings?.unpublish) throw badRequest("Product review isn't available on this server");
      try {
        // The catalogue reports this as a withdrawal; the row is set to rejected right after.
        await this.deps.listings.unpublish(tenantId, row.productId);
      } catch (err) {
        if (!(err instanceof AppError && err.status === 404)) throw err;
      }
    }
    const [u] = await this.db
      .update(vendorProductReviews)
      .set({ status: "rejected", reason, reviewedAt: this.now(), reviewedBy: actorUserId })
      .where(
        and(
          eq(vendorProductReviews.tenantId, tenantId),
          eq(vendorProductReviews.id, id),
          row.changedAfterApproval ? undefined : eq(vendorProductReviews.status, "pending"),
        ),
      )
      .returning();
    if (!u) throw conflict("This review was decided meanwhile; reload and try again");
    const vendor = await this.vendorRow(this.db, tenantId, row.vendorId);
    await this.notifyVendor(tenantId, vendor, "marketplace.product_rejected", { vendorName: vendor.name, productName: row.productName, reason });
    return toReview(u, vendor.name);
  }

  // ---------------------------------------------------------------- seller stock

  private stockDeps(): { stock: StockPort; variants: NonNullable<VendorProductsPort["variants"]> } {
    const products = this.deps.products;
    if (!this.deps.stock || !products?.variants) throw badRequest("Seller stock isn't available on this server");
    return { stock: this.deps.stock, variants: products.variants.bind(products) };
  }

  /** Where a seller's stock lives: their own location, else the shop's default. */
  async stockLocationOf(tenantId: string, vendor: Pick<VendorRow, "stockLocationId">): Promise<string> {
    return vendor.stockLocationId ?? (await this.stockDeps().stock.defaultLocationId(tenantId));
  }

  /** Stock of the seller's own variants (optionally only these products) at the seller's location. */
  async vendorStock(
    tenantId: string,
    vendor: VendorRow,
    query: { productIds?: string | string[] } = {},
  ): Promise<ListResult<VendorStockItem> & { locationId: string }> {
    const { stock, variants } = this.stockDeps();
    const q = stockQuery.parse(query ?? {});
    const list = await variants(tenantId, vendor.id, q.productIds ? { productIds: q.productIds } : {});
    const locationId = await this.stockLocationOf(tenantId, vendor);
    const levels = list.length ? await stock.levels(tenantId, list.map((v) => v.variantId), locationId) : [];
    const byId = new Map(levels.map((l) => [l.itemId, l]));
    const items = list.map((v) => withLevel(v, byId.get(v.variantId)));
    return { items, total: items.length, locationId };
  }

  /** Seller sets or changes the stock of one of their own variants (others 404), with a reason on the movement. */
  async adjustVendorStock(
    tenantId: string,
    vendor: VendorRow,
    variantId: string,
    input: StockAdjustInput,
    userId: string | null,
  ): Promise<{ item: VendorStockItem; before: number; locationId: string }> {
    if (vendor.status === "suspended") throw forbidden("This seller account is suspended");
    const b = stockAdjustSchema.parse(input ?? {});
    const { stock, variants } = this.stockDeps();
    const [v] = await variants(tenantId, vendor.id, { variantIds: [variantId] });
    if (!v) throw notFound("Product");
    const locationId = await this.stockLocationOf(tenantId, vendor);
    const [before] = await stock.levels(tenantId, [v.variantId], locationId);
    const after = await stock.adjust(tenantId, v.variantId, { mode: b.mode, qty: b.qty, note: `Seller ${vendor.name}: ${b.reason}`, locationId }, userId);
    return { item: withLevel(v, after), before: before?.qty ?? 0, locationId };
  }

  // ---------------------------------------------------------------- seller fulfilment

  /**
   * The seller marks their part of an order packed or shipped (`planFulfilment`). When every line of the order belongs
   * to sellers and all their parts reached the step, the whole order moves through the orders module (its own state
   * machine, events and customer messages); otherwise the shop moves it. The shop is told either way.
   */
  async markFulfilment(
    tenantId: string,
    vendor: VendorRow,
    vendorOrderId: string,
    action: FulfilmentAction,
    input: Partial<ShipInput> = {},
    actorUserId: string | null = null,
  ): Promise<VendorOrder> {
    if (vendor.status === "suspended") throw forbidden("This seller account is suspended");
    const ship = action === "shipped" ? shipSchema.parse(input ?? {}) : null;
    const load = async () => {
      const [row] = await this.db
        .select()
        .from(vendorOrders)
        .where(and(eq(vendorOrders.tenantId, tenantId), eq(vendorOrders.id, vendorOrderId), eq(vendorOrders.vendorId, vendor.id)))
        .limit(1);
      if (!row) throw notFound("Order");
      return row;
    };
    const first = await load();
    // The mirrored order status may lag (a failed hook): follow the order first.
    await this.syncOrder(tenantId, first.orderId);
    const vo = await load();
    const plan = planFulfilment(vo, action, this.now());
    if (!plan.ok) throw new AppError(409, plan.code, plan.message);
    const [u] = await this.db
      .update(vendorOrders)
      .set({ ...plan.set, ...(ship ? { carrier: ship.carrier ?? null, trackingNumber: ship.trackingNumber } : {}) })
      .where(
        and(
          eq(vendorOrders.tenantId, tenantId),
          eq(vendorOrders.id, vo.id),
          action === "packed" ? sql`${vendorOrders.packedAt} is null` : sql`${vendorOrders.shippedAt} is null`,
        ),
      )
      .returning();
    if (!u) throw conflict("This order was changed meanwhile; reload and try again");

    if (this.deps.orderActions && this.deps.orders) {
      try {
        const order = await this.deps.orders.getOrder(tenantId, vo.orderId);
        const parts = await this.db
          .select()
          .from(vendorOrders)
          .where(and(eq(vendorOrders.tenantId, tenantId), eq(vendorOrders.orderId, vo.orderId)));
        const sellers = new Set(parts.map((p) => p.vendorId));
        const hasShopLines = !order || order.lines.some((l) => !l.vendorId || !sellers.has(l.vendorId));
        const target = order ? orderAdvanceTarget(order.status, parts, hasShopLines) : null;
        if (target) {
          await this.deps.orderActions.advance(tenantId, vo.orderId, target, {
            note: `${target === "packed" ? "Packed" : "Shipped"} by seller ${vendor.name}`,
            actorUserId,
            ...(target === "shipped" && parts.length === 1 ? { carrier: u.carrier, trackingNumber: u.trackingNumber } : {}),
          });
        }
      } catch (err) {
        this.log.warn({ err, tenantId, orderId: vo.orderId, action }, "marketplace: order not moved after the seller's step");
      }
    }
    await this.notifyShop(tenantId, action === "packed" ? "marketplace.vendor_order_packed" : "marketplace.vendor_order_shipped", {
      vendorName: vendor.name,
      orderNumber: vo.orderNumber,
      tracking: [u.carrier, u.trackingNumber].filter(Boolean).join(" ") || "-",
    });
    return toVendorOrder(await load(), vendor.name);
  }

  /** Best effort, to every owner/admin: WhatsApp to an Indian mobile, else email. */
  private async notifyShop(tenantId: string, template: string, vars: Record<string, string>) {
    if (!this.deps.notifier || !this.deps.shopContacts) return;
    try {
      for (const c of await this.deps.shopContacts.owners(tenantId)) {
        const phone = c.phone && /^\+91[6-9]\d{9}$/.test(c.phone) ? c.phone : null;
        const to = phone ?? c.email;
        if (!to) continue;
        await this.deps.notifier.send({ tenantId, channel: phone ? "whatsapp" : "email", to, template, vars, ...(c.locale ? { locale: c.locale } : {}) });
      }
    } catch (err) {
      this.log.warn({ err, tenantId, template }, "marketplace: shop notification failed");
    }
  }

  // ---------------------------------------------------------------- notifications

  private async notifyVendor(
    tenantId: string,
    vendor: Pick<VendorRow, "id" | "contactPhone" | "contactEmail">,
    template: string,
    vars: Record<string, string>,
  ) {
    if (!this.deps.notifier) return;
    const phone = vendor.contactPhone && /^\+91[6-9]\d{9}$/.test(vendor.contactPhone) ? vendor.contactPhone : null;
    const to = phone ?? vendor.contactEmail;
    if (!to) return;
    try {
      await this.deps.notifier.send({ tenantId, channel: phone ? "whatsapp" : "email", to, template, vars });
    } catch (err) {
      this.log.warn({ err, tenantId, vendorId: vendor.id, template }, "marketplace: notification failed");
    }
  }
}
