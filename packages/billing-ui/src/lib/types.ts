/** Response shapes of the srikit HTTP API (/v1) used by the billing module. Money is integer paise. */
import type {
  GstRate,
  InvoiceTotals,
  LineInput as GstLineInput,
  LineTotals as GstLineTotals,
  TaxBreakupRow,
} from "@srirealtime/gst";

/** v2: lines may carry the saved item they came from (stock is keyed by itemId). */
export type LineInput = GstLineInput & { itemId?: string };
export type LineTotals = GstLineTotals & { itemId?: string };
export type { GstRate, InvoiceTotals, TaxBreakupRow };

export type ISODate = string;

/** Auth, tenancy and branding shapes live in the kit. */
export type { Branding, BrandTokens, MeResponse, OtpRequestResponse, SignInResponse, Tenant, User } from "@srirealtime/web";

export interface Paged<T> {
  items: T[];
  total: number;
}

/** `billing` settings namespace: the seller block printed on invoices. */
export interface SellerProfile {
  legalName: string;
  gstin: string;
  address: string;
  city: string;
  pincode: string;
  stateCode: string;
  phone: string;
  email: string;
  invoicePrefix: string;
  terms: string;
  bankName: string;
  accountNumber: string;
  ifsc: string;
  upiId: string;
  /** v2: WhatsApp/SMS reminders for due bills. */
  autoReminders?: boolean;
  /** Days after the due date on which a reminder goes out. */
  reminderDays?: number[];
  /** Send a receipt message when an online payment arrives. */
  sendPaymentReceipts?: boolean;
}

export interface SettingsValues<T> {
  namespace: string;
  values: T;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
  stateCode: string | null;
  /** Paise: ledger balance (opening + bills − payments − receipts). Negative = advance. */
  outstanding: number;
  /** v2: paise, + = they owe the shop, − = advance. */
  openingBalance?: number;
  /** v2: paise or null (no limit). */
  creditLimit?: number | null;
  /** v2: unallocated receipt money (paise). */
  advance?: number;
  createdAt: ISODate;
  /** Customer list only: latest issued bill date. */
  lastBillDate?: string | null;
  /** Customer list only: paise billed less credit notes. */
  totalBilled?: number;
  /** Customer list only: paise of open bills past their due date. */
  overdue?: number;
}

export interface CustomerInput {
  name: string;
  phone?: string;
  email?: string;
  gstin?: string;
  address?: string;
  stateCode?: string;
  openingBalance?: number;
  creditLimit?: number | null;
}

export interface Item {
  id: string;
  name: string;
  hsn: string | null;
  unit: string | null;
  rate: number;
  gstRate: GstRate;
  /** Catalogue items: price-band GST (apparel / footwear); `gstRate`/`rate` are the band at the item's price. */
  gstRule?: import("@srirealtime/gst").GstRateRule | null;
  createdAt: ISODate;
  /** Catalogue items: the product's category. */
  categoryId?: string | null;
  /** Catalogue items: false for draft/archived products. */
  active?: boolean;
  /** With stock tracking: quantity on hand (all locations) and its status. */
  stockQty?: number | null;
  stockStatus?: "in" | "low" | "out" | "untracked" | null;
}

/** GET /invoices/items: `categories` names the ids in `facets.category`. */
export interface ItemListResponse extends Paged<Item> {
  facets?: Record<string, Record<string, number>>;
  categories?: { id: string; name: string }[];
}

export interface ItemInput {
  name: string;
  hsn?: string;
  unit?: string;
  rate: number;
  gstRate: GstRate;
}

export type InvoiceStatus = "draft" | "issued" | "partially_paid" | "paid" | "cancelled";
export const INVOICE_STATUSES: InvoiceStatus[] = ["draft", "issued", "partially_paid", "paid", "cancelled"];

export type PaymentMethod = "cash" | "upi" | "card" | "bank" | "cheque" | "other";
export const PAYMENT_METHODS: PaymentMethod[] = ["cash", "upi", "card", "bank", "cheque", "other"];

export interface InvoiceSummary {
  id: string;
  number: string | null;
  /** Shop branch (multi-branch shops); null = no branch. */
  branchId?: string | null;
  status: InvoiceStatus;
  date: string;
  dueDate: string | null;
  customerName: string;
  total: number;
  /** Net money received (credit note refunds taken off). */
  paid: number;
  /** Total of the bill's issued credit notes (returns, price corrections). */
  credited?: number;
  balance: number;
  isOverdue: boolean;
}

export interface InvoiceParty {
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
  stateCode: string | null;
}

export interface Payment {
  id?: string;
  amount: number;
  method: PaymentMethod;
  date: string;
  reference: string | null;
  createdAt: ISODate;
  /** "manual" | "receipt" | "online" | "refund" (a credit note refund: negative amount). */
  source?: "bill" | "manual" | "receipt" | "online" | "refund";
  creditNoteId?: string | null;
  provider?: "razorpay" | "mock" | null;
}

