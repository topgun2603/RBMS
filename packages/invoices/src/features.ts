import type { FeatureDef } from "@srirealtime/core";

/** Feature keys declared by this module (docs/features.md). */
export const FEATURES = {
  base: "invoices",
  whatsapp: "invoices.whatsapp",
  reminders: "invoices.reminders",
  creditBook: "invoices.credit-book",
  reports: "invoices.reports",
  gstReports: "invoices.gst-reports",
  quotations: "invoices.quotations",
  salesDocs: "invoices.sales-docs",
} as const;

/** Payments' base feature: the public invoice only offers online payment when it is on. */
export const PAYMENTS_FEATURE = "payments";

export const INVOICE_FEATURES: FeatureDef[] = [
  {
    key: FEATURES.base,
    module: "invoices",
    label: "GST bills",
    description: "Create, issue and share GST invoices with customers and saved items.",
  },
  {
    key: FEATURES.whatsapp,
    module: "invoices",
    label: "Send bills on WhatsApp/SMS",
    description: "Send bills and payment reminders to customers on WhatsApp or SMS.",
    dependsOn: [FEATURES.base],
    shopToggle: true,
  },
  {
    key: FEATURES.reminders,
    module: "invoices",
    label: "Automatic payment reminders",
    description: "Remind customers automatically on WhatsApp when a bill is overdue.",
    dependsOn: [FEATURES.whatsapp],
    shopToggle: true,
  },
  {
    key: FEATURES.creditBook,
    module: "invoices",
    label: "Credit book",
    description: "Customer ledger, receipts, shareable statements and credit limits.",
    dependsOn: [FEATURES.base],
    shopToggle: true,
  },
  {
    key: FEATURES.reports,
    module: "invoices",
    label: "Sales, payments and dues reports",
    description: "Sales trend and register, payments, dues ageing and top items/customers.",
    dependsOn: [FEATURES.base],
  },
  {
    key: FEATURES.gstReports,
    module: "invoices",
    label: "GST reports",
    description: "GSTR-1/3B summaries with HSN, B2B, B2CL and B2CS exports.",
    dependsOn: [FEATURES.reports],
  },
  {
    key: FEATURES.quotations,
    module: "invoices",
    label: "Quotations",
    description: "Give customers a quotation before the order: share it, let them accept online, then make the bill or order in one tap.",
    dependsOn: [FEATURES.base],
    shopToggle: true,
  },
  {
    key: FEATURES.salesDocs,
    module: "invoices",
    label: "Proforma invoices, sale orders and delivery challans",
    description: "Proforma invoices for advances, sale orders with partial delivery, and delivery challans for goods sent before the bill, on approval or for job work.",
    dependsOn: [FEATURES.base],
    shopToggle: true,
  },
];
