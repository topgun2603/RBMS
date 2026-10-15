/** Shared test fixtures (not exported from index). */
import { sql } from "drizzle-orm";
import type { SqlMapping } from "./sql";
import type { DatasetDefinition } from "./types";

export const TENANT = "11111111-1111-4111-8111-111111111111";

export const salesDef: DatasetDefinition = {
  id: "test.sales",
  label: "Sales",
  module: "test",
  dateColumn: "date",
  defaultSort: { column: "date", dir: "desc" },
  columns: [
    { key: "date", label: "Date", type: "date", groupable: true },
    { key: "placedAt", label: "Placed", type: "date", groupable: true, default: false },
    { key: "number", label: "Bill no.", type: "text" },
    { key: "customer", label: "Customer", type: "text", groupable: true },
    {
      key: "status",
      label: "Status",
      type: "enum",
      groupable: true,
      options: [
        { value: "paid", label: "Paid" },
        { value: "issued", label: "Unpaid" },
      ],
    },
    { key: "qty", label: "Qty", type: "number", aggregatable: true },
    { key: "amount", label: "Amount", type: "money", aggregatable: true },
    { key: "rate", label: "Rate", type: "money", default: false },
    { key: "secret", label: "Internal", type: "text", filterable: false, default: false },
  ],
};

export const salesMapping = (tenantId = TENANT): SqlMapping => ({
  from: sql`sales s`,
  where: sql`s.tenant_id = ${tenantId}`,
  columns: {
    date: sql`s.date`,
    placedAt: { expr: sql`s.placed_at`, timestamp: true },
    number: sql`s.number`,
    customer: sql`s.customer->>'name'`,
    status: sql`s.status`,
    qty: sql`(s.qty)::numeric`,
    amount: sql`s.amount`,
    rate: sql`s.rate`,
    secret: sql`s.secret`,
  },
});

export const NOW = new Date("2026-10-15T06:30:00.000Z"); // 12:00 IST, Thursday
