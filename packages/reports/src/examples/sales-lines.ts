/**
 * EXAMPLE (documentation only, not exported): how the invoices module would declare its "Sales lines" dataset.
 * At integration this lives in packages/invoices (or apps/api kit) and is registered with
 * `reports.service.registerDataset(salesLinesDataset(db))`.
 *
 * One row per line of every issued (non-draft, non-cancelled) bill, from `jsonb_array_elements(invoices.lines)`.
 * Money in paise. `invoices.date` is a Postgres `date` already in IST, so no `timestamp: true`.
 */
import { sql } from "drizzle-orm";
import { datasetFromSql, type SqlExecutor } from "../sql";
import type { DatasetDefinition } from "../types";

const STATUS_OPTIONS = [
  { value: "issued", label: "Unpaid" },
  { value: "partially_paid", label: "Partly paid" },
  { value: "paid", label: "Paid" },
];

const GST_RATE_OPTIONS = ["0", "0.25", "3", "5", "12", "18", "28"].map((v) => ({ value: v, label: `${v}%` }));

export const salesLinesDefinition: DatasetDefinition = {
  id: "invoices.sales-lines",
  label: "Sales lines",
  description: "Every item sold on a bill: quantity, taxable value and GST.",
  module: "invoices",
  feature: "invoices.reports",
  dateColumn: "date",
  defaultSort: { column: "date", dir: "desc" },
  columns: [
    { key: "date", label: "Bill date", type: "date", groupable: true },
    { key: "invoiceNumber", label: "Bill no.", type: "text" },
    { key: "customerName", label: "Customer", type: "text", groupable: true },
    { key: "status", label: "Payment status", type: "enum", options: STATUS_OPTIONS, groupable: true },
    { key: "item", label: "Item", type: "text", groupable: true },
    { key: "hsn", label: "HSN/SAC", type: "text", groupable: true, default: false },
    { key: "gstRate", label: "GST rate", type: "enum", options: GST_RATE_OPTIONS, groupable: true },
    { key: "qty", label: "Qty", type: "number", aggregatable: true },
    { key: "rate", label: "Rate", type: "money", default: false },
    { key: "taxable", label: "Taxable value", type: "money", aggregatable: true },
    { key: "gst", label: "GST", type: "money", aggregatable: true },
    { key: "total", label: "Line total", type: "money", aggregatable: true },
  ],
};

/** `execute` is `(q) => db.execute(q)` with the app's drizzle Db. */
export function salesLinesDataset(execute: SqlExecutor) {
  return datasetFromSql({
    definition: salesLinesDefinition,
    execute,
    from: sql`invoices i CROSS JOIN LATERAL jsonb_array_elements(i.lines) AS l(line)`,
    // The tenant filter is mandatory; the rest is the dataset's fixed scope.
    where: (tenantId) => sql`i.tenant_id = ${tenantId} AND i.status NOT IN ('draft', 'cancelled')`,
    columns: {
      date: sql`i.date`,
      invoiceNumber: sql`i.number`,
      customerName: sql`i.customer->>'name'`,
      status: sql`i.status`,
      item: sql`l.line->>'description'`,
      hsn: sql`l.line->>'hsn'`,
      // enum values are text: normalise the numeric rate ("18" not "18.0").
      gstRate: sql`((l.line->>'gstRate')::numeric)::text`,
      qty: sql`(l.line->>'qty')::numeric`,
      rate: sql`(l.line->>'rate')::bigint`,
      taxable: sql`(l.line->>'taxable')::bigint`,
      gst: sql`((l.line->>'cgst')::bigint + (l.line->>'sgst')::bigint + (l.line->>'igst')::bigint)`,
      total: sql`(l.line->>'total')::bigint`,
    },
  });
}
