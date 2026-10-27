import type { AccountType } from "./schema";

/** Account groups: the headings of the balance sheet and the profit and loss. */
export const ACCOUNT_GROUPS = [
  { key: "cash_bank", type: "asset", label: "Cash and bank", plain: "Money you hold" },
  { key: "receivables", type: "asset", label: "Customers (debtors)", plain: "Money customers owe you" },
  { key: "stock", type: "asset", label: "Stock in hand", plain: "Goods waiting to be sold" },
  { key: "tax_assets", type: "asset", label: "GST and tax credits", plain: "GST you paid on purchases (input credit) and tax others hold for you" },
  { key: "current_assets", type: "asset", label: "Other current assets", plain: "Advances, deposits and other short-term assets" },
  { key: "fixed_assets", type: "asset", label: "Fixed assets", plain: "Equipment, furniture, vehicles and other things you keep using" },
  { key: "payables", type: "liability", label: "Suppliers (creditors)", plain: "Money you owe suppliers" },
  { key: "tax_liabilities", type: "liability", label: "GST and taxes payable", plain: "GST you collected and tax you must pay" },
  { key: "current_liabilities", type: "liability", label: "Other current liabilities", plain: "Other bills and dues to pay soon" },
  { key: "loans", type: "liability", label: "Loans", plain: "Money you borrowed" },
  { key: "capital", type: "equity", label: "Owner's capital", plain: "Money you put in, take out, and the profit you keep" },
  { key: "sales", type: "income", label: "Sales", plain: "Money earned from selling" },
  { key: "other_income", type: "income", label: "Other income", plain: "Income apart from sales" },
  { key: "direct", type: "expense", label: "Purchases (cost of goods)", plain: "What the goods you sell cost you" },
  { key: "indirect", type: "expense", label: "Running expenses", plain: "Rent, salaries, electricity and other costs of running the shop" },
] as const satisfies readonly { key: string; type: AccountType; label: string; plain: string }[];

export type AccountGroupKey = (typeof ACCOUNT_GROUPS)[number]["key"];
export const GROUP_BY_KEY: Readonly<Record<string, (typeof ACCOUNT_GROUPS)[number]>> = Object.fromEntries(ACCOUNT_GROUPS.map((g) => [g.key, g]));
export const groupsOfType = (type: AccountType) => ACCOUNT_GROUPS.filter((g) => g.type === type);

/** Keys of the accounts the automatic postings use. */
export const SYS = {
  cash: "cash",
  bank: "bank",
  debtors: "debtors",
  stock: "stock",
  gstInCgst: "gst_in_cgst",
  gstInSgst: "gst_in_sgst",
  gstInIgst: "gst_in_igst",
  gstInCess: "gst_in_cess",
  tdsReceivable: "tds_receivable",
  tcsReceivable: "tcs_receivable",
  tillClearing: "till_clearing",
  creditors: "creditors",
  gstOutCgst: "gst_out_cgst",
  gstOutSgst: "gst_out_sgst",
  gstOutIgst: "gst_out_igst",
  gstOutCess: "gst_out_cess",
  taxPayable: "tax_payable",
  tdsPayable: "tds_payable",
  tcsPayable: "tcs_payable",
  capital: "capital",
  drawings: "drawings",
  openingEquity: "opening_equity",
  sales: "sales",
  salesReturns: "sales_returns",
  discountAllowed: "discount_allowed",
  otherIncome: "other_income",
  discountReceived: "discount_received",
  purchases: "purchases",
  purchaseReturns: "purchase_returns",
  roundOff: "round_off",
  cashShortExcess: "cash_short_excess",
  otherExpense: "other_expense",
  stockAdjustment: "stock_adjustment",
  compositionTax: "composition_tax",
  // ---- Part B (bank, TDS/TCS, fixed assets, year-end close)
  bankCharges: "bank_charges",
  interestReceived: "interest_received",
  interestPaid: "interest_paid",
  depreciation: "depreciation",
  accumulatedDepreciation: "accumulated_depreciation",
  assetDisposal: "asset_disposal",
  retainedEarnings: "retained_earnings",
  taxInterest: "tax_interest",
  // ---- payroll (packages/payroll, docs/payroll.md)
  salaries: "salaries",
  staffStatutory: "staff_statutory",
  salariesPayable: "salaries_payable",
  pfPayable: "pf_payable",
  esiPayable: "esi_payable",
  ptPayable: "pt_payable",
  salaryTdsPayable: "salary_tds_payable",
  staffAdvances: "staff_advances",
} as const;
export type SysKey = (typeof SYS)[keyof typeof SYS];

