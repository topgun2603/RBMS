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
  /** IST date it was cancelled. */
  cancelledOn: string | null;
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
  cashEntries: { id: string; amount: number; reason: string; on: string }[];
}

/** Stock put in or written off by hand (opening stock, adjustments), valued in paise: + = stock added, - = removed. */
export interface StockAdjustmentSrc {
  id: string;
  date: string;
  reason: "opening" | "adjustment";
  value: number;
  itemName: string | null;
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
  tills(tenantId: string): Promise<TillSrc[]>;
  /** Composition tax paid (GST filing); leave out when the shop has no such payments. */
  gstPayments?(tenantId: string): Promise<GstPaymentSrc[]>;
  /** Valued stock adjustments; leave out for shops that do not track stock. */
  stockAdjustments?(tenantId: string): Promise<StockAdjustmentSrc[]>;
  openingBalances(tenantId: string): Promise<{ customers: OpeningParty[]; suppliers: OpeningParty[] }>;
  /** The shop's 2-digit GST state code (to split expense ITC into CGST+SGST or IGST). */
  shopStateCode(tenantId: string): Promise<string | null>;
}

/** Stock value (paise) as of a date from the inventory moving-average cost; null when the shop does not track stock. */
export interface StockValuePort {
  value(tenantId: string, asOf: string): Promise<number | null>;
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
