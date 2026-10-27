/**
 * Source types of the entries Part B posts (bank, cheques, TDS/TCS, fixed assets, year-end close). They are origin
 * "auto" entries outside the document sync's list (rules.ts SOURCE_TYPES), so a sync never reverses them; each is
 * cancelled from its own screen with a `*_reversal` entry.
 */
export const PART_B_SOURCE_TYPES = [
  "bank_entry",
  "bank_entry_reversal",
  "bank_difference",
  "bank_difference_reversal",
  "cheque_bounce",
  "cheque_bounce_reversal",
  "tds_deduction",
  "tds_deduction_reversal",
  "tcs_collection",
  "tcs_collection_reversal",
  "tds_challan",
  "tds_challan_reversal",
  "asset_purchase",
  "asset_purchase_reversal",
  "asset_opening",
  "asset_opening_reversal",
  "depreciation",
  "depreciation_reversal",
  "asset_disposal",
  "asset_disposal_reversal",
  "year_close",
  "year_close_reversal",
] as const;
export type PartBSourceType = (typeof PART_B_SOURCE_TYPES)[number];

/** Closing journals: left out of the profit and loss and the trial balance's movement columns. */
export const CLOSING_SOURCE_TYPES: readonly PartBSourceType[] = ["year_close", "year_close_reversal"];

export const PART_B_LABELS: Readonly<Record<PartBSourceType, string>> = {
  bank_entry: "From the bank statement",
  bank_entry_reversal: "Bank statement entry cancelled",
  bank_difference: "Bank match difference",
  bank_difference_reversal: "Bank match difference cancelled",
  cheque_bounce: "Cheque bounce charges",
  cheque_bounce_reversal: "Cheque bounce charges cancelled",
  tds_deduction: "TDS deducted",
  tds_deduction_reversal: "TDS deduction cancelled",
  tcs_collection: "TCS collected",
  tcs_collection_reversal: "TCS collection cancelled",
  tds_challan: "TDS/TCS deposited (challan)",
  tds_challan_reversal: "Challan cancelled",
  asset_purchase: "Fixed asset bought",
  asset_purchase_reversal: "Fixed asset purchase cancelled",
  asset_opening: "Depreciation before the books started",
  asset_opening_reversal: "Opening depreciation cancelled",
  depreciation: "Depreciation",
  depreciation_reversal: "Depreciation cancelled",
  asset_disposal: "Fixed asset sold or scrapped",
  asset_disposal_reversal: "Asset sale cancelled",
  year_close: "Year-end closing entry",
  year_close_reversal: "Year re-opened (closing entry reversed)",
};