export interface ChartRow {
  code: string;
  name: string;
  type: AccountType;
  group: AccountGroupKey;
  subGroup?: string;
  key?: SysKey;
  isCash?: boolean;
  isBank?: boolean;
  /** One line in plain words, for the chart of accounts page. */
  about?: string;
}

/** Indian small-business standard chart (Tally-style groups), seeded for every shop on first use. */
export const STANDARD_CHART: readonly ChartRow[] = [
  // ---- assets
  { code: "1000", name: "Cash in hand", type: "asset", group: "cash_bank", key: SYS.cash, isCash: true, about: "The cash in your drawer and safe." },
  { code: "1010", name: "Bank account", type: "asset", group: "cash_bank", key: SYS.bank, isBank: true, about: "Your main bank account. UPI, card and bank receipts land here unless you choose another account." },
  { code: "1100", name: "Customers (sundry debtors)", type: "asset", group: "receivables", key: SYS.debtors, about: "What customers owe you. Matches the credit book." },
  { code: "1200", name: "Stock in hand", type: "asset", group: "stock", key: SYS.stock, about: "Value of unsold goods. The balance sheet takes the live stock value from Stock; enter the value you started with as the opening balance." },
  { code: "1300", name: "GST input credit - CGST", type: "asset", group: "tax_assets", subGroup: "GST input", key: SYS.gstInCgst, about: "CGST you paid on purchases and expenses." },
  { code: "1301", name: "GST input credit - SGST", type: "asset", group: "tax_assets", subGroup: "GST input", key: SYS.gstInSgst, about: "SGST you paid on purchases and expenses." },
  { code: "1302", name: "GST input credit - IGST", type: "asset", group: "tax_assets", subGroup: "GST input", key: SYS.gstInIgst, about: "IGST you paid on purchases from other states." },
  { code: "1303", name: "GST input credit - Cess", type: "asset", group: "tax_assets", subGroup: "GST input", key: SYS.gstInCess, about: "Cess you paid on purchases." },
  { code: "1310", name: "TDS receivable", type: "asset", group: "tax_assets", subGroup: "Income tax", key: SYS.tdsReceivable, about: "Tax deducted from your receipts by customers (placeholder, not posted automatically)." },
  { code: "1311", name: "TCS receivable", type: "asset", group: "tax_assets", subGroup: "Income tax", key: SYS.tcsReceivable, about: "Tax collected from you at source (placeholder, not posted automatically)." },
  { code: "1400", name: "Till cash in/out (to review)", type: "asset", group: "current_assets", key: SYS.tillClearing, about: "Cash put into or taken out of the POS drawer by hand. Review these and move them to the right account with a journal entry." },
  { code: "1500", name: "Furniture and equipment", type: "asset", group: "fixed_assets", about: "Shelves, counters, computers and other equipment." },
  { code: "1510", name: "Vehicles", type: "asset", group: "fixed_assets", about: "Vehicles used in the business." },
  // ---- liabilities
  { code: "2000", name: "Suppliers (sundry creditors)", type: "liability", group: "payables", key: SYS.creditors, about: "What you owe suppliers. Matches Payables." },
  { code: "2100", name: "GST output - CGST", type: "liability", group: "tax_liabilities", subGroup: "GST output", key: SYS.gstOutCgst, about: "CGST collected on your sales." },
  { code: "2101", name: "GST output - SGST", type: "liability", group: "tax_liabilities", subGroup: "GST output", key: SYS.gstOutSgst, about: "SGST collected on your sales." },
  { code: "2102", name: "GST output - IGST", type: "liability", group: "tax_liabilities", subGroup: "GST output", key: SYS.gstOutIgst, about: "IGST collected on sales to other states." },
  { code: "2103", name: "GST output - Cess", type: "liability", group: "tax_liabilities", subGroup: "GST output", key: SYS.gstOutCess, about: "Cess collected on your sales." },
  { code: "2110", name: "GST payable (net, after setting off credit)", type: "liability", group: "tax_liabilities", subGroup: "GST output", key: SYS.taxPayable, about: "Use this when you set off input credit against output and pay the balance to the government." },
  { code: "2120", name: "TDS payable", type: "liability", group: "tax_liabilities", subGroup: "Income tax", key: SYS.tdsPayable, about: "Tax you deducted from payments to suppliers and others and must deposit (posted from the TDS register)." },
  { code: "2121", name: "TCS payable", type: "liability", group: "tax_liabilities", subGroup: "Income tax", key: SYS.tcsPayable, about: "Tax you collected at source on sales and must deposit (posted from the TCS register)." },
  // Keyed for payroll; shops seeded before that have an unkeyed 2200, which `accountIdByKey` adopts.
  { code: "2200", name: "Salaries payable", type: "liability", group: "current_liabilities", key: SYS.salariesPayable, about: "Salaries earned by staff but not yet paid. A final payroll credits the net pay here; paying staff debits it." },
  { code: "2300", name: "Bank loan", type: "liability", group: "loans", about: "Loans from banks." },
  { code: "2310", name: "Loans from owner or others", type: "liability", group: "loans", about: "Money lent to the business by the owner, family or others." },
  // ---- equity
  { code: "3000", name: "Owner's capital", type: "equity", group: "capital", key: SYS.capital, about: "Money the owner put into the business." },
  { code: "3100", name: "Owner's drawings", type: "equity", group: "capital", key: SYS.drawings, about: "Money the owner took out for personal use." },
  { code: "3200", name: "Opening balance equity", type: "equity", group: "capital", key: SYS.openingEquity, about: "Balances you started with. The opening entries are balanced against this account." },
  // ---- income
  { code: "4000", name: "Sales", type: "income", group: "sales", key: SYS.sales, about: "Value of goods and services sold, before GST." },
  { code: "4010", name: "Sales returns", type: "income", group: "sales", key: SYS.salesReturns, about: "Value of goods customers returned (credit notes), before GST." },
  { code: "4020", name: "Discount allowed", type: "income", group: "sales", key: SYS.discountAllowed, about: "Discounts you gave on bills." },
  { code: "4100", name: "Other income", type: "income", group: "other_income", key: SYS.otherIncome, about: "Interest, commission and any other income." },
  { code: "4110", name: "Discount received", type: "income", group: "other_income", key: SYS.discountReceived, about: "Discounts suppliers gave you." },
  // ---- expenses
  { code: "5000", name: "Purchases", type: "expense", group: "direct", key: SYS.purchases, about: "Goods you bought for sale, before GST, with freight." },
  { code: "5010", name: "Purchase returns", type: "expense", group: "direct", key: SYS.purchaseReturns, about: "Goods sent back to suppliers (debit notes), before GST." },
  { code: "5900", name: "Round off", type: "expense", group: "indirect", key: SYS.roundOff, about: "Paise rounded to the rupee on bills and purchases." },
  { code: "5910", name: "Cash short and excess", type: "expense", group: "indirect", key: SYS.cashShortExcess, about: "Differences found when the till was counted." },
  { code: "5920", name: "Stock gains and write-offs", type: "expense", group: "indirect", key: SYS.stockAdjustment, about: "Value of stock added or written off by hand (found stock, damage, theft). Opening stock goes to Opening balance equity instead." },
  { code: "5930", name: "Composition tax", type: "expense", group: "indirect", key: SYS.compositionTax, about: "Tax a composition taxable person pays on turnover (CMP-08). It is an expense: a composition shop collects no GST and has no input credit." },
  { code: "5990", name: "Other expenses", type: "expense", group: "indirect", key: SYS.otherExpense, about: "Anything that does not fit another expense account." },
  // ---- Part B accounts (bank reconciliation, TDS/TCS, fixed assets, year-end close). Codes picked away from the ranges
  // used for accounts the owner adds (1700+, 2400+, 3300+, 4300+, 5300+); a clash falls back to a free code.
  { code: "1590", name: "Accumulated depreciation", type: "asset", group: "fixed_assets", key: SYS.accumulatedDepreciation, about: "Depreciation charged so far on your fixed assets. It reduces their value on the balance sheet (a credit balance)." },
  { code: "3050", name: "Retained earnings (profit kept)", type: "equity", group: "capital", key: SYS.retainedEarnings, about: "Profit of closed financial years carried forward. The year-end close moves each year's profit here." },
  { code: "4120", name: "Interest received", type: "income", group: "other_income", key: SYS.interestReceived, about: "Interest the bank or others paid you." },
  { code: "4130", name: "Profit or loss on sale of assets", type: "income", group: "other_income", key: SYS.assetDisposal, about: "What you gained (or lost) when you sold or scrapped a fixed asset." },
  { code: "5940", name: "Bank charges", type: "expense", group: "indirect", key: SYS.bankCharges, about: "Fees the bank takes: SMS, cheque book, card and UPI fees, bounced cheque charges." },
  { code: "5945", name: "Interest paid", type: "expense", group: "indirect", key: SYS.interestPaid, about: "Interest on loans and overdrafts." },
  { code: "5950", name: "Depreciation", type: "expense", group: "indirect", key: SYS.depreciation, about: "The part of your equipment, furniture and vehicles used up this period." },
  { code: "5955", name: "Interest and late fee on taxes", type: "expense", group: "indirect", key: SYS.taxInterest, about: "Interest and late fees paid on TDS/TCS or other taxes." },
  // ---- payroll accounts (posted from final payrolls, salary payments, advances and statutory challans)
  { code: "1410", name: "Advances to staff", type: "asset", group: "current_assets", subGroup: "Staff", key: SYS.staffAdvances, about: "Salary advances and loans given to staff, less what payroll has recovered." },
  { code: "2210", name: "PF payable", type: "liability", group: "current_liabilities", subGroup: "Staff dues", key: SYS.pfPayable, about: "Provident fund deducted from staff plus the shop's share, to deposit with EPFO." },
  { code: "2211", name: "ESI payable", type: "liability", group: "current_liabilities", subGroup: "Staff dues", key: SYS.esiPayable, about: "ESI deducted from staff plus the shop's share, to deposit with ESIC." },
  { code: "2212", name: "Professional tax payable", type: "liability", group: "tax_liabilities", subGroup: "Staff dues", key: SYS.ptPayable, about: "Professional tax deducted from salaries, to pay to the local body." },
  { code: "2213", name: "TDS on salaries payable", type: "liability", group: "tax_liabilities", subGroup: "Income tax", key: SYS.salaryTdsPayable, about: "Income tax deducted from salaries, to deposit (Form 24Q is filed outside RBMS)." },
  { code: "5960", name: "Salaries and wages", type: "expense", group: "indirect", key: SYS.salaries, about: "Gross salaries, wages, overtime and bonus from payroll. Do not also record salaries in Expenses." },
  { code: "5965", name: "Employer PF and ESI", type: "expense", group: "indirect", key: SYS.staffStatutory, about: "The shop's own share of PF and ESI on salaries." },
];

/** First code of expense-category accounts created on demand from the Expenses categories. */
export const EXPENSE_CATEGORY_CODE_BASE = 6000;

/** Debit-positive "normal side" of each type. */
export const NORMAL_SIDE: Readonly<Record<AccountType, "dr" | "cr">> = {
  asset: "dr",
  expense: "dr",
  liability: "cr",
  equity: "cr",
  income: "cr",
};