export interface Invoice extends InvoiceSummary {
  customerId: string | null;
  customer: InvoiceParty;
  seller: Partial<SellerProfile>;
  placeOfSupply: string;
  interState: boolean;
  lines: LineTotals[];
  /** `loyalty` (batch 3): points redeemed on the bill and the discount they gave (paise). */
  totals: Omit<InvoiceTotals, "lines"> & { loyalty?: { points: number; discount: number } };
  amountInWords: string;
  notes: string | null;
  payments: Payment[];
  shareToken: string | null;
  cancelledAt: ISODate | null;
  cancelReason: string | null;
  createdAt: ISODate;
  updatedAt: ISODate;
  /** v2: e.g. ["credit_limit_exceeded"] on create/issue responses. */
  warnings?: string[];
  /** v2: last 10 WhatsApp/SMS messages for this bill. */
  messages?: InvoiceMessage[];
  /** Credit notes against the bill (issued and cancelled), oldest first. */
  creditNotes?: CreditNoteSummary[];
}

// ---------------------------------------------------------------- credit notes

export type CreditNoteReason = "return" | "price_correction" | "discount" | "other";
export const CREDIT_NOTE_REASONS: CreditNoteReason[] = ["return", "price_correction", "discount", "other"];
export type RefundMode = "cash" | "upi" | "card" | "credit_book" | "none";
export const REFUND_MODES: RefundMode[] = ["cash", "upi", "card", "credit_book", "none"];
export type CreditNoteStatus = "issued" | "cancelled";

export interface CreditNoteSummary {
  id: string;
  number: string;
  date: string;
  status: CreditNoteStatus;
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  branchId: string | null;
  customerId: string | null;
  customerName: string;
  reason: CreditNoteReason;
  refundMode: RefundMode;
  refundAmount: number;
  total: number;
  createdAt: ISODate;
}

export type CreditNoteLine = LineTotals & { line: number; kind: "qty" | "value"; restock: boolean };

export interface CreditNote extends CreditNoteSummary {
  customer: InvoiceParty;
  seller: Partial<SellerProfile>;
  note: string | null;
  placeOfSupply: string;
  interState: boolean;
  lines: CreditNoteLine[];
  totals: Omit<InvoiceTotals, "lines">;
  amountInWords: string;
  tillSessionId: string | null;
  issuedAt: ISODate;
  cancelledAt: ISODate | null;
  cancelReason: string | null;
  canCancel: boolean;
  updatedAt: ISODate;
}

export interface ReturnableLine {
  line: number;
  description: string;
  unit: string | null;
  itemId: string | null;
  gstRate: GstRate;
  rate: number;
  qty: number;
  returnedQty: number;
  remainingQty: number;
  total: number;
  credited: { taxable: number; cgst: number; sgst: number; igst: number; total: number };
  remaining: { taxable: number; cgst: number; sgst: number; igst: number; total: number };
}

export interface Returnable {
  invoiceId: string;
  number: string | null;
  status: InvoiceStatus;
  total: number;
  paid: number;
  credited: number;
  balance: number;
  creditable: number;
  interState: boolean;
  hasCustomer: boolean;
  blocked: string | null;
  lines: ReturnableLine[];
  creditNotes: CreditNoteSummary[];
}

export interface CreditNoteInput {
  date?: string;
  reason: CreditNoteReason;
  note?: string;
  refundMode: RefundMode;
  refundReference?: string;
  lines: { line: number; qty?: number; taxable?: number; restock?: boolean }[];
  tillSessionId?: string;
}

export interface CreditNoteResult {
  creditNote: CreditNote;
  invoice: Invoice;
}

export interface InvoiceMessage {
  template: string;
  channel: "whatsapp" | "sms";
  /** Masked number. */
  to: string;
  sentAt: ISODate;
}

export interface InvoiceSummaryResponse {
  month: { invoiced: number; collected: number; count: number };
  outstanding: number;
  overdueCount: number;
  recent: InvoiceSummary[];
  /** v2: last 14 days. */
  trend?: { date: string; invoiced: number }[];
  /** v2: for month-on-month deltas. */
  prevMonth?: { invoiced: number; collected: number; count: number };
}

export interface InvoiceInput {
  /** null on PATCH switches a draft to a walk-in customer. */
  customerId?: string | null;
  /** Walk-in buyer (not saved to the customer list). Empty strings are treated as missing. */
  customer?: { name: string; phone?: string; email?: string; gstin?: string; address?: string; stateCode?: string } | null;
  date: string;
  /** null clears it on PATCH. */
  dueDate?: string | null;
  placeOfSupply?: string;
  lines: LineInput[];
  notes?: string | null;
  issue?: boolean;
  /** Loyalty points to redeem as a bill discount. Only with `issue: true` (a draft can't redeem). */
  loyaltyPoints?: number;
}

