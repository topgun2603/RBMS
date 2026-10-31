import type { InvoiceTotals, LineTotals } from "@rbms/gst";

/**
 * Data shapes the built-in renderers need. They mirror (structurally) the invoices/inventory/orders services'
 * own types, so the kit can pass those objects straight through; this package never imports them.
 */

export type Paper = "A4" | "80mm" | "58mm" | "A6";
export type DocLocale = "en" | "ta";

/** The shop's details printed on documents (invoices' PublicSeller is assignable to it). */
export interface DocSeller {
  /** "composition" from `compositionFrom` on: bills are Bills of Supply with no tax. */
  taxScheme?: "regular" | "composition" | null;
  compositionFrom?: string | null;
  legalName: string | null;
  gstin: string | null;
  address: string | null;
  city: string | null;
  pincode: string | null;
  stateCode: string | null;
  phone: string | null;
  email: string | null;
  terms?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
  ifsc?: string | null;
  upiId?: string | null;
}

export interface DocParty {
  name: string;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  address?: string | null;
  stateCode?: string | null;
  /** ISO 3166 alpha-2 country of a buyer outside India. */
  country?: string | null;
}

/** Foreign-currency figures of an export bill (minor units; invoices' `ForeignAmounts`). */
export interface DocForeign {
  currency: string;
  exchangeRate: number;
  lines: { rate: number; discount: number; amount: number; taxable: number }[];
  subtotal: number;
  discount: number;
  taxable: number;
  tax: number;
  total: number;
}

/** Shipping bill and the frozen LUT of an export / SEZ bill. */
export interface DocExportDetails {
  shippingBillNo?: string | null;
  shippingBillDate?: string | null;
  portCode?: string | null;
  lutNumber?: string | null;
  lutDate?: string | null;
}

/** A GST invoice (invoices' `Invoice` and `PublicInvoice` are assignable to it). */
export interface InvoiceDocData {
  id?: string;
  number: string | null;
  status: "draft" | "issued" | "partially_paid" | "paid" | "cancelled" | (string & {});
  date: string;
  dueDate: string | null;
  customer: DocParty;
  seller: DocSeller;
  placeOfSupply: string;
  interState: boolean;
  lines: LineTotals[];
  totals: Omit<InvoiceTotals, "lines">;
  amountInWords?: string | null;
  notes: string | null;
  paid: number;
  balance: number;
  cancelReason?: string | null;
  updatedAt?: Date | string | null;
  /** GST e-invoice registration (from the einvoice module); printed as an "e-Invoice" block with the signed QR. */
  einvoice?: InvoiceEinvoice | null;
  /** Export / SEZ supply (docs/recurring-export-gstin.md): "export_wpay" | "export_wopay" | "sez_wpay" | "sez_wopay". */
  supplyType?: string | null;
  /** A foreign-currency bill: both currencies are printed (rupees stay the tax figures). */
  foreign?: DocForeign | null;
  exportDetails?: DocExportDetails | null;
}

/** IRN details of an e-invoice. Dates are ISO strings, "YYYY-MM-DD HH:mm:ss" (IST) or Dates. */
export interface InvoiceEinvoice {
  irn: string;
  ackNo: string | null;
  ackDate: string | Date | null;
  /** The signed QR payload from the IRP (a JWT, often ~1 KB). */
  signedQrCode: string | null;
  ewbNo?: string | null;
  ewbValidTill?: string | Date | null;
  /** True for the mock driver: printed with a clear "not valid" label. */
  mock: boolean;
}

