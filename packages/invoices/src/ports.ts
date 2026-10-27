import type { TenantRef } from "@srirealtime/core";
import type { InvoiceStatus } from "./schema";
import type { Customer, Invoice } from "./service";
import type { CreditNote } from "./credit-notes";

/** The shop's own details, read from the `billing` settings namespace (apps/api wires it). */
export interface SellerProfile {
  legalName: string | null;
  gstin: string | null;
  address: string | null;
  city: string | null;
  pincode: string | null;
  /** 2-digit GST state code; required before issuing. */
  stateCode: string | null;
  phone: string | null;
  email: string | null;
  /** Default "INV"; sanitised to A-Z, 0-9, "-" and max 6 characters. */
  invoicePrefix: string | null;
  terms: string | null;
  bankName: string | null;
  accountNumber: string | null;
  ifsc: string | null;
  upiId: string | null;
  /**
   * Letter of Undertaking (or bond) for exports / SEZ supplies without payment of IGST (docs/recurring-export-gstin.md):
   * its ARN / reference and date, printed on such bills. Optional: profiles saved before it read as null.
   */
  lutNumber?: string | null;
  lutDate?: string | null;
  /** WhatsApp reminders for overdue bills (default false). */
  autoReminders: boolean;
  /** Reminders go out this many days after the due date (default [1, 7, 15]). */
  reminderDays: number[];
  /** Thank-you message when a bill is paid online (default true). */
  sendPaymentReceipts: boolean;
  /**
   * Tax scheme of the shop, filled in by the host from GST filing settings (not stored in the billing profile).
   * "composition" from `compositionFrom` on: new bills are bills of supply with no tax (Section 10 CGST Act).
   */
  taxScheme?: "regular" | "composition";
  compositionFrom?: string | null;
}

export const DEFAULT_REMINDER_DAYS: readonly number[] = [1, 7, 15];

/** The text fields of the seller profile. */
export const SELLER_FIELDS = [
  "legalName",
  "gstin",
  "address",
  "city",
  "pincode",
  "stateCode",
  "phone",
  "email",
  "invoicePrefix",
  "terms",
  "bankName",
  "accountNumber",
  "ifsc",
  "upiId",
  "lutNumber",
  "lutDate",
] as const satisfies readonly (keyof SellerProfile)[];

/** Buyer details frozen on the invoice. */
export interface CustomerSnapshot {
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
  stateCode: string | null;
  /** ISO 3166 alpha-2 country of a buyer outside India (place of supply 96); absent = India. */
  country?: string | null;
}

export interface SellerProfilePort {
  /** May return a partial profile; missing fields are treated as null. */
  get(tenantId: string): Promise<Partial<SellerProfile> | SellerProfile>;
}

/** Implemented by the plans module (usage limits; feature access is enforced through route `config.feature`). */
export interface EntitlementsPort {
  /** Throws 402 plan_limit `{ key, limit, used }` when over the limit; returns new usage. */
  consume(tenant: TenantRef, key: string, amount?: number): Promise<number>;
  release?(tenant: TenantRef, key: string, amount?: number): Promise<void>;
}

/** Implemented by the branding module, used on the public invoice page. */
export interface BrandingPort {
  get(tenantId: string): Promise<{ appName: string | null; logoUrl: string | null; css: string }>;
}

/** Implemented by the inventory module. Both calls are idempotent per `refId` (the invoice id). */
export interface StockPort {
  applySale(
    tenantId: string,
    sale: {
      refId: string;
      lines: { itemId: string; qty: number; /** Batch chosen for the line (batch-tracked items). */ batchId?: string }[];
      refNumber?: string | null;
      /** Stock location to take the stock from (the bill's branch location). Absent/null = the default location. */
      locationId?: string | null;
    },
  ): Promise<unknown>;
  reverseSale(tenantId: string, refId: string): Promise<unknown>;
  /**
   * Puts returned goods of a credit note back in stock (where the bill's sale took them, else `locationId`, else the
   * default location). Idempotent per `refId` (the credit note id).
   */
  applyReturn?(
    tenantId: string,
    ret: { refId: string; saleRefId: string; refNumber?: string | null; lines: { itemId: string; qty: number }[]; locationId?: string | null },
  ): Promise<unknown>;
  /** Takes a cancelled credit note's returned goods out of stock again. Idempotent. */
  reverseReturn?(tenantId: string, refId: string): Promise<unknown>;
}

/** A saved item as an item source returns it (`rate` = GST-exclusive paise per unit). */
export interface ItemSourceRecord {
  id: string;
  name: string;
  hsn: string | null;
  unit: string;
  rate: number;
  gstRate: number;
  /** Catalogue: the product's price-band GST rule, if any (`gstRate` is then the band at this item's price). */
  gstRule?: import("@srirealtime/gst").GstRateRule | null;
  createdAt: Date;
  /** Optional extras a source may fill (catalogue: category, product active, stock with inventory). */
  categoryId?: string | null;
  active?: boolean;
  stockQty?: number | null;
  stockStatus?: "in" | "low" | "out" | "untracked" | null;
  /**
   * Alternate units (catalogue, docs/price-lists-units.md): `factor` base units in one; `price` as sold, `rate`
   * GST-exclusive paise for one of the unit. `unit` above is the base (stock) unit.
   */
  units?: { unit: string; factor: number; barcode: string | null; ownPrice: number | null; price: number; rate: number; mrp: number | null }[];
}

