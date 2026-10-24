import { pk, tenantId, timestamps } from "@srirealtime/db";
import { boolean, date, index, integer, jsonb, pgTable, real, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

/** How a shop's GST filing is set up. One row per shop; the defaults mean "regular taxpayer, monthly, no special rules". */
export const COMPOSITION_TYPES = ["trader", "manufacturer", "restaurant", "services"] as const;
export type CompositionType = (typeof COMPOSITION_TYPES)[number];
/** What a 0% line is reported as in GSTR-1 Table 8 / GSTR-3B 3.1(c) / 3.1(e). */
export const ZERO_RATE_CLASSES = ["nil", "exempt", "nongst"] as const;
export type ZeroRateClass = (typeof ZERO_RATE_CLASSES)[number];

export interface ZeroRateRule {
  /** HSN/SAC prefix, e.g. "0402". */
  hsnPrefix: string;
  class: ZeroRateClass;
}

export const gstSettings = pgTable(
  "gst_settings",
  {
    id: pk(),
    tenantId: tenantId(),
    /** Composition taxpayer (Section 10): bills from `compositionFrom` on are bills of supply with no tax. */
    composition: boolean("composition").notNull().default(false),
    compositionFrom: date("composition_from", { mode: "string" }),
    compositionType: text("composition_type").$type<CompositionType>().notNull().default("trader"),
    /** Quarterly return filer with monthly payment (QRMP, turnover up to 5 crore). */
    qrmp: boolean("qrmp").notNull().default(false),
    qrmpFrom: date("qrmp_from", { mode: "string" }),
    /** Reverse-charge categories the owner uses (keys of rcm-categories.ts); empty = show the whole list. */
    rcmCategories: jsonb("rcm_categories").$type<string[]>().notNull().default([]),
    /** What 0% lines are reported as when no HSN rule matches. */
    zeroRateClass: text("zero_rate_class").$type<ZeroRateClass>().notNull().default("nil"),
    zeroRateRules: jsonb("zero_rate_rules").$type<ZeroRateRule[]>().notNull().default([]),
    /** The shop's main GSTIN for filing (blank = the billing profile's). */
    gstin: text("gstin"),
    /** Aggregate turnover of the previous financial year in paise, for the QRMP / e-invoice checks (optional). */
    priorTurnover: integer("prior_turnover"),
    ...timestamps(),
  },
  (t) => [unique("gst_settings_tenant_uq").on(t.tenantId)],
);

export const ITC_STATUSES = ["eligible", "ineligible", "blocked", "reversal"] as const;
/** eligible = claim it; ineligible = not claimable (no GSTIN, personal use ...); blocked = Section 17(5); reversal = claimed and reversed. */
export type ItcStatus = (typeof ITC_STATUSES)[number];
export const ITC_CLASSES = ["oth", "impg", "imps", "isd"] as const;
export type ItcClass = (typeof ITC_CLASSES)[number];
export const REVERSAL_REASONS = ["rule37", "rule38", "rule42", "rule43", "section17_5", "other"] as const;
export type ReversalReason = (typeof REVERSAL_REASONS)[number];
export const FLAG_DOC_TYPES = ["purchase", "expense"] as const;
export type FlagDocType = (typeof FLAG_DOC_TYPES)[number];

/**
 * What the owner or accountant decided about the input tax credit and reverse charge of one purchase bill or expense.
 * A document without a row follows the defaults (credit allowed when the supplier has a valid GSTIN and charged tax).
 */
export const gstDocFlags = pgTable(
  "gst_doc_flags",
  {
    id: pk(),
    tenantId: tenantId(),
    docType: text("doc_type").$type<FlagDocType>().notNull(),
    docId: uuid("doc_id").notNull(),
    itcStatus: text("itc_status").$type<ItcStatus>(),
    itcClass: text("itc_class").$type<ItcClass>(),
    /** Why the credit is blocked / reversed (free words) and under which rule. */
    reversalReason: text("reversal_reason").$type<ReversalReason>(),
    reason: text("reason"),
    /** "YYYY-MM": claim the credit in this month instead of the bill's month (e.g. the supplier filed late). */
    claimMonth: text("claim_month"),
    /** "YYYY-MM": month the reversal is reported in (default the claim month). */
    reversalMonth: text("reversal_month"),
    rcm: boolean("rcm").notNull().default(false),
    rcmCategory: text("rcm_category"),
    /** Percent; default the rate on the document's lines. */
    rcmRate: real("rcm_rate"),
    /** Paise; default the taxable value of the document. */
    rcmTaxable: integer("rcm_taxable"),
    /** Reverse charge is an import of services / goods (always IGST). */
    rcmImport: boolean("rcm_import").notNull().default(false),
    /** The day the reverse-charge tax was paid in cash; the credit can be taken from that month. */
    rcmPaidOn: date("rcm_paid_on", { mode: "string" }),
    rcmPaidAmount: integer("rcm_paid_amount"),
    rcmChallan: text("rcm_challan"),
    note: text("note"),
    updatedBy: uuid("updated_by"),
    ...timestamps(),
  },
  (t) => [unique("gst_doc_flags_tenant_doc_uq").on(t.tenantId, t.docType, t.docId), index("gst_doc_flags_tenant_idx").on(t.tenantId, t.docType)],
);

export const ADJUSTMENT_KINDS = [
  /** 4A(1) import of goods (bill of entry). */
  "itc_impg",
  /** 4A(4) inward supplies from an ISD. */
  "itc_isd",
  /** 4A(5) other credit not from the books (e.g. transitional). */
  "itc_other",
  /** 4B(1) reversed under rules 38, 42, 43 and Section 17(5). */
  "itc_rev_rules",
  /** 4B(2) reversed, other. */
  "itc_rev_other",
  /** 4D(1) credit reclaimed that was reversed earlier. */
  "itc_reclaim",
  /** 4D(2) ineligible under Section 16(4) / place of supply. */
  "itc_ineligible",
  /** 5 inward supplies from composition / exempt / nil: inter-state. */
  "inward_exempt_inter",
  "inward_exempt_intra",
  "inward_nongst_inter",
  "inward_nongst_intra",
  /** 5.1 interest and late fee. */
  "interest",
  "late_fee",
  /** 3.1(b) zero-rated supplies not in the bills (exports with / without payment). */
  "outward_zero",
] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

/** Figures typed in for a GSTR-3B month that the bills do not carry. */
export const gstAdjustments = pgTable(
  "gst_adjustments",
  {
    id: pk(),
    tenantId: tenantId(),
    /** "YYYY-MM". */
    month: text("month").notNull(),
    kind: text("kind").$type<AdjustmentKind>().notNull(),
    /** Paise; for the "inward ... " and "zero-rated" kinds the value in `taxable`. */
    taxable: integer("taxable").notNull().default(0),
    igst: integer("igst").notNull().default(0),
    cgst: integer("cgst").notNull().default(0),
    sgst: integer("sgst").notNull().default(0),
    cess: integer("cess").notNull().default(0),
    note: text("note"),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [index("gst_adjustments_tenant_month_idx").on(t.tenantId, t.month)],
);

/** One GSTR-2B file imported for a month. Importing the same month again replaces it (actions are carried over). */
export const gst2bImports = pgTable(
  "gst_2b_imports",
  {
    id: pk(),
    tenantId: tenantId(),
    /** "YYYY-MM" return period of the 2B. */
    month: text("month").notNull(),
    gstin: text("gstin"),
    filename: text("filename"),
    format: text("format").notNull().default("json"),
    generatedOn: text("generated_on"),
    rowCount: integer("row_count").notNull().default(0),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
    importedBy: uuid("imported_by"),
    ...timestamps(),
  },
  (t) => [unique("gst_2b_imports_tenant_month_uq").on(t.tenantId, t.month)],
);

export const MATCH_STATUSES = ["matched", "fuzzy", "amount_mismatch", "missing_in_books", "accepted", "ignored"] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];
export const MATCH_ACTIONS = ["accept", "ignore", "reopen"] as const;
export type MatchAction = (typeof MATCH_ACTIONS)[number];

export const gst2bRows = pgTable(
  "gst_2b_rows",
  {
    id: pk(),
    tenantId: tenantId(),
    importId: uuid("import_id").notNull(),
    month: text("month").notNull(),
    section: text("section").notNull().default("b2b"),
    supplierGstin: text("supplier_gstin").notNull(),
    supplierName: text("supplier_name"),
    /** "inv" or "cn" / "dn" for notes. */
    docKind: text("doc_kind").notNull().default("inv"),
    docNumber: text("doc_number").notNull(),
    docDate: date("doc_date", { mode: "string" }),
    docValue: integer("doc_value").notNull().default(0),
    pos: text("pos"),
    reverseCharge: boolean("reverse_charge").notNull().default(false),
    /** The portal says the credit is available (ITC Availability = Yes). */
    itcAvailable: boolean("itc_available").notNull().default(true),
    reason: text("reason"),
    taxable: integer("taxable").notNull().default(0),
    igst: integer("igst").notNull().default(0),
    cgst: integer("cgst").notNull().default(0),
    sgst: integer("sgst").notNull().default(0),
    cess: integer("cess").notNull().default(0),
    status: text("status").$type<MatchStatus>().notNull().default("missing_in_books"),
    /** The purchase bill, expense or debit note the row was matched to. */
    matchedType: text("matched_type").$type<"purchase" | "expense" | "debit_note">(),
    matchedId: uuid("matched_id"),
    /** What differed, e.g. { taxable: [2b, books], igst: [...], date: [...] }. */
    diff: jsonb("diff").$type<Record<string, unknown>>().notNull().default({}),
    /** What the person did: accept (take the credit as per 2B) / ignore. */
    action: text("action").$type<MatchAction>(),
    actionNote: text("action_note"),
    actionBy: uuid("action_by"),
    actionAt: timestamp("action_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index("gst_2b_rows_tenant_month_idx").on(t.tenantId, t.month),
    index("gst_2b_rows_import_idx").on(t.importId),
    index("gst_2b_rows_tenant_matched_idx").on(t.tenantId, t.matchedType, t.matchedId),
  ],
);

export const RETURN_TYPES = ["gstr1", "gstr3b", "pmt06", "cmp08", "gstr4", "gstr2b"] as const;
export type ReturnType = (typeof RETURN_TYPES)[number];

/** The owner ticks a return off as filed (the product never files anything on the portal). */
export const gstFilings = pgTable(
  "gst_filings",
  {
    id: pk(),
    tenantId: tenantId(),
    returnType: text("return_type").$type<ReturnType>().notNull(),
    /** "YYYY-MM", "YYYY-Qn" (n = 1..4 of the financial year) or "FY2026-27" for the annual GSTR-4. */
    period: text("period").notNull(),
    filedOn: date("filed_on", { mode: "string" }).notNull(),
    arn: text("arn"),
    note: text("note"),
    filedBy: uuid("filed_by"),
    ...timestamps(),
  },
  (t) => [unique("gst_filings_tenant_return_period_uq").on(t.tenantId, t.returnType, t.period)],
);

export const ADVANCE_KINDS = ["received", "adjusted"] as const;
export type AdvanceKind = (typeof ADVANCE_KINDS)[number];

/** GSTR-1 Table 11: advances received (11A) and advances adjusted against bills (11B), typed in per month. */
export const gstAdvances = pgTable(
  "gst_advances",
  {
    id: pk(),
    tenantId: tenantId(),
    month: text("month").notNull(),
    kind: text("kind").$type<AdvanceKind>().notNull(),
    /** Two-digit place of supply. */
    pos: text("pos").notNull(),
    rate: real("rate").notNull(),
    /** Paise, gross (tax included). */
    amount: integer("amount").notNull(),
    cess: integer("cess").notNull().default(0),
    note: text("note"),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [index("gst_advances_tenant_month_idx").on(t.tenantId, t.month)],
);

export const TAX_PAYMENT_KINDS = ["composition", "liability", "rcm", "other"] as const;
export type TaxPaymentKind = (typeof TAX_PAYMENT_KINDS)[number];

/** Tax paid to the government by challan: composition tax (CMP-08), a GSTR-3B cash payment or reverse-charge tax. */
export const gstTaxPayments = pgTable(
  "gst_tax_payments",
  {
    id: pk(),
    tenantId: tenantId(),
    kind: text("kind").$type<TaxPaymentKind>().notNull(),
    /** The return period it is for ("YYYY-MM" or "YYYY-Qn"). */
    period: text("period").notNull(),
    paidOn: date("paid_on", { mode: "string" }).notNull(),
    igst: integer("igst").notNull().default(0),
    cgst: integer("cgst").notNull().default(0),
    sgst: integer("sgst").notNull().default(0),
    cess: integer("cess").notNull().default(0),
    interest: integer("interest").notNull().default(0),
    lateFee: integer("late_fee").notNull().default(0),
    method: text("method").notNull().default("bank"),
    challan: text("challan"),
    note: text("note"),
    status: text("status").notNull().default("paid"),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [index("gst_tax_payments_tenant_idx").on(t.tenantId, t.paidOn)],
);

export type GstSettingsRow = typeof gstSettings.$inferSelect;
export type GstDocFlagRow = typeof gstDocFlags.$inferSelect;
export type GstAdjustmentRow = typeof gstAdjustments.$inferSelect;
export type Gst2bImportRow = typeof gst2bImports.$inferSelect;
export type Gst2bRowRow = typeof gst2bRows.$inferSelect;
export type GstFilingRow = typeof gstFilings.$inferSelect;
export type GstAdvanceRow = typeof gstAdvances.$inferSelect;
export type GstTaxPaymentRow = typeof gstTaxPayments.$inferSelect;
