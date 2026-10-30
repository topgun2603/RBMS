"use client";

/**
 * Accounting Part B (`/v1/accounting/bank`, `/cheques`, `/tds`, `/assets`, `/depreciation`, `/year-end`): types and
 * React Query hooks. Money is integer paise; statement and book amounts are signed (+ money in, - money out).
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@rbms/web";
import { ACC } from "./accounting";

export const ACC_BANK = "accounting.bank";
export const ACC_TDS = "accounting.tds";

export interface BankAccountRow {
  id: string;
  code: string;
  name: string;
  active: boolean;
  bankName: string | null;
  bankAccountLast4: string | null;
  bankIfsc: string | null;
  bookBalance: number;
  statementLines: number;
  openLines: number;
  statementFrom: string | null;
  statementTo: string | null;
  statementBalance: number | null;
  reconciledThrough: string | null;
}

export type BankField = "date" | "valueDate" | "narration" | "reference" | "debit" | "credit" | "amount" | "drcr" | "balance";
export const BANK_FIELDS: BankField[] = ["date", "narration", "reference", "debit", "credit", "amount", "drcr", "balance", "valueDate"];
export type ColumnMapping = Partial<Record<BankField, number>>;

export interface ParsedLine {
  row: number;
  date: string;
  valueDate: string | null;
  narration: string;
  reference: string | null;
  amount: number;
  balance: number | null;
  duplicate?: boolean;
}
export interface ImportPreview {
  layout: string;
  headerRow: number;
  headers: string[];
  mapping: ColumnMapping;
  sample: string[][];
  lines: ParsedLine[];
  errors: { row: number; message: string }[];
  warnings: string[];
  counts: { lines: number; new: number; duplicates: number; errors: number; skipped: number };
  from: string | null;
  to: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  reversed: boolean;
}
export interface ImportResult {
  statementId: string;
  layout: string;
  lines: number;
  added: number;
  duplicates: number;
  errors: { row: number; message: string }[];
  warnings: string[];
  from: string | null;
  to: string | null;
}
export interface ImportOptions {
  accountId: string;
  file: File;
  mapping?: ColumnMapping;
  headerRow?: number;
  dateOrder?: "dmy" | "mdy";
}

export interface BankLine {
  id: string;
  accountId: string;
  statementId: string;
  date: string;
  valueDate: string | null;
  narration: string;
  reference: string | null;
  amount: number;
  balance: number | null;
  status: "open" | "matched" | "excluded";
  matchGroupId: string | null;
  note: string | null;
}
export interface BookLine {
  id: string;
  entryId: string;
  date: string;
  amount: number;
  narration: string;
  reference: string | null;
  number: string;
  chequeNo: string | null;
  sourceType: string | null;
}
export interface Suggestion {
  kind: "one_to_one" | "many_book" | "many_bank";
  bankIds: string[];
  bookIds: string[];
  confidence: number;
  reasons: string[];
}
export interface Workspace {
  account: { id: string; name: string; code: string; bankName: string | null; bankAccountLast4: string | null };
  bankLines: BankLine[];
  bookLines: BookLine[];
  suggestions: Suggestion[];
  summary: { open: number; matched: number; excluded: number; openBook: number };
}
export interface MatchedGroup {
  groupId: string;
  method: string;
  reconciled: boolean;
  at: string;
  bankLines: { id: string; date: string; amount: number; narration: string; reference: string | null }[];
  bookLines: { id: string; date: string; amount: number; narration: string; number: string }[];
}
export interface BrsLine {
  id: string;
  date: string;
  amount: number;
  narration: string;
  number?: string;
  reference?: string | null;
  chequeNo?: string | null;
}
export interface Reconciliation {
  asOf: string;
  account: { id: string; name: string; code: string };
  bookBalance: number;
  notInBankPayments: BrsLine[];
  notInBankReceipts: BrsLine[];
  notInBooksCredits: BrsLine[];
  notInBooksDebits: BrsLine[];
  totals: { notInBankPayments: number; notInBankReceipts: number; notInBooksCredits: number; notInBooksDebits: number };
  expectedBankBalance: number;
  bankBalance: number | null;
  statementBalance: number | null;
  statementFrom: string | null;
  assumedCleared: number;
  difference: number | null;
  reconciled: boolean;
  reconciledThrough: string | null;
  history: { id: string; asOf: string; bookBalance: number; bankBalance: number; difference: number; note: string | null; at: string }[];
  postDated: Cheque[];
}

export type ChequeStatus = "pending" | "deposited" | "cleared" | "bounced" | "cancelled";
export interface Cheque {
  id: string;
  direction: "issued" | "received";
  accountId: string;
  chequeNo: string;
  chequeDate: string;
  amount: number;
  partyName: string;
  drawnOn: string | null;
  status: ChequeStatus;
  depositedOn: string | null;
  clearedOn: string | null;
  bouncedOn: string | null;
  bounceReason: string | null;
  bounceCharges: number;
  acctLineId: string | null;
  note: string | null;
}

export interface TdsSection {
  key: string;
  kind: "tds" | "tcs";
  section: string;
  label: string;
  plain: string;
  rate: number;
  rateOther: number;
  noPanRate: number;
  single: number | null;
  annual: number | null;
  basis: string;
  needsTurnover10Cr?: boolean;
  validUntil?: string;
  note?: string;
  enabled: boolean;
}
export interface TdsSettings {
  enabled: boolean;
  tcsEnabled: boolean;
  tan: string | null;
  deductorName: string | null;
  responsiblePerson: string | null;
  buyerTurnoverAbove10Cr: boolean;
  overrides: Record<string, Record<string, number | boolean | null>>;
  sections: TdsSection[];
}
export interface TdsParty {
  id: string;
  name: string;
  gstin: string | null;
  phone: string | null;
  pan: string | null;
  panFromGstin: string | null;
  effectivePan: string | null;
  deducteeType: string | null;
  defaultSection: string | null;
  lowerRate: number | null;
  certificateNo: string | null;
  certificateUntil: string | null;
}
export interface TdsEntry {
  id: string;
  kind: "tds" | "tcs";
  date: string;
  section: string;
  partyType: string;
  partyId: string | null;
  partyName: string;
  pan: string | null;
  base: number;
  rate: number;
  amount: number;
  noPan: boolean;
  sourceType: string;
  sourceRef: string | null;
  status: "active" | "cancelled";
  challanId: string | null;
  settlementId: string | null;
  note: string | null;
}
export interface TdsCompute {
  applies: boolean;
  taxable: number;
  rate: number;
  amount: number;
  noPan: boolean;
  reasons: string[];
  pan: string | null;
  deducteeType: string | null;
  earlier: number;
  depositDue: string;
  fy: string;
}
export interface TdsChallan {
  id: string;
  kind: "tds" | "tcs";
  period: string;
  section: string | null;
  bsrCode: string;
  challanNo: string;
  date: string;
  tax: number;
  interest: number;
  fee: number;
  status: "active" | "cancelled";
  allocated: number;
  entries: number;
  note: string | null;
}
export interface TdsPayable {
  fy: string;
  items: { kind: "tds" | "tcs"; month: string; section: string; entries: number; deducted: number; deposited: number; balance: number; dueDate: string; status: "paid" | "due" | "late"; interestHint: number }[];
  totals: { deducted: number; deposited: number; balance: number };
  ledgerBalance: { tds: number; tcs: number };
}
export interface TdsQuarterly {
  quarter: string;
  from: string;
  to: string;
  kind: "tds" | "tcs";
  form: string;
  tan: string | null;
  deductees: { id: string; section: string; partyName: string; pan: string; noPan: boolean; date: string; base: number; rate: number; amount: number; bsrCode: string | null; challanNo: string | null; challanDate: string | null; deposited: boolean; reference: string | null }[];
  sections: { section: string; count: number; base: number; amount: number; deposited: number }[];
  totals: { count: number; base: number; amount: number; deposited: number };
  returnDue: string;
  certificateDue: string;
  issues: string[];
  note: string;
}
export interface TdsCalendar {
  today: string;
  deposits: { kind: string; month: string; section: string; what: string; due: string; amount: number; late: boolean }[];
  returns: { kind: string; quarter: string; form: string; what: string; due: string; certificateDue: string; late: boolean }[];
  alerts: string[];
}
export interface TdsDocument {
  id: string;
  date: string;
  label: string;
  amount: number;
  base: number;
  supplierId?: string | null;
}

export interface FixedAsset {
  id: string;
  name: string;
  assetAccountId: string;
  accountName: string;
  purchaseDate: string;
  inUseFrom: string;
  cost: number;
  salvage: number;
  method: "slm" | "wdv";
  rate: number | null;
  lifeMonths: number | null;
  openingDepreciation: number;
  status: "active" | "disposed";
  disposedOn: string | null;
  saleAmount: number | null;
  accumulated: number;
  bookValue: number;
  depreciatedTo: string | null;
  dueNow: number;
}
export interface DepreciationPreview {
  upTo: string;
  items: { assetId: string; name: string; from: string; to: string; amount: number }[];
  total: number;
}
export interface YearEnd {
  fy: string;
  from: string;
  to: string;
  closed: { id: string; fy: string; netProfit: number; closedAt: string; note: string | null } | null;
  lockedThrough: string | null;
  netProfit: number;
  pnlNetProfit: number;
  stockAdjustment: number;
  lines: { accountId: string; account: string; debit: number; credit: number; memo?: string }[];
  checks: { key: string; ok: boolean; label: string; date: string; count: number; amount: number }[];
  blocking: string[];
  closedYears: string[];
  history: { id: string; fy: string; status: string; netProfit: number; closedAt: string; reopenedAt: string | null; reopenReason: string | null; note: string | null }[];
}

const stale = { staleTime: 10_000 };
const k = (...parts: unknown[]) => ["accounting", "b", ...parts] as const;

function useRefresh() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ["accounting"] });
}
const useAcctMutation = <V, R>(fn: (v: V) => Promise<R>) => {
  const refresh = useRefresh();
  return useMutation({ mutationFn: fn, onSuccess: refresh });
};

// ---- bank
export const useBankAccounts = () => useQuery({ queryKey: k("bank-accounts"), queryFn: () => api.get<{ items: BankAccountRow[] }>(`${ACC}/bank/accounts`).then((r) => r.items), ...stale });
export const useWorkspace = (accountId: string) =>
  useQuery({ queryKey: k("workspace", accountId), queryFn: () => api.get<Workspace>(`${ACC}/bank/workspace`, { accountId }), enabled: !!accountId, placeholderData: keepPreviousData });
export const useMatchedGroups = (accountId: string, enabled = true) =>
  useQuery({ queryKey: k("matches", accountId), queryFn: () => api.get<{ items: MatchedGroup[] }>(`${ACC}/bank/matches`, { accountId }).then((r) => r.items), enabled: !!accountId && enabled });
export const useStatements = (accountId: string) =>
  useQuery({ queryKey: k("statements", accountId), queryFn: () => api.get<{ items: { id: string; fileName: string | null; layout: string; fromDate: string | null; toDate: string | null; rows: number; added: number; duplicates: number; createdAt: string }[] }>(`${ACC}/bank/statements`, { accountId }).then((r) => r.items), enabled: !!accountId });
export const useReconciliation = (p: { accountId: string; asOf: string; bankBalance?: number | null }) =>
  useQuery({
    queryKey: k("brs", p),
    queryFn: () => api.get<Reconciliation>(`${ACC}/bank/reconciliation`, { accountId: p.accountId, asOf: p.asOf, bankBalance: p.bankBalance ?? undefined }),
    enabled: !!p.accountId,
    placeholderData: keepPreviousData,
  });

async function upload<T>(path: string, o: ImportOptions): Promise<T> {
  const blob = new Blob([await o.file.arrayBuffer()], { type: "application/octet-stream" });
  return api<T>(`${ACC}${path}`, {
    method: "POST",
    body: blob,
    query: { accountId: o.accountId, mapping: o.mapping ? JSON.stringify(o.mapping) : undefined, headerRow: o.headerRow !== undefined ? String(o.headerRow) : undefined, dateOrder: o.dateOrder },
    headers: { "x-file-name": encodeURIComponent(o.file.name) },
  });
}
export const usePreviewImport = () => useMutation({ mutationFn: (o: ImportOptions) => upload<ImportPreview>("/bank/import/preview", o) });
export const useImportStatement = () => useAcctMutation((o: ImportOptions) => upload<ImportResult>("/bank/import", o));
export const useDeleteStatement = () => useAcctMutation((id: string) => api.delete(`${ACC}/bank/statements/${id}`));
export const useMatch = () =>
  useAcctMutation((b: { accountId: string; bankLineIds: string[]; bookLineIds: string[]; differenceAccountId?: string | null; note?: string | null }) => api.post<{ groupId: string }>(`${ACC}/bank/match`, b));
export const useAutoMatch = () => useAcctMutation((b: { accountId: string; minConfidence: number }) => api.post<{ matched: number; suggestions: number }>(`${ACC}/bank/auto-match`, b));
export const useUnmatch = () => useAcctMutation((groupId: string) => api.delete(`${ACC}/bank/matches/${groupId}`));
export const useCreateFromLine = () =>
  useAcctMutation((v: { lineId: string; preset: string; accountId?: string | null; narration?: string | null }) =>
    api.post<{ entryId: string }>(`${ACC}/bank/lines/${v.lineId}/entry`, { preset: v.preset, accountId: v.accountId ?? null, narration: v.narration ?? null }),
  );
export const useExcludeLine = () => useAcctMutation((v: { lineId: string; excluded: boolean; note?: string | null }) => api.post(`${ACC}/bank/lines/${v.lineId}/exclude`, { excluded: v.excluded, note: v.note ?? null }));
export const useConfirmReconciliation = () =>
  useAcctMutation((b: { accountId: string; asOf: string; bankBalance?: number | null; note?: string | null; acceptDifference?: boolean }) => api.post<Reconciliation & { suggestLock: string | null }>(`${ACC}/bank/reconciliation/confirm`, b));
export const useReopenReconciliation = () => useAcctMutation((b: { accountId: string; after: string; reason: string }) => api.post(`${ACC}/bank/reconciliation/reopen`, b));

// ---- cheques
export const useCheques = (p: { direction?: string; status?: string }) =>
  useQuery({ queryKey: k("cheques", p), queryFn: () => api.get<{ items: Cheque[]; today: string; summary: { dueToDeposit: number; postDated: number; uncleared: number } }>(`${ACC}/cheques`, p), placeholderData: keepPreviousData });
export const useSaveCheque = () =>
  useAcctMutation((v: { id?: string; body: Partial<Cheque> & { accountId?: string } }) => (v.id ? api.patch<Cheque>(`${ACC}/cheques/${v.id}`, v.body) : api.post<Cheque>(`${ACC}/cheques`, v.body)));
export const useChequeAction = () =>
  useAcctMutation((v: { id: string; action: "deposit" | "clear" | "bounce" | "cancel" | "reopen"; date?: string; reason?: string | null; charges?: number }) =>
    api.post<{ cheque: Cheque; sourceFix: { sourceType: string | null; number: string } | null }>(`${ACC}/cheques/${v.id}/action`, { action: v.action, date: v.date, reason: v.reason ?? null, charges: v.charges }),
  );
export const useChequeCandidates = (id: string | null) =>
  useQuery({ queryKey: k("cheque-candidates", id), queryFn: () => api.get<{ items: BookLine[] }>(`${ACC}/cheques/${id}/candidates`).then((r) => r.items), enabled: !!id });

// ---- TDS / TCS
export const useTdsSettings = () => useQuery({ queryKey: k("tds-settings"), queryFn: () => api.get<TdsSettings>(`${ACC}/tds/settings`), ...stale });
export const useSaveTdsSettings = () => useAcctMutation((b: Partial<Omit<TdsSettings, "sections">>) => api.patch<TdsSettings>(`${ACC}/tds/settings`, b));
export const useTdsParties = (type: "supplier" | "customer", q: string) =>
  useQuery({ queryKey: k("tds-parties", type, q), queryFn: () => api.get<{ items: TdsParty[] }>(`${ACC}/tds/parties`, { type, q: q || undefined, limit: "100" }).then((r) => r.items), placeholderData: keepPreviousData });
export const useSaveParty = () =>
  useAcctMutation((v: { type: "supplier" | "customer"; id: string; body: { pan?: string | null; deducteeType?: string | null; defaultSection?: string | null; lowerRate?: number | null; certificateNo?: string | null; certificateUntil?: string | null } }) =>
    api.put<TdsParty>(`${ACC}/tds/parties/${v.type}/${v.id}`, v.body),
  );
export const useTdsCompute = (p: { section: string; partyType: string; partyId: string; base: number; date: string; sourceType?: string; sourceId?: string }, enabled: boolean) =>
  useQuery({
    queryKey: k("tds-compute", p),
    queryFn: () => api.get<TdsCompute>(`${ACC}/tds/compute`, { ...p, base: String(p.base) }),
    enabled: enabled && !!p.section && p.base > 0,
    placeholderData: keepPreviousData,
  });
export const useTdsDocuments = (type: "purchase" | "expense", supplierId: string | null, enabled: boolean) =>
  useQuery({ queryKey: k("tds-docs", type, supplierId), queryFn: () => api.get<{ items: TdsDocument[] }>(`${ACC}/tds/documents`, { type, supplierId: supplierId ?? undefined }).then((r) => r.items), enabled });
export const useTdsEntries = (p: { kind?: string; quarter?: string; status?: string }) =>
  useQuery({ queryKey: k("tds-entries", p), queryFn: () => api.get<{ items: TdsEntry[]; total: number; amount: number }>(`${ACC}/tds/entries`, { ...p, limit: "200" }), placeholderData: keepPreviousData });
export const useCreateTds = () => useAcctMutation((b: Record<string, unknown>) => api.post<TdsEntry>(`${ACC}/tds/entries`, b));
export const useCancelTds = () => useAcctMutation((v: { id: string; reason: string }) => api.post(`${ACC}/tds/entries/${v.id}/cancel`, { reason: v.reason }));
export const useTdsCandidates = () =>
  useQuery({ queryKey: k("tds-candidates"), queryFn: () => api.get<{ fy: string; items: { purchaseId: string; billNumber: string; date: string; supplierId: string; supplierName: string; taxable: number; section: string; reason: string }[] }>(`${ACC}/tds/candidates`) });
export const useChallans = () => useQuery({ queryKey: k("tds-challans"), queryFn: () => api.get<{ items: TdsChallan[] }>(`${ACC}/tds/challans`).then((r) => r.items) });
export const useCreateChallan = () => useAcctMutation((b: Record<string, unknown>) => api.post<{ id: string; allocated: number; entries: number; unallocated: number }>(`${ACC}/tds/challans`, b));
export const useCancelChallan = () => useAcctMutation((v: { id: string; reason: string }) => api.post(`${ACC}/tds/challans/${v.id}/cancel`, { reason: v.reason }));
export const useTdsPayable = (fy?: string) => useQuery({ queryKey: k("tds-payable", fy), queryFn: () => api.get<TdsPayable>(`${ACC}/tds/payable`, { fy }) });
export const useTdsQuarterly = (quarter: string, kind: "tds" | "tcs") =>
  useQuery({ queryKey: k("tds-quarterly", quarter, kind), queryFn: () => api.get<TdsQuarterly>(`${ACC}/tds/quarterly`, { quarter, kind }), placeholderData: keepPreviousData });
export const useTdsCalendar = () => useQuery({ queryKey: k("tds-calendar"), queryFn: () => api.get<TdsCalendar>(`${ACC}/tds/calendar`) });

// ---- fixed assets, depreciation, year-end
export const useAssets = () => useQuery({ queryKey: k("assets"), queryFn: () => api.get<{ asOf: string; items: FixedAsset[] }>(`${ACC}/assets`) });
export const useSaveAsset = () => useAcctMutation((b: Record<string, unknown>) => api.post<FixedAsset>(`${ACC}/assets`, b));
export const useDisposeAsset = () => useAcctMutation((v: { id: string; date: string; saleAmount: number; receivedInAccountId?: string | null }) => api.post(`${ACC}/assets/${v.id}/dispose`, { date: v.date, saleAmount: v.saleAmount, receivedInAccountId: v.receivedInAccountId ?? null }));
export const useDepreciationPreview = (upTo: string) => useQuery({ queryKey: k("dep-preview", upTo), queryFn: () => api.get<DepreciationPreview>(`${ACC}/depreciation/preview`, { upTo }), enabled: !!upTo });
export const useRunDepreciation = () => useAcctMutation((b: { upTo: string }) => api.post<DepreciationPreview & { posted: boolean }>(`${ACC}/depreciation/run`, b));
export const useDepreciationRuns = () => useQuery({ queryKey: k("dep-runs"), queryFn: () => api.get<{ items: { entryId: string; upTo: string; total: number; assets: number; status: string; number: string }[] }>(`${ACC}/depreciation/runs`).then((r) => r.items) });
export const useCancelRun = () => useAcctMutation((entryId: string) => api.post(`${ACC}/depreciation/runs/${entryId}/cancel`));
export const useYearEnd = (fy: string) => useQuery({ queryKey: k("year-end", fy), queryFn: () => api.get<YearEnd>(`${ACC}/year-end`, { fy: fy || undefined }), placeholderData: keepPreviousData });
export const useCloseYear = () => useAcctMutation((b: { fy: string; note?: string | null }) => api.post<YearEnd>(`${ACC}/year-end/close`, b));
export const useReopenYear = () => useAcctMutation((b: { fy: string; reason: string }) => api.post<YearEnd>(`${ACC}/year-end/reopen`, b));

/** "2026-27-Q3" for a date, and the last eight quarters for a picker. */
export function quarterKey(date: string): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  const q = m >= 4 && m <= 6 ? 1 : m >= 7 && m <= 9 ? 2 : m >= 10 ? 3 : 4;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}-Q${q}`;
}
export function recentQuarters(today: string, n = 8): string[] {
  const out: string[] = [];
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  for (let i = 0; i < n; i++) {
    out.push(quarterKey(`${y}-${String(m).padStart(2, "0")}-15`));
    m -= 3;
    if (m < 1) {
      m += 12;
      y -= 1;
    }
  }
  return [...new Set(out)];
}
export function fyOf(date: string): string {
  const y = Number(date.slice(0, 4));
  const start = Number(date.slice(5, 7)) >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
/** Basis points as "2%" / "0.1%". */
export const pct = (bp: number) => `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : bp % 10 === 0 ? 1 : 2)}%`;
