import { defineModule } from "@srirealtime/core";
import { EXPENSES_FEATURES, EXPENSES_PERMISSIONS } from "./ports";
import { expensesRoutes } from "./routes";
import { expenseCategories, expenses } from "./schema";
import { ExpensesService, type ExpensesDeps } from "./service";

export * from "./schema";
export * from "./logic";
export * from "./ports";
export * from "./csv";
export {
  ExpensesService,
  expenseInput,
  expensePatch,
  listQuery as expenseListQuery,
  reportRange,
  MAX_PAISE,
  MAX_REPORT_DAYS,
} from "./service";
export type { ExpenseInput, ExpenseList, ExpenseListQuery, ExpensePatch, ExpenseView, ExpensesDeps } from "./service";
export { expensesRoutes } from "./routes";

/** Shop expenses with GST input credit, a summary by category/month and a profit report. */
export function createExpenses(deps: ExpensesDeps) {
  const service = new ExpensesService(deps);
  const module = defineModule({
    id: "expenses",
    tables: { expenseCategories, expenses },
    routes: expensesRoutes(service),
    features: EXPENSES_FEATURES,
    permissions: EXPENSES_PERMISSIONS,
  });
  return { service, module };
}
