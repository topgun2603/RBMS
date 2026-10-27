// @srirealtime/billing-ui: the billing UI module (docs/web-modules.md).
import { partBMessages, withAccountingPartB } from "./accounting-b";
import { billingModule as baseBillingModule, type BillingModuleOptions } from "./module";
import { billingMessages as baseBillingMessages } from "./lib/messages";
import { salesDocsMessages, withSalesDocs } from "./sales-docs";

export { BILLING_FEATURES, type BillingModuleOptions } from "./module";

/**
 * The billing UI module with the accounting Part B screens (bank, cheques, TDS/TCS, fixed assets, year-end close) and
 * proforma invoices, sale orders and delivery challans (docs/sales-documents.md).
 */
export function billingModule(opts: BillingModuleOptions = {}) {
  return withSalesDocs(withAccountingPartB(baseBillingModule(opts)));
}

export const billingMessages = {
  en: { ...baseBillingMessages.en, ...partBMessages.en, ...salesDocsMessages.en },
  ta: { ...baseBillingMessages.ta, ...partBMessages.ta, ...salesDocsMessages.ta },
};
