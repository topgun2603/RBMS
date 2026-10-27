import { pk, tenantId, timestamps } from "@srirealtime/db";
import type { ScheduleFrequency } from "@srirealtime/core";
import { boolean, date, index, integer, pgTable, real, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

/**
 * `draft`: made by a recurring expense ("ask each time", or "make a draft") and waiting for the owner to check or fill
 * the amount; not in totals, the books or GST until recorded.
 */
export const EXPENSE_STATUSES = ["recorded", "cancelled", "draft"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

/**
 * `credit`: not paid yet. Needs a supplier; the expense is a bill in that supplier's Payables (ledger, ageing) and is
 * paid through "Pay supplier" (docs/expenses-debit-notes.md).
 */
export const EXPENSE_PAYMENT_METHODS = ["cash", "upi", "card", "bank", "cheque", "other", "credit"] as const;
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
    /** Supplier (inventory `suppliers`) the bill is from; optional. Required when `paymentMethod` is "credit". */
    supplierId: uuid("supplier_id"),
    /** Branch the expense belongs to (null = shop-wide). */
    branchId: uuid("branch_id"),
    /** Credit expenses: when the supplier expects to be paid (ageing counts from it; the expense date when null). */
    dueDate: date("due_date", { mode: "string" }),
    /** Credit expenses: paise paid through Payables (kept in step with the supplier payment rows). */
    amountPaid: integer("amount_paid").notNull().default(0),
    /** The recurring expense and its run that made this expense (null = entered by hand). */
    recurringId: uuid("recurring_id"),
    recurringRunId: uuid("recurring_run_id"),
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
    index("expenses_tenant_supplier_idx").on(t.tenantId, t.supplierId),
    index("expenses_tenant_branch_idx").on(t.tenantId, t.branchId, t.date),
    unique("expenses_recurring_run_uq").on(t.recurringRunId),
  ],
);

// ------------------------------------------------------------------ recurring expenses

/** `ended`: the end date was reached (or the owner ended it). */
export const EXPENSE_RECURRING_STATUSES = ["active", "paused", "ended"] as const;
export type ExpenseRecurringStatus = (typeof EXPENSE_RECURRING_STATUSES)[number];

/** What a run makes: a recorded expense (posted to the books) or a draft to check. "Ask each time" always makes a draft. */
export const EXPENSE_RECURRING_MODES = ["auto", "draft"] as const;
export type ExpenseRecurringMode = (typeof EXPENSE_RECURRING_MODES)[number];

/**
 * `created`: a recorded expense was made; `draft`: a draft was made (reminder to fill / check); `skipped`: skipped by
 * the owner, or a missed date older than the catch-up cap; `locked`: the date is in a locked accounting period.
 */
export const EXPENSE_RUN_STATUSES = ["created", "draft", "skipped", "locked"] as const;
export type ExpenseRunStatus = (typeof EXPENSE_RUN_STATUSES)[number];

/** A repeating expense (rent, electricity, a subscription ...): the expense it makes and its schedule. */
export const expenseRecurring = pgTable(
  "expense_recurring",
  {
    id: pk(),
    tenantId: tenantId(),
    /** Shown in the list, e.g. "Shop rent". */
    name: text("name").notNull(),
    categoryId: uuid("category_id").notNull(),
    supplierId: uuid("supplier_id"),
    branchId: uuid("branch_id"),
    vendorName: text("vendor_name"),
    vendorGstin: text("vendor_gstin"),
    /** Paise including GST; null = "ask each time" (each run makes a draft to fill). */
    amount: integer("amount"),
    gstRate: real("gst_rate").notNull().default(0),
    paymentMethod: text("payment_method").$type<ExpensePaymentMethod>().notNull().default("cash"),
    /** Credit expenses: due date = expense date + this many days. */
    dueDays: integer("due_days"),
    note: text("note"),
    mode: text("mode").$type<ExpenseRecurringMode>().notNull().default("auto"),
    frequency: text("frequency").$type<ScheduleFrequency>().notNull(),
    interval: integer("interval").notNull().default(1),
    dayOfMonth: integer("day_of_month"),
    weekday: integer("weekday"),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    nextRunDate: date("next_run_date", { mode: "string" }),
    status: text("status").$type<ExpenseRecurringStatus>().notNull().default("active"),
    /** Expenses (recorded or draft) made so far. */
    count: integer("count").notNull().default(0),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [index("expense_recurring_tenant_status_idx").on(t.tenantId, t.status), index("expense_recurring_due_idx").on(t.status, t.nextRunDate)],
);

/** One scheduled date of a recurring expense. Unique per (recurring, date): a job that runs twice makes one expense. */
export const expenseRecurringRuns = pgTable(
  "expense_recurring_runs",
  {
    id: pk(),
    tenantId: tenantId(),
    recurringId: uuid("recurring_id")
      .notNull()
      .references(() => expenseRecurring.id, { onDelete: "cascade" }),
    runDate: date("run_date", { mode: "string" }).notNull(),
    status: text("status").$type<ExpenseRunStatus>().notNull(),
    expenseId: uuid("expense_id"),
    error: text("error"),
    /** "auto" (the scheduler), "manual" (Make now), "user" (skipped by the owner). */
    trigger: text("trigger").notNull().default("auto"),
    ...timestamps(),
  },
  (t) => [
    unique("expense_recurring_runs_date_uq").on(t.recurringId, t.runDate),
    index("expense_recurring_runs_tenant_idx").on(t.tenantId, t.recurringId, t.runDate),
  ],
);

export type ExpenseCategory = typeof expenseCategories.$inferSelect;
export type ExpenseRow = typeof expenses.$inferSelect;
export type ExpenseRecurringRow = typeof expenseRecurring.$inferSelect;
export type ExpenseRecurringRunRow = typeof expenseRecurringRuns.$inferSelect;