/** A quotation (invoices' `QuotationDocData` is assignable to it). */
export interface QuotationDocData {
  id?: string;
  number: string;
  rev: number;
  /** "draft" | "sent" | "accepted" | "declined" | "expired" | "converted" | "cancelled"; expired / declined / cancelled get a stamp. */
  status: string;
  date: string;
  validUntil: string;
  customer: DocParty;
  seller: DocSeller;
  placeOfSupply: string;
  interState: boolean;
  lines: LineTotals[];
  totals: Omit<InvoiceTotals, "lines">;
  amountInWords?: string | null;
  notes: string | null;
  terms: string | null;
  deliveryText: string | null;
  advancePercent: number | null;
  advanceAmount: number;
  acceptedBy: string | null;
  acceptedAt: string | null;
  updatedAt?: Date | string | null;
}

/** Proforma invoice, sale order or delivery challan (invoices' `SalesDocData` is assignable to it; docs/sales-documents.md). */
export interface SalesDocDocData {
  kind: "proforma" | "sale_order" | "challan";
  id?: string;
  number: string;
  /** Proforma: draft | issued | expired | converted | cancelled. Sale order: open ... invoiced | cancelled. Challan: issued ... invoiced | cancelled. */
  status: string;
  date: string;
  customer: DocParty;
  seller: DocSeller;
  placeOfSupply: string;
  interState: boolean;
  lines: LineTotals[];
  totals: Omit<InvoiceTotals, "lines">;
  amountInWords?: string | null;
  notes: string | null;
  terms: string | null;
  updatedAt?: Date | string | null;
  validUntil?: string | null;
  deliveryText?: string | null;
  advancePercent?: number | null;
  advanceAmount?: number;
  advanceReceived?: number;
  quotationNumber?: string | null;
  promisedDate?: string | null;
  customerRef?: string | null;
  progress?: { description: string; unit: string | null; ordered: number; delivered: number }[];
  reason?: string;
  returnBy?: string | null;
  shipTo?: string | null;
  transport?: {
    mode?: string | null;
    transporterName?: string | null;
    transporterId?: string | null;
    vehicleNo?: string | null;
    docNo?: string | null;
    docDate?: string | null;
    distanceKm?: number | null;
  };
  ewbNo?: string | null;
  ewbDate?: string | null;
  saleOrderNumber?: string | null;
  invoiceNumber?: string | null;
  returned?: { description: string; unit: string | null; qty: number }[];
}