export interface PublicInvoiceResponse {
  invoice: Invoice;
  branding: { appName: string | null; logoUrl: string | null; css: string };
  /** v2 */
  onlinePayment?: { enabled: boolean; provider: "razorpay" | "mock" | null };
}

// ---------------------------------------------------------------- v2 (docs/billing-v2.md)

// payments
export type OnlineProvider = "razorpay" | "mock";

export interface PaymentAccount {
  configured: boolean;
  provider: "razorpay";
  keyId: string | null;
  mode: "test" | "live" | null;
  enabled: boolean;
  webhookUrl: string;
}

export interface PaymentAccountInput {
  keyId: string;
  keySecret?: string;
  webhookSecret?: string;
  enabled: boolean;
}

export interface CheckoutResponse {
  orderId: string;
  provider: OnlineProvider;
  keyId?: string;
  amount: number;
  currency: "INR";
  name: string;
  description: string;
  prefill: { name?: string; contact?: string; email?: string };
}

export interface PaidResponse {
  status: "paid";
  amount: number;
}

// credit book
export interface Receipt {
  id: string;
  amount: number;
  method: PaymentMethod;
  date: string;
  reference: string | null;
  note: string | null;
  createdAt?: ISODate;
}

export interface ReceiptInput {
  amount: number;
  method: PaymentMethod;
  date: string;
  reference?: string;
  note?: string;
}

export interface ReceiptResult {
  receipt: Receipt;
  allocations: { invoiceId: string; number: string | null; amount: number }[];
  advance: number;
}

export type LedgerEntryType = "opening" | "invoice" | "payment" | "receipt" | "cancel" | "credit_note" | "refund";

export interface LedgerEntry {
  date: string;
  type: LedgerEntryType;
  refId: string | null;
  number: string | null;
  description: string | null;
  debit: number;
  credit: number;
  balance: number;
}

export interface LedgerResponse {
  customer: Customer;
  openingBalance: number;
  entries: LedgerEntry[];
  closingBalance: number;
}

export type CreditBookFilter = "due" | "advance" | "all";

export interface CreditBookRow {
  customer: Customer;
  balance: number;
  /** The contract doesn't pin this down: an overdue amount (paise) or a flag. */
  overdue: number | boolean;
  lastActivity: ISODate | null;
  /** Due date (or bill date) of the oldest open bill with money left on it. */
  oldestDue?: string | null;
  /** Latest payment or receipt date. */
  lastPayment?: string | null;
}

export interface CreditBookResponse {
  items: CreditBookRow[];
  total?: number;
  totals: { receivable: number; advance: number; customersWithDues: number };
  facets?: Record<string, Record<string, number>>;
}

export interface ShareLink {
  token: string;
  url: string;
}

export interface PublicStatementResponse {
  customer: { name: string };
  seller: Partial<SellerProfile>;
  /** Last 90 days. Accepts the ledger response shape or a bare entries array. */
  ledger: Partial<LedgerResponse> | LedgerEntry[];
  balance: number;
  branding: { appName: string | null; logoUrl: string | null; css: string };
}

export interface SendResult {
  logId: string;
  url?: string;
}

// inventory
export type StockStatus = "ok" | "low" | "out";

export interface StockRow {
  itemId: string;
  name: string;
  unit: string | null;
  hsn: string | null;
  qty: number;
  reorderLevel: number;
  track: boolean;
  avgCost: number | null;
  value: number;
  status: StockStatus;
  updatedAt: ISODate | null;
  categoryId?: string | null;
  categoryName?: string | null;
}

export type StockFilter = "all" | "low" | "out" | "untracked";

export interface StockListResponse {
  items: StockRow[];
  total: number;
  totals: { stockValue: number; lowCount: number; outCount: number };
  facets?: Record<string, Record<string, number>>;
  categories?: { id: string; name: string }[];
}

export interface StockSummary {
  stockValue: number;
  lowCount: number;
  outCount: number;
  lowItems: StockRow[];
}

export type StockReason = "opening" | "adjustment" | "sale" | "sale_cancel" | "sale_return" | "sale_return_cancel" | "purchase" | "purchase_cancel";

export interface StockMovement {
  id: string;
  date: string;
  reason: StockReason;
  delta: number;
  qtyAfter: number;
  refType: string | null;
  refId: string | null;
  refNumber: string | null;
  note: string | null;
  createdBy: string | null;
}

export interface StockAdjustInput {
  mode: "add" | "remove" | "set";
  qty: number;
  note?: string;
  unitCost?: number;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
  stateCode: string | null;
  /** Sum of unpaid purchases (paise). */
  payable: number;
  createdAt: ISODate;
  /** Supplier list only: latest recorded purchase date. */
  lastPurchase?: string | null;
}

