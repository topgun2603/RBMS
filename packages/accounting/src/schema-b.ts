/**
 * Accounting Part B tables: bank statements and reconciliation, the cheque register, TDS/TCS, fixed assets and
 * depreciation, and the year-end close. Re-exported by schema.ts (drizzle-kit reads that file). Every table is
 * tenant-scoped; journal postings still go through acct_entries / acct_lines (immutable) and are only linked here.
 */
import { pk, tenantId, timestamps } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// ------------------------------------------------------------------ bank statements and reconciliation

/** One imported statement file (an import batch) for a bank account. */
export const acctBankStatements = pgTable(
  "acct_bank_statements",
  {
    id: pk(),
    tenantId: tenantId(),
    /** The bank account (acct_accounts.id with is_bank). */
    accountId: uuid("account_id").notNull(),
    fileName: text("file_name"),
    /** Detected layout: hdfc, icici, sbi, axis, kotak, generic. */
    layout: text("layout").notNull(),
    fromDate: date("from_date", { mode: "string" }),
    toDate: date("to_date", { mode: "string" }),
    /** Paise, from the balance column when the file has one. */
    openingBalance: integer("opening_balance"),
    closingBalance: integer("closing_balance"),
    rows: integer("rows").notNull().default(0),
    added: integer("added").notNull().default(0),
    duplicates: integer("duplicates").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    mapping: jsonb("mapping").$type<Record<string, unknown>>(),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("acct_bank_statements_tenant_account_idx").on(t.tenantId, t.accountId, t.createdAt)],
);

export const BANK_LINE_STATUSES = ["open", "matched", "excluded"] as const;
export type BankLineStatus = (typeof BANK_LINE_STATUSES)[number];

/**
 * A line of a bank statement. `hash` = date + amount + reference + narration (+ the occurrence number of identical
 * lines in one file), unique per account, so importing the same or an overlapping file again adds nothing.
 * Amounts in paise: `amount` is signed from the bank's side (+ money in / deposit, - money out / withdrawal).
 */
