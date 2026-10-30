import { pk, tenantId, timestamps } from "@rbms/db";
import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Voucher kinds a person can post by hand. Everything else is posted by the system from a bill, purchase, payment ... */
export const MANUAL_VOUCHER_TYPES = ["journal", "contra", "payment", "receipt"] as const;
export type ManualVoucherType = (typeof MANUAL_VOUCHER_TYPES)[number];
export const VOUCHER_TYPES = [...MANUAL_VOUCHER_TYPES, "auto", "reversal"] as const;
export type VoucherType = (typeof VOUCHER_TYPES)[number];

export const ENTRY_STATUSES = ["posted", "reversed"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];
export const ENTRY_ORIGINS = ["manual", "auto"] as const;
export type EntryOrigin = (typeof ENTRY_ORIGINS)[number];

export const PARTY_TYPES = ["customer", "supplier"] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

export const IMPORTED_MODES = ["exclude", "post"] as const;
export type ImportedMode = (typeof IMPORTED_MODES)[number];

/**
 * The chart of accounts. Seeded per shop on first use from `chart.ts`. System accounts (`system`) carry a `key` that the
 * automatic postings find them by; they can be renamed and given an opening balance but not deleted or retyped.
 * Bank accounts are normal accounts with `isBank` set (Part B, bank reconciliation, builds on `bank*`).
 */