/** The item list query handed to a source (already validated; `sort` is one of ITEM_SORT_KEYS, "-" = descending). */
export interface ItemSourceListQuery {
  q?: string;
  limit: number;
  offset: number;
  sort?: string;
  category?: string[];
  stock?: ("in" | "low" | "out")[];
  gstRate?: number[];
  active?: boolean;
}

/** A source's list page; `facets`/`categories` are optional extras (category, gstRate and stock counts). */
export interface ItemSourcePage {
  items: ItemSourceRecord[];
  total: number;
  facets?: Record<string, Record<string, number>>;
  categories?: { id: string; name: string }[];
}

/** Validated item fields handed to the source (already parsed by the invoices item schemas). */
export interface ItemSourceInput {
  name: string;
  hsn: string | null;
  unit: string;
  rate: number;
  gstRate: number;
}

/**
 * Where saved items live when not in `billing_items` (implemented with the catalogue in apps/api: an item is a catalogue
 * variant). When wired, every `/v1/invoices/items*` route and getItem/listItems/createItem/updateItem/deleteItem use it.
 */
export interface ItemSourcePort {
  /** Sorting and the filters beyond `q` are optional for a source to honour. */
  list(tenantId: string, query: ItemSourceListQuery): Promise<ItemSourcePage>;
  /** Null when unknown or deleted. */
  get(tenantId: string, id: string): Promise<ItemSourceRecord | null>;
  create(tenantId: string, input: ItemSourceInput): Promise<ItemSourceRecord>;
  /** Null when unknown or deleted. */
  update(tenantId: string, id: string, patch: Partial<ItemSourceInput>): Promise<ItemSourceRecord | null>;
  /** False when unknown or already deleted. */
  remove(tenantId: string, id: string): Promise<boolean>;
}

export interface NotifierSendInput {
  tenantId: string;
  channel: "whatsapp" | "sms";
  /** E.164, e.g. "+919876543210". */
  to: string;
  /** Notify template key, e.g. "invoice.issued". */
  template: string;
  vars: Record<string, string>;
  locale?: string;
}

/** Implemented by the notify module. */
export interface NotifierPort {
  send(input: NotifierSendInput): Promise<{ logId: string }>;
}

/** Implemented by the payments module: whether the shop can take online payments. */
export interface PaymentsAvailabilityPort {
  isEnabled(tenantId: string): Promise<{ enabled: boolean; provider: "razorpay" | "mock" | null; mode?: "test" | "live" | null }>;
}

/** A shop branch's seller details (branches module). Null fields fall back to the billing profile. */
export interface BranchSellerInfo {
  branchId: string;
  isDefault: boolean;
  gstin: string | null;
  stateCode: string | null;
  address: string | null;
  city: string | null;
  pincode: string | null;
  phone: string | null;
  invoicePrefix: string | null;
  stockLocationId: string | null;
}

/** Implemented by the branches module. */
export interface BranchPort {
  /** Null when the branch is unknown (the bill then uses the billing profile alone). */
  seller(tenantId: string, branchId: string): Promise<BranchSellerInfo | null>;
}

/** Implemented by the loyalty module (`service.redeem` / `service.reverse` with refType "invoice"). */
export interface LoyaltyRedeemPort {
  /** Uses points on a bill; returns the discount (paise). Throws (e.g. 409 loyalty_redeem) when not allowed. Idempotent per invoiceId. */
  redeem(
    tenantId: string,
    input: { phone: string; name?: string | null; points: number; invoiceId: string; orderAmount: number },
  ): Promise<{ points: number; discount: number }>;
  /** Gives the points back (failed issue). */
  reverse(tenantId: string, invoiceId: string): Promise<unknown>;
  /**
   * A credit note took `amount` (paise) off a bill that already earned points: takes back the points earned on that
   * value. Idempotent per credit note.
   */
  creditNote?(tenantId: string, e: { invoiceId: string; creditNoteId: string; amount: number }): Promise<unknown>;
  /** A credit note was cancelled: gives back the points `creditNote` took. Idempotent. */
  creditNoteCancelled?(tenantId: string, e: { invoiceId: string; creditNoteId: string }): Promise<unknown>;
}

/**
 * Domain events (developer webhooks, loyalty earn, ...). Called after the write committed; awaited, but a failing
 * handler is only logged and never fails the request.
 */
export interface InvoiceEventsPort {
  issued?(tenantId: string, invoice: Invoice): Promise<void> | void;
  /** The bill's status became `paid` (any path: payment on the bill, receipt allocation, online payment). */
  paid?(tenantId: string, invoice: Invoice): Promise<void> | void;
  cancelled?(tenantId: string, invoice: Invoice, previousStatus: InvoiceStatus): Promise<void> | void;
  paymentReceived?(
    tenantId: string,
    e: { invoice: Invoice; amount: number; method: string; source: "manual" | "receipt" | "online" },
  ): Promise<void> | void;
  customerCreated?(tenantId: string, customer: Customer): Promise<void> | void;
  creditNoteIssued?(tenantId: string, note: CreditNote, invoice: Invoice): Promise<void> | void;
  creditNoteCancelled?(tenantId: string, note: CreditNote, invoice: Invoice): Promise<void> | void;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };
