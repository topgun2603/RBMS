export type { FeatureGatePort } from "@srirealtime/core";

/** Document types of the NIC schema: tax invoices (`INV`) and credit notes (`CRN`) come from the invoices module. */
export const DOC_TYPES = ["INV", "CRN", "DBN"] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** Party details as the invoices module knows them (seller profile / customer snapshot), plus optional extras. */
export interface PartySource {
  /** Legal name (seller: `legalName`, buyer: customer name). */
  name: string | null;
  tradeName?: string | null;
  gstin: string | null;
  /** Free-text address; lines are split on newlines / commas into Addr1 / Addr2. */
  address: string | null;
  /** City / town (NIC `Loc`). Falls back to the last address part. */
  city?: string | null;
  /** 6-digit pincode. Falls back to a 6-digit number found in the address. */
  pincode?: string | null;
  /** 2-digit GST state code (falls back to the GSTIN's). */
  stateCode: string | null;
  phone?: string | null;
  email?: string | null;
}

/** One bill line, mirroring the invoices module's `LineTotals` (money in paise). */
export interface SourceLine {
  description: string;
  hsn?: string | null;
  /** Up to 3 decimals. */
  qty: number;
  unit?: string | null;
  /** Alternate unit (1 box = 12 pcs → 12): GSTR-1's HSN summary counts `qty × unitFactor` of `baseUnit`. */
  unitFactor?: number | null;
  baseUnit?: string | null;
  /** Paise per unit, GST-exclusive. */
  rate: number;
  /** Paise, whole line. */
  discount?: number | null;
  gstRate: number;
  /** round(qty × rate). */
  amount: number;
  /** amount − discount. */
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

/** What e-invoicing needs to know about one bill. Supplied by `InvoiceDataPort` (kit maps the invoices service). */
export interface EInvoiceSource {
  id: string;
  /** Bill number, e.g. "INV/26-27/0001"; null for drafts. */
  number: string | null;
  /** Invoices status: `draft|issued|partially_paid|paid|cancelled`. */
  status: string;
  /** "YYYY-MM-DD". */
  date: string;
  /** Default "INV". */
  docType?: DocType;
  seller: PartySource;
  buyer: PartySource;
  /** 2-digit place of supply. */
  placeOfSupply: string;
  interState: boolean;
  lines: SourceLine[];
  totals: {
    taxable: number;
    cgst: number;
    sgst: number;
    igst: number;
    /** Paise added/removed to reach the rounded total. */
    roundOff: number;
    /** Grand total (paise). */
    total: number;
  };
  /** Paise of invoice-level other charges (freight etc.) already inside `totals.total`. Default 0. */
  otherCharges?: number;
  /** For credit / debit notes: the original invoice (its grand total decides CDNUR B2CL vs B2CS). */
  precedingDoc?: { number: string; date: string; total?: number } | null;
}

/**
 * Implemented in apps/api/src/kit.ts over the invoices service. `listForPeriod` returns every numbered bill dated
 * within [from, to] — issued, paid and **cancelled** (cancelled ones only count in GSTR-1 `doc_issue`); no drafts.
 */
export interface InvoiceDataPort {
  getInvoice(tenantId: string, invoiceId: string): Promise<EInvoiceSource | null>;
  listForPeriod(tenantId: string, range: { from: string; to: string }): Promise<EInvoiceSource[]>;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };
