import { safeFilename, type DocumentRegistry } from "./registry";
import { renderInvoice, renderInvoiceThermal } from "./renderers/invoice";
import { renderPackingSlip, renderShippingLabel } from "./renderers/order";
import { renderPurchase } from "./renderers/purchase";
import { renderStatement } from "./renderers/statement";
import type { InvoiceDocData, InvoiceDocPort, OrderDocData, OrderDocPort, PurchaseDocData, PurchaseDocPort, StatementDocData, StatementDocPort } from "./types";

/** Feature each built-in type's staff route belongs to (docs/commerce-batch1.md §6). */
export const DOCUMENT_TYPE_FEATURES = {
  invoice: "invoices",
  "invoice-thermal": "invoices",
  statement: "invoices.credit-book",
  "packing-slip": "orders",
  "shipping-label": "orders",
  purchase: "inventory.purchases",
} as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const version = (d: { updatedAt?: Date | string | null }) =>
  d.updatedAt ? (d.updatedAt instanceof Date ? d.updatedAt.toISOString() : String(d.updatedAt)) : null;

export const invoiceFilename = (inv: InvoiceDocData) => safeFilename(inv.number ? `Invoice-${inv.number}` : `Invoice-draft-${(inv.id ?? "").slice(0, 8)}`);

export interface BuiltinPorts {
  invoices?: InvoiceDocPort;
  statements?: StatementDocPort;
  orders?: OrderDocPort;
  purchases?: PurchaseDocPort;
}

/** Registers the built-in types whose data port is present. */
export function registerBuiltins(reg: DocumentRegistry, ports: BuiltinPorts): void {
  const inv = ports.invoices;
  if (inv) {
    reg.register<InvoiceDocData>({
      key: "invoice",
      paper: "A4",
      feature: DOCUMENT_TYPE_FEATURES.invoice,
      load: (tenantId, id) => inv.invoice(tenantId, id),
      render: renderInvoice,
      filename: invoiceFilename,
      version,
    });
    reg.register<InvoiceDocData>({
      key: "invoice-thermal",
      paper: "80mm",
      feature: DOCUMENT_TYPE_FEATURES["invoice-thermal"],
      load: (tenantId, id) => inv.invoice(tenantId, id),
      render: renderInvoiceThermal,
      filename: (d) => safeFilename(`Receipt-${d.number ?? "draft"}`),
      version,
    });
  }
  const st = ports.statements;
  if (st) {
    reg.register<StatementDocData>({
      key: "statement",
      paper: "A4",
      feature: DOCUMENT_TYPE_FEATURES.statement,
      load: (tenantId, id, ctx) => {
        const range: { from?: string; to?: string } = {};
        if (ctx.query.from && DATE.test(ctx.query.from)) range.from = ctx.query.from;
        if (ctx.query.to && DATE.test(ctx.query.to)) range.to = ctx.query.to;
        return st.statement(tenantId, id, range);
      },
      render: renderStatement,
      filename: (d) => safeFilename(`Statement-${d.customer.name}${d.to ? `-${d.to}` : ""}`),
    });
  }
  const ord = ports.orders;
  if (ord) {
    reg.register<OrderDocData>({
      key: "packing-slip",
      paper: "A4",
      feature: DOCUMENT_TYPE_FEATURES["packing-slip"],
      load: (tenantId, id) => ord.order(tenantId, id),
      render: renderPackingSlip,
      filename: (d) => safeFilename(`Packing-slip-${d.number}`),
      version,
    });
    reg.register<OrderDocData>({
      key: "shipping-label",
      paper: "A6",
      feature: DOCUMENT_TYPE_FEATURES["shipping-label"],
      load: (tenantId, id) => ord.order(tenantId, id),
      render: renderShippingLabel,
      filename: (d) => safeFilename(`Label-${d.number}`),
      version,
    });
  }
  const pur = ports.purchases;
  if (pur) {
    reg.register<PurchaseDocData>({
      key: "purchase",
      paper: "A4",
      feature: DOCUMENT_TYPE_FEATURES.purchase,
      load: (tenantId, id) => pur.purchase(tenantId, id),
      render: renderPurchase,
      filename: (d) => safeFilename(`Purchase-${d.billNumber}`),
      version,
    });
  }
}