export const acctAccounts = pgTable(
  "acct_accounts",
  {
    id: pk(),
    tenantId: tenantId(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: text("type").$type<AccountType>().notNull(),
    /** Group key from chart.ts (cash_bank, receivables, sales, indirect ...). */
    group: text("group_key").notNull(),
    subGroup: text("sub_group"),
    /** Stable key of system accounts ("cash", "sales", "gst_out_cgst"), "expcat:<id>" for expense categories. */
    key: text("key"),
    system: boolean("system").notNull().default(false),
    isCash: boolean("is_cash").notNull().default(false),
    /** A bank account of the shop (money account that gets a statement to reconcile in Part B). */
    isBank: boolean("is_bank").notNull().default(false),
    bankName: text("bank_name"),
    /** Last 4 digits only. */
    bankAccountLast4: text("bank_account_last4"),
    bankIfsc: text("bank_ifsc"),
    /** Paise, debit-positive (a credit balance is negative), as on the books start date. Posted as one opening journal. */
    openingBalance: integer("opening_balance").notNull().default(0),
    active: boolean("active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    description: text("description"),
    ...timestamps(),
  },
  (t) => [
    unique("acct_accounts_tenant_code_uq").on(t.tenantId, t.code),
    unique("acct_accounts_tenant_key_uq").on(t.tenantId, t.key),
    index("acct_accounts_tenant_type_idx").on(t.tenantId, t.type),
  ],
);

/**
 * A posted journal entry (voucher). Immutable: nothing but `status`/`reversedById`/`reversedAt` ever changes, and only
 * when it is reversed (a new entry with the lines swapped). Automatic postings are keyed by (source_type, source_id,
 * source_version); `content_hash` says what that version was built from, so a re-run with the same document does nothing.
 */
export const acctEntries = pgTable(
  "acct_entries",
  {
    id: pk(),
    tenantId: tenantId(),
    /** Running number per shop; `number` is its printed form (JV-000012). */
    seq: integer("seq").notNull(),
    number: text("number").notNull(),
    voucherType: text("voucher_type").$type<VoucherType>().notNull(),
    origin: text("origin").$type<EntryOrigin>().notNull().default("manual"),
    date: date("date", { mode: "string" }).notNull(),
    /** The document's own date when a locked period made the posting land later. */
    lateFor: date("late_for", { mode: "string" }),
    narration: text("narration").notNull().default(""),
    reference: text("reference"),
    status: text("status").$type<EntryStatus>().notNull().default("posted"),
    /** Paise: total of the debits (= total of the credits). */
    total: integer("total").notNull(),
    sourceType: text("source_type"),
    sourceId: text("source_id"),
    sourceVersion: integer("source_version"),
    contentHash: text("content_hash"),
    reversalOfId: uuid("reversal_of_id"),
    reversedById: uuid("reversed_by_id"),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversalReason: text("reversal_reason"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("acct_entries_tenant_number_uq").on(t.tenantId, t.number),
    uniqueIndex("acct_entries_source_uq")
      .on(t.tenantId, t.sourceType, t.sourceId, t.sourceVersion)
      .where(sql`${t.sourceType} is not null`),
    index("acct_entries_tenant_date_idx").on(t.tenantId, t.date, t.seq),
    index("acct_entries_tenant_source_idx").on(t.tenantId, t.sourceType, t.sourceId),
  ],
);

export const acctLines = pgTable(
  "acct_lines",
  {
    id: pk(),
    tenantId: tenantId(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => acctEntries.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => acctAccounts.id),
    /** The entry's date, copied so balances are one indexed scan. */
    entryDate: date("entry_date", { mode: "string" }).notNull(),
    /** Paise. */
    debit: integer("debit").notNull().default(0),
    credit: integer("credit").notNull().default(0),
    memo: text("memo"),
    /** Customer / supplier the line belongs to (debtors and creditors control accounts). */
    partyType: text("party_type").$type<PartyType>(),
    partyId: uuid("party_id"),
  },
  (t) => [
    index("acct_lines_entry_idx").on(t.entryId),
    index("acct_lines_tenant_account_date_idx").on(t.tenantId, t.accountId, t.entryDate),
    index("acct_lines_tenant_party_idx").on(t.tenantId, t.partyType, t.partyId),
    check("acct_lines_amounts_chk", sql`${t.debit} >= 0 and ${t.credit} >= 0 and (${t.debit} = 0 or ${t.credit} = 0)`),
  ],
);

/** One row per shop: period lock, books settings and the entry counter. */
export const acctSettings = pgTable(
  "acct_settings",
  {
    id: pk(),
    tenantId: tenantId(),
    /** Nothing may be posted or changed on or before this date (null = open). */
    lockedThrough: date("locked_through", { mode: "string" }),
    /** Date of the opening-balance journals. */
    startDate: date("start_date", { mode: "string" }),
    /** Documents dated before this are not posted (null = post everything). Set by a backfill with `from`. */
    postFrom: date("post_from", { mode: "string" }),
    /** Imported historical bills: "exclude" them from the books or "post" them like any other bill. */
    importedBills: text("imported_bills").$type<ImportedMode>().notNull().default("exclude"),
    /** Value closing stock from the inventory moving-average cost on the P&L and balance sheet. */
    valueStock: boolean("value_stock").notNull().default(true),
    /** Payment method -> account id, overriding cash -> Cash in hand, everything else -> the default bank account. */
    methodAccounts: jsonb("method_accounts").$type<Record<string, string>>().notNull().default({}),
    /** Posting from documents runs by itself (set by the first real backfill). */
    autoPost: boolean("auto_post").notNull().default(false),
    nextSeq: integer("next_seq").notNull().default(1),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastSyncSummary: jsonb("last_sync_summary").$type<Record<string, unknown>>(),
    ...timestamps(),
  },
  (t) => [unique("acct_settings_tenant_uq").on(t.tenantId)],
);

/** History of the period lock (who moved it, from where to where, why). */
export const acctLockLog = pgTable(
  "acct_lock_log",
  {
    id: pk(),
    tenantId: tenantId(),
    lockedThrough: date("locked_through", { mode: "string" }),
    previous: date("previous", { mode: "string" }),
    reason: text("reason"),
    userId: uuid("user_id"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("acct_lock_log_tenant_at_idx").on(t.tenantId, t.at)],
);

export type AcctAccount = typeof acctAccounts.$inferSelect;
export type AcctEntry = typeof acctEntries.$inferSelect;
export type AcctLine = typeof acctLines.$inferSelect;
export type AcctSettings = typeof acctSettings.$inferSelect;

// Part B tables (bank reconciliation, cheques, TDS/TCS, fixed assets, year-end close).
export * from "./schema-b";
