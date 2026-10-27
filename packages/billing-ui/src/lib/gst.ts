"use client";

/**
 * GST filing centre (`/v1/gstfiling`, packages/gstfiling): types, period helpers and React Query hooks.
 * Money is integer paise. Months are "YYYY-MM", quarters "YYYY-Qn" (Q1 = April to June; the year in the key is the
 * calendar year of the quarter's last month, so Jan-Mar 2027 is "2027-Q4").
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type QueryParams } from "@srirealtime/web";

export const G = "/gstfiling";
/** Same gate as the GSTR-1 download in Reports: feature `invoices.gst-reports`. */
export const GST_FEATURE = "invoices.gst-reports";
export const GST_VIEW = "reports.view";
export const GST_MANAGE = "gst.manage";

// ---------------------------------------------------------------- periods

export const isMonthKey = (s: string | null | undefined): boolean => !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export const isQuarterKey = (s: string | null | undefined): boolean => !!s && /^\d{4}-Q[1-4]$/.test(s);

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/** Start year of the financial year (April to March) a date falls in. */
export const fyStartYear = (date: string) => {
  const y = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 4 ? y : y - 1;
};
export const fyLabel = (startYear: number) => `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;

export interface Quarter {
  key: string;
  fy: number;
  q: 1 | 2 | 3 | 4;
  months: [string, string, string];
  from: string;
  to: string;
}

/** Q1 = Apr-Jun ... Q4 = Jan-Mar (same rule as packages/gstfiling/src/util.ts). */
export function quarterOfMonth(month: string): Quarter {
  const start = fyStartYear(`${month}-01`);
  const m = Number(month.slice(5, 7));
  const idxInFy = (m + 8) % 12;
  const q = (Math.floor(idxInFy / 3) + 1) as 1 | 2 | 3 | 4;
  const first = addMonths(`${start}-04`, (q - 1) * 3);
  const months: [string, string, string] = [first, addMonths(first, 1), addMonths(first, 2)];
  return { key: `${months[2].slice(0, 4)}-Q${q}`, fy: start, q, months, from: monthRange(months[0]).from, to: monthRange(months[2]).to };
}

export function parseQuarter(key: string): Quarter | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(key);
  if (!m) return null;
  return quarterOfMonth(`${m[1]}-${["06", "09", "12", "03"][Number(m[2]) - 1]!}`);
}

/** The month a period stands for (a quarter's last month): what month-based tabs (credit, 2B) use. */
export const monthOfPeriod = (p: string) => (isQuarterKey(p) ? (parseQuarter(p)?.months[2] ?? p) : p);
/** The quarter a period belongs to: what the composition tab uses. */
export const quarterOfPeriod = (p: string) => (isQuarterKey(p) ? p : quarterOfMonth(p).key);
/** The months a period covers. */
export const monthsOfPeriod = (p: string): string[] => (isQuarterKey(p) ? [...(parseQuarter(p)?.months ?? [])] : [p]);

/** The month whose returns are being prepared now: last month. */
export const defaultMonth = (today: string) => addMonths(today.slice(0, 7), -1);

/** Months newest first, starting this month. */
export function monthOptions(today: string, count = 24): string[] {
  const now = today.slice(0, 7);
  return Array.from({ length: count }, (_, i) => addMonths(now, -i));
}
/** Quarters newest first, starting with the current one. */
export function quarterOptions(today: string, count = 10): string[] {
  const out: string[] = [];
  let m = today.slice(0, 7);
  while (out.length < count) {
    const q = quarterOfMonth(m).key;
    if (!out.includes(q)) out.push(q);
    m = addMonths(m, -3);
  }
  return out;
}
/** First years of the financial years to pick from, newest first. */
export const fyOptions = (today: string, count = 5): number[] => Array.from({ length: count }, (_, i) => fyStartYear(today) - i);

// ---------------------------------------------------------------- types

export type ReturnKind = "gstr1" | "gstr3b" | "pmt06" | "cmp08" | "gstr4" | "gstr2b";
export type CompositionType = "trader" | "manufacturer" | "restaurant" | "services";
export type ZeroRateClass = "nil" | "exempt" | "nongst";
export type Scheme = "regular" | "qrmp" | "composition";

export interface Tax {
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}
export interface TaxValue extends Tax {
  taxable: number;
}
export const taxTotal = (t: Tax) => t.igst + t.cgst + t.sgst + t.cess;

export interface GstConfig {
  composition: boolean;
  compositionFrom: string | null;
  compositionType: CompositionType;
  qrmp: boolean;
  qrmpFrom: string | null;
  rcmCategories: string[];
  zeroRateClass: ZeroRateClass;
  zeroRateRules: { hsnPrefix: string; class: ZeroRateClass }[];
  gstin: string | null;
  priorTurnover: number | null;
}
export const schemeOf = (c: Pick<GstConfig, "composition" | "qrmp"> | undefined): Scheme => (c?.composition ? "composition" : c?.qrmp ? "qrmp" : "regular");
export const COMPOSITION_RATES: Record<CompositionType, number> = { trader: 1, manufacturer: 1, restaurant: 5, services: 6 };
export const COMPOSITION_TYPES = ["trader", "manufacturer", "restaurant", "services"] as const;
export const ZERO_CLASSES = ["nil", "exempt", "nongst"] as const;

export interface DueItem {
  returnType: ReturnKind;
  period: string;
  from: string;
  to: string;
  dueDate: string;
  filed: boolean;
  filedOn: string | null;
  daysLeft: number | null;
  status: "filed" | "overdue" | "due_soon" | "upcoming";
}

export type IssueTab = "gstr1" | "gstr3b" | "itc" | "gstr2b" | "rcm" | "composition" | "settings" | "calendar";
export interface FilingIssue {
  id: string;
  severity: "error" | "warning" | "info";
  area: string;
  code: string;
  params?: Record<string, string | number>;
  link?: { tab: IssueTab; period?: string; filter?: string };
  count?: number;
}

export interface GstOverview {
  today: string;
  config: GstConfig;
  profile: { gstin: string | null; legalName: string | null; stateCode: string | null };
  calendar: DueItem[];
  issues: FilingIssue[];
  filings: { returnType: string; period: string; filedOn: string; arn: string | null }[];
}

export interface RcmCategory {
  key: string;
  name: string;
  nameTa: string;
  rate: number;
  kind: "goods" | "services";
  note: string;
  ref: string;
  unregisteredOnly?: boolean;
  import?: boolean;
}

export interface SettingsPatch {
  composition?: boolean;
  compositionFrom?: string | null;
  compositionType?: CompositionType;
  qrmp?: boolean;
  qrmpFrom?: string | null;
  rcmCategories?: string[];
  zeroRateClass?: ZeroRateClass;
  zeroRateRules?: { hsnPrefix: string; class: ZeroRateClass }[];
  gstin?: string | null;
  priorTurnover?: number | null;
}

export interface CompositionPreview {
  from: string;
  taxedBills: number;
  taxedTotal: number;
  bills: number;
}

// ---- GSTR-1
export const GSTR1_CODES = [
  "seller_gstin_missing",
  "seller_gstin_other",
  "buyer_gstin_invalid",
  "hsn_missing",
  "hsn_short",
  "hsn_invalid",
  "unit_missing",
  "pos_invalid",
  "inter_flag_mismatch",
  "tax_mismatch",
  "rate_unusual",
  "duplicate_number",
  "number_gap",
  "tax_on_bill_of_supply",
  "negative_total",
  "no_documents",
] as const;

export interface Gstr1Issue {
  code: string;
  severity: "error" | "warning";
  docType?: "invoice" | "credit_note" | "debit_note";
  docId?: string;
  number?: string;
  detail?: string;
}
export interface Gstr1Result {
  period: { key: string; kind: "month" | "quarter"; months: string[]; from: string; to: string; fp: string };
  gstin: string | null;
  json: Record<string, unknown>;
  warnings: string[];
  issues: Gstr1Issue[];
  counts: Record<string, number>;
  tables: { nil: Record<string, { exempt: number; nil: number; nongst: number }> };
  applicable: boolean;
  filename: string;
}

/** Number of document ranges in Table 13 of the GSTR-1 file. */
export function docRangeCount(json: Record<string, unknown>): number {
  const det = (json.doc_issue as { doc_det?: { docs?: unknown[] }[] } | undefined)?.doc_det ?? [];
  return det.reduce((s, d) => s + (d.docs?.length ?? 0), 0);
}

export interface GstAdvance {
  id: string;
  month: string;
  kind: "received" | "adjusted";
  pos: string;
  rate: number;
  amount: number;
  cess: number;
  note: string | null;
}

// ---- GSTR-3B
export const CELLS = [
  "3.1a",
  "3.1b",
  "3.1c",
  "3.1d",
  "3.1e",
  "3.2",
  "4A1",
  "4A2",
  "4A3",
  "4A4",
  "4A5",
  "4B1",
  "4B2",
  "4D1",
  "4D2",
  "5.exempt.inter",
  "5.exempt.intra",
  "5.nongst.inter",
  "5.nongst.intra",
  "5.1.interest",
  "5.1.latefee",
] as const;
export type CellId = (typeof CELLS)[number];

export interface SetOff {
  used: Record<keyof Tax, Record<keyof Tax, number>>;
  cash: Tax;
  carry: Tax;
}
export interface Gstr3b {
  period: { key: string; kind: "month" | "quarter"; months: string[]; from: string; to: string };
  month: string;
  fp: string;
  gstin: string;
  applicable: boolean;
  cells: Record<CellId, TaxValue>;
  unregByPos: { pos: string; taxable: number; igst: number }[];
  outputTax: Tax;
  rcmTax: Tax;
  itcNet: Tax;
  setOff: SetOff;
  cashPayable: number;
  counts: { invoices: number; creditNotes: number; debitNotes?: number; purchases: number; expenses: number; rcm: number; adjustments: number };
  json: Record<string, unknown>;
  filename: string;
  qrmp: boolean;
  warnings: string[];
  ledger: { books: { output: Tax; input: Tax }; returnOutput: Tax; returnItc: Tax; outputDiff: Tax; itcDiff: Tax } | null;
  shopState: string | null;
}

export interface Contribution {
  cell: CellId;
  /** `debit_note` = a supplier debit note (purchase return); `sales_debit_note` = a debit note to a customer. */
  docType: "invoice" | "credit_note" | "sales_debit_note" | "purchase" | "expense" | "debit_note" | "adjustment";
  docId: string;
  number: string;
  date: string;
  party: string;
  pos?: string;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  note?: string;
}
export interface Gstr3bCell {
  cell: CellId;
  label: string;
  total: Contribution;
  items: Contribution[];
  truncated: boolean;
}

export const ADJUSTMENT_KINDS = [
  "itc_impg",
  "itc_isd",
  "itc_other",
  "itc_rev_rules",
  "itc_rev_other",
  "itc_reclaim",
  "itc_ineligible",
  "inward_exempt_inter",
  "inward_exempt_intra",
  "inward_nongst_inter",
  "inward_nongst_intra",
  "interest",
  "late_fee",
  "outward_zero",
] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];
export interface GstAdjustment {
  id: string;
  month: string;
  kind: AdjustmentKind;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  note: string | null;
}

// ---- input credit
export const ITC_STATUSES = ["eligible", "ineligible", "blocked", "reversal"] as const;
export type ItcStatus = (typeof ITC_STATUSES)[number];
export const ITC_CLASSES = ["oth", "impg", "imps", "isd"] as const;
export type ItcClass = (typeof ITC_CLASSES)[number];
export const REVERSAL_REASONS = ["rule37", "rule38", "rule42", "rule43", "section17_5", "other"] as const;
export type ReversalReason = (typeof REVERSAL_REASONS)[number];
export const ITC_REASONS = ["ok", "no_gstin", "no_tax", "composition", "owner_ineligible", "owner_blocked", "owner_reversal", "lapsed_16_4", "rcm_unpaid", "rcm_paid"] as const;

export interface ItcFlag {
  docType: "purchase" | "expense";
  docId: string;
  itcStatus: ItcStatus | null;
  itcClass: ItcClass | null;
  reversalReason: ReversalReason | null;
  reason: string | null;
  claimMonth: string | null;
  reversalMonth: string | null;
  rcm: boolean;
  rcmCategory: string | null;
  rcmRate: number | null;
  rcmTaxable: number | null;
  rcmImport: boolean;
  rcmPaidOn: string | null;
  rcmPaidAmount: number | null;
  rcmChallan: string | null;
  note: string | null;
}
export interface RcmLiability {
  category: string | null;
  isImport: boolean;
  rate: number;
  taxable: number;
  tax: Tax;
  month: string;
  paidOn: string | null;
  paidAmount: number | null;
  due: number;
  paid: boolean;
}
export interface ItcRow {
  key: string;
  docType: "purchase" | "expense" | "debit_note";
  docId: string;
  number: string;
  date: string;
  party: string;
  gstin: string | null;
  taxable: number;
  tax: Tax;
  total: number;
  status: ItcStatus;
  reason: (typeof ITC_REASONS)[number];
  source: "default" | "owner";
  class: ItcClass;
  claimMonth: string | null;
  lapsed: boolean;
  rcm: RcmLiability | null;
  flag: ItcFlag | null;
}
export interface Rule37Row {
  key: string;
  docId: string;
  number: string;
  party: string;
  date: string;
  days: number;
  unpaid: number;
  credit: Tax;
}
export interface ItcRegister {
  items: ItcRow[];
  total: number;
  limit: number;
  offset: number;
  facets: { status: Record<string, number> };
  totals: Record<string, { count: number; tax: number }>;
  range: { from: string; to: string };
  rule37: Rule37Row[];
}
export interface RcmRegister {
  items: ItcRow[];
  due: Tax;
  dueTotal: number;
  paid: number;
  unpaid: number;
  suggestions: (ItcRow & { suggestedCategory: string })[];
  categories: string[];
  range: { from: string; to: string };
}
export interface ItcFlagPatch {
  itcStatus?: ItcStatus | null;
  itcClass?: ItcClass | null;
  reversalReason?: ReversalReason | null;
  reason?: string | null;
  claimMonth?: string | null;
  reversalMonth?: string | null;
  rcm?: boolean;
  rcmCategory?: string | null;
  rcmRate?: number | null;
  rcmTaxable?: number | null;
  rcmImport?: boolean;
  rcmPaidOn?: string | null;
  rcmPaidAmount?: number | null;
  rcmChallan?: string | null;
  note?: string | null;
  reset?: boolean;
}

// ---- payments
export type TaxPaymentKind = "composition" | "liability" | "rcm" | "other";
export interface GstPayment {
  id: string;
  kind: TaxPaymentKind;
  period: string;
  paidOn: string;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  interest: number;
  lateFee: number;
  method: string;
  challan: string | null;
  note: string | null;
}
export const PAYMENT_METHODS = ["bank", "cash", "upi", "cheque", "other"] as const;

// ---- composition
export interface Cmp08 {
  quarter: string;
  from: string;
  to: string;
  rate: number;
  turnover: number;
  interStateTurnover: number;
  tax: { cgst: number; sgst: number; total: number };
  rcm: { taxable: number; tax: Tax };
  invoices: number;
  creditNotes: number;
  taxCharged: { count: number; tax: number };
  paid: number;
  balance: number;
  applicable: boolean;
  config: { type: CompositionType; from: string | null };
}
export interface Gstr4 {
  fy: string;
  from: string;
  to: string;
  quarters: Omit<Cmp08, "paid" | "balance" | "applicable" | "config">[];
  turnover: number;
  tax: number;
  inward: { registered: number; rcmRegistered: number; rcmUnregistered: number; imports: number };
  paid: number;
  applicable: boolean;
}

// ---- GSTR-2B
export const MATCH_STATUSES = ["matched", "fuzzy", "amount_mismatch", "missing_in_books", "accepted", "ignored"] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];
export interface Import2b {
  id: string;
  month: string;
  filename: string | null;
  format: string;
  rowCount: number;
  importedAt: string;
}
export interface Summary2b {
  month: string;
  imported: boolean;
  import?: { id: string; filename: string | null; format: string; gstin: string | null; generatedOn: string | null; rowCount: number; importedAt: string };
  counts?: Record<string, number>;
  open?: number;
  tax2b?: number;
  taxBooks?: number;
  itcAtRisk?: number;
  missingIn2b?: { docType: string; docId: string; number: string; date: string; party: string; gstin: string | null; taxable: number; tax: Tax }[];
}
export interface Row2b {
  id: string;
  section: string;
  supplierGstin: string;
  supplierName: string | null;
  docKind: "inv" | "cn" | "dn" | string;
  docNumber: string;
  docDate: string | null;
  docValue: number;
  itcAvailable: boolean;
  reverseCharge: boolean;
  reason: string | null;
  taxable: number;
  tax: Tax;
  status: MatchStatus;
  action: "accept" | "ignore" | null;
  actionNote: string | null;
  match: { type: string; id: string; number: string | null; date: string | null; taxable: number; tax: Tax } | null;
  diff: Record<string, unknown>;
}
export interface Rows2b {
  items: Row2b[];
  total: number;
  limit: number;
  offset: number;
  facets: { status: Record<string, number> };
}
export interface Supplier2b {
  gstin: string;
  name: string | null;
  docs: number;
  tax2b: number;
  taxBooks: number;
  matched: number;
  open: number;
  missingInBooks: number;
  diff: number;
}
export const effectiveStatus = (r: Pick<Row2b, "status" | "action">): MatchStatus => (r.action === "accept" ? "accepted" : r.action === "ignore" ? "ignored" : r.status);

// ---------------------------------------------------------------- queries

const stale = { staleTime: 20_000 };
const key = (...rest: unknown[]) => ["gst", ...rest] as const;

export const gstr1Params = (period: string): QueryParams => (isQuarterKey(period) ? { quarter: period } : { period: `${period.slice(5, 7)}${period.slice(0, 4)}` });

export const useGstOverview = () => useQuery({ queryKey: key("overview"), queryFn: () => api.get<GstOverview>(`${G}/overview`), ...stale });

export const useGstIssues = (period: string, enabled = true) =>
  useQuery({ queryKey: key("issues", period), queryFn: ({ signal }) => api.get<{ period: string; issues: FilingIssue[] }>(`${G}/issues`, { period }, { signal }), enabled, placeholderData: keepPreviousData, ...stale });

export const useGstSettings = () =>
  useQuery({ queryKey: key("settings"), queryFn: () => api.get<{ config: GstConfig; rcmCategories: RcmCategory[] }>(`${G}/settings`), ...stale });

export const useRcmCategories = () =>
  useQuery({ queryKey: key("rcm-categories"), queryFn: () => api.get<{ items: RcmCategory[] }>(`${G}/rcm-categories`).then((r) => r.items), staleTime: 3_600_000 });

export const useCompositionPreview = (from: string, enabled: boolean) =>
  useQuery({ queryKey: key("comp-preview", from), queryFn: () => api.get<CompositionPreview>(`${G}/composition/preview`, { from }), enabled: enabled && /^\d{4}-\d{2}-\d{2}$/.test(from) });

export const useGstr1 = (period: string, enabled = true) =>
  useQuery({ queryKey: key("gstr1", period), queryFn: ({ signal }) => api.get<Gstr1Result>(`${G}/gstr1`, gstr1Params(period), { signal }), enabled, placeholderData: keepPreviousData, ...stale });

export const useGstr3b = (period: string, enabled = true) =>
  useQuery({ queryKey: key("gstr3b", period), queryFn: ({ signal }) => api.get<Gstr3b>(`${G}/gstr3b`, { period }, { signal }), enabled, placeholderData: keepPreviousData, ...stale });

export const useGstr3bCell = (period: string, cell: CellId | null) =>
  useQuery({ queryKey: key("gstr3b-cell", period, cell), queryFn: ({ signal }) => api.get<Gstr3bCell>(`${G}/gstr3b/cell`, { period, cell }, { signal }), enabled: !!cell });

export const useItc = (params: QueryParams) =>
  useQuery({ queryKey: key("itc", params), queryFn: ({ signal }) => api.get<ItcRegister>(`${G}/itc`, params, { signal }), placeholderData: keepPreviousData, ...stale });

export const useRcm = (range: { from: string; to: string }) =>
  useQuery({ queryKey: key("rcm", range), queryFn: ({ signal }) => api.get<RcmRegister>(`${G}/rcm`, range, { signal }), placeholderData: keepPreviousData, ...stale });

export const useAdjustments = (month: string) =>
  useQuery({ queryKey: key("adjustments", month), queryFn: () => api.get<{ items: GstAdjustment[] }>(`${G}/adjustments`, { month }).then((r) => r.items), ...stale });

export const useAdvances = (month: string, enabled = true) =>
  useQuery({ queryKey: key("advances", month), queryFn: () => api.get<{ items: GstAdvance[] }>(`${G}/advances`, { month }).then((r) => r.items), enabled, ...stale });

export const usePayments = (params: QueryParams = {}, enabled = true) =>
  useQuery({ queryKey: key("payments", params), queryFn: () => api.get<{ items: GstPayment[] }>(`${G}/payments`, params).then((r) => r.items), enabled, ...stale });

export const useCmp08 = (quarter: string, enabled = true) =>
  useQuery({ queryKey: key("cmp08", quarter), queryFn: () => api.get<Cmp08>(`${G}/cmp08`, { quarter }), enabled, placeholderData: keepPreviousData, ...stale });

export const useGstr4 = (fy: number, enabled = true) =>
  useQuery({ queryKey: key("gstr4", fy), queryFn: () => api.get<Gstr4>(`${G}/gstr4`, { fy }), enabled, placeholderData: keepPreviousData, ...stale });

export const useImports2b = () => useQuery({ queryKey: key("2b-imports"), queryFn: () => api.get<{ items: Import2b[] }>(`${G}/gstr2b/imports`).then((r) => r.items), ...stale });

export const useSummary2b = (month: string) =>
  useQuery({ queryKey: key("2b", month, "summary"), queryFn: () => api.get<Summary2b>(`${G}/gstr2b/${month}`), placeholderData: keepPreviousData, ...stale });

export const useRows2b = (month: string, params: QueryParams, enabled: boolean) =>
  useQuery({ queryKey: key("2b", month, "rows", params), queryFn: () => api.get<Rows2b>(`${G}/gstr2b/${month}/rows`, params), enabled, placeholderData: keepPreviousData, ...stale });

export const useSuppliers2b = (month: string, enabled: boolean) =>
  useQuery({ queryKey: key("2b", month, "suppliers"), queryFn: () => api.get<{ items: Supplier2b[] }>(`${G}/gstr2b/${month}/suppliers`).then((r) => r.items), enabled, ...stale });

// ---------------------------------------------------------------- changes

function useGstMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => void qc.invalidateQueries({ queryKey: ["gst"] }) });
}

export const useSaveSettings = () => useGstMutation((body: SettingsPatch) => api.put<{ config: GstConfig }>(`${G}/settings`, body));
export const useMarkFiled = () =>
  useGstMutation((body: { returnType: string; period: string; filedOn: string; arn?: string | null }) => api.put(`${G}/filings`, body));
export const useUnmarkFiled = () => useGstMutation((v: { returnType: string; period: string }) => api.delete(`${G}/filings/${v.returnType}/${v.period}`));

export const useSetItcFlag = () =>
  useGstMutation((v: { docType: "purchase" | "expense"; docId: string; patch: ItcFlagPatch }) => api.put(`${G}/itc/${v.docType}/${v.docId}`, v.patch));

export const useAddAdjustment = () =>
  useGstMutation((body: { month: string; kind: AdjustmentKind; taxable: number; igst: number; cgst: number; sgst: number; cess: number; note?: string | null }) => api.post<GstAdjustment>(`${G}/adjustments`, body));
export const useDeleteAdjustment = () => useGstMutation((id: string) => api.delete(`${G}/adjustments/${id}`));

export const useAddAdvance = () =>
  useGstMutation((body: { month: string; kind: "received" | "adjusted"; pos: string; rate: number; amount: number; cess?: number; note?: string | null }) => api.post<GstAdvance>(`${G}/advances`, body));
export const useDeleteAdvance = () => useGstMutation((id: string) => api.delete(`${G}/advances/${id}`));

export const useAddPayment = () =>
  useGstMutation((body: { kind: TaxPaymentKind; period: string; paidOn: string; igst?: number; cgst?: number; sgst?: number; cess?: number; interest?: number; lateFee?: number; method?: string; challan?: string | null; note?: string | null }) =>
    api.post<GstPayment>(`${G}/payments`, body),
  );
export const useDeletePayment = () => useGstMutation((id: string) => api.delete(`${G}/payments/${id}`));

/** Uploads a GSTR-2B JSON or Excel file (nothing is sent to the GST portal). */
export const useImport2b = () =>
  useGstMutation(async (v: { file: File; month: string }) => {
    const isXlsx = /\.xlsx$/i.test(v.file.name);
    const blob = new Blob([await v.file.arrayBuffer()], { type: isXlsx ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/json" });
    return api<{ importId: string; month: string; rows: number; warnings: string[]; summary: unknown }>(`${G}/gstr2b/import`, {
      method: "POST",
      body: blob,
      query: { month: v.month },
      headers: { "x-file-name": v.file.name.replace(/[^\x20-\x7e]/g, "_") },
    });
  });
export const useRematch2b = () => useGstMutation((month: string) => api.post(`${G}/gstr2b/${month}/rematch`));
export const useAct2b = () => useGstMutation((v: { id: string; action: "accept" | "ignore" | "reopen"; note?: string | null }) => api.post(`${G}/gstr2b/rows/${v.id}/action`, { action: v.action, note: v.note ?? null }));
export const useDelete2b = () => useGstMutation((month: string) => api.delete(`${G}/gstr2b/${month}`));
