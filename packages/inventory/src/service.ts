import {
  AppError,
  badRequest,
  conflict,
  defineSort,
  facetCounts,
  listFilter,
  listQuerySchema,
  notFound,
  parseSortValue,
  rangeOrder,
  runList,
  searchAny,
  splitList,
  type ListPage,
  type ResolvedSort,
} from "@srirealtime/core";
import type { Db, DbOrTx } from "@srirealtime/db";
import {
  computeInvoice,
  GST_RATES,
  isGstRate,
  isInterState,
  isValidDate,
  isValidGstin,
  isValidStateCode,
  lineAmount,
  normalizeGstin,
  normalizeStateCode,
  stateFromGstin,
  todayIST,
  type GstRate,
  type InvoiceTotals,
  type LineInput,
  type TaxBreakupRow,
} from "@srirealtime/gst";
import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  adjustmentDelta,
  fromMilli,
  hasAtMost3Decimals,
  mergePurchaseLines,
  mergeQtyLines,
  milliToDecimal,
  movingAverageCost,
  stockStatus,
  stockValue,
  toMilli,
  unitCostOf,
  type StockStatus,
} from "./logic";
import {
  activeReservations,
  aggregateStock,
  checkAvailability,
  isItemTracked,
  locationCodeFrom,
  locationDeleteProblem,
  locationPatchProblem,
  lowStockEvents,
  netByLocationItem,
  publicStockFlags,
  reserveDecision,
  transferProblem,
  type ShortItem,
  type StockDrop,
  type StockLevelInput,
} from "./levels";
import { AuditService } from "./audit";
import { BatchService, batchFieldsSchema, batchReasonFor, type TakeResult } from "./batches";
import { PurchasingService } from "./purchasing";
import { TransferService } from "./transfers";
import { apportion, purchaseBalance } from "./payables";
import { noopLogger, type CatalogItem, type EventsPort, type ItemCatalogPort, type LegacyBatchPort, type LoggerPort, type SellerStatePort, type TransferNoticePort } from "./ports";
import {
  LOCATION_TYPES,
  debitNotes,
  goodsReceipts,
  purchasePayments,
  purchases,
  type PaymentMode,
  PAYMENT_MODES,
  type LocationType,
  type MovementReason,
  type ReservationStatus,
  stockItems,
  stockLocations,
  stockMovements,
  stockReservations,
  stockTransfers,
  suppliers,
  type StockLocationRow,
  type StockReservationRow,
  type StockTransferRow,
  type TransferLine,
  type TransferStatus,
  type PurchaseLine,
  type PurchaseRow,
  type PurchaseStatus,
  type RefType,
  type StockItemRow,
  type SupplierRow,
  type SupplierSnapshot,
} from "./schema";

export const MODULE_ID = "inventory";
/** Money columns are Postgres `integer` (paise). */
export const MAX_PAISE = 2_000_000_000;
/** numeric(14,3) holds up to 99,999,999,999.999; stay well inside it. */
export const MAX_QTY = 1_000_000_000;
export const DEFAULT_SUPPLIER_NAME = "Cash purchase";
export const DEFAULT_LOCATION_NAME = "Main";
export const DEFAULT_LOCATION_CODE = "MAIN";

/** Internal extras of a purchase made from a goods receipt / purchase order. */
export interface PurchaseExtra {
  /** The stock already came in with a goods receipt. */
  skipStock?: boolean;
  purchaseOrderId?: string;
  goodsReceiptId?: string;
}

export interface InventoryDeps {
  db: Db;
  catalog: ItemCatalogPort;
  sellerState: SellerStatePort;
  /** Webhook events (`stock.low`). Without it nothing is emitted and no extra reads happen. */
  events?: EventsPort;
  log?: LoggerPort;
  /** Clock override for tests. */
  now?: () => Date;
  /** The pharmacy module's batches (batches there stay managed there). */
  legacyBatches?: LegacyBatchPort;
  /** Tells the receiving branch that a transfer is on its way. */
  transferNotice?: TransferNoticePort;
}

// ------------------------------------------------------------------ DTOs

export interface ListResult<T> {
  items: T[];
  total: number;
}

export interface StockRow {
  itemId: string;
  name: string;
  unit: string;
  hsn: string | null;
  qty: number;
  reorderLevel: number;
  track: boolean;
  /** Paise per unit, excluding GST; null until a cost is known. */
  avgCost: number | null;
  /** qty × avgCost, paise (0 for negative stock or unknown cost). */
  value: number;
  status: StockStatus;
  updatedAt: Date | null;
}

/** A StockRow with reservations, for one location (`locationId`) or summed over all locations (`locationId: null`). */
export interface StockLevelRow extends StockRow {
  reserved: number;
  /** qty − reserved. */
  available: number;
  locationId: string | null;
  /** Stock lists: the item's category (when the catalogue gives one). */
  categoryId?: string | null;
  categoryName?: string | null;
}

export interface StockLocation {
  id: string;
  name: string;
  code: string;
  type: LocationType;
  address: string | null;
  isDefault: boolean;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface StockTransfer {
  id: string;
  /** "TR/26-27/0001"; null on instant transfers made before the send / receive flow. */
  number: string | null;
  status: TransferStatus;
  fromLocationId: string;
  toLocationId: string;
  lines: TransferLine[];
  note: string | null;
  transport: string | null;
  receiveNote: string | null;
  createdBy: string | null;
  createdAt: Date;
  sentAt: Date | null;
  receivedAt: Date | null;
  closedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
}

export interface ItemAvailability {
  itemId: string;
  /** qty − reserved (sum over locations unless a location was asked for). */
  available: number;
  tracked: boolean;
}

export interface PublicItemAvailability {
  itemId: string;
  inStock: boolean;
  lowStock: boolean;
}

export interface ReservationLine {
  itemId: string;
  locationId: string;
  qty: number;
  status: ReservationStatus;
}

export interface ReserveInput {
  /** e.g. "order". */
  refType: string;
  refId: string;
  /** Default location when omitted. */
  locationId?: string | null;
  lines: { itemId: string; qty: number }[];
  /** Hold the stock even when it isn't available (reserved may exceed qty). */
  allowBackorder?: boolean;
}

export interface BackfillResult {
  tenants: number;
  stockItems: number;
  movements: number;
  /** Legacy rows left with a null location because the item already had a row at the default location. */
  skipped: number;
}

export interface StockTotals {
  stockValue: number;
  lowCount: number;
  outCount: number;
}

export interface StockList extends ListResult<StockLevelRow> {
  limit?: number;
  offset?: number;
  totals: StockTotals;
  /** `status` (in/low/out/untracked) and `category` (id or "none") counts under the other filters. */
  facets?: Record<string, Record<string, number>>;
  /** Names of the categories in `facets.category`. */
  categories?: { id: string; name: string }[];
}

export interface StockSummary extends StockTotals {
  lowItems: StockLevelRow[];
}

export interface Movement {
  id: string;
  /** When the movement was recorded. */
  date: Date;
  reason: MovementReason;
  delta: number;
  qtyAfter: number;
  refType: RefType | null;
  refId: string | null;
  refNumber: string | null;
  note: string | null;
  createdBy: string | null;
  locationId: string | null;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
  stateCode: string | null;
  /** Paise we owe: opening balance + unpaid recorded bills - on-account payments (negative = advance paid). */
  payable: number;
  /** Paise owed when the supplier was set up (positive = payable). */
  openingBalance: number;
  openingDate: string | null;
  createdAt: Date;
}

export interface PurchaseSummary {
  id: string;
  billNumber: string;
  date: string;
  supplierId: string | null;
  supplierName: string;
  supplierGstin: string | null;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  paid: boolean;
  /** Paise paid so far (net of refunds). */
  amountPaid: number;
  returnedAmount: number;
  /** total - returnedAmount - amountPaid. */
  balance: number;
  dueDate: string | null;
  status: PurchaseStatus;
  createdAt: Date;
}

export interface Purchase {
  id: string;
  billNumber: string;
  date: string;
  supplierId: string | null;
  supplier: SupplierSnapshot;
  placeOfSupply: string;
  interState: boolean;
  lines: PurchaseLine[];
  totals: Omit<InvoiceTotals, "lines">;
  total: number;
  paid: boolean;
  amountPaid: number;
  returnedAmount: number;
  balance: number;
  dueDate: string | null;
  freight: number;
  otherCharges: number;
  purchaseOrderId: string | null;
  goodsReceiptId: string | null;
  status: PurchaseStatus;
  notes: string | null;
  cancelledAt: Date | null;
  createdAt: Date;
}

export interface ItcTotals {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export interface PurchaseReport {
  rows: PurchaseSummary[];
  itc: ItcTotals;
  byRate: TaxBreakupRow[];
}

export interface SaleInput {
  refId: string;
  /** Invoice number, shown on movements. */
  refNumber?: string | null;
  /** Default location when omitted. */
  locationId?: string | null;
  /** `batchId`: the batch the cashier chose for the line (stock comes from it first). */
  lines: { itemId: string; qty: number; batchId?: string | null }[];
}

// ------------------------------------------------------------------ validation

/** Empty strings become null; undefined stays undefined (PATCH: "leave as is"). */
const opt = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), s.nullable().optional());

const money = z.number().int("Amounts are whole paise").min(0).max(MAX_PAISE);
const dateStr = z.string().refine(isValidDate, "Use a valid YYYY-MM-DD date");
const stateCode = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const c = normalizeStateCode(v);
  if (!c || !isValidStateCode(c)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Unknown GST state code" });
    return z.NEVER;
  }
  return c;
});
const gstin = z.string().transform(normalizeGstin).refine(isValidGstin, "Invalid GSTIN");
const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 -]{5,19}$/, "Invalid phone number");
const email = z.string().trim().toLowerCase().email().max(254);
const hsn = z
  .string()
  .trim()
  .regex(/^[0-9]{2,8}$/, "HSN/SAC must be 2–8 digits");
const gstRate = z
  .number()
  .refine(isGstRate, `GST rate must be one of ${GST_RATES.join(", ")}`)
  .transform((v) => v as GstRate);
const qtyNumber = z.coerce.number().finite().refine(hasAtMost3Decimals, "Quantity allows up to 3 decimals");
const positiveQty = qtyNumber.refine((q) => q > 0 && q <= MAX_QTY, "Quantity must be more than 0");
const nonNegativeQty = qtyNumber.refine((q) => q >= 0 && q <= MAX_QTY, "Quantity can't be negative");
const uuid = z.string().uuid();
const formatParam = z.enum(["json", "csv"]).default("json");

/** Optional location filter/target: the default location for writes, all locations (summed) for lists. */
const locationIdParam = z.preprocess((v) => (v === "" || v === null ? undefined : v), uuid.optional());

/** Stock list statuses: in stock, low (at or under the reorder level), out, not tracked. */
export const STOCK_LIST_STATUSES = ["in", "low", "out", "untracked"] as const;
export type StockListStatus = (typeof STOCK_LIST_STATUSES)[number];
/** `category` value for items without a category. */
export const NO_CATEGORY = "none";

/**
 * GET /v1/inventory/stock (docs/CONVENTIONS.md → "Lists and tables"). Without `limit` every item comes back (up to
 * 1000), as before. `status` (comma list) replaces the single `filter`, which still works; `category` takes ids or
 * "none".
 */
export const stockQuerySchema = listQuerySchema({ defaultLimit: 1000, maxLimit: 1000 }).extend({
  filter: z.enum(["all", "low", "out", "untracked"]).default("all"),
  status: listFilter.oneOf(STOCK_LIST_STATUSES),
  category: z.preprocess(splitList, z.array(z.union([z.string().uuid(), z.literal(NO_CATEGORY)])).max(50).optional()),
  locationId: locationIdParam,
});
export type StockQuery = z.input<typeof stockQuerySchema>;

export const STOCK_SORT_KEYS = ["name", "qty", "value", "reorderLevel"] as const;
export type StockSortKey = (typeof STOCK_SORT_KEYS)[number];

/** Resolves the stock list `sort` (default "name"); unknown keys are a 400 listing the allowed ones. */
export function parseStockSort(raw: string | undefined | null): ResolvedSort<StockSortKey> {
  const value = (raw ?? "").trim() || "name";
  const r = parseSortValue(value, STOCK_SORT_KEYS);
  if (!r) {
    throw badRequest(`Unknown sort field "${value}". Sort by one of: ${STOCK_SORT_KEYS.join(", ")} (prefix "-" for descending).`, {
      field: "sort",
      value,
      allowed: STOCK_SORT_KEYS,
    });
  }
  return r;
}

