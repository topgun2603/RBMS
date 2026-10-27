import { AppError, type AuditEvent, type FeatureGatePort } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { createQuotations, type InvoicesService, type QuotationOrdersPort, type QuotationSalesDocsPort } from "@srirealtime/invoices";
import type { OrdersService } from "@srirealtime/orders";

/** What the quotations wiring needs from the host's services (structural, so kit.ts passes its own objects). */
export interface QuotationsWiring {
  db: Db;
  invoices: InvoicesService;
  orders: OrdersService;
  catalogue: {
    storeVariants(tenantId: string, ids: string[]): Promise<{ id: string; taxInclusive: boolean }[]>;
  };
  features: { gate: FeatureGatePort; service: { isEnabled(tenantId: string, key: string): Promise<boolean> } };
  notify: {
    send(input: { tenantId: string; channel: "whatsapp" | "sms" | "email"; to: string; template: string; vars: Record<string, string>; locale?: string }): Promise<{ logId: string }>;
  };
  audit: { record(e: AuditEvent): Promise<void> };
  settings: { get(tenantId: string): Promise<Record<string, unknown>> };
  branding: { get(tenantId: string): Promise<{ appName: string | null; logoUrl: string | null; css: string }> };
  publicBaseUrl: (tenantId: string) => Promise<string>;
  branches?: Parameters<typeof createQuotations>[0]["branches"];
  /** Proforma invoices and sale orders (docs/sales-documents.md), for "Make proforma" / "Make sale order". */
  salesDocs?: QuotationSalesDocsPort;
  now?: () => Date;
  log: Parameters<typeof createQuotations>[0]["log"];
}

/**
 * Quotations (docs/quotations.md): the invoices package's quotation service, wired to the shop's settings, WhatsApp / SMS /
 * email (notify), the audit log, and the orders module for "Make order".
 */
export function wireQuotations(w: QuotationsWiring) {
  const orderPort: QuotationOrdersPort = {
    async createFromQuotation(tenant, quote, opts) {
      if (!(await w.features.service.isEnabled(tenant.id, "orders"))) {
        throw new AppError(409, "orders_unavailable", "This shop doesn't take orders");
      }
      const missing = quote.lines.filter((l) => !l.itemId);
      if (missing.length > 0) {
        throw new AppError(400, "quotation_free_text_lines", "Make order needs every line to be a saved item. Pick items from the catalogue, or make a bill instead", {
          lines: missing.map((l) => l.description),
        });
      }
      const variants = await w.catalogue.storeVariants(tenant.id, [...new Set(quote.lines.map((l) => l.itemId!))]);
      const byId = new Map(variants.map((v) => [v.id, v]));
      const gone = quote.lines.filter((l) => !byId.has(l.itemId!));
      if (gone.length > 0) {
        throw new AppError(400, "quotation_items_missing", "Some items on this quotation are no longer in the catalogue", { lines: gone.map((l) => l.description) });
      }
      const order = await w.orders.create(
        tenant.id,
        {
          channel: "manual",
          customer: { name: quote.customer.name, phone: quote.customer.phone, email: quote.customer.email },
          lines: quote.lines.map((l) => {
            const v = byId.get(l.itemId!)!;
            // The order prices a unit like the catalogue does (GST-inclusive when the item is tax-inclusive); the quotation's
            // agreed rate after discount is what we pass, so the order total matches the quotation to within a paisa a line.
            const exclusive = Math.round(l.taxable / l.qty);
            const price = v.taxInclusive ? Math.round(exclusive * (1 + l.gstRate / 100)) : exclusive;
            return { variantId: l.itemId!, qty: l.qty, price };
          }),
          paymentMethod: "cash",
          notes: `From quotation ${quote.number}${quote.rev > 1 ? ` (rev ${quote.rev})` : ""}${quote.deliveryText ? `. Delivery: ${quote.deliveryText}` : ""}`,
        },
        opts.userId,
        { branchId: opts.branchId },
      );
      return { id: order.id, number: order.number };
    },
    async recordAdvance(tenantId, orderId, advance) {
      await w.orders.addPayment(tenantId, orderId, {
        amount: advance.amount,
        method: advance.method as "cash" | "upi" | "card" | "bank" | "cheque" | "other",
        reference: advance.reference,
      });
    },
    async isLive(tenantId, orderId) {
      const order = await w.orders.get(tenantId, orderId).catch(() => null);
      return Boolean(order) && order!.status !== "cancelled";
    },
  };

  return createQuotations({
    db: w.db,
    invoices: w.invoices,
    settings: { get: (tenantId) => w.settings.get(tenantId) },
    branding: w.branding,
    publicBaseUrl: w.publicBaseUrl,
    branches: w.branches,
    featureGate: w.features.gate,
    notifier: {
      send: async ({ tenantId, channel, to, template, vars, locale }) => ({
        logId: (await w.notify.send({ tenantId, channel, to, template, vars, locale })).logId,
      }),
    },
    orders: orderPort,
    salesDocs: w.salesDocs
      ? {
          fromQuotation: async (tenant, quote, kind, ctx) => {
            if (!(await w.features.service.isEnabled(tenant.id, "invoices.sales-docs"))) {
              throw new AppError(409, "sales_docs_unavailable", "Proforma invoices and sale orders are not switched on for this shop");
            }
            return w.salesDocs!.fromQuotation(tenant, quote, kind, ctx);
          },
          isLive: (tenantId, kind, id) => w.salesDocs!.isLive(tenantId, kind, id),
        }
      : undefined,
    audit: {
      record: (e) => w.audit.record({ tenantId: e.tenantId, actorUserId: null, action: e.action, entityType: e.entityType, entityId: e.entityId, summary: e.summary }),
    },
    now: w.now,
    log: w.log,
  });
}