export const acctBankLines = pgTable(
  "acct_bank_lines",
  {
    id: pk(),
    tenantId: tenantId(),
    accountId: uuid("account_id").notNull(),
    statementId: uuid("statement_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    valueDate: date("value_date", { mode: "string" }),
    narration: text("narration").notNull().default(""),
    reference: text("reference"),
    amount: integer("amount").notNull(),
    /** Running balance printed on the statement (paise), when the file has one. */
    balance: integer("balance"),
    /** Order inside the statement (oldest first), to read the balance on a date. */
    seq: integer("seq").notNull().default(0),
    hash: text("hash").notNull(),
    status: text("status").$type<BankLineStatus>().notNull().default("open"),
    /** Match group (acct_bank_matches.group_id) while matched. */
    matchGroupId: uuid("match_group_id"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("acct_bank_lines_account_hash_uq").on(t.tenantId, t.accountId, t.hash),
    index("acct_bank_lines_tenant_account_date_idx").on(t.tenantId, t.accountId, t.date),
    index("acct_bank_lines_tenant_status_idx").on(t.tenantId, t.accountId, t.status),
  ],
);

/**
 * Links statement lines to book lines (acct_lines on the bank account). One group = n statement lines and m book
 * lines whose amounts are equal in total (one-to-one, one-to-many, many-to-one). Each line is in at most one group.
 * Removing the group (unmatch) is allowed until it is reconciled.
 */
export const acctBankMatches = pgTable(
  "acct_bank_matches",
  {
    id: pk(),
    tenantId: tenantId(),
    accountId: uuid("account_id").notNull(),
    groupId: uuid("group_id").notNull(),
    /** Exactly one of the two is set. */
    bankLineId: uuid("bank_line_id"),
    acctLineId: uuid("acct_line_id"),
    /** auto (accepted suggestion), manual, created (entry made from the statement line). */
    method: text("method").notNull().default("manual"),
    confidence: integer("confidence"),
    /** Set when the reconciliation up to a date was confirmed; the group can no longer be undone. */
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("acct_bank_matches_bank_line_uq").on(t.tenantId, t.bankLineId).where(sql`${t.bankLineId} is not null`),
    uniqueIndex("acct_bank_matches_acct_line_uq").on(t.tenantId, t.acctLineId).where(sql`${t.acctLineId} is not null`),
    index("acct_bank_matches_tenant_group_idx").on(t.tenantId, t.groupId),
  ],
);

/** Per bank account: how far it has been reconciled, with who and the figures of the last confirmation. */
export const acctBankRecons = pgTable(
  "acct_bank_recons",
  {
    id: pk(),
    tenantId: tenantId(),
    accountId: uuid("account_id").notNull(),
    asOf: date("as_of", { mode: "string" }).notNull(),
    bookBalance: integer("book_balance").notNull(),
    bankBalance: integer("bank_balance").notNull(),
    difference: integer("difference").notNull(),
    note: text("note"),
    userId: uuid("user_id"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("acct_bank_recons_tenant_account_idx").on(t.tenantId, t.accountId, t.asOf)],
);

export const CHEQUE_DIRECTIONS = ["issued", "received"] as const;
export type ChequeDirection = (typeof CHEQUE_DIRECTIONS)[number];
export const CHEQUE_STATUSES = ["pending", "deposited", "cleared", "bounced", "cancelled"] as const;
export type ChequeStatus = (typeof CHEQUE_STATUSES)[number];

/**
 * Cheques written (issued) and received, including post-dated ones. Status: pending (issued / received, not yet
 * presented) -> deposited (received cheques) -> cleared or bounced; cancelled. The cheque number feeds the matching.
 */
export const acctCheques = pgTable(
  "acct_cheques",
  {
    id: pk(),
    tenantId: tenantId(),
    direction: text("direction").$type<ChequeDirection>().notNull(),
    /** Our bank account the cheque is drawn on (issued) or deposited into (received). */
    accountId: uuid("account_id").notNull(),
    chequeNo: text("cheque_no").notNull(),
    chequeDate: date("cheque_date", { mode: "string" }).notNull(),
    amount: integer("amount").notNull(),
    partyType: text("party_type"),
    partyId: uuid("party_id"),
    partyName: text("party_name").notNull().default(""),
    /** Drawee bank of a received cheque. */
    drawnOn: text("drawn_on"),
    status: text("status").$type<ChequeStatus>().notNull().default("pending"),
    depositedOn: date("deposited_on", { mode: "string" }),
    clearedOn: date("cleared_on", { mode: "string" }),
    bouncedOn: date("bounced_on", { mode: "string" }),
    bounceReason: text("bounce_reason"),
    bounceCharges: integer("bounce_charges").notNull().default(0),
    /** The book line (acct_lines) of the payment / receipt, when known. */
    acctLineId: uuid("acct_line_id"),
    /** Entries posted by the register: the bounce charges and, for manual entries, the reversal. */
    entryIds: jsonb("entry_ids").$type<string[]>().notNull().default([]),
    note: text("note"),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [
    index("acct_cheques_tenant_status_idx").on(t.tenantId, t.status, t.chequeDate),
    index("acct_cheques_tenant_no_idx").on(t.tenantId, t.chequeNo),
  ],
);

// ------------------------------------------------------------------ TDS / TCS

/** One row per shop: TAN, which sections are used, rate/threshold overrides, TCS switch. */
export const acctTdsSettings = pgTable(
  "acct_tds_settings",
  {
    id: pk(),
    tenantId: tenantId(),
    enabled: boolean("enabled").notNull().default(false),
    tcsEnabled: boolean("tcs_enabled").notNull().default(false),
    tan: text("tan"),
    deductorName: text("deductor_name"),
    responsiblePerson: text("responsible_person"),
    /** The shop's own turnover last year was above Rs 10 crore (section 194Q applies to it as a buyer). */
    buyerTurnoverAbove10Cr: boolean("buyer_turnover_above_10cr").notNull().default(false),
    /** Section key -> { rate, rateOther, noPanRate, single, annual, enabled } overrides (rates in basis points). */
    overrides: jsonb("overrides").$type<Record<string, Record<string, number | boolean | null>>>().notNull().default({}),
    ...timestamps(),
  },
  (t) => [unique("acct_tds_settings_tenant_uq").on(t.tenantId)],
);

export const DEDUCTEE_TYPES = ["individual", "huf", "company", "firm", "other"] as const;
export type DeducteeType = (typeof DEDUCTEE_TYPES)[number];

/** PAN and TDS details of a supplier or customer (the parties' own tables are not changed). */
export const acctPartyTax = pgTable(
  "acct_party_tax",
  {
    id: pk(),
    tenantId: tenantId(),
    partyType: text("party_type").notNull(),
    partyId: uuid("party_id").notNull(),
    pan: text("pan"),
    deducteeType: text("deductee_type").$type<DeducteeType>(),
    /** Section used by default when deducting from this party (e.g. 194C). */
    defaultSection: text("default_section"),
    /** Lower / nil deduction certificate (section 197): rate in basis points, number and validity. */
    lowerRate: integer("lower_rate"),
    certificateNo: text("certificate_no"),
    certificateUntil: date("certificate_until", { mode: "string" }),
    ...timestamps(),
  },
  (t) => [unique("acct_party_tax_party_uq").on(t.tenantId, t.partyType, t.partyId)],
);

export const TAX_KINDS = ["tds", "tcs"] as const;
export type TaxKind = (typeof TAX_KINDS)[number];

/**
 * Tax deducted (TDS) or collected (TCS). Posting: TDS on a supplier bill or payment Dr Creditors / Cr TDS payable (and
 * the same amount settled on the bill in Payables); TDS on an expense Dr the expense's money account / Cr TDS payable;
 * TCS Dr Debtors / Cr TCS payable. Cancelled rows keep their reversal entry.
 */
export const acctTdsEntries = pgTable(
  "acct_tds_entries",
  {
    id: pk(),
    tenantId: tenantId(),
    kind: text("kind").$type<TaxKind>().notNull(),
    date: date("date", { mode: "string" }).notNull(),
    section: text("section").notNull(),
    partyType: text("party_type").notNull(),
    partyId: uuid("party_id"),
    partyName: text("party_name").notNull(),
    pan: text("pan"),
    /** Paise the tax is computed on (GST excluded when shown separately on the bill). */
    base: integer("base").notNull(),
    /** Basis points: 100 = 1%. */
    rate: integer("rate").notNull(),
    amount: integer("amount").notNull(),
    noPan: boolean("no_pan").notNull().default(false),
    /** purchase, expense, supplier, invoice, customer, other. */
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id"),
    sourceRef: text("source_ref"),
    /** The account debited for `other` entries. */
    otherAccountId: uuid("other_account_id"),
    status: text("status").notNull().default("active"),
    entryId: uuid("entry_id"),
    reversalEntryId: uuid("reversal_entry_id"),
    /** The Payables row (purchase_payments.id) that settles the deducted part of the bill. */
    settlementId: text("settlement_id"),
    challanId: uuid("challan_id"),
    note: text("note"),
    createdBy: uuid("created_by"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("acct_tds_entries_tenant_date_idx").on(t.tenantId, t.kind, t.date),
    index("acct_tds_entries_tenant_party_idx").on(t.tenantId, t.partyType, t.partyId),
    index("acct_tds_entries_tenant_source_idx").on(t.tenantId, t.sourceType, t.sourceId),
  ],
);

/** Tax deposited to the government by challan (ITNS 281): Dr TDS/TCS payable (+ interest / fee) / Cr bank. */
export const acctTdsChallans = pgTable(
  "acct_tds_challans",
  {
    id: pk(),
    tenantId: tenantId(),
    kind: text("kind").$type<TaxKind>().notNull(),
    /** Month the tax was deducted in (YYYY-MM). */
    period: text("period").notNull(),
    section: text("section"),
    bsrCode: text("bsr_code").notNull(),
    challanNo: text("challan_no").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    tax: integer("tax").notNull(),
    interest: integer("interest").notNull().default(0),
    fee: integer("fee").notNull().default(0),
    paidFromAccountId: uuid("paid_from_account_id").notNull(),
    status: text("status").notNull().default("active"),
    entryId: uuid("entry_id"),
    reversalEntryId: uuid("reversal_entry_id"),
    note: text("note"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("acct_tds_challans_tenant_period_idx").on(t.tenantId, t.kind, t.period)],
);

// ------------------------------------------------------------------ fixed assets and depreciation

export const DEPRECIATION_METHODS = ["slm", "wdv"] as const;
export type DepreciationMethod = (typeof DEPRECIATION_METHODS)[number];

export const acctFixedAssets = pgTable(
  "acct_fixed_assets",
  {
    id: pk(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    /** The fixed-asset account it sits in (Furniture and equipment, Vehicles ...). */
    assetAccountId: uuid("asset_account_id").notNull(),
    purchaseDate: date("purchase_date", { mode: "string" }).notNull(),
    /** Depreciation starts from this date (put to use). */
    inUseFrom: date("in_use_from", { mode: "string" }).notNull(),
    cost: integer("cost").notNull(),
    salvage: integer("salvage").notNull().default(0),
    method: text("method").$type<DepreciationMethod>().notNull(),
    /** Yearly rate in basis points (WDV, or SLM by rate). */
    rate: integer("rate"),
    /** Useful life in months (SLM by life). */
    lifeMonths: integer("life_months"),
    /** Depreciation charged before these books started (paise), e.g. in the old software. */
    openingDepreciation: integer("opening_depreciation").notNull().default(0),
    status: text("status").notNull().default("active"),
    disposedOn: date("disposed_on", { mode: "string" }),
    saleAmount: integer("sale_amount"),
    disposalEntryId: uuid("disposal_entry_id"),
    purchaseEntryId: uuid("purchase_entry_id"),
    note: text("note"),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [index("acct_fixed_assets_tenant_idx").on(t.tenantId, t.status)],
);

/** Depreciation posted for one asset and period (unique, so a run can be repeated safely). */
export const acctDepreciation = pgTable(
  "acct_depreciation",
  {
    id: pk(),
    tenantId: tenantId(),
    assetId: uuid("asset_id").notNull(),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    amount: integer("amount").notNull(),
    entryId: uuid("entry_id").notNull(),
    status: text("status").notNull().default("posted"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("acct_depreciation_asset_period_uq").on(t.tenantId, t.assetId, t.periodEnd).where(sql`${t.status} = 'posted'`),
    index("acct_depreciation_tenant_idx").on(t.tenantId, t.periodEnd),
  ],
);

// ------------------------------------------------------------------ year-end close

/** A closed financial year: the closing journal, the lock it set, and a re-open with who and why. */
export const acctYearCloses = pgTable(
  "acct_year_closes",
  {
    id: pk(),
    tenantId: tenantId(),
    /** "2025-26". */
    fy: text("fy").notNull(),
    fromDate: date("from_date", { mode: "string" }).notNull(),
    toDate: date("to_date", { mode: "string" }).notNull(),
    netProfit: integer("net_profit").notNull(),
    stockAdjustment: integer("stock_adjustment").notNull().default(0),
    entryId: uuid("entry_id"),
    reversalEntryId: uuid("reversal_entry_id"),
    previousLock: date("previous_lock", { mode: "string" }),
    status: text("status").notNull().default("closed"),
    closedBy: uuid("closed_by"),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
    note: text("note"),
    reopenedBy: uuid("reopened_by"),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    reopenReason: text("reopen_reason"),
  },
  (t) => [
    uniqueIndex("acct_year_closes_fy_uq").on(t.tenantId, t.fy).where(sql`${t.status} = 'closed'`),
    index("acct_year_closes_tenant_idx").on(t.tenantId, t.toDate),
  ],
);

export type AcctBankLine = typeof acctBankLines.$inferSelect;
export type AcctBankStatement = typeof acctBankStatements.$inferSelect;
export type AcctCheque = typeof acctCheques.$inferSelect;
export type AcctTdsEntry = typeof acctTdsEntries.$inferSelect;
export type AcctTdsChallan = typeof acctTdsChallans.$inferSelect;
export type AcctFixedAsset = typeof acctFixedAssets.$inferSelect;
export type AcctYearClose = typeof acctYearCloses.$inferSelect;
