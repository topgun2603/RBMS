import type { Invoice, InvoiceInput, InvoiceParty, ISODate, LineTotals, Paged, PaymentMethod } from "./types";

/**
 * Proforma invoices, sale orders and delivery challans: mirror @srirealtime/invoices proformas.ts, sale-orders.ts and
 * challans.ts (docs/sales-documents.md). Money is in paise.
 */

export type SalesDocKind = "proforma" | "sale_order" | "challan";

export const PROFORMA_STATUSES = ["draft", "issued", "converted", "cancelled"] as const;
/** Stored statuses plus the derived "expired" (issued and past valid-until). */
export const PROFORMA_DISPLAY_STATUSES = [...PROFORMA_STATUSES, "expired"] as const;
export type ProformaStatus = (typeof PROFORMA_STATUSES)[number];
export type ProformaDisplayStatus = (typeof PROFORMA_DISPLAY_STATUSES)[number];

export const SALE_ORDER_STATUSES = ["open", "partly_delivered", "delivered", "invoiced", "cancelled"] as const;
export type SaleOrderStatus = (typeof SALE_ORDER_STATUSES)[number];

export const CHALLAN_STATUSES = ["issued", "partly_returned", "returned", "invoiced", "cancelled"] as const;
export type ChallanStatus = (typeof CHALLAN_STATUSES)[number];

/** CGST Rule 55: why goods move without a bill. Only approval and before_invoice challans are billed. */
export const CHALLAN_REASONS = ["before_invoice", "approval", "job_work", "exhibition", "other"] as const;
export type ChallanReason = (typeof CHALLAN_REASONS)[number];
export const BILLABLE_REASONS: readonly ChallanReason[] = ["approval", "before_invoice"];

export const TRANSPORT_MODES = ["road", "rail", "air", "ship", "hand"] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

export const SALES_DOC_EVENT_TYPES = ["created", "edited", "issued", "sent", "advance", "converted", "delivered", "invoiced", "returned", "cancelled", "reopened"] as const;

export interface SalesDocEvent {
  at: ISODate;
  type: (typeof SALES_DOC_EVENT_TYPES)[number];
  by?: string | null;
  note?: string | null;
}

/** An advance taken against a proforma / sale order: a customer receipt kept for it. */
export interface SalesDocAdvance {
  id: string;
  customerId: string;
  amount: number;
  method: PaymentMethod;
  date: string;
  reference: string | null;
  note: string | null;
  /** Still to be put on a bill. */
  advance: number;
  against: { kind: "proforma" | "sale_order"; id: string; number: string | null } | null;
  createdAt: ISODate;
}

export type SalesDocLine = LineTotals & { key: string; orderLineKey?: string };

// ---------------------------------------------------------------- proforma

export interface ProformaSummary {
  id: string;
  number: string;
  status: ProformaStatus;
  displayStatus: ProformaDisplayStatus;
  date: string;
  validUntil: string | null;
  customerId: string | null;
  customerName: string;
  branchId: string | null;
  total: number;
  advanceReceived: number;
  invoiceId: string | null;
  invoiceNumber: string | null;
  createdAt: ISODate;
}

export interface Proforma extends ProformaSummary {
  customer: InvoiceParty;
  seller: Invoice["seller"];
  placeOfSupply: string;
  interState: boolean;
  lines: LineTotals[];
  totals: Invoice["totals"];
  amountInWords: string;
  notes: string | null;
  terms: string | null;
  deliveryText: string | null;
  advancePercent: number | null;
  advanceAmount: number;
  advances: SalesDocAdvance[];
  advanceUnapplied: number;
  quotationId: string | null;
  quotationNumber: string | null;
  hasShareLink: boolean;
  sentAt: ISODate | null;
  convertedAt: ISODate | null;
  invoiceMissing: boolean;
  cancelledAt: ISODate | null;
  cancelReason: string | null;
  events: SalesDocEvent[];
  canEdit: boolean;
  canConvert: boolean;
  canCancel: boolean;
  canAdvance: boolean;
  updatedAt: ISODate;
}

/** Customer, date, place of supply, lines, notes and terms: shared by every document's input. */
export interface DocBaseInput {
  customerId?: string | null;
  customer?: InvoiceInput["customer"];
  date?: string;
  placeOfSupply?: string | null;
  lines: InvoiceInput["lines"];
  notes?: string | null;
  terms?: string | null;
}

