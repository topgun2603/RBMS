import { defineModule } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { AssetService, YearEndService } from "./assets";
import { BankService } from "./bank";
import { ACCOUNTING_FEATURES, ACCOUNTING_PERMISSIONS } from "./features";
import { accountingRoutes } from "./routes";
import { partBRoutes } from "./routes-b";
import {
  acctAccounts,
  acctBankLines,
  acctBankMatches,
  acctBankRecons,
  acctBankStatements,
  acctCheques,
  acctDepreciation,
  acctEntries,
  acctFixedAssets,
  acctLines,
  acctLockLog,
  acctPartyTax,
  acctSettings,
  acctTdsChallans,
  acctTdsEntries,
  acctTdsSettings,
  acctYearCloses,
} from "./schema";
import { AccountingService, type AccountingDeps } from "./service";
import { TdsService } from "./tds";

export * from "./schema";
export * from "./features";
export * from "./ports";
export * from "./chart";
export * from "./rules";
export * from "./reports-logic";
export * from "./tables";
export * from "./part-b-types";
export * from "./bank-import";
export * from "./bank-match";
export * from "./tds-rules";
export * from "./assets-logic";
export { readXlsx, SpreadsheetError } from "./xlsx-lite";
export { reportBodyHtml, REPORT_CSS } from "./pdf";
export { accountingRoutes } from "./routes";
export { partBRoutes } from "./routes-b";
export { BankService } from "./bank";
export { TdsService } from "./tds";
export { AssetService, YearEndService } from "./assets";
export { AccountingService, kindLabel, MAX_PAISE, accountInput, accountPatch, entryInput, entryListQuery, lockInput, reverseInput, settingsPatch, backfillInput } from "./service";
export type { AccountingDeps, EntryListQuery, EntryView, SyncResult, ReconcileCheck, PartyDifference } from "./service";

/**
 * Double-entry books for a small shop: a chart of accounts seeded per shop, immutable journal entries, a period lock,
 * automatic postings from bills, purchases, payments and expenses (read through ports), and the standard reports.
 * Part B: bank statements and reconciliation, the cheque register, TDS/TCS, fixed assets and depreciation, and the
 * year-end close (docs/accounting.md, docs/bank-reconciliation.md, docs/tds.md).
 */
export function createAccounting(deps: AccountingDeps) {
  const service = new AccountingService(deps);
  const bank = new BankService({ db: deps.db, acct: service, now: deps.now });
  const tds = new TdsService({ db: deps.db, acct: service, sources: deps.sources, shopName: deps.shopName });
  const assets = new AssetService({ db: deps.db, acct: service });
  const yearEnd = new YearEndService({ db: deps.db, acct: service, assets });
  // CSV / PDF of the Part B reports through the same report-table path as the Part A reports.
  service.extraReport = async (tenantId, report, q, shop) => {
    switch (report) {
      case "bank-reconciliation":
        return bank.reconciliationTable(tenantId, q, shop);
      case "tds-quarterly":
        return tds.quarterlyTable(await tds.quarterly(tenantId, q), shop);
      case "tds-certificate":
        return tds.certificate(tenantId, q);
      default:
        return null;
    }
  };
  const base = accountingRoutes(service);
  const partB = partBRoutes({ bank, tds, assets, yearEnd, sources: deps.sources, shopName: deps.shopName, today: () => service.today() });
  const module = defineModule({
    id: "accounting",
    tables: {
      acctAccounts,
      acctEntries,
      acctLines,
      acctSettings,
      acctLockLog,
      acctBankStatements,
      acctBankLines,
      acctBankMatches,
      acctBankRecons,
      acctCheques,
      acctTdsSettings,
      acctPartyTax,
      acctTdsEntries,
      acctTdsChallans,
      acctFixedAssets,
      acctDepreciation,
      acctYearCloses,
    },
    routes: async (app: FastifyInstance) => {
      await base(app);
      await partB(app);
    },
    features: ACCOUNTING_FEATURES,
    permissions: ACCOUNTING_PERMISSIONS,
  });
  return { service, bank, tds, assets, yearEnd, module };
}