export interface DocLedgerEntry {
  date: string;
  type: "opening" | "invoice" | "payment" | "receipt" | "cancel" | (string & {});
  number: string | null;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

/** A customer statement (credit book ledger). */
export interface StatementDocData {
  customer: DocParty & { id?: string };
  seller: DocSeller;
  ledger: { openingBalance: number; entries: DocLedgerEntry[]; closingBalance: number };
  from?: string | null;
  to?: string | null;
  /** "YYYY-MM-DD"; defaults to `to`, else the last entry's date. */
  generatedOn?: string | null;
}

export interface DocAddress {
  name?: string | null;
  phone?: string | null;
  line1?: string | null;
  line2?: string | null;
  landmark?: string | null;
  city?: string | null;
  district?: string | null;
  state?: string | null;
  stateCode?: string | null;
  pincode?: string | null;
  country?: string | null;
}

export interface OrderDocLine {
  name: string;
  sku?: string | null;
  qty: number;
  unit?: string | null;
  price?: number | null;
  total?: number | null;
}

/** An order for packing slips and shipping labels. */
export interface OrderDocData {
  id?: string;
  number: string;
  /** "YYYY-MM-DD" or a timestamp. */
  placedAt: string | Date;
  customer: { name: string; phone?: string | null; email?: string | null };
  shippingAddress: DocAddress | null;
  lines: OrderDocLine[];
  total: number;
  paymentStatus?: string | null;
  paymentMethod?: string | null;
  fulfillment?: { carrier?: string | null; trackingNumber?: string | null } | null;
  customerNote?: string | null;
  notes?: string | null;
  /** The shop (ship-from). */
  seller: DocSeller;
  /** Parcel weight in grams, if known. */
  weightGrams?: number | null;
  updatedAt?: Date | string | null;
}

/** A supplier bill recorded in inventory (inventory's `Purchase` plus the shop's details). */
export interface PurchaseDocData {
  id?: string;
  billNumber: string;
  date: string;
  supplier: { name: string; gstin?: string | null; stateCode?: string | null; phone?: string | null; address?: string | null };
  placeOfSupply: string;
  interState: boolean;
  lines: LineTotals[];
  totals: Omit<InvoiceTotals, "lines">;
  total: number;
  paid: boolean;
  status: "recorded" | "cancelled" | (string & {});
  notes: string | null;
  /** The buying shop. */
  shop: DocSeller;
  updatedAt?: Date | string | null;
}

/** A purchase order sent to a supplier (inventory's `PurchaseOrderRow` plus the shop's details). */
export interface PurchaseOrderDocData {
  id?: string;
  number: string;
  status: "draft" | "sent" | "partially_received" | "received" | "cancelled" | (string & {});
  date: string;
  expectedDate: string | null;
  supplier: { name: string; gstin?: string | null; stateCode?: string | null; phone?: string | null; address?: string | null };
  placeOfSupply: string;
  interState: boolean;
  lines: LineTotals[];
  totals: Omit<InvoiceTotals, "lines">;
  total: number;
  notes: string | null;
  /** The buying shop. */
  shop: DocSeller;
  updatedAt?: Date | string | null;
}

/** A GST credit note against an invoice (invoices' `CreditNote` is assignable to it). */
export interface CreditNoteDocData {
  id?: string;
  number: string;
  status: "issued" | "cancelled" | (string & {});
  date: string;
  invoiceNumber: string;
  invoiceDate: string;
  customer: DocParty;
  seller: DocSeller;
  placeOfSupply: string;
  interState: boolean;
  lines: LineTotals[];
  totals: Omit<InvoiceTotals, "lines">;
  total: number;
  amountInWords?: string | null;
  /** "return" | "price_correction" | "discount" | "other". */
  reason: string;
  note: string | null;
  /** "cash" | "upi" | "card" | "credit_book" | "none". */
  refundMode: string;
  refundAmount: number;
  cancelReason?: string | null;
  updatedAt?: Date | string | null;
  /** IRN of the credit note (document type CRN), when generated. */
  einvoice?: InvoiceEinvoice | null;
}

/** A debit note to a customer (CGST s.34(3)): the value of an earlier bill goes up. */
export interface DebitNoteDocData {
  id?: string;
  number: string;
  status: "issued" | "cancelled" | (string & {});
  date: string;
  invoiceNumber: string;
  invoiceDate: string;
  customer: DocParty;
  seller: DocSeller;
  placeOfSupply: string;
  interState: boolean;
  lines: LineTotals[];
  totals: Omit<InvoiceTotals, "lines">;
  total: number;
  amountInWords?: string | null;
  /** "price_revision" | "short_billed" | "freight" | "other_charges" | "other". */
  reason: string;
  note: string | null;
  cancelReason?: string | null;
  updatedAt?: Date | string | null;
  /** IRN of the debit note (document type DBN), when generated. */
  einvoice?: InvoiceEinvoice | null;
}

export interface DebitNoteDocPort {
  debitNote(tenantId: string, id: string): Promise<DebitNoteDocData | null>;
}

export interface TillDocMethodRow {
  method: string;
  amount: number;
  count: number;
}

/** A POS till session for the Z report (invoices' `TillSession` + its report + the shop). */
export interface TillDocData {
  id?: string;
  register: string;
  branchName?: string | null;
  status: "open" | "closed" | (string & {});
  date: string;
  openedAt: Date | string;
  openedByName: string | null;
  closedAt: Date | string | null;
  closedByName: string | null;
  openingCash: number;
  cashEntries: { amount: number; category?: string; reason: string; byName?: string | null; at: string }[];
  /** Z number of the register (1 = Z1), set at close. */
  zNumber?: number | null;
  /** Who has the drawer now. */
  cashierName?: string | null;
  handovers?: { at: string; fromName: string | null; toName: string; expected: number; counted: number; difference: number; note: string | null; approvedByName: string | null }[];
  differenceReason?: string | null;
  closeApprovedByName?: string | null;
  closingCount: Record<string, number> | null;
  expectedCash: number | null;
  countedCash: number | null;
  difference: number | null;
  note: string | null;
  report: {
    bills: { count: number; total: number; cancelled: number };
    payments: TillDocMethodRow[];
    refunds: TillDocMethodRow[];
    creditNotes: { count: number; total: number };
    onCredit: number;
    collected: number;
    refunded: number;
    cash: { opening: number; sales: number; refunds: number; cashIn: number; cashOut: number; handoverAdjust?: number; expected: number };
    voids?: { count: number; total: number };
    discounts?: { total: number; bills: number };
    taxByRate?: { gstRate: number; taxable: number; cgst: number; sgst: number; igst: number }[];
    returnsTaxByRate?: { gstRate: number; taxable: number; cgst: number; sgst: number; igst: number }[];
    billRange?: { from: string | null; to: string | null };
    cashByCategory?: { category: string; cashIn: number; cashOut: number; count: number }[];
  };
  seller: DocSeller;
  updatedAt?: Date | string | null;
}

export interface Branding {
  appName: string | null;
  logoUrl: string | null;
  /** Extra CSS from the tenant's branding (sanitised before use). */
  css: string;
  /** Primary colour, e.g. "#0f766e". */
  primary: string | null;
}

export interface RenderContext {
  locale: DocLocale;
  branding: Branding;
}

// ------------------------------------------------------------------ ports (implemented in apps/api kit)

export interface InvoiceDocPort {
  /** A staff-visible invoice of the tenant, or null when it doesn't exist. */
  invoice(tenantId: string, id: string): Promise<InvoiceDocData | null>;
  /** The invoice behind a public share token (null = unknown token or the shop's feature is off). */
  publicInvoice(token: string): Promise<{ tenantId?: string | null; invoice: InvoiceDocData; branding?: Partial<Branding> | null } | null>;
}

export interface QuotationDocPort {
  /** A quotation of the tenant (any revision), or null. */
  quotation(tenantId: string, id: string): Promise<QuotationDocData | null>;
  /** The quotation behind a public share token (null = unknown token, a draft, or the shop's feature is off). */
  publicQuotation(token: string): Promise<{ tenantId?: string | null; quotation: QuotationDocData; branding?: Partial<Branding> | null } | null>;
}

export interface SalesDocPort {
  /** A proforma invoice, sale order or delivery challan of the tenant, or null. */
  doc(kind: SalesDocDocData["kind"], tenantId: string, id: string): Promise<SalesDocDocData | null>;
  /** The document behind a public share token (null = unknown token, a draft, or the shop's feature is off). */
  publicDoc(token: string): Promise<{ tenantId?: string | null; doc: SalesDocDocData; branding?: Partial<Branding> | null } | null>;
}

export interface StatementDocPort {
  /** Ledger of a customer for the range (default: the service's own default range). */
  statement(tenantId: string, customerId: string, range: { from?: string; to?: string }): Promise<StatementDocData | null>;
}

export interface OrderDocPort {
  order(tenantId: string, id: string): Promise<OrderDocData | null>;
}

export interface CreditNoteDocPort {
  creditNote(tenantId: string, id: string): Promise<CreditNoteDocData | null>;
}

export interface TillDocPort {
  session(tenantId: string, id: string): Promise<TillDocData | null>;
}

export interface PurchaseDocPort {
  purchase(tenantId: string, id: string): Promise<PurchaseDocData | null>;
}

export interface PurchaseOrderDocPort {
  purchaseOrder(tenantId: string, id: string): Promise<PurchaseOrderDocData | null>;
}

export interface BrandingPort {
  get(tenantId: string): Promise<Partial<Branding> | null>;
}

export interface LoggerPort {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };
