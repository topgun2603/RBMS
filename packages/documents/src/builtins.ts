import { safeFilename, type DocumentRegistry } from "./registry";
import { renderInvoice, renderInvoiceThermal } from "./renderers/invoice";
import { renderPackingSlip, renderShippingLabel } from "./renderers/order";
import { renderPurchase } from "./renderers/purchase";
import { renderPurchaseOrder } from "./renderers/purchase-order";
import { renderStatement } from "./renderers/statement";
import { renderCreditNote, renderCreditNoteThermal } from "./renderers/credit-note";
import { renderQuotation, renderQuotationThermal } from "./renderers/quotation";
import { renderSalesDoc } from "./renderers/sales-doc";
import { renderTillReport } from "./renderers/till";
import type {
  CreditNoteDocData,
  CreditNoteDocPort,
  InvoiceDocData,
  InvoiceDocPort,
  OrderDocData,
  OrderDocPort,
  PurchaseDocData,
  PurchaseDocPort,
  PurchaseOrderDocData,
  PurchaseOrderDocPort,
  QuotationDocData,
  QuotationDocPort,
  SalesDocDocData,
  SalesDocPort,
  StatementDocData,
  StatementDocPort,
  TillDocData,
  TillDocPort,
} from "./types";

/** Feature each built-in type's staff route belongs to (docs/commerce-batch1.md §6). */
export const DOCUMENT_TYPE_FEATURES = {
  invoice: "invoices",
  "invoice-thermal": "invoices",
  statement: "invoices.credit-book",
  "packing-slip": "orders",
  "shipping-label": "orders",
  purchase: "inventory.purchases",
  "purchase-order": "inventory.purchases",
  "credit-note": "invoices",
  "credit-note-thermal": "invoices",
  "till-z": "invoices",
  quotation: "invoices.quotations",
  "quotation-thermal": "invoices.quotations",
  proforma: "invoices.sales-docs",
  "sale-order": "invoices.sales-docs",
  challan: "invoices.sales-docs",
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
  purchaseOrders?: PurchaseOrderDocPort;
  creditNotes?: CreditNoteDocPort;
  quotations?: QuotationDocPort;
  salesDocs?: SalesDocPort;
  till?: TillDocPort;
}

export const quotationFilename = (d: QuotationDocData) => safeFilename(`Quotation-${d.number}${d.rev > 1 ? `-rev${d.rev}` : ""}`);

const SALES_DOC_FILE: Record<SalesDocDocData["kind"], string> = { proforma: "Proforma", sale_order: "Sale-order", challan: "Delivery-challan" };
export const salesDocFilename = (d: SalesDocDocData) => safeFilename(`${SALES_DOC_FILE[d.kind]}-${d.number}`);

export const creditNoteFilename = (d: CreditNoteDocData) => safeFilename(`Credit-note-${d.number}`);

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
  const cn = ports.creditNotes;
  if (cn) {
    reg.register<CreditNoteDocData>({
      key: "credit-note",
      paper: "A4",
      feature: DOCUMENT_TYPE_FEATURES["credit-note"],
      load: (tenantId, id) => cn.creditNote(tenantId, id),
      render: renderCreditNote,
      filename: creditNoteFilename,
      version,
    });
    reg.register<CreditNoteDocData>({
      key: "credit-note-thermal",
      paper: "80mm",
      feature: DOCUMENT_TYPE_FEATURES["credit-note-thermal"],
      load: (tenantId, id) => cn.creditNote(tenantId, id),
      render: renderCreditNoteThermal,
      filename: creditNoteFilename,
      version,
    });
  }
  const qt = ports.quotations;
  if (qt) {
    reg.register<QuotationDocData>({
      key: "quotation",
      paper: "A4",
      feature: DOCUMENT_TYPE_FEATURES.quotation,
      permission: "quotations.view",
      load: (tenantId, id) => qt.quotation(tenantId, id),
      render: renderQuotation,
      filename: quotationFilename,
      version,
    });
    reg.register<QuotationDocData>({
      key: "quotation-thermal",
      paper: "80mm",
      feature: DOCUMENT_TYPE_FEATURES["quotation-thermal"],
      permission: "quotations.view",
      load: (tenantId, id) => qt.quotation(tenantId, id),
      render: renderQuotationThermal,
      filename: quotationFilename,
      version,
    });
  }
  const sd = ports.salesDocs;
  if (sd) {
    const kinds = [
      ["proforma", "proforma"],
      ["sale-order", "sale_order"],
      ["challan", "challan"],
    ] as const;
    for (const [key, kind] of kinds) {
      reg.register<SalesDocDocData>({
        key,
        paper: "A4",
        feature: DOCUMENT_TYPE_FEATURES[key],
        permission: "sales-docs.view",
        load: (tenantId, id) => sd.doc(kind, tenantId, id),
        render: renderSalesDoc,
        filename: salesDocFilename,
        version,
      });
    }
  }
  const till = ports.till;
  if (till) {
    reg.register<TillDocData>({
      key: "till-z",
      paper: "80mm",
      feature: DOCUMENT_TYPE_FEATURES["till-z"],
      permission: "pos.till",
      load: (tenantId, id) => till.session(tenantId, id),
      render: renderTillReport,
      filename: (d) => safeFilename(`${d.status === "closed" ? "Z" : "X"}-report-${d.register}-${d.date}`),
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
  const po = ports.purchaseOrders;
  if (po) {
    reg.register<PurchaseOrderDocData>({
      key: "purchase-order",
      paper: "A4",
      feature: DOCUMENT_TYPE_FEATURES["purchase-order"],
      load: (tenantId, id) => po.purchaseOrder(tenantId, id),
      render: renderPurchaseOrder,
      filename: (d) => safeFilename(`Purchase-order-${d.number}`),
      version,
    });
  }
}
