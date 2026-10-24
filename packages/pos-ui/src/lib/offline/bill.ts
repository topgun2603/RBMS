import type { PaymentMethod, Invoice, PosCustomer } from "../types";
import { customerPhone } from "../types";
import { cartTotals, toLineInput, type CartLine } from "../cart";
import type { SaleInput } from "./queue";
import type { OfflineBillPayload, QueuedBill } from "./types";

/**
 * Turns the counter's cart into an offline sale and back into the `Invoice` shape the receipt screen already prints.
 * Pure: the screen passes in the cart, the payments and the context.
 */

export interface BuildSaleArgs {
  lines: readonly CartLine[];
  customer: PosCustomer;
  /** E.164 or digits; goes on a walk-in customer. */
  phone: string | null;
  /** Payments recorded at the counter (cash applied after change, UPI, card). */
  payments: { method: Extract<PaymentMethod, "cash" | "upi" | "card">; amount: number; reference?: string }[];
  tillSessionId?: string;
  cashier: string;
  date: string;
  now: Date;
  walkInName: string;
  sellerState: string;
  placeOfSupply: string;
}

/** Why a cart can't be billed offline, or null when it can. */
export function offlineBlocker(lines: readonly CartLine[], methods: readonly string[]): "ticket" | "method" | null {
  // A weigh ticket is marked used on the server right after the bill; offline it could be billed twice.
  if (lines.some((l) => l.ticket)) return "ticket";
  // Offline money is cash, UPI and card taken at the counter. Credit book and loyalty points need the server.
  if (methods.some((m) => m !== "cash" && m !== "upi" && m !== "card")) return "method";
  return null;
}

export function buildSale(a: BuildSaleArgs): SaleInput & { receipt: Omit<Invoice, "id" | "number"> } {
  const lineInputs = a.lines.map(toLineInput);
  const totals = cartTotals(a.lines, { sellerState: a.sellerState, placeOfSupply: a.placeOfSupply });
  const received = a.payments.reduce((s, p) => s + p.amount, 0);
  const walkIn = a.customer.kind === "walkin" ? a.customer : null;
  const customerName = a.customer.kind === "saved" ? a.customer.customer.name : walkIn?.name.trim() || a.walkInName;
  const phone = a.phone ?? customerPhone(a.customer);
  const snapshots = a.lines
    .filter((l) => !l.itemId.startsWith("open:"))
    .map((l) => ({ itemId: l.itemId, price: l.listPrice, gstRate: l.gstRate }));

  const sale: SaleInput = {
    date: a.date,
    billedAt: a.now,
    lines: lineInputs as unknown as Record<string, unknown>[],
    snapshots,
    payments: a.payments.map((p) => ({ method: p.method, amount: p.amount, ...(p.reference ? { reference: p.reference } : {}) })),
    ...(a.customer.kind === "saved" ? { customerId: a.customer.customer.id } : { customer: { name: customerName, ...(phone ? { phone } : {}) } }),
    ...(a.tillSessionId ? { tillSessionId: a.tillSessionId } : {}),
    display: { total: totals.total, itemCount: a.lines.length, customerName, cashier: a.cashier, received },
  };

  const receipt: Omit<Invoice, "id" | "number"> = {
    branchId: null,
    status: received >= totals.total ? "paid" : "issued",
    date: a.date,
    customerName,
    total: totals.total,
    paid: received,
    balance: Math.max(totals.total - received, 0),
    customerId: a.customer.kind === "saved" ? a.customer.customer.id : null,
    customer: { name: customerName, ...(phone ? { phone } : {}), ...(a.customer.kind === "saved" && a.customer.customer.gstin ? { gstin: a.customer.customer.gstin } : {}) },
    placeOfSupply: a.placeOfSupply,
    lines: totals.lines.map((l, i) => ({
      description: l.description,
      ...(l.hsn ? { hsn: l.hsn } : {}),
      qty: l.qty,
      ...(l.unit ? { unit: l.unit } : {}),
      rate: l.rate,
      ...(l.discount ? { discount: l.discount } : {}),
      gstRate: l.gstRate,
      ...(lineInputs[i]?.itemId ? { itemId: lineInputs[i]!.itemId } : {}),
      amount: l.amount,
      taxable: l.taxable,
      cgst: l.cgst,
      sgst: l.sgst,
      igst: l.igst,
      total: l.total,
    })),
    totals: {
      subtotal: totals.subtotal,
      discount: totals.discount,
      taxable: totals.taxable,
      cgst: totals.cgst,
      sgst: totals.sgst,
      igst: totals.igst,
      roundOff: totals.roundOff,
      total: totals.total,
    },
    payments: a.payments.map((p, i) => ({ id: `offline-${i}`, amount: p.amount, method: p.method, date: a.date, reference: p.reference ?? null })),
    shareToken: null,
    warnings: [],
    cancelledAt: null,
  };
  return { ...sale, receipt };
}

/** Prefix of the `id` of an invoice that exists only on this device. */
export const OFFLINE_ID_PREFIX = "offline:";
export const isOfflineInvoice = (inv: Pick<Invoice, "id">) => inv.id.startsWith(OFFLINE_ID_PREFIX);

/** A slip that is not yet an invoice: on this device only, under a provisional `OFF-…` number (a reserved number is final). */
export const isProvisionalSlip = (inv: Pick<Invoice, "id" | "number">) => isOfflineInvoice(inv) && (inv.number ?? "").startsWith("OFF-");

/**
 * The bill as an `Invoice` for the receipt screen and the printers (a `receiptData` source for the printing code): its
 * number is the slip number (a reserved invoice number, or the provisional "OFF-…" one) and its id starts with
 * `offline:`, so a caller knows there is nothing on the server to fetch yet (no PDF, no WhatsApp link).
 */
export function offlineInvoice(bill: Pick<QueuedBill, "clientId" | "number" | "receipt">): Invoice | null {
  if (!bill.receipt) return null;
  return { ...bill.receipt, id: `${OFFLINE_ID_PREFIX}${bill.clientId}`, number: bill.number };
}

/**
 * The invoice to show on the slip screen: while the bill is only on this device, the offline one; once it has synced,
 * the real invoice (its id, so the PDF and the WhatsApp link work, and its final legal number, which is what a
 * reprint or a WhatsApp share must carry when it differs from the number printed offline).
 */
export function slipInvoice(bill: Pick<QueuedBill, "clientId" | "number" | "receipt" | "result">): Invoice | null {
  const inv = offlineInvoice(bill);
  if (!inv) return null;
  if (bill.result?.invoiceId) return { ...inv, id: bill.result.invoiceId, number: bill.result.number ?? inv.number };
  return inv;
}

/** The payload as the server will see it, for tests and the support export. */
export type { OfflineBillPayload };
