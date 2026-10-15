import { pk, tenantId, timestamps } from "@srirealtime/db";
import { boolean, date, index, integer, pgTable, real, text, unique, uuid } from "drizzle-orm/pg-core";

export const EXPENSE_STATUSES = ["recorded", "cancelled"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const EXPENSE_PAYMENT_METHODS = ["cash", "upi", "card", "bank", "cheque", "other"] as const;
export type ExpensePaymentMethod = (typeof EXPENSE_PAYMENT_METHODS)[number];

/** Seeded lazily (first read) for each shop. Built-in categories can be renamed or re-sorted but not deleted. */
export const BUILTIN_CATEGORIES = ["Rent", "Salaries", "Electricity", "Transport", "Packaging", "Marketing", "Repairs", "Other"] as const;

export const expenseCategories = pgTable(
  "expense_categories",
  {
    id: pk(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    sort: integer("sort").notNull().default(0),
    builtin: boolean("builtin").notNull().default(false),
    ...timestamps(),
  },
  (t) => [unique("expense_categories_tenant_name_uq").on(t.tenantId, t.name)],
);

export const expenses = pgTable(
  "expenses",
  {
    id: pk(),
    tenantId: tenantId(),
    date: date("date", { mode: "string" }).notNull(),
    categoryId: uuid("category_id").notNull(),
    /** Paise, including GST. */
    amount: integer("amount").notNull(),
    gstRate: real("gst_rate").notNull().default(0),
    /** Paise of GST inside `amount`; claimable as ITC only when a valid vendor GSTIN is given. */
    gstAmount: integer("gst_amount").notNull().default(0),
    vendorName: text("vendor_name"),
    vendorGstin: text("vendor_gstin"),
    paymentMethod: text("payment_method").$type<ExpensePaymentMethod>().notNull().default("cash"),
    reference: text("reference"),
    note: text("note"),
    receiptUrl: text("receipt_url"),
    status: text("status").$type<ExpenseStatus>().notNull().default("recorded"),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [
    index("expenses_tenant_date_idx").on(t.tenantId, t.date),
    index("expenses_tenant_category_idx").on(t.tenantId, t.categoryId),
  ],
);

export type ExpenseCategory = typeof expenseCategories.$inferSelect;
export type ExpenseRow = typeof expenses.$inferSelect;