export interface SupplierInput {
  name: string;
  phone?: string;
  email?: string;
  gstin?: string;
  address?: string;
  stateCode?: string;
}

export interface PurchaseSupplierSnapshot {
  id?: string | null;
  name: string;
  gstin?: string | null;
  stateCode?: string | null;
  phone?: string | null;
}

export interface PurchaseSummary {
  id: string;
  billNumber: string;
  date: string;
  supplierName?: string;
  supplier?: PurchaseSupplierSnapshot;
  taxable?: number;
  tax?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  total: number;
  paid: boolean;
  status: "recorded" | "cancelled";
}

export interface Purchase {
  id: string;
  billNumber: string;
  date: string;
  supplier: PurchaseSupplierSnapshot;
  lines: LineTotals[];
  totals: Omit<InvoiceTotals, "lines">;
  total: number;
  paid: boolean;
  status: "recorded" | "cancelled";
  notes: string | null;
  createdAt: ISODate;
}

export interface PurchaseInput {
  supplierId?: string;
  supplier?: { name: string; gstin?: string; stateCode?: string };
  billNumber: string;
  date: string;
  lines: LineInput[];
  notes?: string;
  paid?: boolean;
}

// reports
export interface SalesTrendPoint {
  date: string;
  invoiced: number;
  collected: number;
  count: number;
}

export interface SalesRegisterRow {
  id: string;
  /** "credit_note" rows have negative amounts (status "credit_note"). */
  type?: "invoice" | "credit_note";
  /** Credit notes: the original bill's number. */
  against?: string | null;
  number: string | null;
  date: string;
  customer: string;
  gstin: string | null;
  placeOfSupply: string | null;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  paid: number;
  status: InvoiceStatus | "credit_note";
}

export interface SalesRegisterResponse {
  items: SalesRegisterRow[];
  totals?: Partial<Record<"taxable" | "cgst" | "sgst" | "igst" | "total" | "paid" | "count", number>>;
}

export interface GstSummaryResponse {
  b2b: { gstin: string; name: string; invoices: number; taxable: number; cgst: number; sgst: number; igst: number; total: number }[];
  b2cl: { placeOfSupply: string; rate: number; taxable: number; igst: number }[];
  b2cs: { placeOfSupply: string; rate: number; taxable: number; cgst: number; sgst: number; igst: number }[];
  hsn: { hsn: string; description: string; unit: string; qty: number; taxable: number; cgst: number; sgst: number; igst: number; total: number }[];
  byRate: TaxBreakupRow[];
  gstr3b: { outwardTaxable: number; igst: number; cgst: number; sgst: number; nilRated: number };
  totals?: Partial<Record<"taxable" | "cgst" | "sgst" | "igst" | "total" | "creditNotes", number>>;
  /** Credit notes to registered buyers (GSTR-1 Table 9B). */
  cdnr?: {
    gstin: string;
    name: string;
    noteNumber: string;
    noteDate: string;
    invoiceNumber: string;
    invoiceDate: string;
    placeOfSupply: string;
    rate: number;
    taxable: number;
    cgst: number;
    sgst: number;
    igst: number;
    noteValue: number;
  }[];
  /** Credit notes to unregistered buyers on B2CL bills. */
  cdnur?: { noteNumber: string; noteDate: string; invoiceNumber: string; placeOfSupply: string; rate: number; taxable: number; igst: number; noteValue: number }[];
  creditNoteTotals?: { count: number; taxable: number; cgst: number; sgst: number; igst: number; total: number };
}

export type PaymentSource = "bill" | "receipt" | "online";

export interface PaymentsReportResponse {
  byMethod: { method: string; amount: number; count: number }[];
  items: { date: string; number: string | null; customer: string; method: string; amount: number; reference: string | null; source: PaymentSource }[];
}

export type AgeingKey = "current" | "1-30" | "31-60" | "61-90" | "90+";

export interface AgeingResponse {
  buckets: { key: AgeingKey; amount: number; count: number }[];
  customers: { customerId: string; name: string; current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number; total: number }[];
}

export interface TopItemsResponse {
  items: { itemId: string | null; description: string; qty: number; unit: string | null; taxable: number }[];
}

export interface TopCustomersResponse {
  items: { customerId: string | null; name: string; invoices: number; total: number }[];
}

export interface PurchasesReportResponse {
  rows: PurchaseSummary[];
  itc: { taxable: number; cgst: number; sgst: number; igst: number; total: number };
  byRate: TaxBreakupRow[];
}

export interface StockReportResponse {
  items?: StockRow[];
  rows?: StockRow[];
  totals?: { stockValue?: number };
}
