import { z } from "zod";
import type { OrderStatus, SourceOrderLine, SourceOrderTotals } from "./ports";
import type { PayoutProvider } from "./settings";

// ------------------------------------------------------------------ status vocabularies

export const VENDOR_STATUSES = ["pending", "active", "suspended"] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

export const VENDOR_KYC_STATUSES = ["none", "pending", "verified", "failed"] as const;
export type VendorKycStatus = (typeof VENDOR_KYC_STATUSES)[number];

export const PAYOUT_ACCOUNT_STATUSES = ["none", "pending", "verified", "rejected"] as const;
export type PayoutAccountStatus = (typeof PAYOUT_ACCOUNT_STATUSES)[number];

export const VENDOR_USER_ROLES = ["owner", "staff"] as const;
export type VendorUserRole = (typeof VENDOR_USER_ROLES)[number];

export const SETTLEMENT_STATUSES = ["pending", "eligible", "settled", "reversed"] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export const LEDGER_TYPES = ["sale", "commission", "refund", "payout", "adjustment"] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];

/** `cancelled` = a failed payout given up on; its amount went back to the seller's balance. */
export const PAYOUT_STATUSES = ["pending", "processing", "paid", "failed", "cancelled"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

/** Ledger `ref_type`s. The vendor-order ones are unique per vendor order (idempotent posting). */
export const LEDGER_REF = {
  vendorOrder: "vendor_order",
  vendorOrderReversal: "vendor_order_reversal",
  payout: "payout",
  payoutCancelled: "payout_cancelled",
  manual: "manual",
} as const;

/** Staff transitions: approve (pending/suspended → active), suspend (pending/active → suspended). */
export function canSetVendorStatus(from: VendorStatus, to: VendorStatus): boolean {
  if (from === to) return false;
  if (to === "active") return from === "pending" || from === "suspended";
  if (to === "suspended") return from === "pending" || from === "active";
  return false;
}

// ------------------------------------------------------------------ money

/**
 * Splits `total` paise over `weights` in proportion, with largest-remainder rounding so the parts are integers that
 * sum exactly to `total`. Negative weights count as 0; when every weight is 0 the total is split evenly. A negative
 * total is split like its absolute value and negated. Ties go to the earlier index.
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  if (!Number.isInteger(total)) throw new Error("allocate: total must be whole paise");
  if (total < 0) return allocate(-total, weights).map((v) => (v === 0 ? 0 : -v));
  let w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  let base = w.reduce((s, x) => s + x, 0);
  if (base <= 0) {
    w = weights.map(() => 1);
    base = n;
  }
  const out = new Array<number>(n).fill(0);
  const rem: { i: number; frac: number }[] = [];
  let given = 0;
  for (let i = 0; i < n; i++) {
    if (w[i]! <= 0) continue;
    const exact = (total * w[i]!) / base;
    const floor = Math.floor(exact);
    out[i] = floor;
    given += floor;
    rem.push({ i, frac: exact - floor });
  }
  rem.sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; given < total; k = (k + 1) % rem.length, given++) out[rem[k]!.i]! += 1;
  return out;
}

/** Commission on `base` paise at `bps` basis points, rounded half up (exact integer arithmetic). Never negative. */
export function commissionOf(base: number, bps: number): number {
  if (base <= 0 || bps <= 0) return 0;
  const b = Math.min(Math.max(Math.trunc(bps), 0), 10_000);
  return Math.floor((Math.trunc(base) * b + 5_000) / 10_000);
}

export const formatBps = (bps: number) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, "")}%`;

// ------------------------------------------------------------------ order split

/** A line as stored on a vendor order (a copy of the order line's display fields). */
export interface VendorOrderLine {
  variantId: string;
  productId: string;
  name: string;
  sku: string | null;
  image: string | null;
  qty: number;
  unit: string;
  price: number;
  gstRate: number;
  /** qty × price, rounded to paise. */
  gross: number;
  total: number;
}

export interface SplitAmounts {
  /** Goods as charged, before the coupon (share of the order's `subtotal`). */
  subtotal: number;
  /** Share of the order's coupon discount. */
  discount: number;
  /** Share of the order's shipping charge. */
  shippingShare: number;
}

export interface VendorSplit extends SplitAmounts {
  vendorId: string;
  lines: VendorOrderLine[];
  /** subtotal − discount + shippingShare: what the seller sold, as charged. */
  saleAmount: number;
  commissionBps: number;
  /** round((subtotal − discount) × bps / 10000): commission is on goods, never on shipping. */
  commission: number;
  /** saleAmount − commission: what the seller is owed. */
  net: number;
}

export interface OrderSplit {
  /** One per seller, in the order their first line appears. */
  vendors: VendorSplit[];
  /** The shop's own lines (vendorId null), if any. */
  house: (SplitAmounts & { lines: VendorOrderLine[] }) | null;
  /**
   * What the shop keeps of the order total: its own lines, commissions, GST added on top of tax-exclusive prices,
   * COD fee and round-off. Σ vendors' net + platformAmount = totals.total.
   */
  platformAmount: number;
}

const toVendorLine = (l: SourceOrderLine): VendorOrderLine => ({
  variantId: l.variantId,
  productId: l.productId,
  name: l.name,
  sku: l.sku,
  image: l.image,
  qty: l.qty,
  unit: l.unit,
  price: l.price,
  gstRate: l.gstRate,
  gross: Math.round(l.qty * l.price),
  total: l.total,
});

/**
 * Splits an order into per-seller parts. Every amount is reconciled to the paisa: Σ parts' subtotal = totals.subtotal,
 * Σ discount = totals.discount, Σ shippingShare = totals.shipping (the shop's own lines take their share too).
 * - subtotal: totals.subtotal over the groups by Σ round(qty × price);
 * - discount: by the lines' coupon shares when the order has any (product/category coupons hit only some lines),
 *   otherwise by subtotal;
 * - shipping: by goods after discount (subtotal − discount);
 * - commission: `commissionBpsFor(vendorId)` on subtotal − discount, rounded half up.
 */
export function splitOrder(
  lines: readonly SourceOrderLine[],
  totals: SourceOrderTotals,
  commissionBpsFor: (vendorId: string) => number,
): OrderSplit {
  const keys: (string | null)[] = [];
  const groups = new Map<string | null, SourceOrderLine[]>();
  for (const l of lines) {
    const key = l.vendorId ?? null;
    if (!groups.has(key)) {
      groups.set(key, []);
      keys.push(key);
    }
    groups.get(key)!.push(l);
  }
  if (keys.length === 0) return { vendors: [], house: null, platformAmount: totals.total };

  const grouped = keys.map((k) => groups.get(k)!);
  const gross = grouped.map((ls) => ls.reduce((s, l) => s + Math.round(l.qty * l.price), 0));
  const subtotals = allocate(totals.subtotal, gross);
  const lineDiscounts = grouped.map((ls) => ls.reduce((s, l) => s + Math.max(l.discount ?? 0, 0), 0));
  const hasLineDiscounts = lineDiscounts.some((d) => d > 0);
  const discounts = allocate(totals.discount, hasLineDiscounts ? lineDiscounts : subtotals);
  const shipping = allocate(
    totals.shipping,
    subtotals.map((s, i) => s - discounts[i]!),
  );

  const vendors: VendorSplit[] = [];
  let house: OrderSplit["house"] = null;
  keys.forEach((key, i) => {
    const amounts: SplitAmounts = { subtotal: subtotals[i]!, discount: discounts[i]!, shippingShare: shipping[i]! };
    const vLines = grouped[i]!.map(toVendorLine);
    if (key === null) {
      house = { ...amounts, lines: vLines };
      return;
    }
    const bps = Math.min(Math.max(Math.trunc(commissionBpsFor(key)), 0), 10_000);
    const saleAmount = amounts.subtotal - amounts.discount + amounts.shippingShare;
    const commission = commissionOf(amounts.subtotal - amounts.discount, bps);
    vendors.push({ vendorId: key, lines: vLines, ...amounts, saleAmount, commissionBps: bps, commission, net: saleAmount - commission });
  });
  const platformAmount = totals.total - vendors.reduce((s, v) => s + v.net, 0);
  return { vendors, house, platformAmount };
}

// ------------------------------------------------------------------ settlement (IST)

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** "YYYY-MM-DD" of `d` in India Standard Time. */
export const istDateOf = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** Start (00:00 IST) of an IST date, as an instant. */
export const istMidnight = (date: string) => new Date(`${date}T00:00:00.000+05:30`);

/**
 * When a delivered sale becomes payable: returns are allowed through the end of the IST day `returnWindowDays` after
 * the delivery date, so it is eligible from 00:00 IST the day after. A 0-day window is eligible at delivery.
 */
export function eligibleAtFor(deliveredAt: Date, returnWindowDays: number): Date {
  const days = Math.max(Math.trunc(returnWindowDays), 0);
  if (days === 0) return deliveredAt;
  return new Date(istMidnight(istDateOf(deliveredAt)).getTime() + (days + 1) * DAY_MS);
}

export interface VendorOrderState {
  status: OrderStatus;
  settlementStatus: SettlementStatus;
  deliveredAt: Date | null;
  eligibleAt: Date | null;
}

export interface VendorOrderUpdate {
  next: VendorOrderState;
  /** The sale was already credited to the seller's ledger and must be reversed (return after the window). */
  reverseLedger: boolean;
  changed: boolean;
}

/**
 * Follows the order's status. Delivered → eligibility date fixed from the delivery time. Cancelled/returned →
 * `reversed` (with a ledger reversal when the sale was already credited, i.e. eligible or settled).
 */
export function planVendorOrderUpdate(
  cur: VendorOrderState,
  order: { status: OrderStatus; deliveredAt: Date | null },
  returnWindowDays: number,
  now: Date,
): VendorOrderUpdate {
  const next: VendorOrderState = { ...cur, status: order.status };
  let reverseLedger = false;
  if (order.status === "delivered") {
    next.deliveredAt = cur.deliveredAt ?? order.deliveredAt ?? now;
    if (cur.settlementStatus === "pending") next.eligibleAt = cur.eligibleAt ?? eligibleAtFor(next.deliveredAt, returnWindowDays);
  } else if (order.status === "cancelled" || order.status === "returned") {
    if (cur.settlementStatus !== "reversed") {
      reverseLedger = cur.settlementStatus === "eligible" || cur.settlementStatus === "settled";
      next.settlementStatus = "reversed";
    }
    if (cur.settlementStatus === "pending") next.eligibleAt = null;
  } else if (cur.settlementStatus === "pending") {
    next.eligibleAt = null;
  }
  const changed =
    next.status !== cur.status ||
    next.settlementStatus !== cur.settlementStatus ||
    next.deliveredAt?.getTime() !== cur.deliveredAt?.getTime() ||
    next.eligibleAt?.getTime() !== cur.eligibleAt?.getTime();
  return { next, reverseLedger, changed };
}

/** A pending, delivered sale whose return window is over by `at`. */
export const isSettlementEligible = (vo: VendorOrderState, at: Date) =>
  vo.status === "delivered" && vo.settlementStatus === "pending" && vo.eligibleAt !== null && vo.eligibleAt.getTime() <= at.getTime();

// ------------------------------------------------------------------ ledger

export interface LedgerDraft {
  type: LedgerType;
  /** Signed paise: + owed to the seller, − owed by the seller / paid out. */
  amount: number;
  refType: string;
  note: string;
}

interface SaleFigures {
  subtotal: number;
  discount: number;
  shippingShare: number;
  commission: number;
  orderNumber: string;
}

/** Credited when the sale becomes eligible: the sale, then the commission taken from it. */
export function saleEntries(vo: SaleFigures): LedgerDraft[] {
  const sale = vo.subtotal - vo.discount + vo.shippingShare;
  const out: LedgerDraft[] = [{ type: "sale", amount: sale, refType: LEDGER_REF.vendorOrder, note: `Sale ${vo.orderNumber}` }];
  if (vo.commission) out.push({ type: "commission", amount: -vo.commission, refType: LEDGER_REF.vendorOrder, note: `Commission ${vo.orderNumber}` });
  return out;
}

/** Posted when an already-credited sale is returned/cancelled: the refund, and the commission given back. */
export function reversalEntries(vo: SaleFigures): LedgerDraft[] {
  const sale = vo.subtotal - vo.discount + vo.shippingShare;
  const out: LedgerDraft[] = [{ type: "refund", amount: -sale, refType: LEDGER_REF.vendorOrderReversal, note: `Return ${vo.orderNumber}` }];
  if (vo.commission)
    out.push({ type: "commission", amount: vo.commission, refType: LEDGER_REF.vendorOrderReversal, note: `Commission returned ${vo.orderNumber}` });
  return out;
}

export interface LedgerBalance {
  /** Owed to the seller now (may be negative after refunds of paid-out sales; carried over). */
  balance: number;
  sales: number;
  /** Net commission (negative = taken). */
  commission: number;
  refunds: number;
  /** Net paid out / reserved for payouts (negative). */
  payouts: number;
  adjustments: number;
}

export function ledgerBalance(entries: readonly { type: LedgerType; amount: number }[]): LedgerBalance {
  const b: LedgerBalance = { balance: 0, sales: 0, commission: 0, refunds: 0, payouts: 0, adjustments: 0 };
  for (const e of entries) {
    b.balance += e.amount;
    if (e.type === "sale") b.sales += e.amount;
    else if (e.type === "commission") b.commission += e.amount;
    else if (e.type === "refund") b.refunds += e.amount;
    else if (e.type === "payout") b.payouts += e.amount;
    else b.adjustments += e.amount;
  }
  return b;
}

/** Balance per seller. */
export function balancesByVendor(entries: readonly { vendorId: string; amount: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) m.set(e.vendorId, (m.get(e.vendorId) ?? 0) + e.amount);
  return m;
}

// ------------------------------------------------------------------ payouts

export interface PayoutCandidate {
  vendorId: string;
  /** Current ledger balance, paise. */
  balance: number;
  vendorStatus: VendorStatus;
  kycStatus: string;
  payoutAccountStatus: PayoutAccountStatus;
  /** Type of the saved payout account, null when none. */
  accountType: PayoutAccountType | null;
}

export type PayoutSkipReason =
  | "nothing_due"
  | "below_minimum"
  | "vendor_not_active"
  | "kyc_not_verified"
  | "no_payout_account"
  | "account_not_supported";

export interface PayoutPlan {
  pay: { vendorId: string; amount: number }[];
  /** Balances not paid this run stay in the ledger and carry over to the next run. */
  skip: { vendorId: string; reason: PayoutSkipReason; balance: number }[];
}

/**
 * Who gets paid this run: the whole balance, when it reaches the minimum (and is positive), the seller is active,
 * KYC is verified (if required) and a verified payout account exists that the provider can pay
 * (Razorpay Route needs a linked account).
 */
export function planPayouts(
  candidates: readonly PayoutCandidate[],
  opts: { minPayoutPaise: number; requireKyc: boolean; provider: PayoutProvider },
): PayoutPlan {
  const plan: PayoutPlan = { pay: [], skip: [] };
  const min = Math.max(opts.minPayoutPaise, 1);
  for (const c of candidates) {
    const skip = (reason: PayoutSkipReason) => plan.skip.push({ vendorId: c.vendorId, reason, balance: c.balance });
    if (c.balance <= 0) skip("nothing_due");
    else if (c.balance < min) skip("below_minimum");
    else if (c.vendorStatus !== "active") skip("vendor_not_active");
    else if (opts.requireKyc && c.kycStatus !== "verified") skip("kyc_not_verified");
    else if (!c.accountType || c.payoutAccountStatus !== "verified") skip("no_payout_account");
    else if (opts.provider === "razorpayRoute" && c.accountType !== "route") skip("account_not_supported");
    else plan.pay.push({ vendorId: c.vendorId, amount: c.balance });
  }
  return plan;
}

// ------------------------------------------------------------------ payout accounts

export const PAYOUT_ACCOUNT_TYPES = ["bank", "upi", "route"] as const;
export type PayoutAccountType = (typeof PAYOUT_ACCOUNT_TYPES)[number];

export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const VPA_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/;
export const ROUTE_ACCOUNT_RE = /^acc_[A-Za-z0-9]{14}$/;

export const payoutAccountSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("bank"),
    holderName: z.string().trim().min(2).max(120),
    accountNumber: z.string().trim().regex(/^[0-9]{6,20}$/, "Account number is 6–20 digits"),
    ifsc: z
      .string()
      .trim()
      .transform((s) => s.toUpperCase())
      .refine((s) => IFSC_RE.test(s), "Invalid IFSC"),
  }),
  z.object({
    type: z.literal("upi"),
    vpa: z.string().trim().regex(VPA_RE, "Invalid UPI ID"),
    holderName: z.string().trim().max(120).optional(),
  }),
  z.object({
    type: z.literal("route"),
    accountId: z.string().trim().regex(ROUTE_ACCOUNT_RE, "Razorpay linked account ids look like acc_XXXXXXXXXXXXXX"),
  }),
]);
export type PayoutAccount = z.output<typeof payoutAccountSchema>;

/** What may be shown for a saved account (never the full bank account number). */
export type MaskedPayoutAccount =
  | { type: "bank"; holderName: string; ifsc: string; last4: string }
  | { type: "upi"; vpa: string; holderName: string | null }
  | { type: "route"; accountId: string };

export function maskPayoutAccount(a: PayoutAccount): MaskedPayoutAccount {
  if (a.type === "bank") return { type: "bank", holderName: a.holderName, ifsc: a.ifsc, last4: a.accountNumber.slice(-4) };
  if (a.type === "upi") {
    const [handle = "", psp = ""] = a.vpa.split("@");
    return { type: "upi", vpa: `${handle.slice(0, 2)}${"*".repeat(Math.max(handle.length - 2, 3))}@${psp}`, holderName: a.holderName ?? null };
  }
  return { type: "route", accountId: a.accountId };
}

// ------------------------------------------------------------------ vendors

/** URL slug from a seller name; null when nothing usable remains (e.g. a Tamil-only name). */
export function slugify(name: string): string | null {
  const s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return s.length >= 2 ? s : null;
}

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;

/** `base`, or `base-2`, `base-3`… — the first one not in `taken`. */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, 60 - suffix.length).replace(/-+$/g, "")}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export interface VendorMembership {
  vendorId: string;
  slug: string;
  name: string;
  role: VendorUserRole;
}

export type VendorPick =
  | { ok: true; membership: VendorMembership }
  | { ok: false; reason: "not_a_vendor" | "unknown_vendor" | "vendor_required"; vendors: { id: string; slug: string; name: string }[] };

/**
 * The seller a signed-in user acts for: their only one, or the one named by the `x-vendor` header (id or slug).
 * Several without a header → `vendor_required` (the client must choose).
 */
export function pickVendor(memberships: readonly VendorMembership[], header?: string | null): VendorPick {
  const vendors = memberships.map((m) => ({ id: m.vendorId, slug: m.slug, name: m.name }));
  if (memberships.length === 0) return { ok: false, reason: "not_a_vendor", vendors };
  const h = header?.trim();
  if (h) {
    const m = memberships.find((x) => x.vendorId === h || x.slug === h.toLowerCase());
    return m ? { ok: true, membership: m } : { ok: false, reason: "unknown_vendor", vendors };
  }
  if (memberships.length === 1) return { ok: true, membership: memberships[0]! };
  return { ok: false, reason: "vendor_required", vendors };
}

/** Effective commission for a seller: their own rate, or the shop default. */
export const effectiveCommissionBps = (vendorBps: number | null | undefined, defaultBps: number) =>
  vendorBps === null || vendorBps === undefined ? defaultBps : vendorBps;
