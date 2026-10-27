import type { Invoice, InvoiceInput, InvoiceParty, ISODate, LineTotals, Paged } from "./types";

/** Quotation types: mirror @srirealtime/invoices quotations.ts (docs/quotations.md). Money is in paise. */

export const QUOTATION_STATUSES = ["draft", "sent", "accepted", "declined", "cancelled", "converted"] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];
/** Stored statuses plus the derived "expired" (sent and past valid-until). */
export const QUOTATION_DISPLAY_STATUSES = [...QUOTATION_STATUSES, "expired"] as const;
export type QuotationDisplayStatus = (typeof QUOTATION_DISPLAY_STATUSES)[number];

export interface QuotationSummary {
  id: string;
  groupId: string;
  number: string;
  rev: number;
  latest: boolean;
  status: QuotationStatus;
  displayStatus: QuotationDisplayStatus;
  date: string;
  validUntil: string;
  customerId: string | null;
  customerName: string;
  branchId: string | null;
  total: number;
  daysLeft: number | null;
  createdAt: ISODate;
}

export interface QuotationEvent {
  at: ISODate;
  type: "created" | "revised" | "sent" | "viewed" | "accepted" | "declined" | "converted" | "cancelled";
  by?: string | null;
  note?: string | null;
  rev: number;
}

export interface QuotationConverted {
  /** A bill, an online-store order, or a proforma invoice / sale order (docs/sales-documents.md). */
  kind: "invoice" | "order" | "proforma" | "sale_order";
  id: string;
  number: string | null;
  at: ISODate | null;
  missing: boolean;
}

export interface Quotation extends QuotationSummary {
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
  hasShareLink: boolean;
  sentAt: ISODate | null;
  respondedAt: ISODate | null;
  respondedBy: string | null;
  responseNote: string | null;
  cancelledAt: ISODate | null;
  cancelReason: string | null;
  converted: QuotationConverted | null;
  events: QuotationEvent[];
  revisions: QuotationSummary[];
  canEdit: boolean;
  canRevise: boolean;
  canSend: boolean;
  canConvert: boolean;
  canCancel: boolean;
  updatedAt: ISODate;
}

export interface QuotationInput {
  customerId?: string | null;
  customer?: InvoiceInput["customer"];
  date?: string;
  validUntil?: string | null;
  placeOfSupply?: string | null;
  lines: InvoiceInput["lines"];
  notes?: string | null;
  terms?: string | null;
  deliveryText?: string | null;
  advancePercent?: number | null;
}

export type QuotationChannel = "whatsapp" | "sms" | "email";

export interface QuotationSettings {
  prefix: string;
  validityDays: number;
  terms: string | null;
  /** Advance % new quotations start with; null = none. */
  advancePercent: number | null;
}

export interface QuotationSummaryReport {
  awaiting: { count: number; value: number };
  toConvert: { count: number; value: number };
  open: { count: number; value: number };
  expiringSoon: number;
  drafts: number;
  acceptedThisMonth: { count: number; value: number };
  convertedThisMonth: { count: number; value: number };
  conversionRate: number;
  sentLast90: number;
}

export interface QuotationListResponse extends Paged<QuotationSummary> {
  limit: number;
  offset: number;
  totals: { count: number; value: number };
  facets?: { status?: Record<string, number> };
}

export interface QuotationConvertResult {
  quotation: Quotation;
  invoice?: Invoice;
  order?: { id: string; number: string };
  salesDoc?: { kind: "proforma" | "sale_order"; id: string; number: string };
  advanceRecorded: number;
}

export interface QuotationConvertInput {
  to: "invoice" | "order" | "proforma" | "sale_order";
  issue?: boolean;
  recordAdvance?: boolean;
  advanceMethod?: "cash" | "upi" | "card" | "bank" | "cheque" | "other";
  advanceReference?: string;
}

/** What the customer sees at /q/:token. */
export interface PublicQuotation extends Omit<Quotation, "id" | "groupId" | "branchId" | "customerId" | "hasShareLink" | "canEdit" | "canRevise" | "canSend" | "canConvert" | "canCancel" | "cancelReason" | "events" | "revisions" | "converted" | "seller"> {
  seller: Partial<Invoice["seller"]>;
  canRespond: boolean;
  respondProblem: { code: string; message: string } | null;
  latestToken: string | null;
}

export interface PublicQuotationResponse {
  quotation: PublicQuotation;
  branding: { appName: string | null; logoUrl: string | null; css: string };
}

export interface LinkedQuotation extends QuotationSummary {
  advanceAmount: number;
  advancePercent: number | null;
  kind: "invoice" | "order";
}

/** What the printable document needs on top of the bill-shaped data (see components/invoice-document.tsx). */
export interface QuotationDocMeta {
  rev: number;
  validUntil: string;
  terms: string | null;
  deliveryText: string | null;
  advancePercent: number | null;
  advanceAmount: number;
  displayStatus: QuotationDisplayStatus;
  acceptedBy: string | null;
  acceptedAt: string | null;
}

type DocSource = Pick<Quotation, "number" | "date" | "customer" | "placeOfSupply" | "interState" | "lines" | "totals" | "amountInWords" | "notes" | "total" | "createdAt" | "updatedAt" | "status"> & {
  seller: Partial<Invoice["seller"]>;
  customerId?: string | null;
  id?: string;
};

/** A quotation in the shape the printable bill document draws (nothing paid, no due date). */
export function quotationAsInvoice(q: DocSource): Invoice {
  return {
    id: q.id ?? "",
    number: q.number,
    branchId: null,
    status: q.status === "cancelled" ? "cancelled" : "issued",
    date: q.date,
    dueDate: null,
    customerName: q.customer.name,
    total: q.total,
    paid: 0,
    credited: 0,
    balance: 0,
    isOverdue: false,
    customerId: q.customerId ?? null,
    customer: q.customer,
    seller: q.seller,
    placeOfSupply: q.placeOfSupply,
    interState: q.interState,
    lines: q.lines,
    totals: q.totals,
    amountInWords: q.amountInWords,
    notes: q.notes,
    payments: [],
    shareToken: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
  } as Invoice;
}

export function quotationDocMeta(q: Pick<Quotation, "rev" | "validUntil" | "terms" | "deliveryText" | "advancePercent" | "advanceAmount" | "displayStatus" | "respondedBy" | "respondedAt" | "status">): QuotationDocMeta {
  const accepted = q.status === "accepted" || (q.status === "converted" && !!q.respondedAt);
  return {
    rev: q.rev,
    validUntil: q.validUntil,
    terms: q.terms,
    deliveryText: q.deliveryText,
    advancePercent: q.advancePercent,
    advanceAmount: q.advanceAmount,
    displayStatus: q.displayStatus,
    acceptedBy: accepted ? q.respondedBy : null,
    acceptedAt: accepted ? q.respondedAt : null,
  };
}
