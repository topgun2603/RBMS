import { defineModule } from "@srirealtime/core";
import { EXPENSES_FEATURES, EXPENSES_PERMISSIONS } from "./ports";
import { expensesRoutes } from "./routes";
import { RecurringExpensesService } from "./recurring";
import { expenseCategories, expenseRecurring, expenseRecurringRuns, expenses } from "./schema";
import { ExpensesService, type ExpensesDeps } from "./service";

export * from "./schema";
export * from "./logic";
export * from "./ports";
export * from "./csv";
export * from "./recurring";
export {
  ExpensesService,
  EXPENSE_REPORT_GROUPS,
  expenseBalance,
  expenseRecordInput,
  groupExpenses,
  categoryInput as expenseCategoryInput,
  categoryPatch as expenseCategoryPatch,
  expenseInput,
  expensePatch,
  listQuery as expenseListQuery,
  reportRange,
  MAX_PAISE,
  MAX_REPORT_DAYS,
} from "./service";
export type { ExpenseInput, ExpenseList, ExpenseListQuery, ExpensePatch, ExpenseReport, ExpenseReportGroup, ExpenseReportRow, ExpenseView, ExpensesDeps } from "./service";
export {
  expensesRoutes,
  expenseCategoryListSchema,
  expenseCategorySchema,
  expenseListSchema,
  expenseSchema,
  expenseSummarySchema,
} from "./routes";

/** The scheduled job that makes the day's recurring expenses (docs/expenses-debit-notes.md). */
export const RECURRING_EXPENSES_JOB = "expenses.recurring";
/** 06:20 IST daily (after the recurring invoices at 06:15). */
export const RECURRING_EXPENSES_CRON = "20 6 * * *";

/**
 * Shop expenses with GST input credit, suppliers (bought on credit = a bill in Payables), branches, recurring expenses,
 * a summary by category/month, the expense report and a profit report.
 */
export function createExpenses(deps: ExpensesDeps) {
  const service = new ExpensesService(deps);
  const recurring = new RecurringExpensesService({ db: deps.db, expenses: service, lockedThrough: deps.lockedThrough, isEnabled: deps.isEnabled, log: deps.log, now: deps.now });
  const module = defineModule({
    id: "expenses",
    tables: { expenseCategories, expenses, expenseRecurring, expenseRecurringRuns },
    routes: expensesRoutes(service, recurring),
    features: EXPENSES_FEATURES,
    permissions: EXPENSES_PERMISSIONS,
  });
  return { service, recurring, module, runDue: () => recurring.runDue() };
}
