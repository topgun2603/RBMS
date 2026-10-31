/**
 * What the books read from the rest of the product. Packages never import each other, so apps/api (kit.ts) implements
 * these ports over the invoices, inventory and expenses services/tables. Every method returns the documents of ONE shop
 * as plain data; the posting rules (rules.ts) are pure functions over them. Money is integer paise, dates "YYYY-MM-DD"
 * (IST). Nothing here changes any money logic of the source modules.
 */

export type MoneyMethod = "cash" | "upi" | "card" | "bank" | "cheque" | "other";

export interface TaxParts {
  cgst: number;
  sgst: number;
  igst: number;
}

export interface InvoiceSrc extends TaxParts {
  id: string;
  number: string | null;
  date: string;
  /** Not "draft" (drafts are never passed). */
  status: "issued" | "partially_paid" | "paid" | "cancelled";
  imported: boolean;
  customerId: string | null;
  customerName: string;
  total: number;
  /** Before discount, GST-exclusive. */
  subtotal: number;
  discount: number;
  taxable: number;
  roundOff: number;
  /** IST date of cancellation. */
  cancelledOn: string | null;
  /** Branch of the document (packages/branches); null / absent = head office / unassigned. */
  branchId?: string | null;
}

export interface InvoicePaymentSrc {
  id: string;
  invoiceId: string;
  invoiceNumber: string | null;
  customerId: string | null;
  customerName: string;
  /** The bill is an imported historical bill. */
  imported: boolean;
  date: string;
  /** Negative = a refund paid back with a credit note. */
  amount: number;
  method: MoneyMethod;
  /** Set when the row is the allocation of a customer receipt (the receipt itself is what is posted). */
  receiptId: string | null;
  /**
   * A payment received in a foreign currency (docs/recurring-export-gstin.md): rupees received above (+) or below (−)
   * `amount`, the part of the bill it settled at the bill's rate. Absent / 0 = none.
   */
  forexDiff?: number;
  /** Branch of the document (packages/branches); null / absent = head office / unassigned. */
  branchId?: string | null;
}

export interface ReceiptSrc {
  id: string;
  customerId: string;
  customerName: string;
  date: string;
  amount: number;
  method: MoneyMethod;
  reference: string | null;
}

export interface CreditNoteSrc extends TaxParts {
  id: string;
  number: string;
  invoiceNumber: string | null;
  date: string;
  status: "issued" | "cancelled";
  /** The original bill was cancelled (the customer ledger then leaves its notes out). */
  invoiceCancelled: boolean;
  invoiceImported: boolean;
  customerId: string | null;
  customerName: string;
  total: number;
  taxable: number;
  roundOff: number;
  /** IST date of cancellation. */
  cancelledOn: string | null;
  /** Branch of the document (packages/branches); null / absent = head office / unassigned. */
  branchId?: string | null;
}

export interface PurchaseSrc extends TaxParts {
  id: string;
  billNumber: string;
  date: string;
  status: "recorded" | "cancelled";
  imported: boolean;
  supplierId: string | null;
  supplierName: string;
  total: number;
  roundOff: number;
  cancelledOn: string | null;
  /** Branch of the document (packages/branches); null / absent = head office / unassigned. */
  branchId?: string | null;
}

export interface SupplierPaymentSrc {
  id: string;
  supplierId: string | null;
  supplierName: string;
  purchaseBill: string | null;
  /** The bill paid is an imported historical bill. */
  purchaseImported: boolean;
  kind: "payment" | "refund";
  amount: number;
  mode: MoneyMethod;
  date: string;
  /** IST date it was reversed (the row stays for the audit trail). */
  reversedOn: string | null;
  /** Branch of the document (packages/branches); null / absent = head office / unassigned. */
  branchId?: string | null;
}

export interface DebitNoteSrc extends TaxParts {
  id: string;
  number: string;
  date: string;
  status: "issued" | "cancelled";
  supplierId: string | null;
  supplierName: string;
  purchaseImported: boolean;
  total: number;
  roundOff: number;
  cancelledOn: string | null;
  /** Branch of the document (packages/branches); null / absent = head office / unassigned. */
  branchId?: string | null;
}

