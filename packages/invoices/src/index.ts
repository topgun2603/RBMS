import { defineModule } from "@srirealtime/core";
import { INVOICE_FEATURES } from "./features";
import { invoicesRoutes } from "./routes";
import {
  billingCustomers,
  billingItems,
  creditNotes,
  creditNoteSeries,
  customerReceipts,
  invoiceMessages,
  invoicePayments,
  invoiceReminders,
  invoices,
  invoiceSeries,
  tillSessions,
} from "./schema";
import { InvoicesService, type InvoicesDeps } from "./service";

export * from "./schema";
export * from "./calc";
export * from "./ports";
export * from "./logic";
export * from "./ledger";
export * from "./reports";
export * from "./service";
export * from "./features";
export * from "./credit-notes-calc";
export * from "./credit-notes";
export * from "./till-calc";
export * from "./till";
export {
  invoicesRoutes,
  billingItemListSchema,
  billingItemSchema,
  creditBookRowSchema,
  creditBookSchema,
  creditNoteSummarySchema,
  customerListItemSchema,
  customerListSchema,
  customerSchema,
  customerSnapshotSchema,
  dashboardSummarySchema,
  invoiceLineSchema,
  invoiceListSchema,
  invoicePaymentSchema,
  invoiceSchema,
  invoiceSummarySchema,
  invoiceTotalsSchema,
  ledgerEntrySchema,
  ledgerSchema,
  receiptResultSchema,
  receiptSchema,
  sellerProfileSchema,
  sendResultSchema,
  shareLinkSchema,
  tillCurrentSchema,
  tillReportResponseSchema,
  tillReportSchema,
  tillSessionSchema,
} from "./routes";

/**
 * GST billing: customers with a credit book, items, invoices with FY numbering, payments and receipts, public share
 * links and statements, WhatsApp/SMS sending with automatic reminders, online-payment glue and reports.
 */
export function createInvoices(deps: InvoicesDeps) {
  const service = new InvoicesService(deps);
  const module = defineModule({
    id: "invoices",
    tables: {
      billingCustomers,
      billingItems,
      invoices,
      invoicePayments,
      invoiceSeries,
      customerReceipts,
      invoiceReminders,
      invoiceMessages,
      creditNotes,
      creditNoteSeries,
      tillSessions,
    },
    routes: invoicesRoutes(service),
    features: INVOICE_FEATURES,
  });
  return { service, module };
}
