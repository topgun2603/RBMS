/**
 * What "Ask your shop" may read. The API host implements these over the existing services and report functions
 * (apps/api/src/kit-ai-ask.ts); evals and tests implement them over a fixture. Every method takes the tenant id first
 * and is READ-ONLY. Money is paise. A method returns `null` when the shop does not have that module switched on
 * ("not available"), and the tool says so to the model.
 */
export interface DateRange {
  from: string;
  to: string;
  branchId?: string;
}

export interface SalesFigures {
  /** Bills issued in the range (credit notes are not counted here). */
  bills: number;
  creditNotes: number;
  /** All net of credit notes, paise. */
  taxable: number;
  tax: number;
  total: number;
  /** Paid against those bills so far. */
  paid: number;
  byDay: { date: string; bills: number; total: number }[];
}

export interface AskPorts {
  /** Today's IST date, "YYYY-MM-DD". */
  today(): string;
  sales(tenantId: string, range: DateRange): Promise<SalesFigures | null>;
  /** Money received in the range by method (cash, upi, card...). */
  payments(tenantId: string, range: DateRange): Promise<{ byMethod: { method: string; amount: number; count: number }[] } | null>;
  topItems(tenantId: string, range: DateRange, limit: number): Promise<{ name: string; qty: number; unit: string; taxable: number }[] | null>;
  topCustomers(tenantId: string, range: DateRange, limit: number): Promise<{ name: string; bills: number; total: number }[] | null>;
  /** Receivables ageing as of a day: buckets and customers, biggest first. */
  ageing(tenantId: string, q: { asOf?: string; limit: number }): Promise<{
    asOf: string;
    buckets: { key: string; amount: number; count: number }[];
    customers: { name: string; current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number; total: number }[];
    totalCustomers: number;
  } | null>;
  /** Customers with money due, biggest first. `phone` is whatever the shop stored: the tool masks it. */
  creditBook(tenantId: string, q: { limit: number }): Promise<{
    totals: { receivable: number; customersWithDues: number };
    items: { name: string; phone: string | null; balance: number; overdue: number; oldestDue: string | null }[];
  } | null>;
  stock(tenantId: string, q: { status: "low" | "out"; limit: number }): Promise<{
    totals: { items: number; stockValue: number; lowCount: number; outCount: number };
    items: { name: string; qty: number; unit: string; reorderLevel: number; value: number }[];
  } | null>;
  /** Tracked items still on the shelf, least sold first, with what sold in the last `days` days. */
  slowStock(tenantId: string, q: { days: number; limit: number; onlyUnsold: boolean }): Promise<{
    asOf: string;
    totalOnShelf: number;
    items: { name: string; qty: number; unit: string; value: number; soldQty: number; lastSold: string | null }[];
  } | null>;
  expiry(tenantId: string, q: { withinDays: number; limit: number }): Promise<{
    source: "pharmacy" | "stock";
    expired: { batches: number; qty: number; value: number };
    expiring: { batches: number; qty: number; value: number };
    items: { item: string; batchNo: string; expiry: string; daysLeft: number; qty: number }[];
  } | null>;
  purchases(tenantId: string, range: DateRange): Promise<{
    bills: number;
    taxable: number;
    itc: number;
    total: number;
    bySupplier: { name: string; bills: number; total: number }[];
  } | null>;
  payables(tenantId: string, q: { limit: number }): Promise<{
    asOf: string;
    payable: number;
    overdue: number;
    dueSoon: number;
    suppliers: { name: string; total: number; overdue: number }[];
  } | null>;
  expenses(tenantId: string, range: DateRange): Promise<{
    total: number;
    gst: number;
    count: number;
    byCategory: { name: string; total: number; count: number }[];
  } | null>;
  /** The profit report the app computes: sales (taxable) minus purchases (taxable) minus expenses. */
  profit(tenantId: string, range: DateRange): Promise<{
    salesTaxable: number;
    purchasesTaxable: number;
    expensesTotal: number;
    expensesItc: number;
    grossProfit: number;
    netProfit: number;
    gstOutput: number;
    gstItc: number;
    gstPayable: number;
  } | null>;
  gst(tenantId: string, range: DateRange): Promise<GstFigures | null>;
  /** The GSTR-1 check for a return month ("MMYYYY"): how many documents per section and the warnings the export raised. */
  gstr1Check(tenantId: string, period: string): Promise<{ counts: { b2b: number; b2cl: number; b2cs: number; cdnr: number; cdnur: number; cancelled: number; skipped: number }; warnings: string[] } | null>;
  salesByStaff(tenantId: string, range: DateRange): Promise<{ name: string; bills: number; total: number }[] | null>;
  /** One row per branch; null when the shop does not use branches. */
  salesByBranch(tenantId: string, range: DateRange): Promise<{ name: string; bills: number; total: number }[] | null>;
}

/** Computed GSTR-1 style figures for a range (paise): what the GST report page shows. */
export interface GstFigures {
  invoices: number;
  creditNotes: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  byRate: { rate: number; taxable: number; cgst: number; sgst: number; igst: number }[];
  sections: { b2b: number; b2cl: number; b2cs: number; cdnr: number; cdnur: number };
  nilRated: number;
}
