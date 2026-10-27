/**
 * What GST filing reads from the rest of the product. Packages never import each other, so apps/api (kit-gstfiling.ts)
 * implements these ports over the invoices, inventory and expenses services. Everything is plain data: money is integer
 * paise, dates "YYYY-MM-DD" (IST). Nothing here changes any money logic of the source modules.
 */

export interface SalesLineSrc {
  description: string;
  hsn?: string | null;
  unit?: string | null;
  qty: number;
  /** Percent. */
  gstRate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}

/** A bill or credit note as the e-invoice module sees it (the einvoice `EInvoiceSource` is assignable to this). */
export interface SalesDocSrc {
  id: string;
  /** Null for drafts (never passed). */
  number: string | null;
  /** draft | issued | partially_paid | paid | cancelled */
  status: string;
  date: string;
  /** INV (default), CRN, DBN. */
  docType?: "INV" | "CRN" | "DBN";
  seller: { gstin: string | null; stateCode: string | null };
  buyer: { name: string | null; gstin: string | null; stateCode: string | null };
  placeOfSupply: string;
  interState: boolean;
  lines: SalesLineSrc[];
  totals: { taxable: number; cgst: number; sgst: number; igst: number; roundOff: number; total: number };
  precedingDoc?: { number: string; date: string; total?: number } | null;
  /** Export / SEZ supply of the bill (docs/recurring-export-gstin.md); absent = domestic. */
  supplyType?: "domestic" | "export_wpay" | "export_wopay" | "sez_wpay" | "sez_wopay" | null;
  /** Shipping bill no. / date (YYYY-MM-DD) / port code of an export (GSTR-1 table 6A). */
  exportDetails?: { shippingBillNo?: string | null; shippingBillDate?: string | null; portCode?: string | null } | null;
}

export interface PurchaseLineSrc {
  description: string;
  hsn?: string | null;
  qty: number;
  gstRate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}

/** A supplier bill. */
export interface PurchaseSrc {
  id: string;
  billNumber: string;
  date: string;
  status: "recorded" | "cancelled";
  imported: boolean;
  supplierId: string | null;
  supplierName: string;
  supplierGstin: string | null;
  supplierState: string | null;
  placeOfSupply: string;
  interState: boolean;
  lines: PurchaseLineSrc[];
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  amountPaid: number;
  dueDate: string | null;
}

/** A debit note the shop issued to a supplier (goods returned): reduces the credit claimed on the bill. */
export interface PurchaseReturnSrc {
  id: string;
  number: string;
  date: string;
  status: "issued" | "cancelled";
  imported: boolean;
  purchaseId: string;
  billNumber: string | null;
  supplierId: string | null;
  supplierName: string;
  supplierGstin: string | null;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export interface ExpenseSrc {
  id: string;
  date: string;
  status: "recorded" | "cancelled";
  categoryName: string;
  /** Paise including GST. */
  amount: number;
  gstRate: number;
  /** Paise of GST inside `amount`. */
  gstAmount: number;
  vendorName: string | null;
  vendorGstin: string | null;
  reference: string | null;
}

export interface ShopProfile {
  gstin: string | null;
  legalName: string | null;
  stateCode: string | null;
}

/** A number taken from the invoice series for offline billing that no bill holds (unused / voided). */
export interface VoidedNumberSrc {
  number: string;
  prefix: string;
  seq: number;
  /** IST date it was released. */
  date: string;
  reason: string;
}

export interface GstSourcesPort {
  profile(tenantId: string): Promise<ShopProfile>;
  /** Every numbered bill and credit note dated in the range; no drafts; imported (history) bills left out. */
  sales(tenantId: string, range: { from: string; to: string }): Promise<SalesDocSrc[]>;
  purchases(tenantId: string, range: { from: string; to: string }): Promise<PurchaseSrc[]>;
  /** Purchase bills by id (a debit note's or a 2B match's bill, which can be outside the range). */
  purchasesByIds?(tenantId: string, ids: string[]): Promise<PurchaseSrc[]>;
  purchaseReturns(tenantId: string, range: { from: string; to: string }): Promise<PurchaseReturnSrc[]>;
  expenses(tenantId: string, range: { from: string; to: string }): Promise<ExpenseSrc[]>;
  expensesByIds?(tenantId: string, ids: string[]): Promise<ExpenseSrc[]>;
  /** Voided / unused offline invoice numbers released in the range. */
  voidedNumbers?(tenantId: string, range: { from: string; to: string }): Promise<VoidedNumberSrc[]>;
}

/** The accounting module's GST ledger totals for a range, when accounting is on. */
export interface LedgerPort {
  isEnabled(tenantId: string): Promise<boolean>;
  gstLedger(
    tenantId: string,
    range: { from: string; to: string },
  ): Promise<{ output: { cgst: number; sgst: number; igst: number; cess: number }; input: { cgst: number; sgst: number; igst: number; cess: number } }>;
}

/** The existing GSTR-1 builder (einvoice module): the sections that already exist (B2B, B2CL, B2CS, CDNR, CDNUR, HSN). */
export interface Gstr1BasePort {
  /** `period` is the portal's MMYYYY (the quarter's last month for a quarterly return); `from`/`to` widen it to a quarter. */
  build(
    tenantId: string,
    opts: { period: string; from?: string; to?: string; gstin?: string | null },
  ): Promise<{ json: Record<string, unknown>; warnings: string[]; counts: Record<string, number>; filename: string }>;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}
export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };
