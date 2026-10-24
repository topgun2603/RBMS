import { defineModule } from "@srirealtime/core";
import { ACCOUNTING_FEATURES, ACCOUNTING_PERMISSIONS } from "./features";
import { accountingRoutes } from "./routes";
import { acctAccounts, acctEntries, acctLines, acctLockLog, acctSettings } from "./schema";
import { AccountingService, type AccountingDeps } from "./service";

export * from "./schema";
export * from "./features";
export * from "./ports";
export * from "./chart";
export * from "./rules";
export * from "./reports-logic";
export * from "./tables";
export { reportBodyHtml, REPORT_CSS } from "./pdf";
export { accountingRoutes } from "./routes";
export { AccountingService, kindLabel, MAX_PAISE, accountInput, accountPatch, entryInput, entryListQuery, lockInput, reverseInput, settingsPatch, backfillInput } from "./service";
export type { AccountingDeps, EntryListQuery, EntryView, SyncResult, ReconcileCheck, PartyDifference } from "./service";

/**
 * Double-entry books for a small shop: a chart of accounts seeded per shop, immutable journal entries, a period lock,
 * automatic postings from bills, purchases, payments and expenses (read through ports), and the standard reports.
 */
export function createAccounting(deps: AccountingDeps) {
  const service = new AccountingService(deps);
  const module = defineModule({
    id: "accounting",
    tables: { acctAccounts, acctEntries, acctLines, acctSettings, acctLockLog },
    routes: accountingRoutes(service),
    features: ACCOUNTING_FEATURES,
    permissions: ACCOUNTING_PERMISSIONS,
  });
  return { service, module };
}
