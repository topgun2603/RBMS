"use client";

import { printDirectIfConfigured, receiptFromInvoice, type ReceiptLocale } from "@srirealtime/receipt-print";
import { upiLink } from "@srirealtime/gst";
import { api } from "@srirealtime/web";
import type { Invoice } from "./types";

/**
 * Prints a bill on this computer's direct thermal printer (Settings → Printing in the counter) when one is set up.
 * Returns `"printed"`, `"none"` (no direct printer here: use the thermal PDF as before) or `"failed"` (the printer was
 * configured but unreachable: the caller shows a note and falls back). Never throws.
 */
export async function printInvoiceDirect(inv: Invoice, o: { tenant: string | null | undefined; locale: string; shopName: string; logoUrl?: string | null }): Promise<"printed" | "none" | "failed"> {
  try {
    const locale: ReceiptLocale = o.locale === "ta" ? "ta" : "en";
    const out = await printDirectIfConfigured({
      tenant: o.tenant,
      loadShop: () => api<{ values?: Record<string, unknown> }>("/settings/printing").then((r) => r.values ?? {}),
      logoUrl: o.logoUrl,
      receipt: receiptFromInvoice(inv, {
        locale,
        shopName: o.shopName,
        seller: inv.seller,
        upiLink: (x) => upiLink({ vpa: x.vpa, name: x.name, amountPaise: x.amountPaise, note: x.note }),
      }),
    });
    if (out.handled) return "printed";
    return out.reason === "not_configured" ? "none" : "failed";
  } catch {
    return "failed";
  }
}
