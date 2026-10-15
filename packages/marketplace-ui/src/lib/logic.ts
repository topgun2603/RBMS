/**
 * Pure display math for the marketplace screens (unit tested in logic.test.ts). Money is integer paise throughout;
 * commission rates are basis points (1000 bps = 10 %).
 */
import { formatINR } from "@srirealtime/gst";
import type {
  KycCheck,
  KycCheckType,
  LedgerEntry,
  MarketplaceSettings,
  MaskedPayoutAccount,
  OrderStatus,
  Payout,
  PayoutAccountStatus,
  PayoutSkipReason,
  Vendor,
  VendorOrder,
  VendorStatus,
} from "./types";
import { MARKETPLACE_SETTINGS_DEFAULTS, PAYOUT_PROVIDERS } from "./types";

// ---------------------------------------------------------------- money and rates

/** ₹ with Indian grouping from integer paise (en-IN digits in every locale). */
export const money = (paise: number | null | undefined) => formatINR(Math.round(paise ?? 0));

/** Signed money for ledgers: "+₹1,200.00" / "−₹120.00". */
export function signedMoney(paise: number): string {
  if (paise === 0) return money(0);
  return `${paise > 0 ? "+" : "−"}${money(Math.abs(paise))}`;
}

/** 1000 → "10%", 1250 → "12.5%", 875 → "8.75%". */
export function bpsToPercent(bps: number | null | undefined): string {
  return `${bpsToPercentInput(bps ?? 0)}%`;
}

/** 1250 → "12.5" (for an input). */
export function bpsToPercentInput(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return "";
  const v = Math.round(bps) / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, "");
}

/** "12.5" / "12.5 %" → 1250; empty, invalid, more than 2 decimals or outside 0–100 → null. */
export function percentToBps(input: string | null | undefined): number | null {
  const s = (input ?? "").replace(/[%\s]/g, "");
  if (!s || !/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const bps = Math.round(Number(s) * 100);
  return bps >= 0 && bps <= 10_000 ? bps : null;
}

/** "1,249.50" → 124950 paise; empty or invalid → null. */
export function rupeesToPaise(input: string | null | undefined): number | null {
  const s = (input ?? "").replace(/[,\s₹]/g, "");
  if (!s || !/^\d*\.?\d{0,2}$/.test(s) || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** 124950 → "1249.5" (plain, for an input). */
export function paiseToInput(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "";
  const r = Math.round(paise) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0$/, "");
}

/** What the seller sold on a vendor order, as charged: goods − coupon share + shipping share. */
export const saleAmountOf = (vo: Pick<VendorOrder, "subtotal" | "discount" | "shippingShare">) => vo.subtotal - vo.discount + vo.shippingShare;

/** Commission the shop keeps on `base` paise at `bps` (rounded half up, never negative; same as the server). */
export function commissionOf(base: number, bps: number): number {
  if (base <= 0 || bps <= 0) return 0;
  const b = Math.min(Math.max(Math.trunc(bps), 0), 10_000);
  return Math.floor((Math.trunc(base) * b + 5_000) / 10_000);
}

/** Example for the commission editor: on a ₹1,000 sale the shop keeps X and the seller gets Y. */
export function commissionExample(bps: number, salePaise = 100_000) {
  const commission = commissionOf(salePaise, bps);
  return { sale: salePaise, commission, net: salePaise - commission };
}

// ---------------------------------------------------------------- ledger

export interface LedgerRow extends LedgerEntry {
  /** Balance right after this entry. */
  balanceAfter: number;
}

/**
 * Running balance for a newest-first ledger page. `balanceAfterNewest` is the balance after the page's first entry:
 * the seller's current balance for the first page of an unfiltered list, or the previous page's last
 * `balanceAfter − amount` when paging.
 */
export function withRunningBalance(entries: readonly LedgerEntry[], balanceAfterNewest: number): LedgerRow[] {
  const out: LedgerRow[] = [];
  let after = balanceAfterNewest;
  for (const e of entries) {
    out.push({ ...e, balanceAfter: after });
    after -= e.amount;
  }
  return out;
}

/** Credits and debits of a ledger page (for the totals row). */
export function ledgerTotals(entries: readonly Pick<LedgerEntry, "amount">[]) {
  let credit = 0;
  let debit = 0;
  for (const e of entries) {
    if (e.amount >= 0) credit += e.amount;
    else debit += -e.amount;
  }
  return { credit, debit, net: credit - debit };
}

// ---------------------------------------------------------------- IST dates

const IST_OFFSET_MS = 5.5 * 3_600_000;
/** YYYY-MM-DD of an instant in India. */
export const istDateOf = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
/** First day of the IST month of `d`. */
export const istMonthStartOf = (d: Date) => `${istDateOf(d).slice(0, 8)}01`;
/** End of the IST day `date` (YYYY-MM-DD) as an instant. */
export const istEndOfDay = (date: string) => new Date(new Date(`${date}T00:00:00.000+05:30`).getTime() + 86_400_000 - 1);

// ---------------------------------------------------------------- seller sales

const NOT_SOLD: readonly OrderStatus[] = ["cancelled", "returned"];

/** Sales (as charged) and net (after commission) today and this month, from the seller's recent vendor orders. */
export function salesSummary(orders: readonly VendorOrder[], now: Date) {
  const today = istDateOf(now);
  const month = today.slice(0, 7);
  const out = { today: 0, todayCount: 0, month: 0, monthCount: 0, monthNet: 0 };
  for (const o of orders) {
    if (NOT_SOLD.includes(o.status)) continue;
    const day = istDateOf(new Date(o.placedAt));
    if (day.slice(0, 7) !== month) continue;
    const sale = saleAmountOf(o);
    out.month += sale;
    out.monthNet += o.net;
    out.monthCount++;
    if (day === today) {
      out.today += sale;
      out.todayCount++;
    }
  }
  return out;
}

/**
 * Money not yet payable: net of live vendor orders still in the return window or not delivered yet, and the part of
 * it that becomes payable by `until` (delivered, window ending by then).
 */
export function pendingSettlement(orders: readonly VendorOrder[], until: Date) {
  let pending = 0;
  let releasing = 0;
  let nextAt: string | null = null;
  for (const o of orders) {
    if (o.settlementStatus !== "pending" || NOT_SOLD.includes(o.status)) continue;
    pending += o.net;
    if (o.status === "delivered" && o.eligibleAt) {
      if (new Date(o.eligibleAt).getTime() <= until.getTime()) releasing += o.net;
      if (!nextAt || o.eligibleAt < nextAt) nextAt = o.eligibleAt;
    }
  }
  return { pending, releasing, nextAt };
}

/** The seller's next payout: current balance plus what becomes payable by then, if it reaches the minimum. */
export function nextPayoutEstimate(balance: number, releasing: number, minPayoutPaise: number) {
  const amount = Math.max(balance + releasing, 0);
  const min = Math.max(minPayoutPaise, 1);
  return { amount, reachesMinimum: amount >= min, shortBy: amount >= min ? 0 : min - amount };
}

// ---------------------------------------------------------------- payout preview (dry run)

export interface PreviewVendor {
  id: string;
  name: string;
  status: VendorStatus;
  kycStatus: string;
  payoutAccountStatus: PayoutAccountStatus;
  payoutAccount: Pick<MaskedPayoutAccount, "type"> | null;
  /** Current ledger balance, paise. */
  balance: number;
}

export interface PreviewRow {
  vendorId: string;
  vendorName: string;
  /** Ledger balance now. */
  balance: number;
  /** Delivered sales whose return window ends by the run date (credited when the run starts). */
  releasing: number;
  /** balance + releasing. */
  amount: number;
  orders: number;
  reason: PayoutSkipReason | null;
}

export interface PayoutPreview {
  pay: PreviewRow[];
  skip: PreviewRow[];
  total: number;
}

/**
 * What a payout run up to `until` would do, computed on the client (the API has no dry run): every seller's
 * balance plus their sales released by then, then the same rules as the server's `planPayouts`.
 */
export function previewPayouts(
  vendors: readonly PreviewVendor[],
  orders: readonly VendorOrder[],
  settings: Pick<MarketplaceSettings, "minPayoutPaise" | "requireKyc" | "payoutProvider">,
  until: Date,
): PayoutPreview {
  const releasing = new Map<string, { net: number; n: number }>();
  for (const o of orders) {
    if (o.status !== "delivered" || o.settlementStatus !== "pending" || !o.eligibleAt) continue;
    if (new Date(o.eligibleAt).getTime() > until.getTime()) continue;
    const r = releasing.get(o.vendorId) ?? { net: 0, n: 0 };
    r.net += o.net;
    r.n++;
    releasing.set(o.vendorId, r);
  }
  const min = Math.max(settings.minPayoutPaise, 1);
  const out: PayoutPreview = { pay: [], skip: [], total: 0 };
  for (const v of vendors) {
    const rel = releasing.get(v.id) ?? { net: 0, n: 0 };
    const amount = v.balance + rel.net;
    let reason: PayoutSkipReason | null = null;
    if (amount <= 0) reason = "nothing_due";
    else if (amount < min) reason = "below_minimum";
    else if (v.status !== "active") reason = "vendor_not_active";
    else if (settings.requireKyc && v.kycStatus !== "verified") reason = "kyc_not_verified";
    else if (!v.payoutAccount || v.payoutAccountStatus !== "verified") reason = "no_payout_account";
    else if (settings.payoutProvider === "razorpayRoute" && v.payoutAccount.type !== "route") reason = "account_not_supported";
    const row: PreviewRow = { vendorId: v.id, vendorName: v.name, balance: v.balance, releasing: rel.net, amount, orders: rel.n, reason };
    if (reason) {
      if (amount !== 0 || v.balance !== 0) out.skip.push(row);
    } else {
      out.pay.push(row);
      out.total += amount;
    }
  }
  out.pay.sort((a, b) => b.amount - a.amount || a.vendorName.localeCompare(b.vendorName));
  out.skip.sort((a, b) => b.amount - a.amount || a.vendorName.localeCompare(b.vendorName));
  return out;
}

// ---------------------------------------------------------------- payout actions

export const canRetryPayout = (p: Pick<Payout, "status">) => p.status === "failed";
export const canMarkPaid = (p: Pick<Payout, "status">) => p.status === "processing" || p.status === "failed";
export const canCancelPayout = (p: Pick<Payout, "status" | "provider">) =>
  p.status === "failed" || p.status === "pending" || (p.status === "processing" && p.provider === "manual");
export const canRefreshPayout = (p: Pick<Payout, "status" | "providerRef" | "provider">) =>
  p.status === "processing" && !!p.providerRef && p.provider === "razorpayRoute";

/** Vendor status moves staff may make (same rules as the server). */
export function canSetVendorStatus(from: VendorStatus, to: VendorStatus): boolean {
  if (from === to) return false;
  if (to === "active") return from === "pending" || from === "suspended";
  if (to === "suspended") return from === "pending" || from === "active";
  return false;
}

/** Staff notes with a dated suspension reason appended. */
export function notesWithReason(existing: string | null | undefined, label: string, reason: string, at: Date): string {
  const line = `[${istDateOf(at)}] ${label}: ${reason.trim()}`;
  const prev = (existing ?? "").trim();
  return (prev ? `${prev}\n${line}` : line).slice(-2000);
}

// ---------------------------------------------------------------- settings

/** Stored (partial / stale) settings with defaults for anything missing or invalid. */
export function resolveSettings(raw: Partial<Record<keyof MarketplaceSettings, unknown>> | null | undefined): MarketplaceSettings {
  const d = MARKETPLACE_SETTINGS_DEFAULTS;
  const r = raw ?? {};
  const int = (v: unknown, min: number, max: number, dflt: number) =>
    typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : dflt;
  return {
    defaultCommissionBps: int(r.defaultCommissionBps, 0, 10_000, d.defaultCommissionBps),
    returnWindowDays: int(r.returnWindowDays, 0, 90, d.returnWindowDays),
    minPayoutPaise: int(r.minPayoutPaise, 0, 100_000_000, d.minPayoutPaise),
    requireKyc: typeof r.requireKyc === "boolean" ? r.requireKyc : d.requireKyc,
    payoutProvider: (PAYOUT_PROVIDERS as readonly unknown[]).includes(r.payoutProvider) ? (r.payoutProvider as MarketplaceSettings["payoutProvider"]) : d.payoutProvider,
    acceptApplications: typeof r.acceptApplications === "boolean" ? r.acceptApplications : d.acceptApplications,
  };
}

// ---------------------------------------------------------------- payout accounts and identifiers

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const VPA_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/;
export const ACCOUNT_RE = /^[0-9]{9,18}$/;
export const ROUTE_ACCOUNT_RE = /^acc_[A-Za-z0-9]{14}$/;
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PHONE_RE = /^(\+91|91|0)?[6-9]\d{9}$/;

export const normalizeId = (v: string) => v.replace(/[\s-]+/g, "").toUpperCase();

/** One line for a saved (masked) payout account. */
export function accountText(a: MaskedPayoutAccount | null | undefined): string {
  if (!a) return "—";
  if (a.type === "bank") return `${a.holderName} · A/c ••••${a.last4} · ${a.ifsc}`;
  if (a.type === "upi") return a.holderName ? `${a.vpa} · ${a.holderName}` : a.vpa;
  return a.accountId;
}

// ---------------------------------------------------------------- kyc

/** Newest check of any of `types`. */
export function latestCheck(checks: readonly KycCheck[], types: readonly KycCheckType[]): KycCheck | null {
  let best: KycCheck | null = null;
  for (const c of checks) {
    if (!types.includes(c.type)) continue;
    if (!best || c.createdAt > best.createdAt) best = c;
  }
  return best;
}

const KNOWN_KYC_ERRORS = [
  "invalid_pan",
  "account_not_found",
  "vpa_not_found",
  "name_mismatch",
  "gstin_not_found",
  "gstin_inactive",
  "low_confidence",
  "rejected",
  "verification_failed",
] as const;

/** Message key for a check's error code (mock and HTTP providers share the codes). */
export function kycErrorKey(code: string | null | undefined): string {
  if (!code) return "marketplace.kyc.error.verification_failed";
  if (code.startsWith("provider_")) return "marketplace.kyc.error.provider";
  return (KNOWN_KYC_ERRORS as readonly string[]).includes(code) ? `marketplace.kyc.error.${code}` : "marketplace.kyc.error.verification_failed";
}

// ---------------------------------------------------------------- onboarding checklist

export type StepState = "done" | "waiting" | "failed" | "todo";

export interface OnboardingSteps {
  profile: StepState;
  pan: StepState;
  bank: StepState;
  payout: StepState;
  approval: StepState;
  /** Steps done, out of the steps shown. */
  done: number;
  total: number;
}

const checkState = (c: KycCheck | null): StepState =>
  !c ? "todo" : c.status === "verified" ? "done" : c.status === "failed" ? "failed" : "waiting";

/** Profile counts as complete with a contact name, phone and a short description. */
export const profileComplete = (v: Pick<Vendor, "contactName" | "contactPhone" | "description">) =>
  !!(v.contactName?.trim() && v.contactPhone?.trim() && v.description?.trim());

/** Checklist state for a seller. `checks` is null when the KYC feature is off (those steps are hidden). */
export function onboardingSteps(
  v: Pick<Vendor, "status" | "contactName" | "contactPhone" | "description" | "payoutAccountStatus">,
  checks: readonly KycCheck[] | null,
): OnboardingSteps {
  const profile: StepState = profileComplete(v) ? "done" : "todo";
  const pan = checks ? checkState(latestCheck(checks, ["pan"])) : "done";
  const bank = checks ? checkState(latestCheck(checks, ["bank_account", "upi"])) : "done";
  const payout: StepState =
    v.payoutAccountStatus === "verified" ? "done" : v.payoutAccountStatus === "pending" ? "waiting" : v.payoutAccountStatus === "rejected" ? "failed" : "todo";
  const approval: StepState = v.status === "active" ? "done" : v.status === "suspended" ? "failed" : "waiting";
  const shown: StepState[] = checks ? [profile, pan, bank, payout, approval] : [profile, payout, approval];
  return { profile, pan, bank, payout, approval, done: shown.filter((s) => s === "done").length, total: shown.length };
}

// ---------------------------------------------------------------- products (seller editor)

/** Every combination of option values, in option order. */
export function cartesian(options: readonly { name: string; values: readonly string[] }[]): Record<string, string>[] {
  const usable = options.filter((o) => o.name.trim() && o.values.length > 0);
  if (usable.length === 0) return [];
  let out: Record<string, string>[] = [{}];
  for (const o of usable) out = out.flatMap((combo) => o.values.map((v) => ({ ...combo, [o.name]: v })));
  return out;
}

/** "S / Red" for a combination, in option order. */
export const variantTitle = (combo: Record<string, string>, options: readonly { name: string }[]) =>
  options
    .map((o) => combo[o.name])
    .filter(Boolean)
    .join(" / ");

/** Stable key for a combination regardless of key order. */
export const comboKey = (combo: Record<string, string>) =>
  Object.keys(combo)
    .sort()
    .map((k) => `${k}=${combo[k]}`)
    .join("|");

/** Percentage off MRP (whole number), null when there is no discount. */
export function discountPct(price: number, mrp: number | null | undefined): number | null {
  if (!mrp || mrp <= price) return null;
  return Math.round(((mrp - price) / mrp) * 100);
}
