/** Types of the supplier payables, purchase order and debit note API (/v1/inventory/...). Money is integer paise. */
import type { ISODate, LineTotals } from "./types";

export const PAYMENT_MODES = ["cash", "upi", "bank", "cheque", "card", "other"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

/** Fields the purchase and supplier endpoints now add (opening balance, paid so far, due date, charges). */
export interface PurchasePayables {
  amountPaid?: number;
  returnedAmount?: number;
  /** total - returned - paid; negative = the supplier owes us. */
  balance?: number;
  dueDate?: string | null;
  freight?: number;
  otherCharges?: number;
  purchaseOrderId?: string | null;
  goodsReceiptId?: string | null;
}

export interface SupplierPayables {
  openingBalance?: number;
  openingDate?: string | null;
}

export interface PurchasePayment {
  id: string;
  groupId: string;
  purchaseId: string | null;
  supplierId: string | null;
  billNumber: string | null;
  kind: "payment" | "refund";
  amount: number;
  mode: PaymentMode;
  reference: string | null;
  date: string;
  note: string | null;
  debitNoteId: string | null;
  reversedAt: ISODate | null;
  reverseNote: string | null;
  createdAt: ISODate;
}

export interface PaymentInput {
  amount: number;
  mode: PaymentMode;
  reference?: string;
  date?: string;
  note?: string;
}

export interface SupplierPaymentInput extends PaymentInput {
  allocations?: { purchaseId: string; amount: number }[];
}

export interface SupplierPaymentResult {
  groupId: string;
  amount: number;
  allocations: { purchaseId: string; billNumber: string; amount: number }[];
  onAccount: number;
}

export interface AgeingSupplierRow {
  supplierId: string | null;
  name: string;
  opening: number;
  b0_30: number;
  b31_60: number;
  b61_90: number;
  b90plus: number;
  advance: number;
  total: number;
  overdue: number;
}

export interface PayablesAgeing {
  asOf: string;
  rows: AgeingSupplierRow[];
  totals: Omit<AgeingSupplierRow, "supplierId" | "name">;
}

export interface PayablesSummary {
  payable: number;
  overdue: number;
  dueSoon: number;
  advance: number;
  suppliers: number;
  asOf: string;
}

export interface StatementRow {
  date: string;
  type: "opening" | "purchase" | "debit_note" | "payment" | "refund";
  ref: string;
  description: string;
  credit: number;
  debit: number;
  balance: number;
  id?: string;
}

export interface SupplierStatement {
  supplier: { id: string; name: string; gstin: string | null; phone: string | null };
  from: string | null;
  to: string | null;
  openingBalance: number;
  rows: StatementRow[];
  totalCredit: number;
  totalDebit: number;
  closingBalance: number;
}

export type PoStatus = "draft" | "sent" | "partially_received" | "received" | "cancelled";
export const PO_STATUSES: PoStatus[] = ["draft", "sent", "partially_received", "received", "cancelled"];

export interface PoLine extends LineTotals {
  itemId?: string;
  received: number;
}

export interface PurchaseOrder {
  id: string;
  number: string;
  supplierId: string | null;
  supplier: { name: string; gstin: string | null; phone: string | null; stateCode: string | null };
  date: string;
  expectedDate: string | null;
  status: PoStatus;
  lines: PoLine[];
  total: number;
  notes: string | null;
  createdAt: ISODate;
}

export interface GoodsReceipt {
  id: string;
  number: string;
  purchaseOrderId: string;
  date: string;
  lines: { lineIndex: number; itemId?: string; description: string; qty: number; taxable: number; landed: number }[];
  freight: number;
  otherCharges: number;
  purchaseId: string | null;
  note: string | null;
  /** Set when the receipt was cancelled (its stock went back out). */
  cancelledAt?: string | null;
  cancelReason?: string | null;
}

export interface PurchaseOrderDetail extends PurchaseOrder {
  receipts: GoodsReceipt[];
}

export interface ReceiveResult {
  grn: GoodsReceipt;
  purchase: { id: string; billNumber: string } | null;
  billError: string | null;
}

export interface BillFields {
  billNumber: string;
  billDate?: string;
  dueDate?: string;
  billNotes?: string;
  paid?: boolean;
  amountPaid?: number;
  paymentMode?: PaymentMode;
}

export interface ReceiveInput {
  date?: string;
  lines: { lineIndex: number; qty: number }[];
  freight?: number;
  otherCharges?: number;
  note?: string;
  bill?: BillFields;
}

export interface ConvertInput extends BillFields {
  date?: string;
  freight?: number;
  otherCharges?: number;
  note?: string;
}

export interface DebitNote {
  id: string;
  number: string;
  purchaseId: string;
  billNumber?: string | null;
  supplierId: string | null;
  supplierName: string;
  date: string;
  lines: (LineTotals & { lineIndex: number })[];
  total: number;
  refundAmount: number;
  reason: string | null;
  status: "issued" | "cancelled";
  createdAt: ISODate;
}

export interface DebitNoteInput {
  purchaseId: string;
  date?: string;
  lines: { lineIndex: number; qty: number }[];
  reason?: string;
  refundAmount?: number;
  refundMode?: PaymentMode;
}
