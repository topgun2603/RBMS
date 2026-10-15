/**
 * EXAMPLE (documentation only, not exported): the invoices module's "Payments received" dataset — a plain join.
 * Shows a `timestamp: true` column (recorded at, a timestamptz) next to the IST `date` column used for ranges.
 */
import { sql } from "drizzle-orm";
import { datasetFromSql, type SqlExecutor } from "../sql";
import type { DatasetDefinition } from "../types";

export const paymentsDefinition: DatasetDefinition = {
  id: "invoices.payments",
  label: "Payments received",
  description: "Money received against bills, by date and payment mode.",
  module: "invoices",
  feature: "invoices.reports",
  dateColumn: "date",
  defaultSort: { column: "date", dir: "desc" },
  columns: [
    { key: "date", label: "Date", type: "date", groupable: true },
    { key: "recordedAt", label: "Recorded on", type: "date", groupable: true, default: false },
    {
      key: "method",
      label: "Mode",
      type: "enum",
      groupable: true,
      options: [
        { value: "cash", label: "Cash" },
        { value: "upi", label: "UPI" },
        { value: "card", label: "Card" },
        { value: "bank", label: "Bank transfer" },
        { value: "cheque", label: "Cheque" },
        { value: "other", label: "Other" },
      ],
    },
    {
      key: "source",
      label: "Recorded via",
      type: "enum",
      groupable: true,
      default: false,
      options: [
        { value: "manual", label: "On the bill" },
        { value: "receipt", label: "Receipt" },
        { value: "online", label: "Online payment" },
      ],
    },
    { key: "amount", label: "Amount", type: "money", aggregatable: true },
    { key: "reference", label: "Reference", type: "text", default: false },
    { key: "invoiceNumber", label: "Bill no.", type: "text" },
    { key: "customerName", label: "Customer", type: "text", groupable: true },
  ],
};

export function paymentsDataset(execute: SqlExecutor) {
  return datasetFromSql({
    definition: paymentsDefinition,
    execute,
    // Join on tenant too, so a bad invoice_id can never pull another shop's bill.
    from: sql`invoice_payments p JOIN invoices i ON i.id = p.invoice_id AND i.tenant_id = p.tenant_id`,
    where: (tenantId) => sql`p.tenant_id = ${tenantId} AND i.status <> 'cancelled'`,
    columns: {
      date: sql`p.date`,
      recordedAt: { expr: sql`p.created_at`, timestamp: true },
      method: sql`p.method`,
      source: sql`p.source`,
      amount: sql`p.amount`,
      reference: sql`p.reference`,
      invoiceNumber: sql`i.number`,
      customerName: sql`i.customer->>'name'`,
    },
  });
}
