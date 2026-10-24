import { RECEIPT_LABELS, type ReceiptLocale } from "./labels";
import type { ReceiptData } from "./receipt";

/** The fields of an invoice (counter or billing page) a receipt needs. Both UIs' `Invoice` types satisfy it. */
export interface InvoiceLike {
  number: string | null;
  date: string;
  customer?: { name?: string | null } | null;
  lines: { description: string; qty: number; total: number; rate?: number }[];
  totals: { taxable: number; cgst: number; sgst: number; igst: number; roundOff: number; total: number; loyalty?: { points: number; discount: number } };
  payments: { method: string; amount: number }[];
  balance: number;
}

export interface SellerLike {
  legalName?: string | null;
  address?: string | null;
  city?: string | null;
  gstin?: string | null;
  phone?: string | null;
  upiId?: string | null;
}

export interface InvoiceReceiptContext {
  locale?: ReceiptLocale;
  shopName: string;
  branchName?: string | null;
  seller?: SellerLike | null;
  /** Already formatted time of the sale, appended to the date. */
  time?: string | null;
  cashier?: string | null;
  change?: number;
  /** E-invoice QR payload when the invoice has an IRN. */
  einvoiceQr?: string | null;
  /** Builds the UPI link for the balance (apps/gst `upiLink`); omitted = no payment QR. */
  upiLink?: ((o: { vpa: string; name: string; amountPaise: number; note: string }) => string) | null;
  barcode?: boolean;
  /** Offline slip under a provisional number: titled "Provisional receipt" instead of "Tax invoice". */
  provisional?: boolean;
}

/** Same grouping as the PDF thermal template: cash / UPI / card / other. */
export function receiptFromInvoice(inv: InvoiceLike, c: InvoiceReceiptContext): ReceiptData {
  const L = RECEIPT_LABELS[c.locale ?? "en"];
  const name = c.seller?.legalName?.trim() || c.shopName;
  const label = (m: string) => (m === "cash" ? L.cash : m === "upi" ? L.upi : m === "card" ? L.card : L.other);
  const address = [c.seller?.address, c.seller?.city].filter((x) => x && x.trim()).join(", ");
  const vpa = c.seller?.upiId?.trim();
  const number = inv.number ?? "DRAFT";
  return {
    locale: c.locale,
    shop: { name, branch: c.branchName ?? null, address: address || null, gstin: c.seller?.gstin ?? null, phone: c.seller?.phone ?? null },
    ...(c.provisional ? { title: L.provisional } : {}),
    number,
    date: [inv.date, c.time].filter(Boolean).join(" "),
    customer: inv.customer?.name ?? null,
    cashier: c.cashier ?? null,
    lines: inv.lines.map((l) => ({ description: l.description, qty: l.qty, unitPrice: l.qty > 0 ? Math.round(l.total / l.qty) : l.rate ?? l.total, total: l.total })),
    totals: {
      taxable: inv.totals.taxable,
      cgst: inv.totals.cgst,
      sgst: inv.totals.sgst,
      igst: inv.totals.igst,
      loyaltyDiscount: inv.totals.loyalty?.discount,
      loyaltyPoints: inv.totals.loyalty?.points,
      roundOff: inv.totals.roundOff,
      total: inv.totals.total,
    },
    payments: inv.payments.map((p) => ({ label: label(p.method), amount: p.amount })),
    change: c.change,
    balance: inv.balance,
    upiLink: vpa && c.upiLink && inv.balance > 0 ? c.upiLink({ vpa, name, amountPaise: inv.balance, note: number }) : null,
    einvoiceQr: c.einvoiceQr ?? null,
    barcode: c.barcode,
  };
}

/** Did any payment on the bill go in the cash drawer? */
export const hasCashPayment = (inv: Pick<InvoiceLike, "payments">) => inv.payments.some((p) => p.method === "cash" && p.amount > 0);
