import type { GstRate } from "@rbms/gst";
import { renderInvoice } from "./invoice";
import type { InvoiceDocData, RenderContext } from "../types";

/** A party on a platform invoice (the platform as seller, the shop as buyer). */
export interface PlatformInvoiceParty {
  legalName: string;
  gstin: string | null;
  stateCode: string | null;
  address: string | null;
}

/**
 * A plan invoice the platform issues to a shop (packages/subscriptions `platform_invoices`, structurally): one SAC
 * 998314 line, 18% GST split into CGST + SGST or IGST, already computed. Money in paise.
 */
export interface PlatformInvoiceDocData {
  id?: string;
  number: string;
  /** "YYYY-MM-DD" (IST). */
  date: string;
  status: "paid" | "void" | (string & {});
  seller: PlatformInvoiceParty;
  buyer: PlatformInvoiceParty;
  placeOfSupply: string;
  /** Line text, e.g. "Pro plan (monthly)". */
  description: string;
  sac: string;
  gstRate: number;
  periodStart?: Date | string | null;
  periodEnd?: Date | string | null;
  subtotalPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  providerPaymentId?: string | null;
  voidReason?: string | null;
  updatedAt?: Date | string | null;
  /**
   * The invoice's lines when there is more than the plan: the plan at its full value and a negative credit line (a
   * proration credit reduces the taxable value). They add up to the totals above; without them, one plan line.
   */
  lines?: PlatformInvoiceLine[] | null;
}

/** A line of a platform invoice (paise; a credit line is negative). */
export interface PlatformInvoiceLine {
  kind: "plan" | "addon" | "credit";
  description: string;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}

const day = (v: Date | string | null | undefined) => {
  if (!v) return null;
  const d = typeof v === "string" ? new Date(v) : v;
  return Number.isNaN(d.getTime()) ? null : new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
};

/** The platform invoice as a GST invoice document (the same A4 layout as shop bills). */
export function platformInvoiceDoc(p: PlatformInvoiceDocData): InvoiceDocData {
  const interState = p.igstPaise > 0 || (p.cgstPaise === 0 && p.sgstPaise === 0 && p.seller.stateCode !== p.placeOfSupply);
  const gstRate = p.gstRate as GstRate;
  const from = day(p.periodStart);
  const to = day(p.periodEnd);
  const description = from && to ? `${p.description}: ${from} to ${to}` : p.description;
  const toLine = (l: Omit<PlatformInvoiceLine, "kind" | "description">, text: string, unit: string) => ({
    description: text,
    hsn: p.sac,
    qty: 1,
    unit,
    rate: l.taxablePaise,
    gstRate,
    amount: l.taxablePaise,
    discount: 0,
    taxable: l.taxablePaise,
    cgst: l.cgstPaise,
    sgst: l.sgstPaise,
    igst: l.igstPaise,
    total: l.totalPaise,
  });
  const totalsLine = { taxablePaise: p.subtotalPaise, cgstPaise: p.cgstPaise, sgstPaise: p.sgstPaise, igstPaise: p.igstPaise, totalPaise: p.totalPaise };
  const lines =
    p.lines && (p.lines.length > 1 || (p.lines.length === 1 && p.lines[0]!.kind !== "plan"))
      ? p.lines.map((l) =>
          l.kind === "plan"
            ? toLine(l, from && to ? `${l.description}: ${from} to ${to}` : l.description, "plan")
            : toLine(l, l.description, l.kind === "addon" ? "add-on" : "credit"),
        )
      : [toLine(totalsLine, description, "plan")];
  const paid = p.status === "paid";
  return {
    id: p.id,
    number: p.number,
    status: paid ? "paid" : "cancelled",
    date: p.date,
    dueDate: null,
    customer: { name: p.buyer.legalName, gstin: p.buyer.gstin, stateCode: p.buyer.stateCode, address: p.buyer.address },
    seller: {
      legalName: p.seller.legalName,
      gstin: p.seller.gstin,
      address: p.seller.address,
      city: null,
      pincode: null,
      stateCode: p.seller.stateCode,
      phone: null,
      email: null,
      terms: null,
    },
    placeOfSupply: p.placeOfSupply,
    interState,
    lines,
    totals: {
      // The lines (a credit line is negative) add up to the taxable value; GST is on the net.
      subtotal: p.subtotalPaise,
      discount: 0,
      taxable: p.subtotalPaise,
      cgst: p.cgstPaise,
      sgst: p.sgstPaise,
      igst: p.igstPaise,
      roundOff: 0,
      total: p.totalPaise,
      taxBreakup: [{ gstRate, taxable: p.subtotalPaise, cgst: p.cgstPaise, sgst: p.sgstPaise, igst: p.igstPaise }],
    },
    notes: [paid ? `Paid${p.providerPaymentId ? ` (payment ${p.providerPaymentId})` : ""}. Thank you.` : null, "Prices in Indian Rupees; GST charged on the plan price."]
      .filter(Boolean)
      .join("\n"),
    paid: paid ? p.totalPaise : 0,
    balance: 0,
    cancelReason: paid ? null : (p.voidReason ?? "Voided"),
    updatedAt: p.updatedAt ?? null,
  };
}

/** HTML of a platform invoice (A4). */
export function renderPlatformInvoice(p: PlatformInvoiceDocData, ctx: RenderContext): string {
  return renderInvoice(platformInvoiceDoc(p), ctx);
}