export interface ExpenseSrc {
  id: string;
  date: string;
  status: "recorded" | "cancelled";
  categoryId: string;
  categoryName: string;
  /** Including GST. */
  amount: number;
  gstAmount: number;
  /** Claimable input credit (the GST when the vendor GSTIN is valid). */
  itc: number;
  vendorName: string | null;
  vendorGstin: string | null;
  paymentMethod: MoneyMethod;
  /**
   * Bought on credit from `supplierId` (docs/expenses-debit-notes.md): owed to the supplier (Creditors) instead of paid
   * from a money account; paid later through Payables (a supplier payment). `paymentMethod` is then ignored.
   */
  onCredit?: boolean;
  supplierId?: string | null;
  /** IST date it was cancelled. */
  cancelledOn: string | null;
  /** Branch of the document (packages/branches); null / absent = head office / unassigned. */
  branchId?: string | null;
}

/** A debit note to a customer (CGST s.34): the customer owes more on an earlier bill (docs/expenses-debit-notes.md). */
export interface SalesDebitNoteSrc extends TaxParts {
  id: string;
  number: string;
  invoiceNumber: string | null;
  date: string;
  status: "issued" | "cancelled";
  customerId: string | null;
  customerName: string;
  total: number;
  taxable: number;
  roundOff: number;
  /** IST date of cancellation. */
  cancelledOn: string | null;
  /** Branch of the document (packages/branches); null / absent = head office / unassigned. */
  branchId?: string | null;
}

export interface TillSrc {
  id: string;
  register: string;
  status: "open" | "closed";
  /** IST date it was closed. */
  closedOn: string | null;
  /** counted - expected cash (paise), set when closed. */
  difference: number | null;
  /** Cash put in (+) or taken out (-) by hand. `on` is the IST date. */
  cashEntries: { id: string; amount: number; reason: string; on: string; category?: string }[];
  /** Differences found when the drawer changed hands (counted - expected, paise); posted like a closing difference. */
  handovers?: { id: string; difference: number; on: string }[];
  /** Branch of the document (packages/branches); null / absent = head office / unassigned. */
  branchId?: string | null;
}

/** Stock put in or written off by hand (opening stock, adjustments), valued in paise: + = stock added, - = removed. */
export interface StockAdjustmentSrc {
  id: string;
  date: string;
  reason: "opening" | "adjustment";
  value: number;
  itemName: string | null;
  /** Branch of the document (packages/branches); null / absent = head office / unassigned. */
  branchId?: string | null;
}

/** Composition tax paid by challan (CMP-08), entered in GST filing. Paid in full from the money account. */
export interface GstPaymentSrc {
  id: string;
  date: string;
  /** Paise: central + State/UT tax (+ interest and late fee). */
  amount: number;
  mode: MoneyMethod;
  status: "paid" | "cancelled";
  /** IST date it was cancelled. */
  cancelledOn: string | null;
  period: string;
}

/** A final payroll of a month (packages/payroll), in paise. gross + employerPf + employerEsi + roundOff = net + pf + esi + pt + tds + advance + other. */
export interface PayrollRunSrc {
  id: string;
  month: string;
  /** Last day of the month paid. */
  date: string;
  gross: number;
  employerPf: number;
  employerEsi: number;
  /** Net pay to staff (after rounding). */
  net: number;
  /** Employee + employer shares. */
  pf: number;
  esi: number;
  pt: number;
  tds: number;
  /** Advances recovered. */
  advance: number;
  /** Other deductions (fines, canteen ...), booked as other income. */
  other: number;
  /** Net rounded up (+) or down (-) to the rupee. */
  roundOff: number;
}

/** Payroll documents of a shop: final payrolls, salaries paid, advances given, PF / ESI / PT / salary TDS deposited. */
export interface PayrollSrc {
  runs: PayrollRunSrc[];
  payments: { id: string; date: string; amount: number; method: MoneyMethod; employeeName: string; month: string }[];
  advances: { id: string; date: string; amount: number; method: MoneyMethod; employeeName: string }[];
  dues: { id: string; kind: "pf" | "esi" | "pt" | "tds"; month: string; date: string; amount: number; method: MoneyMethod; reference: string | null }[];
}

export interface OpeningParty {
  id: string;
  name: string;
  /** Customers: + = they owed the shop. Suppliers: + = the shop owed them. */
  opening: number;
}