/** The list status of a stock row. */
export const stockListStatus = (r: Pick<StockRow, "track" | "status">): StockListStatus =>
  !r.track ? "untracked" : r.status === "ok" ? "in" : r.status;

/** Sorts stock rows (a copy) by the resolved sort; ties by name, then item id. */
export function sortStockRows<T extends StockRow>(rows: readonly T[], sort: ResolvedSort<StockSortKey>): T[] {
  const dir = sort.desc ? -1 : 1;
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.itemId.localeCompare(b.itemId);
  const val = (r: T) => (sort.key === "qty" ? r.qty : sort.key === "value" ? r.value : r.reorderLevel);
  return [...rows].sort((a, b) => (sort.key === "name" ? dir * byName(a, b) : dir * (val(a) - val(b)) || byName(a, b)));
}


export const stockPatchSchema = z.object({
  track: z.boolean().optional(),
  reorderLevel: nonNegativeQty.optional(),
  /** Reorder level is per location; `track` always applies to the item at every location. */
  locationId: locationIdParam,
});
export type StockPatch = z.input<typeof stockPatchSchema>;

export const adjustInputSchema = z
  .object({
    mode: z.enum(["add", "remove", "set"]),
    qty: nonNegativeQty,
    note: opt(z.string().trim().max(500)),
    unitCost: opt(money),
    locationId: locationIdParam,
    /** Adjust one batch of a batch-tracked item (remove / set take from it, add puts into it). */
    batchId: opt(uuid),
    /** Stock added into a (new or known) batch: batch number, expiry... */
    batch: batchFieldsSchema.optional(),
  })
  .superRefine((b, ctx) => {
    if (b.mode !== "set" && b.qty <= 0)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["qty"], message: "Quantity must be more than 0" });
  });
export type AdjustInput = z.input<typeof adjustInputSchema>;

export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PageQuery = z.input<typeof pageQuerySchema>;

export const movementsQuerySchema = pageQuerySchema.extend({ locationId: locationIdParam });
export type MovementsQuery = z.input<typeof movementsQuerySchema>;

export const locationQuerySchema = z.object({ locationId: locationIdParam });
export type LocationQuery = z.input<typeof locationQuerySchema>;

export const saleInputSchema = z.object({
  refId: z.string().trim().min(1).max(100),
  refNumber: opt(z.string().trim().max(50)),
  locationId: locationIdParam,
  /** `batchId`: the batch the cashier chose for the line (the rest, if it runs short, comes first-expiry-first-out). */
  lines: z.array(z.object({ itemId: uuid, qty: positiveQty, batchId: opt(uuid) })).max(500),
});

/** Goods of a credit note coming back (`saleRefId` = the invoice whose sale took them). */
export const returnInputSchema = z.object({
  refId: z.string().trim().min(1).max(100),
  saleRefId: z.string().trim().min(1).max(100),
  refNumber: opt(z.string().trim().max(50)),
  locationId: locationIdParam,
  lines: z.array(z.object({ itemId: uuid, qty: positiveQty })).max(500),
});
export type ReturnInput = z.input<typeof returnInputSchema>;

export const supplierInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: opt(phone),
  email: opt(email),
  gstin: opt(gstin),
  address: opt(z.string().trim().max(500)),
  stateCode: opt(stateCode),
  /** Paise already owed to the supplier when starting (negative = advance paid to them). */
  openingBalance: z.number().int().min(-MAX_PAISE).max(MAX_PAISE).optional(),
  openingDate: opt(dateStr),
});
export const supplierPatchSchema = supplierInputSchema.partial();
export type SupplierInput = z.input<typeof supplierInputSchema>;

/** GET /v1/inventory/suppliers: limits 50 / 200; `sort` = name / balance / lastPurchase. */
export const supplierListQuerySchema = listQuerySchema({ defaultLimit: 50, maxLimit: 200 });
export type SupplierListQuery = z.input<typeof supplierListQuerySchema>;

/** A purchase line: rate = cost per unit (paise, excluding GST); `itemId` adds stock for that item. */
export const purchaseLineSchema = z
  .object({
    itemId: opt(uuid),
    description: z.string().trim().min(1).max(300),
    hsn: opt(hsn),
    qty: positiveQty.refine((q) => q <= 1_000_000, "Quantity is too large"),
    unit: opt(z.string().trim().max(16)),
    rate: money,
    discount: money.optional(),
    gstRate,
    /** Batch received on this line (batch-tracked items): number, dates and MRP. */
    batchNo: opt(z.string().trim().max(60)),
    mfgDate: opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
    expiry: opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  })
  .superRefine((l, ctx) => {
    if ((l.discount ?? 0) > lineAmount(l.qty, l.rate)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["discount"], message: "Discount can't exceed the line amount" });
    }
  })
  .transform((l): LineInput & { itemId?: string } => {
    const out: LineInput & { itemId?: string } = { description: l.description, qty: l.qty, rate: l.rate, gstRate: l.gstRate };
    if (l.itemId) out.itemId = l.itemId;
    if (l.hsn) out.hsn = l.hsn;
    if (l.unit) out.unit = l.unit;
    if (l.discount) out.discount = l.discount;
    if (l.batchNo) out.batchNo = l.batchNo;
    if (l.mfgDate) out.mfgDate = l.mfgDate;
    if (l.expiry) out.expiry = l.expiry;
    return out;
  });

const inlineSupplierSchema = z.object({
  name: z.string().trim().min(1).max(120),
  gstin: opt(gstin),
  stateCode: opt(stateCode),
  phone: opt(phone),
  address: opt(z.string().trim().max(500)),
});

export const purchaseInputSchema = z.object({
  supplierId: opt(uuid),
  supplier: inlineSupplierSchema.nullable().optional(),
  billNumber: z.string().trim().min(1, "Enter the supplier's bill number").max(50),
  date: dateStr,
  lines: z.array(purchaseLineSchema).min(1, "Add at least one line").max(200),
  notes: opt(z.string().trim().max(2000)),
  paid: z.boolean().default(false),
  /** Paid at entry (part payment), paise; `paid: true` means the whole bill. */
  amountPaid: money.optional(),
  paymentMode: z.enum(PAYMENT_MODES).optional(),
  paymentReference: opt(z.string().trim().max(100)),
  dueDate: opt(dateStr),
  /** Supplier's freight and other charges (no GST); added to the bill total and spread over the stock cost. */
  freight: money.optional(),
  otherCharges: money.optional(),
  /** Where the stock arrives (default location when omitted). */
  locationId: locationIdParam,
});
export type PurchaseInput = z.input<typeof purchaseInputSchema>;

/** Purchase list statuses: recorded and unpaid / recorded and paid / cancelled. */
export const PURCHASE_LIST_STATUSES = ["unpaid", "paid", "cancelled"] as const;
export type PurchaseListStatus = (typeof PURCHASE_LIST_STATUSES)[number];

/**
 * GET /v1/inventory/purchases (docs/CONVENTIONS.md → "Lists and tables"): limits 50 / 200; `status` and `supplierId`
 * take comma lists; `from`/`to` are bill dates.
 */
export const purchaseListQuerySchema = listQuerySchema({ defaultLimit: 50, maxLimit: 200 })
  .extend({
    status: listFilter.oneOf(PURCHASE_LIST_STATUSES),
    supplierId: listFilter.ids(),
    from: listFilter.date(),
    to: listFilter.date(),
  })
  .superRefine(rangeOrder("from", "to"));
export type PurchaseListQuery = z.input<typeof purchaseListQuerySchema>;

export const paidInputSchema = z.object({ paid: z.boolean() });

/** `unpaid` / `paid` / `cancelled` of a purchase, as SQL. */
const purchaseListStatusSql = sql<string>`(case when ${purchases.status} = 'cancelled' then 'cancelled' when ${purchases.paid} then 'paid' else 'unpaid' end)`;

/** Purchase list sort; `balance` = what is still to pay (unpaid recorded bills). Default: newest first. */
export const PURCHASE_SORT = defineSort(
  {
    date: purchases.date,
    number: sql`lower(${purchases.billNumber})`,
    supplier: sql`lower(${purchases.supplier}->>'name')`,
    total: purchases.total,
    balance: sql`(case when ${purchases.status} = 'recorded' then ${purchases.total} - ${purchases.returnedAmount} - ${purchases.amountPaid} else 0 end)`,
    due: purchases.dueDate,
  },
  { default: "-date", tieBreaker: [purchases.createdAt, purchases.id] },
);

export const purchaseReportQuerySchema = z
  .object({ from: dateStr, to: dateStr, format: formatParam })
  .refine((v) => v.from <= v.to, { message: "`from` must be on or before `to`", path: ["from"] });
export const stockReportQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  format: formatParam,
  locationId: locationIdParam,
});

// ---- locations, transfers, availability, reservations

const locationCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,15}$/, "Code: up to 16 letters, digits, - or _");

export const locationInputSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(80),
  code: opt(locationCode),
  type: z.enum(LOCATION_TYPES).default("store"),
  address: opt(z.string().trim().max(500)),
  isDefault: z.boolean().optional(),
  active: z.boolean().optional(),
});
export type LocationInput = z.input<typeof locationInputSchema>;

export const locationPatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  code: locationCode.optional(),
  type: z.enum(LOCATION_TYPES).optional(),
  address: opt(z.string().trim().max(500)),
  isDefault: z.boolean().optional(),
  active: z.boolean().optional(),
});
export type LocationPatch = z.input<typeof locationPatchSchema>;

const boolParam = z.preprocess((v) => (v === "true" || v === "1" ? true : v === "false" || v === "0" ? false : v), z.boolean());
export const locationListQuerySchema = z.object({ includeInactive: boolParam.default(true) });
export type LocationListQuery = z.input<typeof locationListQuerySchema>;

export const transferInputSchema = z.object({
  fromLocationId: uuid,
  toLocationId: uuid,
  lines: z
    .array(z.object({ itemId: uuid, qty: positiveQty }))
    .min(1, "Add at least one line")
    .max(500),
  note: opt(z.string().trim().max(500)),
});
export type TransferInput = z.input<typeof transferInputSchema>;

export const transferListQuerySchema = pageQuerySchema.extend({ locationId: locationIdParam });
export type TransferListQuery = z.input<typeof transferListQuerySchema>;

/** `itemIds=a,b,c` (or repeated) → unique uuids, 1..200. */
const itemIdsParam = z.preprocess((v) => {
  const list = Array.isArray(v) ? v : typeof v === "string" ? [v] : v;
  if (!Array.isArray(list)) return list;
  return [
    ...new Set(
      list
        .flatMap((x) => (typeof x === "string" ? x.split(",") : [x]))
        .map((x) => (typeof x === "string" ? x.trim() : x))
        .filter((x) => x !== ""),
    ),
  ];
}, z.array(uuid).min(1, "Give at least one itemId").max(200));
export const availabilityQuerySchema = z.object({ itemIds: itemIdsParam, locationId: locationIdParam });
export type AvailabilityQuery = z.input<typeof availabilityQuerySchema>;

const refTypeSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_-]{0,39}$/, "Invalid ref type");
const refIdSchema = z.string().trim().min(1).max(100);
export const reserveInputSchema = z.object({
  refType: refTypeSchema,
  refId: refIdSchema,
  locationId: locationIdParam,
  lines: z.array(z.object({ itemId: uuid, qty: positiveQty })).max(500),
  allowBackorder: z.boolean().optional(),
});

/** 409 `insufficient_stock` with `{ items: { itemId, available, requested }[] }`. */
export const insufficientStock = (items: ShortItem[]) =>
  new AppError(409, "insufficient_stock", "Not enough stock for some items", { items });

const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;

// ------------------------------------------------------------------ helpers

function snapshotOf(c: {
  name: string;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  address?: string | null;
  stateCode?: string | null;
}): SupplierSnapshot {
  const g = c.gstin ?? null;
  return {
    name: c.name,
    phone: c.phone ?? null,
    email: c.email ?? null,
    gstin: g,
    address: c.address ?? null,
    stateCode: c.stateCode ?? (g ? stateFromGstin(g) : null),
  };
}

const toSupplier = (s: SupplierRow, payable: unknown): Supplier => ({
  openingBalance: s.openingBalance,
  openingDate: s.openingDate,
  id: s.id,
  name: s.name,
  phone: s.phone,
  email: s.email,
  gstin: s.gstin,
  address: s.address,
  stateCode: s.stateCode,
  payable: Number(payable ?? 0),
  createdAt: s.createdAt,
});

const toPurchase = (r: PurchaseRow): Purchase => ({
  id: r.id,
  billNumber: r.billNumber,
  date: r.date,
  supplierId: r.supplierId,
  supplier: r.supplier,
  placeOfSupply: r.placeOfSupply,
  interState: r.interState,
  lines: r.lines,
  totals: r.totals,
  total: r.total,
  paid: r.paid,
  amountPaid: r.amountPaid,
  returnedAmount: r.returnedAmount,
  balance: purchaseBalance(r),
  dueDate: r.dueDate,
  freight: r.freight,
  otherCharges: r.otherCharges,
  purchaseOrderId: r.purchaseOrderId,
  goodsReceiptId: r.goodsReceiptId,
  status: r.status,
  notes: r.notes,
  cancelledAt: r.cancelledAt,
  createdAt: r.createdAt,
});

const toPurchaseSummary = (r: PurchaseRow): PurchaseSummary => ({
  id: r.id,
  billNumber: r.billNumber,
  date: r.date,
  supplierId: r.supplierId,
  supplierName: r.supplier.name,
  supplierGstin: r.supplier.gstin,
  taxable: r.totals.taxable,
  cgst: r.totals.cgst,
  sgst: r.totals.sgst,
  igst: r.totals.igst,
  total: r.total,
  paid: r.paid,
  amountPaid: r.amountPaid,
  returnedAmount: r.returnedAmount,
  balance: purchaseBalance(r),
  dueDate: r.dueDate,
  status: r.status,
  createdAt: r.createdAt,
});

const withoutLines = ({ lines: _lines, ...rest }: InvoiceTotals): Omit<InvoiceTotals, "lines"> => rest;

/** Builds a StockRow from a catalog item and its (optional) stock row. Untracked items are always "ok". */
export function buildStockRow(
  item: CatalogItem,
  stock: (Pick<StockItemRow, "qty" | "reorderLevel" | "track" | "avgCost"> & { updatedAt: Date | null }) | null,
): StockRow {
  const qtyMilli = toMilli(stock?.qty ?? 0);
  const reorderMilli = toMilli(stock?.reorderLevel ?? 0);
  const track = stock?.track ?? true;
  const avgCost = stock?.avgCost ?? null;
  return {
    itemId: item.id,
    name: item.name,
    unit: item.unit,
    hsn: item.hsn,
    qty: fromMilli(qtyMilli),
    reorderLevel: fromMilli(reorderMilli),
    track,
    avgCost,
    value: track ? stockValue(qtyMilli, avgCost) : 0,
    status: track ? stockStatus(qtyMilli, reorderMilli) : "ok",
    updatedAt: stock?.updatedAt ?? null,
  };
}

/**
 * StockRow (exact legacy shape and math) plus reserved/available, from an item's rows at one location or at
 * every location (summed). `track` is the item-level switch (false if any location has it off).
 */
export function buildStockLevelRow(
  item: CatalogItem,
  rows: readonly StockLevelInput[],
  opts: { locationId: string | null; track?: boolean },
): StockLevelRow {
  const agg = aggregateStock(rows);
  const track = opts.track ?? agg?.track ?? true;
  const base = buildStockRow(
    item,
    agg
      ? {
          qty: milliToDecimal(agg.qtyMilli),
          reorderLevel: milliToDecimal(agg.reorderMilli),
          track,
          avgCost: agg.avgCost,
          updatedAt: agg.updatedAt,
        }
      : track
        ? null
        : { qty: "0", reorderLevel: "0", track, avgCost: null, updatedAt: null },
  );
  return {
    ...base,
    reserved: fromMilli(agg?.reservedMilli ?? 0),
    available: fromMilli(agg?.availableMilli ?? 0),
    locationId: opts.locationId,
  };
}

const toLocation = (r: StockLocationRow): StockLocation => ({
  id: r.id,
  name: r.name,
  code: r.code,
  type: r.type,
  address: r.address,
  isDefault: r.isDefault,
  active: r.active,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

export const toTransfer = (r: StockTransferRow): StockTransfer => ({
  id: r.id,
  number: r.number,
  status: r.status,
  fromLocationId: r.fromLocationId,
  toLocationId: r.toLocationId,
  lines: r.lines,
  note: r.note,
  transport: r.transport,
  receiveNote: r.receiveNote,
  createdBy: r.createdBy,
  createdAt: r.createdAt,
  sentAt: r.sentAt,
  receivedAt: r.receivedAt,
  closedAt: r.closedAt,
  cancelledAt: r.cancelledAt,
  cancelReason: r.cancelReason,
});

const toReservationLine = (r: Pick<StockReservationRow, "itemId" | "locationId" | "qty" | "status">): ReservationLine => ({
  itemId: r.itemId,
  locationId: r.locationId,
  qty: fromMilli(toMilli(r.qty)),
  status: r.status,
});

/** Postgres unique violation. */
const isUniqueViolation = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
};

/** Totals over tracked rows. */
export function stockTotals(rows: readonly StockRow[]): StockTotals {
  let stockValue = 0;
  let lowCount = 0;
  let outCount = 0;
  for (const r of rows) {
    if (!r.track) continue;
    stockValue += r.value;
    if (r.status === "low") lowCount++;
    if (r.status === "out") outCount++;
  }
  return { stockValue, lowCount, outCount };
}

/** Sums purchase tax breakups by rate. */
export function mergeTaxBreakup(list: readonly (readonly TaxBreakupRow[])[]): TaxBreakupRow[] {
  const byRate = new Map<GstRate, TaxBreakupRow>();
  for (const rows of list) {
    for (const r of rows) {
      const cur = byRate.get(r.gstRate) ?? { gstRate: r.gstRate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
      cur.taxable += r.taxable;
      cur.cgst += r.cgst;
      cur.sgst += r.sgst;
      cur.igst += r.igst;
      byRate.set(r.gstRate, cur);
    }
  }
  return [...byRate.values()].sort((a, b) => a.gstRate - b.gstRate);
}

/**
 * Adds `deltaMilli` to an item's stock at a location (and optionally `reservedDeltaMilli` to its reserved qty,
 * never below 0), creating the row if needed. The upsert takes the row lock, so concurrent changes to the same
 * row serialise until the transaction ends. Returns the new qty. The service always passes a location.
 */
export function upsertStockStatement(
  db: DbOrTx,
  args: { tenantId: string; locationId?: string | null; itemId: string; deltaMilli: number; reservedDeltaMilli?: number },
) {
  const delta = milliToDecimal(args.deltaMilli);
  const col = (name: string) => sql`${sql.identifier("stock_items")}.${sql.identifier(name)}`;
  const rd = args.reservedDeltaMilli ?? 0;
  const reservedDelta = milliToDecimal(rd);
  return db
    .insert(stockItems)
    .values({
      tenantId: args.tenantId,
      locationId: args.locationId ?? null,
      itemId: args.itemId,
      qty: delta,
      ...(rd > 0 ? { reserved: reservedDelta } : {}),
    })
    .onConflictDoUpdate({
      target: [stockItems.tenantId, stockItems.locationId, stockItems.itemId],
      set: {
        qty: sql`${col("qty")} + ${delta}::numeric`,
        ...(rd !== 0 ? { reserved: sql`greatest(${col("reserved")} + ${reservedDelta}::numeric, 0)` } : {}),
        updatedAt: sql`now()`,
      },
    })
    .returning({
      id: stockItems.id,
      qty: stockItems.qty,
      avgCost: stockItems.avgCost,
      track: stockItems.track,
      reserved: stockItems.reserved,
      reorderLevel: stockItems.reorderLevel,
    });
}

interface StockChange {
  tenantId: string;
  locationId: string;
  itemId: string;
  deltaMilli: number;
  /** Also changes the reserved qty (commit of a reservation). */
  reservedDeltaMilli?: number;
  reason: MovementReason;
  refType?: RefType | null;
  refId?: string | null;
  refNumber?: string | null;
  /** Paise per unit of incoming stock; updates the moving-average cost when delta > 0. */
  unitCost?: number | null;
  note?: string | null;
  createdBy?: string | null;
  /** The batch ledger is handled by the caller (reversals, transfers, explicit batch adjustments). */
  skipBatch?: boolean;
  /** Batches to take from first when stock goes out (the cashier's choice). */
  batchPreferred?: readonly { batchId: string; milli: number }[];
  /** Returned goods: the sale they came from (stored on the batch ledger). */
  batchSourceRefId?: string | null;
}

/** Transaction-scoped advisory lock so two applySale/reverseSale (or reserve/release/commit) calls for one ref can't interleave. */
const lockRef = (tx: DbOrTx, tenantId: string, refType: RefType, refId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`inventory:${tenantId}:${refType}:${refId}`}))`);

// ------------------------------------------------------------------ service

export class InventoryService {
  private readonly db: Db;
  private readonly catalog: ItemCatalogPort;
  private readonly sellerState: SellerStatePort;
  private readonly log: LoggerPort;
  private readonly now: () => Date;
  private readonly events: EventsPort | null;
  /** Tenants whose legacy (null-location) rows were moved to the default location by this process. */
  private readonly healed = new Set<string>();
  /** Supplier payments, purchase orders / goods receipts and debit notes. */
  readonly purchasing: PurchasingService;
  /** Batches and expiry (batch levels under the stock totals). */
  readonly batches: BatchService;
  /** Physical stock audits (stock counts). */
  readonly audits: AuditService;
  /** Transfers with the in-transit step. */
  readonly transfers: TransferService;

  constructor(deps: InventoryDeps) {
    this.purchasing = new PurchasingService(this, deps);
    this.batches = new BatchService(this, deps);
    this.audits = new AuditService(this, deps);
    this.transfers = new TransferService(this, deps);
    this.db = deps.db;
    this.catalog = deps.catalog;
    this.sellerState = deps.sellerState;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
    this.events = deps.events ?? null;
  }

  today() {
    return todayIST(this.now());
  }

  // ================================================================ locations (self-healing default)

  /**
   * The tenant's default location, created lazily ("Main", code MAIN). The first call per process and tenant also
   * moves legacy rows without a location (stock_items, stock_movements) to it, so a tenant heals on first use.
   * Call it outside transactions.
   */
  async ensureDefaultLocation(tenantId: string): Promise<StockLocation> {
    return toLocation(await this.defaultLocationRow(tenantId));
  }

  /** @internal */
  async defaultLocationRow(tenantId: string): Promise<StockLocationRow> {
    const find = async () =>
      (
        await this.db
          .select()
          .from(stockLocations)
          .where(and(eq(stockLocations.tenantId, tenantId), eq(stockLocations.isDefault, true)))
          .limit(1)
      )[0] ?? null;
    let row = await find();
    if (!row) {
      // Conflicts (a concurrent first call, or a MAIN code without a default) are ignored; re-read below.
      await this.db
        .insert(stockLocations)
        .values({ tenantId, name: DEFAULT_LOCATION_NAME, code: DEFAULT_LOCATION_CODE, type: "store", isDefault: true, active: true })
        .onConflictDoNothing();
      row = await find();
      if (!row) {
        await this.db
          .insert(stockLocations)
          .values({
            tenantId,
            name: DEFAULT_LOCATION_NAME,
            code: `${DEFAULT_LOCATION_CODE}-${Date.now() % 100000}`,
            type: "store",
            isDefault: true,
            active: true,
          })
          .onConflictDoNothing();
        row = await find();
      }
      if (!row) throw conflict("Could not create the default stock location; try again");
      this.log.info({ tenantId, locationId: row.id }, "inventory: default location created");
    }
    if (!this.healed.has(tenantId)) {
      await this.healTenant(tenantId, row.id);
      this.healed.add(tenantId);
    }
    return row;
  }

  /** Moves this tenant's rows without a location to `defaultId`. Rows that would collide are left (and counted). */
  private async healTenant(tenantId: string, defaultId: string): Promise<Omit<BackfillResult, "tenants">> {
    const items = await this.db
      .update(stockItems)
      .set({ locationId: defaultId })
      .where(
        and(
          eq(stockItems.tenantId, tenantId),
          isNull(stockItems.locationId),
          sql`not exists (select 1 from ${stockItems} s2 where s2.tenant_id = ${tenantId} and s2.location_id = ${defaultId} and s2.item_id = ${stockItems.itemId})`,
        ),
      )
      .returning({ id: stockItems.id });
    const moves = await this.db
      .update(stockMovements)
      .set({ locationId: defaultId })
      .where(and(eq(stockMovements.tenantId, tenantId), isNull(stockMovements.locationId)))
      .returning({ id: stockMovements.id });
    const [left] = await this.db
      .select({ n: count() })
      .from(stockItems)
      .where(and(eq(stockItems.tenantId, tenantId), isNull(stockItems.locationId)));
    const skipped = left?.n ?? 0;
    if (items.length > 0 || moves.length > 0) {
      this.log.info({ tenantId, stockItems: items.length, movements: moves.length }, "inventory: legacy rows moved to default location");
    }
    if (skipped > 0) this.log.warn({ tenantId, skipped }, "inventory: legacy stock rows collide with default-location rows; left as is");
    return { stockItems: items.length, movements: moves.length, skipped };
  }

  /**
   * One-off data migration: gives every tenant with legacy rows (null location) a default location and moves the
   * rows to it. Safe to run repeatedly and while serving traffic.
   */
  async backfillLocations(): Promise<BackfillResult> {
    const rows = await this.db.execute<{ tenant_id: string }>(
      sql`select distinct tenant_id from ${stockItems} where location_id is null
          union select distinct tenant_id from ${stockMovements} where location_id is null`,
    );
    const tenants = [...rows].map((r) => r.tenant_id);
    const out: BackfillResult = { tenants: tenants.length, stockItems: 0, movements: 0, skipped: 0 };
    for (const tenantId of tenants) {
      // Heal explicitly below so the moved rows are counted (defaultLocationRow would otherwise heal first, uncounted).
      const wasHealed = this.healed.has(tenantId);
      this.healed.add(tenantId);
      let def: StockLocationRow;
      try {
        def = await this.defaultLocationRow(tenantId);
      } catch (err) {
        if (!wasHealed) this.healed.delete(tenantId);
        throw err;
      }
      const r = await this.healTenant(tenantId, def.id);
      out.stockItems += r.stockItems;
      out.movements += r.movements;
      out.skipped += r.skipped;
    }
    return out;
  }

  /** @internal */
  locationRowPublic(db: DbOrTx, tenantId: string, id: string): Promise<StockLocationRow | null> {
    return this.locationRow(db, tenantId, id);
  }

  private async locationRow(db: DbOrTx, tenantId: string, id: string): Promise<StockLocationRow | null> {
    const [row] = await db
      .select()
      .from(stockLocations)
      .where(and(eq(stockLocations.tenantId, tenantId), eq(stockLocations.id, id)))
      .limit(1);
    return row ?? null;
  }

  /** The given location (404 if unknown; 400 if inactive and `active` is required) or the default one. Heals the tenant. */
  /** @internal */
  async resolveLocation(tenantId: string, locationId: string | null | undefined, opts: { active?: boolean } = {}) {
    const def = locationId && this.healed.has(tenantId) ? null : await this.defaultLocationRow(tenantId);
    if (!locationId) return def!;
    const loc = def && def.id === locationId ? def : await this.locationRow(this.db, tenantId, locationId);
    if (!loc) throw notFound("Location");
    if (opts.active && !loc.active) throw badRequest("This location is inactive");
    return loc;
  }

  async listLocations(tenantId: string, query: LocationListQuery = {}): Promise<ListResult<StockLocation>> {
    const { includeInactive } = locationListQuerySchema.parse(query);
    await this.defaultLocationRow(tenantId);
    const rows = await this.db
      .select()
      .from(stockLocations)
      .where(and(eq(stockLocations.tenantId, tenantId), includeInactive ? undefined : eq(stockLocations.active, true)))
      .orderBy(desc(stockLocations.isDefault), asc(stockLocations.name), asc(stockLocations.id));
    return { items: rows.map(toLocation), total: rows.length };
  }

  async getLocation(tenantId: string, id: string): Promise<StockLocation> {
    await this.defaultLocationRow(tenantId);
    const row = await this.locationRow(this.db, tenantId, id);
    if (!row) throw notFound("Location");
    return toLocation(row);
  }

  private async freeCode(tenantId: string, base: string): Promise<string> {
    const taken = new Set(
      (
        await this.db
          .select({ code: stockLocations.code })
          .from(stockLocations)
          .where(and(eq(stockLocations.tenantId, tenantId), ilike(stockLocations.code, `${base}%`)))
      ).map((r) => r.code),
    );
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
  }

  async createLocation(tenantId: string, input: LocationInput): Promise<StockLocation> {
    const b = locationInputSchema.parse(input);
    if (b.isDefault && b.active === false) throw badRequest("An inactive location can't be the default");
    await this.defaultLocationRow(tenantId);
    const code = b.code ?? (await this.freeCode(tenantId, locationCodeFrom(b.name)));
    try {
      const row = await this.db.transaction(async (tx) => {
        if (b.isDefault) {
          await tx
            .update(stockLocations)
            .set({ isDefault: false })
            .where(and(eq(stockLocations.tenantId, tenantId), eq(stockLocations.isDefault, true)));
        }
        const [created] = await tx
          .insert(stockLocations)
          .values({
            tenantId,
            name: b.name,
            code,
            type: b.type,
            address: b.address ?? null,
            isDefault: b.isDefault ?? false,
            active: b.active ?? true,
          })
          .returning();
        return created!;
      });
      return toLocation(row);
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict(`A location with code ${code} already exists`);
      throw e;
    }
  }

  /** Can't deactivate or un-default the default location; making another location the default moves the flag. */
  async updateLocation(tenantId: string, id: string, input: LocationPatch): Promise<StockLocation> {
    const b = locationPatchSchema.parse(input);
    await this.defaultLocationRow(tenantId);
    try {
      const row = await this.db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(stockLocations)
          .where(and(eq(stockLocations.tenantId, tenantId), eq(stockLocations.id, id)))
          .limit(1)
          .for("update");
        if (!current) throw notFound("Location");
        const problem = locationPatchProblem(current, b);
        if (problem) throw badRequest(problem);
        const set: Partial<StockLocationRow> = {};
        if (b.name !== undefined) set.name = b.name;
        if (b.code !== undefined) set.code = b.code;
        if (b.type !== undefined) set.type = b.type;
        if (b.address !== undefined) set.address = b.address;
        if (b.active !== undefined) set.active = b.active;
        if (b.isDefault === true && !current.isDefault) {
          await tx
            .update(stockLocations)
            .set({ isDefault: false })
            .where(and(eq(stockLocations.tenantId, tenantId), eq(stockLocations.isDefault, true)));
          set.isDefault = true;
        }
        if (Object.keys(set).length === 0) return current;
        const [updated] = await tx
          .update(stockLocations)
          .set(set)
          .where(and(eq(stockLocations.tenantId, tenantId), eq(stockLocations.id, id)))
          .returning();
        return updated!;
      });
      return toLocation(row);
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict(`A location with code ${b.code ?? ""} already exists`);
      throw e;
    }
  }

  /** Only empty locations without history can be deleted (deactivate the others). */
  async deleteLocation(tenantId: string, id: string): Promise<void> {
    await this.defaultLocationRow(tenantId);
    await this.db.transaction(async (tx) => {
      const [loc] = await tx
        .select()
        .from(stockLocations)
        .where(and(eq(stockLocations.tenantId, tenantId), eq(stockLocations.id, id)))
        .limit(1)
        .for("update");
      if (!loc) throw notFound("Location");
      const atLoc = <T extends typeof stockItems | typeof stockMovements | typeof stockReservations>(t: T) =>
        and(eq(t.tenantId, tenantId), eq(t.locationId, id));
      const [[stock], [res], [moves]] = await Promise.all([
        tx
          .select({ n: count() })
          .from(stockItems)
          .where(and(atLoc(stockItems), or(ne(stockItems.qty, "0"), ne(stockItems.reserved, "0")))),
        tx
          .select({ n: count() })
          .from(stockReservations)
          .where(and(atLoc(stockReservations), eq(stockReservations.status, "active"))),
        tx.select({ n: count() }).from(stockMovements).where(atLoc(stockMovements)),
      ]);
      const problem = locationDeleteProblem({
        isDefault: loc.isDefault,
        stockRows: stock?.n ?? 0,
        activeReservations: res?.n ?? 0,
        movements: moves?.n ?? 0,
      });
      if (problem) throw new AppError(problem.status, problem.status === 409 ? "conflict" : "bad_request", problem.message);
      await tx.delete(stockItems).where(atLoc(stockItems));
      await tx.delete(stockLocations).where(and(eq(stockLocations.tenantId, tenantId), eq(stockLocations.id, id)));
    });
  }

  // ================================================================ stock primitives

  /** Applies one stock change inside `tx`: upsert qty (and reserved), update average cost, append a movement. */
  /** @internal used by PurchasingService */
  async change(tx: DbOrTx, c: StockChange, drops?: StockDrop[]): Promise<{ qtyMilli: number; avgCost: number | null; batches: TakeResult }> {
    const [row] = await upsertStockStatement(tx, {
      tenantId: c.tenantId,
      locationId: c.locationId,
      itemId: c.itemId,
      deltaMilli: c.deltaMilli,
      reservedDeltaMilli: c.reservedDeltaMilli,
    });
    const qtyMilli = toMilli(row!.qty);
    if (drops && c.deltaMilli < 0) {
      drops.push({
        locationId: c.locationId,
        itemId: c.itemId,
        beforeMilli: qtyMilli - c.deltaMilli,
        afterMilli: qtyMilli,
        reorderMilli: toMilli(row!.reorderLevel),
      });
    }
    let avgCost = row!.avgCost;
    const unitCost = c.unitCost ?? null;
    if (unitCost !== null && c.deltaMilli > 0) {
      const next = movingAverageCost(qtyMilli - c.deltaMilli, avgCost, c.deltaMilli, unitCost);
      if (next !== avgCost) {
        avgCost = next;
        await tx
          .update(stockItems)
          .set({ avgCost })
          .where(and(eq(stockItems.tenantId, c.tenantId), eq(stockItems.id, row!.id)));
      }
    }
    await tx.insert(stockMovements).values({
      tenantId: c.tenantId,
      locationId: c.locationId,
      itemId: c.itemId,
      delta: milliToDecimal(c.deltaMilli),
      qtyAfter: milliToDecimal(qtyMilli),
      reason: c.reason,
      refType: c.refType ?? null,
      refId: c.refId ?? null,
      refNumber: c.refNumber ?? null,
      unitCost,
      note: c.note ?? null,
      createdBy: c.createdBy ?? null,
      createdAt: this.now(),
    });
    // Stock going out of an item that has batches comes out of them (chosen batch, then first-expiry-first-out).
    const batches: TakeResult =
      c.deltaMilli < 0 && !c.skipBatch
        ? await this.batches.takeOut(tx, {
            tenantId: c.tenantId,
            itemId: c.itemId,
            locationId: c.locationId,
            milli: -c.deltaMilli,
            reason: batchReasonFor(c.reason),
            preferred: c.batchPreferred,
            refType: c.refType ?? null,
            refId: c.refId ?? null,
            refNumber: c.refNumber ?? null,
            note: c.note ?? null,
            userId: c.createdBy ?? null,
          })
        : { allocations: [], shortMilli: Math.max(0, -c.deltaMilli) };
    return { qtyMilli, avgCost, batches };
  }

  /** @internal item details for the batch, audit and transfer services. */
  async catalogItems(tenantId: string, ids: string[]): Promise<CatalogItem[]> {
    return this.catalog.getItems(tenantId, ids);
  }

  /** @internal items whose name or HSN matches `q`. */
  async catalogSearch(tenantId: string, q: string): Promise<CatalogItem[]> {
    return this.catalog.listItems(tenantId, q || undefined);
  }

  /** @internal */
  dropSinkPublic(): StockDrop[] | undefined {
    return this.dropSink();
  }

  /** @internal */
  async emitLowStockPublic(tenantId: string, drops: StockDrop[] | undefined): Promise<void> {
    return this.emitLowStock(tenantId, drops);
  }

  /** @internal */
  eventsPort(): EventsPort | null {
    return this.events;
  }

  /** A collector for `change()` when events are wired (else undefined: no extra work). */
  private dropSink(): StockDrop[] | undefined {
    return this.events ? [] : undefined;
  }

  /**
   * After the stock write committed: `stock.low` per tracked item that got low or ran out at a location. Never
   * throws (errors are logged).
   */
  private async emitLowStock(tenantId: string, drops: StockDrop[] | undefined): Promise<void> {
    const events = this.events;
    if (!events || !drops || drops.length === 0) return;
    try {
      const ids = [...new Set(drops.map((d) => d.itemId))];
      const low = lowStockEvents(drops, await this.untrackedOf(this.db, tenantId, ids));
      if (low.length === 0) return;
      const names = new Map<string, string>();
      try {
        for (const i of await this.catalog.getItems(tenantId, [...new Set(low.map((e) => e.itemId))])) names.set(i.id, i.name);
      } catch (err) {
        this.log.warn({ err, tenantId }, "inventory: item names unavailable for stock.low");
      }
      for (const e of low) {
        try {
          await events.emit(tenantId, "stock.low", {
            itemId: e.itemId,
            name: names.get(e.itemId) ?? "",
            locationId: e.locationId,
            qty: e.qty,
            reorderLevel: e.reorderLevel,
            status: e.status,
          });
        } catch (err) {
          this.log.warn({ err, tenantId, itemId: e.itemId }, "inventory: stock.low emit failed");
        }
      }
    } catch (err) {
      this.log.warn({ err, tenantId }, "inventory: stock.low check failed");
    }
  }

  /** All rows of one item (every location). */
  private async itemRows(db: DbOrTx, tenantId: string, itemId: string) {
    return db
      .select()
      .from(stockItems)
      .where(and(eq(stockItems.tenantId, tenantId), eq(stockItems.itemId, itemId)));
  }

  /** Item ids (of `itemIds`) that are untracked at any location. */
  /** @internal */
  async untrackedOf(db: DbOrTx, tenantId: string, itemIds: string[]): Promise<Set<string>> {
    if (itemIds.length === 0) return new Set();
    const rows = await db
      .select({ itemId: stockItems.itemId })
      .from(stockItems)
      .where(and(eq(stockItems.tenantId, tenantId), inArray(stockItems.itemId, itemIds), eq(stockItems.track, false)));
    return new Set(rows.map((r) => r.itemId));
  }

  /** Creates missing rows (qty 0) for these items at these locations, then locks them in item, location order. */
  /** @internal */
  lockRowsPublic(tx: DbOrTx, tenantId: string, locationIds: string[], itemIds: string[]) {
    return this.lockRows(tx, tenantId, locationIds, itemIds);
  }

  private async lockRows(tx: DbOrTx, tenantId: string, locationIds: string[], itemIds: string[]) {
    if (itemIds.length === 0) return [];
    await tx
      .insert(stockItems)
      .values(locationIds.flatMap((locationId) => itemIds.map((itemId) => ({ tenantId, locationId, itemId }))))
      .onConflictDoNothing({ target: [stockItems.tenantId, stockItems.locationId, stockItems.itemId] });
    return tx
      .select()
      .from(stockItems)
      .where(and(eq(stockItems.tenantId, tenantId), inArray(stockItems.locationId, locationIds), inArray(stockItems.itemId, itemIds)))
      .orderBy(asc(stockItems.itemId), asc(stockItems.locationId))
      .for("update");
  }

  private levelRow(item: CatalogItem, all: readonly StockItemRow[], locationId: string | null): StockLevelRow {
    const rows = locationId ? all.filter((r) => r.locationId === locationId) : all;
    return buildStockLevelRow(item, rows, { locationId, track: isItemTracked(all) });
  }

  /** @internal */
  async catalogItem(tenantId: string, itemId: string): Promise<CatalogItem> {
    const [item] = await this.catalog.getItems(tenantId, [itemId]);
    if (!item || item.id !== itemId) throw notFound("Item");
    return item;
  }

  // ================================================================ stock reads

  /** Every saved item with its stock at `locationId`, or summed over all locations. */
  private async allRows(tenantId: string, q?: string, locationId?: string | null): Promise<StockLevelRow[]> {
    const [items, stock] = await Promise.all([
      this.catalog.listItems(tenantId, q || undefined),
      this.db.select().from(stockItems).where(eq(stockItems.tenantId, tenantId)),
    ]);
    const byItem = new Map<string, StockItemRow[]>();
    for (const s of stock) {
      const list = byItem.get(s.itemId);
      if (list) list.push(s);
      else byItem.set(s.itemId, [s]);
    }
    return items
      .map((i): StockLevelRow => {
        const row = this.levelRow(i, byItem.get(i.id) ?? [], locationId ?? null);
        return i.categoryId !== undefined ? { ...row, categoryId: i.categoryId ?? null, categoryName: i.categoryName ?? null } : row;
      })
      .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.itemId.localeCompare(b.itemId));
  }

  /**
   * Every saved item with its stock, paged, sorted (name / qty / value / reorderLevel; default name) and filtered by
   * search, `status` (in/low/out/untracked; `filter` is the older single form), category and location. Totals cover
   * the tracked items matching `q`; `facets` count status and category under the other filters. Items come from the
   * catalogue (not SQL), so this pages in memory.
   */
  async listStock(tenantId: string, query: StockQuery = {}): Promise<StockList> {
    const p = stockQuerySchema.parse(query);
    const sort = parseStockSort(p.sort);
    const loc = p.locationId ? await this.resolveLocation(tenantId, p.locationId) : null;
    const all = await this.allRows(tenantId, p.q, loc?.id);
    const statuses = p.status ?? (p.filter === "all" ? undefined : [p.filter === "untracked" ? "untracked" : p.filter]);
    const byStatus = (r: StockLevelRow) => !statuses?.length || statuses.includes(stockListStatus(r));
    const byCategory = (r: StockLevelRow) => !p.category?.length || p.category.includes(r.categoryId ?? NO_CATEGORY);
    const filtered = all.filter((r) => byStatus(r) && byCategory(r));
    const status: Record<string, number> = {};
    for (const r of all) if (byCategory(r)) status[stockListStatus(r)] = (status[stockListStatus(r)] ?? 0) + 1;
    const category: Record<string, number> = {};
    const categoryNames = new Map<string, string>();
    for (const r of all) {
      if (!byStatus(r)) continue;
      const id = r.categoryId ?? NO_CATEGORY;
      category[id] = (category[id] ?? 0) + 1;
      if (r.categoryId && r.categoryName) categoryNames.set(r.categoryId, r.categoryName);
    }
    const items = sortStockRows(filtered, sort).slice(p.offset, p.offset + p.limit);
    return {
      items,
      total: filtered.length,
      limit: p.limit,
      offset: p.offset,
      totals: stockTotals(all),
      facets: { status, category },
      categories: [...categoryNames].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  /** One item's stock at `locationId`, or summed over all locations. */
  async getStock(tenantId: string, itemId: string, query: LocationQuery = {}): Promise<StockLevelRow> {
    const p = locationQuerySchema.parse(query);
    const loc = p.locationId ? await this.resolveLocation(tenantId, p.locationId) : null;
    const [item, rows] = await Promise.all([this.catalogItem(tenantId, itemId), this.itemRows(this.db, tenantId, itemId)]);
    return this.levelRow(item, rows, loc?.id ?? null);
  }

  async summary(tenantId: string, query: LocationQuery = {}): Promise<StockSummary> {
    const p = locationQuerySchema.parse(query);
    const loc = p.locationId ? await this.resolveLocation(tenantId, p.locationId) : null;
    const all = await this.allRows(tenantId, undefined, loc?.id);
    const rank = (s: StockStatus) => (s === "out" ? 0 : 1);
    const lowItems = all
      .filter((r) => r.track && r.status !== "ok")
      .sort((a, b) => rank(a.status) - rank(b.status) || a.qty - b.qty || a.name.localeCompare(b.name))
      .slice(0, 5);
    return { ...stockTotals(all), lowItems };
  }

  async movements(tenantId: string, itemId: string, query: MovementsQuery = {}): Promise<ListResult<Movement>> {
    const { limit, offset, locationId } = movementsQuerySchema.parse(query);
    const loc = locationId ? await this.resolveLocation(tenantId, locationId) : null;
    const where = and(
      eq(stockMovements.tenantId, tenantId),
      eq(stockMovements.itemId, itemId),
      loc ? eq(stockMovements.locationId, loc.id) : undefined,
    );
    const [rows, [counted]] = await Promise.all([
      this.db
        .select()
        .from(stockMovements)
        .where(where)
        .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
        .limit(limit)
        .offset(offset),
      this.db.select({ total: count() }).from(stockMovements).where(where),
    ]);
    return {
      items: rows.map((m) => ({
        id: m.id,
        date: m.createdAt,
        reason: m.reason,
        delta: fromMilli(toMilli(m.delta)),
        qtyAfter: fromMilli(toMilli(m.qtyAfter)),
        refType: m.refType,
        refId: m.refId,
        refNumber: m.refNumber,
        note: m.note,
        createdBy: m.createdBy,
        locationId: m.locationId,
      })),
      total: counted?.total ?? 0,
    };
  }

  /** Staff view: available (qty − reserved) per item at `locationId`, or summed over all locations. */
  async availability(tenantId: string, query: AvailabilityQuery): Promise<ListResult<ItemAvailability>> {
    const levels = await this.levels(tenantId, query);
    const items = levels.map((l) => ({ itemId: l.itemId, available: fromMilli(l.availableMilli), tracked: l.track }));
    return { items, total: items.length };
  }

  /** Storefront view: booleans only (`lowStock` = available ≤ reorder level). */
  async publicAvailability(tenantId: string, query: AvailabilityQuery): Promise<ListResult<PublicItemAvailability>> {
    const levels = await this.levels(tenantId, query);
    const items = levels.map((l) => ({ itemId: l.itemId, ...publicStockFlags(l) }));
    return { items, total: items.length };
  }

  private async levels(tenantId: string, query: AvailabilityQuery) {
    const p = availabilityQuerySchema.parse(query);
    const loc = p.locationId ? await this.resolveLocation(tenantId, p.locationId) : null;
    const rows = await this.db
      .select()
      .from(stockItems)
      .where(and(eq(stockItems.tenantId, tenantId), inArray(stockItems.itemId, p.itemIds)));
    return p.itemIds.map((itemId) => {
      const all = rows.filter((r) => r.itemId === itemId);
      const agg = aggregateStock(loc ? all.filter((r) => r.locationId === loc.id) : all);
      return {
        itemId,
        availableMilli: agg?.availableMilli ?? 0,
        reorderMilli: agg?.reorderMilli ?? 0,
        track: isItemTracked(all),
      };
    });
  }

  // ================================================================ stock writes

  /** `track` applies to the item at every location; `reorderLevel` to the given (default) location. */
  async updateStock(tenantId: string, itemId: string, input: StockPatch): Promise<StockLevelRow> {
    const b = stockPatchSchema.parse(input);
    const item = await this.catalogItem(tenantId, itemId);
    const loc = await this.resolveLocation(tenantId, b.locationId);
    const set: { track?: boolean; reorderLevel?: string } = {};
    if (b.track !== undefined) set.track = b.track;
    if (b.reorderLevel !== undefined) set.reorderLevel = milliToDecimal(toMilli(b.reorderLevel));
    if (Object.keys(set).length > 0) {
      await this.db.transaction(async (tx) => {
        if (b.track !== undefined) {
          await tx
            .update(stockItems)
            .set({ track: b.track })
            .where(and(eq(stockItems.tenantId, tenantId), eq(stockItems.itemId, itemId)));
        }
        await tx
          .insert(stockItems)
          .values({ tenantId, locationId: loc.id, itemId, ...set })
          .onConflictDoUpdate({
            target: [stockItems.tenantId, stockItems.locationId, stockItems.itemId],
            set: { ...set, updatedAt: sql`now()` },
          });
      });
    }
    return this.levelRow(item, await this.itemRows(this.db, tenantId, itemId), loc.id);
  }

  /** Manual stock change at a location. The first movement there is recorded as `opening`, later ones as `adjustment`. */
  async adjust(tenantId: string, itemId: string, input: AdjustInput, userId: string | null = null): Promise<StockLevelRow> {
    const b = adjustInputSchema.parse(input);
    const item = await this.catalogItem(tenantId, itemId);
    const loc = await this.resolveLocation(tenantId, b.locationId, { active: true });
    const qtyMilli = toMilli(b.qty);
    const unitCost = b.unitCost ?? null;
    const drops = this.dropSink();
    await this.db.transaction(async (tx) => {
      // Make sure the row exists, then lock it to read the current qty (needed for "set").
      const [current] = await this.lockRows(tx, tenantId, [loc.id], [itemId]);
      const delta = adjustmentDelta(b.mode, qtyMilli, toMilli(current?.qty ?? 0));
      if (delta === 0) {
        // Nothing moves; "set" with a cost just records the cost.
        if (unitCost !== null && current) {
          await tx
            .update(stockItems)
            .set({ avgCost: unitCost })
            .where(and(eq(stockItems.tenantId, tenantId), eq(stockItems.id, current.id)));
        }
        return;
      }
      const [prior] = await tx
        .select({ id: stockMovements.id })
        .from(stockMovements)
        .where(and(eq(stockMovements.tenantId, tenantId), eq(stockMovements.itemId, itemId), eq(stockMovements.locationId, loc.id)))
        .limit(1);
      const reason = prior ? "adjustment" : "opening";
      // A named batch: removing takes from it (it must have that much), adding puts into it.
      const batchId = b.batchId ?? null;
      if (batchId && delta < 0) {
        await this.batches.takeFrom(tx, tenantId, batchId, loc.id, -delta, "adjustment", { note: b.note ?? null, userId });
      }
      await this.change(tx, {
        tenantId,
        locationId: loc.id,
        itemId,
        deltaMilli: delta,
        reason,
        unitCost: delta > 0 ? unitCost : null,
        note: b.note ?? null,
        createdBy: userId,
        skipBatch: batchId !== null,
      }, drops);
      if (delta > 0 && (b.batch || batchId)) {
        const known = batchId ? await this.batches.batchRow(tx, tenantId, batchId) : null;
        await this.batches.receiveInto(tx, {
          tenantId,
          itemId,
          locationId: loc.id,
          milli: delta,
          batch: b.batch ?? { batchNo: known!.batchNo },
          reason: reason === "opening" ? "opening" : "adjustment",
          unitCost,
          note: b.note ?? null,
          userId,
        });
      }
    });
    await this.emitLowStock(tenantId, drops);
    return this.levelRow(item, await this.itemRows(this.db, tenantId, itemId), loc.id);
  }

  /**
   * Reduces stock for an issued invoice at `locationId` (default location). Idempotent per refId; lines for the
   * same item are merged and untracked items are skipped. Returns whether anything was applied.
   */
  async applySale(tenantId: string, input: SaleInput): Promise<{ applied: boolean; items: number }> {
    const b = saleInputSchema.parse(input);
    const lines = mergeQtyLines(b.lines);
    if (lines.length === 0) return { applied: false, items: 0 };
    const loc = await this.resolveLocation(tenantId, b.locationId, { active: true });
    const drops = this.dropSink();
    const result = await this.db.transaction(async (tx) => {
      await lockRef(tx, tenantId, "invoice", b.refId);
      const [existing] = await tx
        .select({ id: stockMovements.id })
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.tenantId, tenantId),
            eq(stockMovements.refType, "invoice"),
            eq(stockMovements.refId, b.refId),
            inArray(stockMovements.reason, ["sale", "sale_cancel"]),
          ),
        )
        .limit(1);
      if (existing) return { applied: false, items: 0 };

      const untracked = await this.untrackedOf(
        tx,
        tenantId,
        lines.map((l) => l.itemId),
      );
      // The batch the cashier chose for a line (summed per item and batch).
      const chosen = new Map<string, Map<string, number>>();
      for (const l of b.lines) {
        if (!l.batchId) continue;
        const m = chosen.get(l.itemId) ?? new Map<string, number>();
        m.set(l.batchId, (m.get(l.batchId) ?? 0) + toMilli(l.qty));
        chosen.set(l.itemId, m);
      }
      let items = 0;
      for (const l of lines) {
        if (untracked.has(l.itemId)) continue;
        await this.change(tx, {
          tenantId,
          locationId: loc.id,
          itemId: l.itemId,
          deltaMilli: -l.milli,
          reason: "sale",
          refType: "invoice",
          refId: b.refId,
          refNumber: b.refNumber ?? null,
          batchPreferred: [...(chosen.get(l.itemId) ?? new Map<string, number>()).entries()].map(([batchId, milli]) => ({ batchId, milli })),
        }, drops);
        items++;
      }
      this.log.info({ tenantId, refId: b.refId, items, locationId: loc.id }, "inventory: sale applied");
      return { applied: items > 0, items };
    });
    await this.emitLowStock(tenantId, drops);
    return result;
  }

  /** Puts back the stock of a cancelled invoice (where it was taken). No-op unless a sale was applied and not yet reversed. */
  async reverseSale(tenantId: string, refId: string): Promise<{ reversed: boolean; items: number }> {
    const ref = z.string().trim().min(1).max(100).parse(refId);
    const def = await this.defaultLocationRow(tenantId);
    return this.db.transaction(async (tx) => {
      await lockRef(tx, tenantId, "invoice", ref);
      const moves = await tx
        .select({
          locationId: stockMovements.locationId,
          itemId: stockMovements.itemId,
          delta: stockMovements.delta,
          reason: stockMovements.reason,
          refNumber: stockMovements.refNumber,
        })
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.tenantId, tenantId),
            eq(stockMovements.refType, "invoice"),
            eq(stockMovements.refId, ref),
            inArray(stockMovements.reason, ["sale", "sale_cancel"]),
          ),
        );
      const sales = moves.filter((m) => m.reason === "sale");
      if (sales.length === 0 || moves.some((m) => m.reason === "sale_cancel")) return { reversed: false, items: 0 };
      const net = netByLocationItem(sales, def.id);
      for (const n of net) {
        await this.change(tx, {
          tenantId,
          locationId: n.locationId,
          itemId: n.itemId,
          deltaMilli: -n.milli,
          reason: "sale_cancel",
          refType: "invoice",
          refId: ref,
          refNumber: sales[0]?.refNumber ?? null,
        });
      }
      await this.batches.reverseRef(tx, tenantId, "invoice", ref, "sale_cancel", { refNumber: sales[0]?.refNumber ?? null });
      this.log.info({ tenantId, refId: ref, items: net.length }, "inventory: sale reversed");
      return { reversed: true, items: net.length };
    });
  }

  /**
   * Puts the goods of a credit note (sales return) back in stock, at the location the bill's sale took them from
   * (`saleRefId`), else `locationId`, else the default location. Idempotent per refId (the credit note id); untracked
   * items are skipped. Movements: reason `sale_return`, ref type `credit_note`.
   */
  async applyReturn(tenantId: string, input: ReturnInput): Promise<{ applied: boolean; items: number }> {
    const b = returnInputSchema.parse(input);
    const lines = mergeQtyLines(b.lines);
    if (lines.length === 0) return { applied: false, items: 0 };
    const def = await this.defaultLocationRow(tenantId);
    const fallback = b.locationId ? (await this.resolveLocation(tenantId, b.locationId).catch(() => def)).id : def.id;
    return this.db.transaction(async (tx) => {
      await lockRef(tx, tenantId, "credit_note", b.refId);
      const [existing] = await tx
        .select({ id: stockMovements.id })
        .from(stockMovements)
        .where(and(eq(stockMovements.tenantId, tenantId), eq(stockMovements.refType, "credit_note"), eq(stockMovements.refId, b.refId)))
        .limit(1);
      if (existing) return { applied: false, items: 0 };
      const sold = await tx
        .select({ itemId: stockMovements.itemId, locationId: stockMovements.locationId })
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.tenantId, tenantId),
            eq(stockMovements.refType, "invoice"),
            eq(stockMovements.refId, b.saleRefId),
            eq(stockMovements.reason, "sale"),
          ),
        );
      const soldAt = new Map(sold.map((m) => [m.itemId, m.locationId ?? def.id]));
      const untracked = await this.untrackedOf(
        tx,
        tenantId,
        lines.map((l) => l.itemId),
      );
      let items = 0;
      for (const l of lines) {
        if (untracked.has(l.itemId)) continue;
        await this.change(tx, {
          tenantId,
          locationId: soldAt.get(l.itemId) ?? fallback,
          itemId: l.itemId,
          deltaMilli: l.milli,
          reason: "sale_return",
          refType: "credit_note",
          refId: b.refId,
          refNumber: b.refNumber ?? null,
        });
        await this.batches.returnToSource(tx, {
          tenantId,
          itemId: l.itemId,
          saleRefId: b.saleRefId,
          creditNoteId: b.refId,
          refNumber: b.refNumber ?? null,
          milli: l.milli,
          defaultLocationId: def.id,
        });
        items++;
      }
      this.log.info({ tenantId, refId: b.refId, items }, "inventory: sales return restocked");
      return { applied: items > 0, items };
    });
  }

  /** Takes a cancelled credit note's returned goods out of stock again (where they were put back). Idempotent. */
  async reverseReturn(tenantId: string, refId: string): Promise<{ reversed: boolean; items: number }> {
    const ref = z.string().trim().min(1).max(100).parse(refId);
    const def = await this.defaultLocationRow(tenantId);
    const drops = this.dropSink();
    const result = await this.db.transaction(async (tx) => {
      await lockRef(tx, tenantId, "credit_note", ref);
      const moves = await tx
        .select({
          locationId: stockMovements.locationId,
          itemId: stockMovements.itemId,
          delta: stockMovements.delta,
          reason: stockMovements.reason,
          refNumber: stockMovements.refNumber,
        })
        .from(stockMovements)
        .where(and(eq(stockMovements.tenantId, tenantId), eq(stockMovements.refType, "credit_note"), eq(stockMovements.refId, ref)));
      const returns = moves.filter((m) => m.reason === "sale_return");
      if (returns.length === 0 || moves.some((m) => m.reason === "sale_return_cancel")) return { reversed: false, items: 0 };
      const net = netByLocationItem(returns, def.id);
      for (const n of net) {
        await this.change(
          tx,
          {
            tenantId,
            locationId: n.locationId,
            itemId: n.itemId,
            deltaMilli: -n.milli,
            reason: "sale_return_cancel",
            refType: "credit_note",
            refId: ref,
            refNumber: returns[0]?.refNumber ?? null,
            skipBatch: true,
          },
          drops,
        );
      }
      await this.batches.reverseRef(tx, tenantId, "credit_note", ref, "sale_return_cancel", { refNumber: returns[0]?.refNumber ?? null });
      return { reversed: true, items: net.length };
    });
    await this.emitLowStock(tenantId, drops);
    return result;
  }

  // ================================================================ transfers

  /**
   * Moves stock between two locations at once (the old API): a transfer note that is sent and received in one step, with
   * the same movements as before. 409 when the source is short. For the in-transit flow see `transfers`.
   */
  async createTransfer(tenantId: string, input: TransferInput, userId: string | null = null): Promise<StockTransfer> {
    return this.transfers.instant(tenantId, input, userId);
  }

  async listTransfers(tenantId: string, query: TransferListQuery = {}): Promise<ListResult<StockTransfer>> {
    const { limit, offset, locationId } = transferListQuerySchema.parse(query);
    const where = and(
      eq(stockTransfers.tenantId, tenantId),
      locationId ? or(eq(stockTransfers.fromLocationId, locationId), eq(stockTransfers.toLocationId, locationId)) : undefined,
    );
    const [rows, [counted]] = await Promise.all([
      this.db
        .select()
        .from(stockTransfers)
        .where(where)
        .orderBy(desc(stockTransfers.createdAt), desc(stockTransfers.id))
        .limit(limit)
        .offset(offset),
      this.db.select({ total: count() }).from(stockTransfers).where(where),
    ]);
    return { items: rows.map(toTransfer), total: counted?.total ?? 0 };
  }

  // ================================================================ reservations

  private reservationsOf(tx: DbOrTx, tenantId: string, refType: string, refId: string) {
    return tx
      .select()
      .from(stockReservations)
      .where(and(eq(stockReservations.tenantId, tenantId), eq(stockReservations.refType, refType), eq(stockReservations.refId, refId)))
      .orderBy(asc(stockReservations.itemId), asc(stockReservations.locationId))
      .for("update");
  }

  /**
   * Holds stock for a reference (e.g. an order) at `locationId` (default location). Idempotent per ref: a ref
   * that already holds or sold stock returns its lines unchanged (`reserved: false`). All-or-nothing: 409
   * `insufficient_stock` `{ items: { itemId, available, requested }[] }` unless `allowBackorder`. Untracked items
   * are not held.
   */
  async reserve(
    tenantId: string,
    input: ReserveInput,
    opts: { allowBackorder?: boolean } = {},
  ): Promise<{ reserved: boolean; items: ReservationLine[] }> {
    const b = reserveInputSchema.parse(input);
    const allowBackorder = opts.allowBackorder ?? b.allowBackorder ?? false;
    const lines = mergeQtyLines(b.lines);
    const loc = await this.resolveLocation(tenantId, b.locationId, { active: true });
    return this.db.transaction(async (tx) => {
      await lockRef(tx, tenantId, b.refType, b.refId);
      const existing = await this.reservationsOf(tx, tenantId, b.refType, b.refId);
      if (reserveDecision(existing) === "noop") return { reserved: false, items: existing.map(toReservationLine) };
      if (lines.length === 0) return { reserved: false, items: [] };

      const ids = lines.map((l) => l.itemId);
      const untracked = await this.untrackedOf(tx, tenantId, ids);
      const tracked = ids.filter((id) => !untracked.has(id));
      const locked = await this.lockRows(tx, tenantId, [loc.id], tracked);
      const stock = new Map(locked.map((r) => [r.itemId, { qtyMilli: toMilli(r.qty), reservedMilli: toMilli(r.reserved) }]));
      const check = checkAvailability(lines, stock, untracked, { allowBackorder });
      if (!check.ok) throw insufficientStock(check.items);

      const now = this.now();
      const out: ReservationLine[] = [];
      for (const l of check.lines) {
        const qty = milliToDecimal(l.milli);
        await tx
          .update(stockItems)
          .set({ reserved: sql`${stockItems.reserved} + ${qty}::numeric`, updatedAt: sql`now()` })
          .where(and(eq(stockItems.tenantId, tenantId), eq(stockItems.locationId, loc.id), eq(stockItems.itemId, l.itemId)));
        await tx
          .insert(stockReservations)
          .values({
            tenantId,
            refType: b.refType,
            refId: b.refId,
            locationId: loc.id,
            itemId: l.itemId,
            qty,
            status: "active",
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [stockReservations.tenantId, stockReservations.refType, stockReservations.refId, stockReservations.itemId],
            set: { locationId: loc.id, qty, status: "active", releasedAt: null, committedAt: null, updatedAt: now },
          });
        out.push({ itemId: l.itemId, locationId: loc.id, qty: fromMilli(l.milli), status: "active" });
      }
      this.log.info({ tenantId, refType: b.refType, refId: b.refId, items: out.length }, "inventory: stock reserved");
      return { reserved: out.length > 0, items: out };
    });
  }

  /** Gives back the stock held for a ref. Idempotent (no active reservation = no-op). */
  async release(tenantId: string, refType: string, refId: string): Promise<{ released: boolean; items: number }> {
    const rt = refTypeSchema.parse(refType);
    const ref = refIdSchema.parse(refId);
    return this.db.transaction(async (tx) => {
      await lockRef(tx, tenantId, rt, ref);
      const active = activeReservations(await this.reservationsOf(tx, tenantId, rt, ref));
      if (active.length === 0) return { released: false, items: 0 };
      for (const r of active) {
        await tx
          .update(stockItems)
          .set({ reserved: sql`greatest(${stockItems.reserved} - ${r.qty}::numeric, 0)`, updatedAt: sql`now()` })
          .where(and(eq(stockItems.tenantId, tenantId), eq(stockItems.locationId, r.locationId), eq(stockItems.itemId, r.itemId)));
      }
      const now = this.now();
      await tx
        .update(stockReservations)
        .set({ status: "released", releasedAt: now, updatedAt: now })
        .where(
          and(
            eq(stockReservations.tenantId, tenantId),
            inArray(
              stockReservations.id,
              active.map((r) => r.id),
            ),
          ),
        );
      this.log.info({ tenantId, refType: rt, refId: ref, items: active.length }, "inventory: reservation released");
      return { released: true, items: active.length };
    });
  }

  /**
   * Turns the stock held for a ref into a sale: a `sale` movement with the ref (qty −, reserved −) per line.
   * Idempotent (no active reservation = no-op).
   */
  async commit(
    tenantId: string,
    refType: string,
    refId: string,
    opts: { refNumber?: string | null; userId?: string | null } = {},
  ): Promise<{ committed: boolean; items: number }> {
    const rt = refTypeSchema.parse(refType);
    const ref = refIdSchema.parse(refId);
    const drops = this.dropSink();
    const result = await this.db.transaction(async (tx) => {
      await lockRef(tx, tenantId, rt, ref);
      const active = activeReservations(await this.reservationsOf(tx, tenantId, rt, ref));
      if (active.length === 0) return { committed: false, items: 0 };
      for (const r of active) {
        const milli = toMilli(r.qty);
        await this.change(tx, {
          tenantId,
          locationId: r.locationId,
          itemId: r.itemId,
          deltaMilli: -milli,
          reservedDeltaMilli: -milli,
          reason: "sale",
          refType: rt,
          refId: ref,
          refNumber: opts.refNumber ?? null,
          createdBy: opts.userId ?? null,
        }, drops);
      }
      const now = this.now();
      await tx
        .update(stockReservations)
        .set({ status: "committed", committedAt: now, updatedAt: now })
        .where(
          and(
            eq(stockReservations.tenantId, tenantId),
            inArray(
              stockReservations.id,
              active.map((r) => r.id),
            ),
          ),
        );
      this.log.info({ tenantId, refType: rt, refId: ref, items: active.length }, "inventory: reservation committed");
      return { committed: true, items: active.length };
    });
    await this.emitLowStock(tenantId, drops);
    return result;
  }

  /** Current reservation lines of a ref (any status). */
  async getReservation(tenantId: string, refType: string, refId: string): Promise<ReservationLine[]> {
    const rt = refTypeSchema.parse(refType);
    const ref = refIdSchema.parse(refId);
    const rows = await this.db
      .select()
      .from(stockReservations)
      .where(and(eq(stockReservations.tenantId, tenantId), eq(stockReservations.refType, rt), eq(stockReservations.refId, ref)))
      .orderBy(asc(stockReservations.itemId));
    return rows.map(toReservationLine);
  }

  // ================================================================ suppliers

  payableSubquery(tenantId: string) {
    return this.db
      .select({
        supplierId: purchases.supplierId,
        payable: sql<string>`coalesce(sum(${purchases.total} - ${purchases.returnedAmount} - ${purchases.amountPaid}), 0)`.as("payable"),
        lastPurchase: sql<string | null>`max(${purchases.date})::text`.as("last_purchase"),
      })
      .from(purchases)
      .where(and(eq(purchases.tenantId, tenantId), eq(purchases.status, "recorded")))
      .groupBy(purchases.supplierId)
      .as("supplier_payable");
  }

  /** Paise paid (net of refunds) to a supplier that belong to no bill: settle the opening balance or are advances. */
  private onAccountSql() {
    return sql<string>`(select coalesce(sum(case when pp.kind = 'payment' then pp.amount else -pp.amount end), 0) from purchase_payments pp where pp.tenant_id = ${suppliers.tenantId} and pp.supplier_id = ${suppliers.id} and pp.purchase_id is null and pp.reversed_at is null)`;
  }

  /** What we owe a supplier in total: unpaid bills + opening balance - on-account payments. */
  private supplierPayableSql(due: ReturnType<InventoryService["payableSubquery"]>) {
    return sql<string>`(coalesce(${due.payable}, 0) + ${suppliers.openingBalance} - ${this.onAccountSql()})`;
  }

  /** Supplier list sort (name / balance = total payable / lastPurchase). Default: name A→Z. */
  supplierSort(due: ReturnType<InventoryService["payableSubquery"]>) {
    return defineSort(
      { name: sql`lower(${suppliers.name})`, balance: this.supplierPayableSql(due), lastPurchase: due.lastPurchase },
      { default: "name", tieBreaker: suppliers.id },
    );
  }

  /**
   * Suppliers: paged, sorted (name / balance / lastPurchase; default name) and searched by name, phone or GSTIN.
   * Limits stay 50 / 200 (the supplier picker asks for 100).
   */
  async listSuppliers(tenantId: string, query: SupplierListQuery = {}): Promise<ListPage<Supplier & { lastPurchase: string | null }>> {
    const p = supplierListQuerySchema.parse(query);
    const where = and(
      eq(suppliers.tenantId, tenantId),
      isNull(suppliers.deletedAt),
      searchAny(p.q, [suppliers.name, suppliers.phone, suppliers.gstin]),
    );
    const due = this.payableSubquery(tenantId);
    const order = this.supplierSort(due).orderBy(p.sort);
    return runList(p, {
      rows: () =>
        this.db
          .select({ s: suppliers, payable: this.supplierPayableSql(due), lastPurchase: due.lastPurchase })
          .from(suppliers)
          .leftJoin(due, eq(due.supplierId, suppliers.id))
          .where(where)
          .orderBy(...order)
          .limit(p.limit)
          .offset(p.offset),
      count: () => this.db.select({ total: count() }).from(suppliers).where(where),
      map: (r) => ({ ...toSupplier(r.s, r.payable), lastPurchase: r.lastPurchase ?? null }),
    });
  }

  /** @internal */
  async supplierRow(db: DbOrTx, tenantId: string, id: string): Promise<SupplierRow | null> {
    const [row] = await db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.id, id), isNull(suppliers.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async getSupplier(tenantId: string, id: string): Promise<Supplier> {
    const due = this.payableSubquery(tenantId);
    const [row] = await this.db
      .select({ s: suppliers, payable: this.supplierPayableSql(due) })
      .from(suppliers)
      .leftJoin(due, eq(due.supplierId, suppliers.id))
      .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.id, id), isNull(suppliers.deletedAt)))
      .limit(1);
    if (!row) throw notFound("Supplier");
    return toSupplier(row.s, row.payable);
  }

  async createSupplier(tenantId: string, input: SupplierInput): Promise<Supplier> {
    const b = supplierInputSchema.parse(input);
    const [row] = await this.db
      .insert(suppliers)
      .values({ tenantId, ...snapshotOf(b), openingBalance: b.openingBalance ?? 0, openingDate: b.openingDate ?? null })
      .returning();
    return toSupplier(row!, row!.openingBalance);
  }

  async updateSupplier(tenantId: string, id: string, input: Partial<SupplierInput>): Promise<Supplier> {
    const b = supplierPatchSchema.parse(input);
    const existing = await this.supplierRow(this.db, tenantId, id);
    if (!existing) throw notFound("Supplier");
    const set: Partial<SupplierRow> = {};
    if (b.name !== undefined) set.name = b.name;
    if (b.phone !== undefined) set.phone = b.phone;
    if (b.email !== undefined) set.email = b.email;
    if (b.gstin !== undefined) set.gstin = b.gstin;
    if (b.address !== undefined) set.address = b.address;
    if (b.stateCode !== undefined) set.stateCode = b.stateCode;
    else if (b.gstin) set.stateCode = stateFromGstin(b.gstin);
    if (b.openingBalance !== undefined) set.openingBalance = b.openingBalance;
    if (b.openingDate !== undefined) set.openingDate = b.openingDate;
    if (Object.keys(set).length > 0) {
      await this.db
        .update(suppliers)
        .set(set)
        .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.id, id)));
    }
    return this.getSupplier(tenantId, id);
  }

  /** Soft delete; purchases keep their snapshot. */
  async deleteSupplier(tenantId: string, id: string): Promise<void> {
    const rows = await this.db
      .update(suppliers)
      .set({ deletedAt: this.now() })
      .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.id, id), isNull(suppliers.deletedAt)))
      .returning({ id: suppliers.id });
    if (rows.length === 0) throw notFound("Supplier");
  }

  // ================================================================ purchases

  /** @internal */
  async purchaseRow(db: DbOrTx, tenantId: string, id: string, lock = false): Promise<PurchaseRow> {
    const q = db
      .select()
      .from(purchases)
      .where(and(eq(purchases.tenantId, tenantId), eq(purchases.id, id)))
      .limit(1);
    const [row] = lock ? await q.for("update") : await q;
    if (!row) throw notFound("Purchase");
    return row;
  }

  private purchaseWhere(tenantId: string, p: { q?: string; supplierId?: string; from?: string; to?: string; recordedOnly?: boolean }) {
    const conds: (SQL | undefined)[] = [eq(purchases.tenantId, tenantId)];
    if (p.recordedOnly) conds.push(eq(purchases.status, "recorded"));
    if (p.supplierId) conds.push(eq(purchases.supplierId, p.supplierId));
    if (p.from) conds.push(gte(purchases.date, p.from));
    if (p.to) conds.push(lte(purchases.date, p.to));
    if (p.q) {
      const pat = likePattern(p.q);
      conds.push(
        or(
          ilike(purchases.billNumber, pat),
          sql`${purchases.supplier}->>'name' ilike ${pat}`,
          sql`${purchases.supplier}->>'gstin' ilike ${pat}`,
        ),
      );
    }
    return and(...conds);
  }

  /** WHERE of the purchase list; without `status` for its facet counts. */
  purchaseListConditions(tenantId: string, p: z.output<typeof purchaseListQuerySchema>, withStatus = true): SQL | undefined {
    return and(
      eq(purchases.tenantId, tenantId),
      withStatus && p.status?.length ? inArray(purchaseListStatusSql, [...p.status]) : undefined,
      p.supplierId?.length ? inArray(purchases.supplierId, p.supplierId) : undefined,
      p.from ? gte(purchases.date, p.from) : undefined,
      p.to ? lte(purchases.date, p.to) : undefined,
      searchAny(p.q, [purchases.billNumber, sql`${purchases.supplier}->>'name'`, sql`${purchases.supplier}->>'gstin'`]),
    );
  }

  /** Purchases: paged, sorted (PURCHASE_SORT) and filtered; `facets.status` counts unpaid / paid / cancelled. */
  async listPurchases(tenantId: string, query: PurchaseListQuery = {}): Promise<ListPage<PurchaseSummary>> {
    const p = purchaseListQuerySchema.parse(query);
    const order = PURCHASE_SORT.orderBy(p.sort);
    const where = this.purchaseListConditions(tenantId, p);
    const [page, byStatus] = await Promise.all([
      runList(p, {
        rows: () => this.db.select().from(purchases).where(where).orderBy(...order).limit(p.limit).offset(p.offset),
        count: () => this.db.select({ total: count() }).from(purchases).where(where),
        map: toPurchaseSummary,
      }),
      this.db
        .select({ key: purchaseListStatusSql, n: count() })
        .from(purchases)
        .where(this.purchaseListConditions(tenantId, p, false))
        .groupBy(sql`1`),
    ]);
    return { ...page, facets: { status: facetCounts(byStatus) } };
  }

  async getPurchase(tenantId: string, id: string): Promise<Purchase> {
    return toPurchase(await this.purchaseRow(this.db, tenantId, id));
  }

  /**
   * Records a supplier bill. Totals are recomputed here; lines with an itemId add stock (reason
   * `purchase`) at cost = taxable / qty (GST excluded, it is claimed as ITC) and update the average cost.
   */
  async createPurchase(tenantId: string, input: PurchaseInput, userId: string | null = null, extra: PurchaseExtra = {}): Promise<Purchase> {
    const b = purchaseInputSchema.parse(input);

    let supplierId: string | null = null;
    let supplier: SupplierSnapshot;
    if (b.supplierId) {
      const row = await this.supplierRow(this.db, tenantId, b.supplierId);
      if (!row) throw notFound("Supplier");
      supplierId = row.id;
      supplier = snapshotOf(row);
    } else if (b.supplier) {
      supplier = snapshotOf(b.supplier);
    } else {
      supplier = snapshotOf({ name: DEFAULT_SUPPLIER_NAME });
    }

    const ownState = normalizeStateCode(await this.sellerState.stateCode(tenantId));
    const placeOfSupply = ownState ?? supplier.stateCode;
    if (!placeOfSupply) {
      throw badRequest("Complete the business profile (state) in billing settings, or give the supplier's state");
    }
    const supplierState = supplier.stateCode ?? placeOfSupply;
    const totals = computeInvoice(b.lines, { sellerState: supplierState, placeOfSupply });
    const freight = b.freight ?? 0;
    const otherCharges = b.otherCharges ?? 0;
    const grandTotal = totals.total + freight + otherCharges;
    if (grandTotal > MAX_PAISE) throw badRequest("Purchase total is too large");
    const amountPaid = b.paid ? grandTotal : (b.amountPaid ?? 0);
    if (amountPaid > grandTotal) throw badRequest("The amount paid can't be more than the bill total");
    if (b.dueDate && b.dueDate < b.date) throw badRequest("The due date can't be before the bill date");

    const stockLines = mergePurchaseLines(totals.lines as PurchaseLine[]);
    if (stockLines.length > 0) {
      const ids = stockLines.map((l) => l.itemId);
      const found = new Set((await this.catalog.getItems(tenantId, ids)).map((i) => i.id));
      const missing = ids.filter((id) => !found.has(id));
      if (missing.length > 0) throw badRequest("Some lines refer to items that no longer exist", { itemIds: missing });
    }

    const loc = await this.resolveLocation(tenantId, b.locationId, { active: true });
    const row = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(purchases)
        .values({
          tenantId,
          supplierId,
          supplier,
          billNumber: b.billNumber,
          date: b.date,
          placeOfSupply,
          interState: isInterState(supplierState, placeOfSupply),
          lines: totals.lines as PurchaseLine[],
          totals: withoutLines(totals),
          total: grandTotal,
          paid: grandTotal - amountPaid <= 0,
          amountPaid,
          dueDate: b.dueDate ?? null,
          freight,
          otherCharges,
          purchaseOrderId: extra.purchaseOrderId ?? null,
          goodsReceiptId: extra.goodsReceiptId ?? null,
          status: "recorded",
          notes: b.notes ?? null,
          createdBy: userId,
        })
        .returning();
      if (!extra.skipStock) await this.addPurchaseStock(tx, tenantId, loc.id, created!, stockLines, userId, freight + otherCharges);
      if (amountPaid > 0) {
        await tx.insert(purchasePayments).values({
          tenantId,
          supplierId,
          purchaseId: created!.id,
          groupId: randomUUID(),
          kind: "payment",
          amount: amountPaid,
          mode: b.paymentMode ?? "cash",
          reference: b.paymentReference ?? null,
          date: b.date,
          note: b.paid ? "Paid at entry" : "Part payment at entry",
          createdBy: userId,
        });
      }
      return created!;
    });
    this.log.info({ tenantId, purchaseId: row.id, total: row.total }, "inventory: purchase recorded");
    return toPurchase(row);
  }

  private async addPurchaseStock(
    tx: DbOrTx,
    tenantId: string,
    locationId: string,
    p: PurchaseRow,
    lines: { itemId: string; milli: number; taxable: number }[],
    userId: string | null,
    /** Freight and other charges, spread over the lines by taxable value into the unit cost. */
    landed = 0,
  ) {
    if (lines.length === 0) return;
    // Lines that name a batch put their quantity into it (the totals below already include it).
    const batched = (p.lines as (PurchaseLine & { batchNo?: string; mfgDate?: string; expiry?: string })[]).filter((l) => l.itemId && l.batchNo);
    const shares = apportion(
      landed,
      lines.map((l) => l.taxable),
    );
    const untracked = await this.untrackedOf(
      tx,
      tenantId,
      lines.map((l) => l.itemId),
    );
    for (const [i, l] of lines.entries()) {
      if (untracked.has(l.itemId)) continue;
      await this.change(tx, {
        tenantId,
        locationId,
        itemId: l.itemId,
        deltaMilli: l.milli,
        reason: "purchase",
        refType: "purchase",
        refId: p.id,
        refNumber: p.billNumber,
        unitCost: unitCostOf(l.taxable + (shares[i] ?? 0), l.milli),
        createdBy: userId,
      });
    }
    for (const l of batched) {
      if (untracked.has(l.itemId!) || (await this.batches.pharmacyManaged(tenantId, l.itemId!))) continue;
      await this.batches.receiveInto(tx, {
        tenantId,
        itemId: l.itemId!,
        locationId,
        milli: toMilli(l.qty),
        batch: { batchNo: l.batchNo!, mfgDate: l.mfgDate, expiry: l.expiry, cost: l.qty > 0 ? Math.round(l.taxable / l.qty) : undefined, supplierName: p.supplier?.name },
        reason: "receive",
        refType: "purchase",
        refId: p.id,
        refNumber: p.billNumber,
        userId,
      });
    }
  }

  /** Cancels a purchase and takes back the stock it added. Idempotent: a cancelled purchase is returned as is. */
  async cancelPurchase(tenantId: string, id: string, userId: string | null = null): Promise<Purchase> {
    const def = await this.defaultLocationRow(tenantId);
    const row = await this.db.transaction(async (tx) => {
      const p = await this.purchaseRow(tx, tenantId, id, true);
      if (p.status === "cancelled") return p;
      if (p.imported) throw conflict("This bill was imported from your old software and can't be cancelled here; roll back the import instead");
      const [dn] = await tx
        .select({ id: debitNotes.id })
        .from(debitNotes)
        .where(and(eq(debitNotes.tenantId, tenantId), eq(debitNotes.purchaseId, id), eq(debitNotes.status, "issued")))
        .limit(1);
      if (dn) throw conflict("This purchase has debit notes; cancel them first");
      // Its payments are reversed with it (they stay in the history, marked reversed).
      await tx
        .update(purchasePayments)
        .set({ reversedAt: this.now(), reversedBy: userId, reverseNote: "Purchase cancelled" })
        .where(and(eq(purchasePayments.tenantId, tenantId), eq(purchasePayments.purchaseId, id), isNull(purchasePayments.reversedAt)));
      if (p.goodsReceiptId) {
        await tx
          .update(goodsReceipts)
          .set({ purchaseId: null })
          .where(and(eq(goodsReceipts.tenantId, tenantId), eq(goodsReceipts.id, p.goodsReceiptId)));
      }
      const [updated] = await tx
        .update(purchases)
        .set({ status: "cancelled", cancelledAt: this.now(), amountPaid: 0, paid: false })
        .where(and(eq(purchases.tenantId, tenantId), eq(purchases.id, id), eq(purchases.status, "recorded")))
        .returning();
      if (!updated) throw conflict("This purchase was changed meanwhile; reload and try again");
      const moves = await tx
        .select({
          locationId: stockMovements.locationId,
          itemId: stockMovements.itemId,
          delta: stockMovements.delta,
          reason: stockMovements.reason,
        })
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.tenantId, tenantId),
            eq(stockMovements.refType, "purchase"),
            eq(stockMovements.refId, id),
            inArray(stockMovements.reason, ["purchase", "purchase_cancel"]),
          ),
        );
      // Net of what is still applied (guards against a half-reversed history).
      for (const n of netByLocationItem(moves, def.id)) {
        await this.change(tx, {
          tenantId,
          locationId: n.locationId,
          itemId: n.itemId,
          deltaMilli: -n.milli,
          reason: "purchase_cancel",
          refType: "purchase",
          refId: id,
          refNumber: p.billNumber,
          createdBy: userId,
          skipBatch: true,
        });
      }
      await this.batches.reverseRef(tx, tenantId, "purchase", id, "purchase_cancel", { refNumber: p.billNumber, userId });
      return updated;
    });
    return toPurchase(row);
  }

  /**
   * The old paid / unpaid switch, now on top of payments: `paid: true` records a payment for what is still due (cash),
   * `paid: false` reverses every payment on the bill.
   */
  async setPurchasePaid(tenantId: string, id: string, input: { paid: boolean }, userId: string | null = null): Promise<Purchase> {
    const { paid } = paidInputSchema.parse(input);
    return this.purchasing.setPaidFlag(tenantId, id, paid, userId);
  }

  // ================================================================ reports

  /** Valuation of tracked items. */
  async stockReport(
    tenantId: string,
    query: { q?: string; locationId?: string | null } = {},
  ): Promise<{ items: StockLevelRow[]; total: number; totals: StockTotals }> {
    const q = z.string().trim().max(100).optional().parse(query.q);
    const { locationId } = locationQuerySchema.parse({ locationId: query.locationId });
    const loc = locationId ? await this.resolveLocation(tenantId, locationId) : null;
    const rows = (await this.allRows(tenantId, q, loc?.id)).filter((r) => r.track);
    return { items: rows, total: rows.length, totals: stockTotals(rows) };
  }

  /** Recorded (not cancelled) purchases dated from..to, with input tax credit totals. */
  async purchaseReport(tenantId: string, query: { from: string; to: string }): Promise<PurchaseReport> {
    const { from, to } = purchaseReportQuerySchema.parse(query);
    const rows = await this.db
      .select()
      .from(purchases)
      .where(this.purchaseWhere(tenantId, { from, to, recordedOnly: true }))
      .orderBy(asc(purchases.date), asc(purchases.createdAt));
    const itc: ItcTotals = { taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 };
    for (const r of rows) {
      itc.taxable += r.totals.taxable;
      itc.cgst += r.totals.cgst;
      itc.sgst += r.totals.sgst;
      itc.igst += r.totals.igst;
    }
    itc.total = itc.cgst + itc.sgst + itc.igst;
    return { rows: rows.map(toPurchaseSummary), itc, byRate: mergeTaxBreakup(rows.map((r) => r.totals.taxBreakup)) };
  }
}