export interface ProformaInput extends DocBaseInput {
  validUntil?: string | null;
  deliveryText?: string | null;
  advancePercent?: number | null;
  issue?: boolean;
}

// ---------------------------------------------------------------- sale order

export interface SaleOrderSummary {
  id: string;
  number: string;
  status: SaleOrderStatus;
  date: string;
  promisedDate: string | null;
  overdue: boolean;
  customerId: string | null;
  customerName: string;
  customerRef: string | null;
  branchId: string | null;
  total: number;
  advanceReceived: number;
  createdAt: ISODate;
}

export interface OrderLineProgress {
  key: string;
  description: string;
  unit: string | null;
  itemId: string | null;
  ordered: number;
  delivered: number;
  invoiced: number;
  toDeliver: number;
  onChallans: number;
}

export interface SaleOrderBillLink {
  invoiceId: string;
  number: string | null;
  status: string | null;
  missing: boolean;
  via: "order" | "challan";
  lines: { key: string; qty: number }[];
}

export interface SaleOrder extends SaleOrderSummary {
  customer: InvoiceParty;
  seller: Invoice["seller"];
  placeOfSupply: string;
  interState: boolean;
  lines: SalesDocLine[];
  totals: Invoice["totals"];
  amountInWords: string;
  notes: string | null;
  terms: string | null;
  advancePercent: number | null;
  advanceAmount: number;
  advances: SalesDocAdvance[];
  advanceUnapplied: number;
  reserveStock: boolean;
  quotationId: string | null;
  quotationNumber: string | null;
  progress: OrderLineProgress[];
  challans: ChallanSummary[];
  bills: SaleOrderBillLink[];
  hasShareLink: boolean;
  sentAt: ISODate | null;
  cancelledAt: ISODate | null;
  cancelReason: string | null;
  events: SalesDocEvent[];
  canEdit: boolean;
  canEditLines: boolean;
  canDeliver: boolean;
  canInvoice: boolean;
  challansToBill: string[];
  canCancel: boolean;
  canAdvance: boolean;
  updatedAt: ISODate;
}

export interface SaleOrderInput extends DocBaseInput {
  promisedDate?: string | null;
  customerRef?: string | null;
  advancePercent?: number | null;
  reserveStock?: boolean;
}

// ---------------------------------------------------------------- challan

export interface ChallanTransport {
  mode?: TransportMode | null;
  transporterName?: string | null;
  transporterId?: string | null;
  vehicleNo?: string | null;
  docNo?: string | null;
  docDate?: string | null;
  distanceKm?: number | null;
}

export interface ChallanReturn {
  id: string;
  date: string;
  lines: { key: string; qty: number }[];
  note?: string | null;
  by?: string | null;
  at: ISODate;
}

export interface ChallanSummary {
  id: string;
  number: string;
  status: ChallanStatus;
  displayStatus: ChallanStatus;
  reason: ChallanReason;
  date: string;
  returnBy: string | null;
  overdue: boolean;
  customerId: string | null;
  customerName: string;
  branchId: string | null;
  total: number;
  saleOrderId: string | null;
  saleOrderNumber: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  createdAt: ISODate;
}

export type ChallanLine = SalesDocLine & { returned: number; net: number };

export interface Challan extends ChallanSummary {
  customer: InvoiceParty;
  seller: Invoice["seller"];
  placeOfSupply: string;
  interState: boolean;
  lines: ChallanLine[];
  totals: Invoice["totals"];
  amountInWords: string;
  shipTo: string | null;
  transport: ChallanTransport;
  ewbNo: string | null;
  ewbDate: string | null;
  ewbSuggested: boolean;
  notes: string | null;
  terms: string | null;
  returns: ChallanReturn[];
  invoiceMissing: boolean;
  invoicedAt: ISODate | null;
  hasShareLink: boolean;
  sentAt: ISODate | null;
  cancelledAt: ISODate | null;
  cancelReason: string | null;
  events: SalesDocEvent[];
  canEdit: boolean;
  canReturn: boolean;
  canInvoice: boolean;
  canCancel: boolean;
  updatedAt: ISODate;
}

export interface ChallanFields {
  reason: ChallanReason;
  returnBy?: string | null;
  shipTo?: string | null;
  transport?: ChallanTransport | null;
  ewbNo?: string | null;
  ewbDate?: string | null;
}

export type ChallanInput = DocBaseInput & ChallanFields;

export interface ChallanPatch {
  returnBy?: string | null;
  shipTo?: string | null;
  transport?: ChallanTransport | null;
  ewbNo?: string | null;
  ewbDate?: string | null;
  notes?: string | null;
  terms?: string | null;
}

// ---------------------------------------------------------------- shared

export interface SalesDocSettings {
  proformaPrefix: string;
  saleOrderPrefix: string;
  challanPrefix: string;
  proformaValidityDays: number;
  proformaTerms: string | null;
  saleOrderTerms: string | null;
  challanTerms: string | null;
  advancePercent: number | null;
  reserveStock: boolean;
}

export interface SalesDocsSummary {
  proformas: { open: { count: number; value: number }; drafts: number; advanceHeld: number };
  saleOrders: { open: { count: number; value: number }; overdue: number; advanceHeld: number };
  challans: { out: { count: number; value: number }; overdue: number; toBill: { count: number; value: number } };
}

export interface SalesDocListResponse<T> extends Paged<T> {
  limit: number;
  offset: number;
  totals: { count: number; value: number; advance?: number };
  facets?: { status?: Record<string, number> };
}

export interface LinkedSalesDocs {
  proforma: ProformaSummary | null;
  saleOrders: SaleOrderSummary[];
  challans: ChallanSummary[];
}

export type SalesDocChannel = "whatsapp" | "sms" | "email";

export interface AdvanceInput {
  amount: number;
  method: PaymentMethod;
  date?: string;
  reference?: string;
  note?: string;
}

/** What the customer sees at /d/:token (no ids). */
export interface PublicSalesDocResponse {
  kind: SalesDocKind;
  token: string;
  doc: {
    kind: SalesDocKind;
    number: string;
    status: string;
    date: string;
    customer: InvoiceParty;
    seller: Partial<Invoice["seller"]>;
    placeOfSupply: string;
    interState: boolean;
    lines: LineTotals[];
    totals: Invoice["totals"];
    amountInWords: string;
    notes: string | null;
    terms: string | null;
    validUntil?: string | null;
    deliveryText?: string | null;
    advancePercent?: number | null;
    advanceAmount?: number;
    advanceReceived?: number;
    quotationNumber?: string | null;
    promisedDate?: string | null;
    customerRef?: string | null;
    progress?: { description: string; unit: string | null; ordered: number; delivered: number }[];
    reason?: ChallanReason;
    returnBy?: string | null;
    shipTo?: string | null;
    transport?: ChallanTransport;
    ewbNo?: string | null;
    ewbDate?: string | null;
    saleOrderNumber?: string | null;
    invoiceNumber?: string | null;
    returned?: { description: string; unit: string | null; qty: number }[];
  };
  branding: { appName: string | null; logoUrl: string | null; css: string };
}

/** What the on-screen document (components/invoice-document.tsx) prints for these kinds; every text already translated. */
export interface SalesDocMeta {
  title: string;
  numberLabel: string;
  forLabel: string;
  meta: [string, string][];
  totals: [string, string][];
  blocks: { label: string; text: string }[];
  terms: string | null;
  note: string;
  stamp: string | null;
  showBank: boolean;
  receiverSign: { text: string; label: string } | null;
  totalLabel?: string;
}

/** Anything shaped like a document: drawn by the bill document with nothing paid and no due date. */
export interface DocShape {
  id?: string;
  number: string;
  date: string;
  customer: InvoiceParty;
  seller: Partial<Invoice["seller"]>;
  placeOfSupply: string;
  interState: boolean;
  lines: LineTotals[];
  totals: Invoice["totals"];
  amountInWords: string;
  notes: string | null;
  status: string;
}

export function salesDocAsInvoice(d: DocShape): Invoice {
  return {
    id: d.id ?? "",
    number: d.number,
    branchId: null,
    status: d.status === "cancelled" ? "cancelled" : "issued",
    date: d.date,
    dueDate: null,
    customerName: d.customer.name,
    total: d.totals.total,
    paid: 0,
    credited: 0,
    balance: 0,
    isOverdue: false,
    customerId: null,
    customer: d.customer,
    seller: d.seller,
    placeOfSupply: d.placeOfSupply,
    interState: d.interState,
    lines: d.lines,
    totals: d.totals,
    amountInWords: d.amountInWords,
    notes: d.notes,
    payments: [],
    shareToken: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: "",
    updatedAt: "",
  } as unknown as Invoice;
}

/** Remaining quantity rounded to 3 decimals (quantities may be fractional: kg, m). */
export const round3 = (n: number) => Math.round(n * 1000) / 1000;