export interface SourcesPort {
  invoices(tenantId: string): Promise<InvoiceSrc[]>;
  invoicePayments(tenantId: string): Promise<InvoicePaymentSrc[]>;
  receipts(tenantId: string): Promise<ReceiptSrc[]>;
  creditNotes(tenantId: string): Promise<CreditNoteSrc[]>;
  purchases(tenantId: string): Promise<PurchaseSrc[]>;
  supplierPayments(tenantId: string): Promise<SupplierPaymentSrc[]>;
  debitNotes(tenantId: string): Promise<DebitNoteSrc[]>;
  expenses(tenantId: string): Promise<ExpenseSrc[]>;
  /** Debit notes to customers; leave out when the shop has none. */
  salesDebitNotes?(tenantId: string): Promise<SalesDebitNoteSrc[]>;
  tills(tenantId: string): Promise<TillSrc[]>;
  /** Composition tax paid (GST filing); leave out when the shop has no such payments. */
  gstPayments?(tenantId: string): Promise<GstPaymentSrc[]>;
  /** Staff payroll (packages/payroll); leave out when the shop has none. Cancelled documents are left out (their postings are reversed). */
  payroll?(tenantId: string): Promise<PayrollSrc>;
  /** Valued stock adjustments; leave out for shops that do not track stock. */
  stockAdjustments?(tenantId: string): Promise<StockAdjustmentSrc[]>;
  openingBalances(tenantId: string): Promise<{ customers: OpeningParty[]; suppliers: OpeningParty[] }>;
  /** The shop's 2-digit GST state code (to split expense ITC into CGST+SGST or IGST). */
  shopStateCode(tenantId: string): Promise<string | null>;

  // ---- Part B (TDS/TCS). Optional: without them the TDS screens work on typed-in parties only.
  /** Suppliers or customers (not deleted) with their GSTIN, for the TDS/TCS screens. */
  parties?(tenantId: string, type: "supplier" | "customer", q?: { ids?: string[]; search?: string; limit?: number }): Promise<PartyRef[]>;
  /**
   * Records the TDS deducted from a supplier against the bill (or on account) in Payables, so the bill's balance drops
   * by the tax as well: a supplier payment row of mode "other" with reference `TDS:<tdsId>`. Such rows are NOT posted
   * by the document sync (`supplierPayments` leaves them out); the TDS entry posts Dr Creditors / Cr TDS payable.
   * Returns an id to undo it with, or null when it could not be recorded (nothing is due on the bill).
   */
  settleSupplierTds?(
    tenantId: string,
    p: { tdsId: string; supplierId: string; purchaseId: string | null; amount: number; date: string; note: string; expenseId?: string | null },
  ): Promise<string | null>;
  unsettleSupplierTds?(tenantId: string, settlementId: string, reason: string): Promise<void>;
}

export interface PartyRef {
  id: string;
  name: string;
  gstin: string | null;
  phone: string | null;
}

/** Reference prefix of the Payables rows that settle TDS (see settleSupplierTds). */
export const TDS_SETTLEMENT_PREFIX = "TDS:";

/** Stock value (paise) as of a date from the inventory moving-average cost; null when the shop does not track stock. */
export interface StockValuePort {
  value(tenantId: string, asOf: string): Promise<number | null>;
  /**
   * The same value split by branch (the branch whose stock location holds the stock; key null = locations of no branch).
   * The parts add up to `value`. Leave out when not known: per-branch profit and loss then carries all valued stock in
   * the head office / unassigned column.
   */
  valueByBranch?(tenantId: string, asOf: string): Promise<Map<string | null, number> | null>;
}

/** The shop's branches (packages/branches), for the branch filter and the per-branch profit and loss. */
export interface BranchesPort {
  list(tenantId: string): Promise<{ id: string; name: string; code: string; active: boolean }[]>;
}

/** The existing modules' own totals, for the reconciliation page. */
export interface ReconcilePort {
  /** Net balance of every customer in the credit book (+ = they owe the shop), customers with a balance only. */
  customerBalances(tenantId: string): Promise<{ id: string; name: string; balance: number }[]>;
  /** Net payable to every supplier in the payables report (+ = the shop owes), suppliers with a balance only. */
  supplierBalances(tenantId: string): Promise<{ id: string | null; name: string; balance: number }[]>;
  /** The invoices module's GST summary totals for the dates (taxable and tax after credit notes). */
  salesGst(tenantId: string, from: string, to: string): Promise<{ taxable: number; cgst: number; sgst: number; igst: number }>;
  /** The inventory purchases report's input credit for the dates. */
  purchaseItc(tenantId: string, from: string, to: string): Promise<{ taxable: number; cgst: number; sgst: number; igst: number }>;
}

/** Tells whether another feature is on for the shop (e.g. "inventory"). */
export interface FeatureGatePort {
  isEnabled(tenantId: string, key: string): Promise<boolean>;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}
export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };
