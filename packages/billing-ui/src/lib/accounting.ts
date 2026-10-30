"use client";

/**
 * The shop's books (`/v1/accounting`, packages/accounting): types and React Query hooks. Money is integer paise.
 * "net" values are debit minus credit (a credit balance is negative).
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type QueryParams } from "@rbms/web";

export const ACC = "/accounting";
export const ACCOUNTING_FEATURE = "accounting";
export const ACC_VIEW = "accounting.view";
export const ACC_POST = "accounting.post";
export const ACC_LOCK = "accounting.lock";

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

export interface AccountGroup {
  key: string;
  type: AccountType;
}

/** The group keys per type (matches packages/accounting/src/chart.ts); labels come from messages. */
export const ACCOUNT_GROUPS: AccountGroup[] = [
  { key: "cash_bank", type: "asset" },
  { key: "receivables", type: "asset" },
  { key: "stock", type: "asset" },
  { key: "tax_assets", type: "asset" },
  { key: "current_assets", type: "asset" },
  { key: "fixed_assets", type: "asset" },
  { key: "payables", type: "liability" },
  { key: "tax_liabilities", type: "liability" },
  { key: "current_liabilities", type: "liability" },
  { key: "loans", type: "liability" },
  { key: "capital", type: "equity" },
  { key: "sales", type: "income" },
  { key: "other_income", type: "income" },
  { key: "direct", type: "expense" },
  { key: "indirect", type: "expense" },
];
export const ACCOUNT_TYPES: AccountType[] = ["asset", "liability", "equity", "income", "expense"];

export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  group: string;
  subGroup: string | null;
  key: string | null;
  system: boolean;
  isCash: boolean;
  isBank: boolean;
  bankName: string | null;
  bankAccountLast4: string | null;
  bankIfsc: string | null;
  openingBalance: number;
  active: boolean;
  description: string | null;
  normalSide: "dr" | "cr";
  balance?: number;
  debit?: number;
  credit?: number;
}

export interface AccountingSettings {
  lockedThrough: string | null;
  startDate: string | null;
  postFrom: string | null;
  importedBills: "exclude" | "post";
  valueStock: boolean;
  methodAccounts: Record<string, string>;
  autoPost: boolean;
  lastSyncAt: string | null;
  lastSyncSummary: { posted?: number; reversed?: number; unchanged?: number; late?: number; errors?: number; ms?: number } | null;
  entryCount: number;
  lockHistory: { id: string; lockedThrough: string | null; previous: string | null; reason: string | null; at: string }[];
}
export interface AccountingOverview extends AccountingSettings {
  accountCount: number;
  today: string;
}

export interface EntryLine {
  id: string;
  lineNo: number;
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  memo: string | null;
  partyType: string | null;
  partyId: string | null;
}
export interface Entry {
  id: string;
  seq: number;
  number: string;
  voucherType: "journal" | "contra" | "payment" | "receipt" | "auto" | "reversal";
  origin: "manual" | "auto";
  date: string;
  lateFor: string | null;
  narration: string;
  reference: string | null;
  status: "posted" | "reversed";
  total: number;
  sourceType: string | null;
  reversalOfId: string | null;
  reversedById: string | null;
  reversalReason: string | null;
  kindLabel: string;
  lines: EntryLine[];
}
export interface EntryPage {
  items: Entry[];
  total: number;
  limit: number;
  offset: number;
  totals: { debit: number; entries: number };
}

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  group: string;
  openingDr: number;
  openingCr: number;
  debit: number;
  credit: number;
  closingDr: number;
  closingCr: number;
}
export interface TrialBalance {
  from: string;
  to: string;
  rows: TrialBalanceRow[];
  totals: { openingDr: number; openingCr: number; debit: number; credit: number; closingDr: number; closingCr: number };
  balanced: boolean;
}

export interface PnlLine {
  accountId: string | null;
  code: string | null;
  name: string;
  amount: number;
  compare?: number;
}
export interface PnlSection {
  key: "sales" | "cogs" | "otherIncome" | "expenses";
  label: string;
  lines: PnlLine[];
  total: number;
  compareTotal?: number;
}
export interface ProfitLoss {
  from: string;
  to: string;
  compare: { from: string; to: string } | null;
  sections: PnlSection[];
  stock: { opening: number; closing: number; compareOpening?: number; compareClosing?: number };
  grossProfit: number;
  netProfit: number;
  compareGrossProfit?: number;
  compareNetProfit?: number;
}

export interface BalanceSheetGroup {
  key: string;
  label: string;
  lines: { accountId: string | null; code: string | null; name: string; amount: number }[];
  total: number;
}
export interface BalanceSheet {
  asOf: string;
  assets: BalanceSheetGroup[];
  liabilities: BalanceSheetGroup[];
  equity: BalanceSheetGroup[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  profitToDate: number;
  stockValue: number;
  difference: number;
  balanced: boolean;
}

export interface LedgerRow {
  lineId: string;
  entryId: string;
  date: string;
  number: string;
  voucherType: string;
  narration: string;
  memo: string | null;
  debit: number;
  credit: number;
  balance: number;
}
export interface Ledger {
  account: Account;
  from: string;
  to: string;
  openingBalance: number;
  rows: LedgerRow[];
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
}
export interface CashBook extends Ledger {
  accounts: { id: string; name: string; isBank: boolean; isCash: boolean }[];
}

export interface GstLedger {
  from: string;
  to: string;
  output: { cgst: number; sgst: number; igst: number; cess: number; total: number };
  input: { cgst: number; sgst: number; igst: number; cess: number; total: number };
  net: number;
}

export interface ReconcileCheck {
  key: string;
  label: string;
  ledger: number;
  source: number;
  difference: number;
  ok: boolean;
  note?: string;
  explained?: { label: string; amount: number }[];
}
export interface Reconcile {
  asOf: string;
  from: string;
  to: string;
  ok: boolean;
  checks: ReconcileCheck[];
}
export interface PartyDifferences {
  type: "customer" | "supplier";
  items: { partyId: string | null; name: string; ledger: number; source: number; difference: number }[];
  total: { ledger: number; source: number; difference: number };
}

export interface SyncResult {
  dryRun: boolean;
  posted: number;
  reversed: number;
  unchanged: number;
  late: number;
  byType: Record<string, { posted: number; reversed: number; unchanged: number }>;
  errors: { sourceType: string; sourceId: string; message: string }[];
  startDate: string | null;
  postFrom: string | null;
  ms: number;
}

export interface EntryInput {
  voucherType: "journal" | "contra" | "payment" | "receipt";
  date: string;
  narration: string;
  reference?: string | null;
  lines?: { accountId: string; debit: number; credit: number; memo?: string | null }[];
  simple?: { accountId: string; otherAccountId: string; amount: number };
}

export interface AccountInput {
  code?: string;
  name: string;
  type: AccountType;
  group: string;
  subGroup?: string | null;
  description?: string | null;
  isBank?: boolean;
  bankName?: string | null;
  bankAccountLast4?: string | null;
  bankIfsc?: string | null;
  openingBalance?: number;
}

export const qka = {
  all: ["accounting"] as const,
  accounts: (balances: boolean) => ["accounting", "accounts", balances] as const,
};

const stale = { staleTime: 15_000 };

export const useAccountingOverview = (enabled = true) =>
  useQuery({ queryKey: ["accounting", "overview"], queryFn: () => api.get<AccountingOverview>(`${ACC}/overview`), enabled, ...stale });

export const useAccountingSettings = () =>
  useQuery({ queryKey: ["accounting", "settings"], queryFn: () => api.get<AccountingSettings>(`${ACC}/settings`), ...stale });

export const useAccounts = (balances = false, enabled = true) =>
  useQuery({ queryKey: qka.accounts(balances), queryFn: () => api.get<{ items: Account[] }>(`${ACC}/accounts`, { balances: balances ? "1" : undefined }).then((r) => r.items), enabled, ...stale });

export const useEntries = (params: QueryParams, enabled = true) =>
  useQuery({ queryKey: ["accounting", "entries", params], queryFn: ({ signal }) => api.get<EntryPage>(`${ACC}/journal-entries`, params, { signal }), placeholderData: keepPreviousData, enabled });

export const useTrialBalance = (p: { from: string; to: string }) =>
  useQuery({ queryKey: ["accounting", "tb", p], queryFn: ({ signal }) => api.get<TrialBalance>(`${ACC}/reports/trial-balance`, p, { signal }), placeholderData: keepPreviousData });

export const useProfitLoss = (p: { from: string; to: string; compare?: string }) =>
  useQuery({ queryKey: ["accounting", "pnl", p], queryFn: ({ signal }) => api.get<ProfitLoss>(`${ACC}/reports/profit-loss`, p, { signal }), placeholderData: keepPreviousData });

export const useBalanceSheet = (asOf: string) =>
  useQuery({ queryKey: ["accounting", "bs", asOf], queryFn: ({ signal }) => api.get<BalanceSheet>(`${ACC}/reports/balance-sheet`, { asOf }, { signal }), placeholderData: keepPreviousData });

export const useLedger = (p: { accountId: string; from: string; to: string }, enabled = true) =>
  useQuery({ queryKey: ["accounting", "ledger", p], queryFn: ({ signal }) => api.get<Ledger>(`${ACC}/reports/ledger`, p, { signal }), enabled: enabled && !!p.accountId, placeholderData: keepPreviousData });

export const useCashBook = (p: { accountId?: string; from: string; to: string }) =>
  useQuery({ queryKey: ["accounting", "cash-book", p], queryFn: ({ signal }) => api.get<CashBook>(`${ACC}/reports/cash-book`, p, { signal }), placeholderData: keepPreviousData });

export const useGstLedger = (p: { from: string; to: string }) =>
  useQuery({ queryKey: ["accounting", "gst", p], queryFn: ({ signal }) => api.get<GstLedger>(`${ACC}/reports/gst-ledger`, p, { signal }), placeholderData: keepPreviousData });

export const useReconcile = (p: { from: string; to: string }) =>
  useQuery({ queryKey: ["accounting", "reconcile", p], queryFn: () => api.get<Reconcile>(`${ACC}/reconcile`, p) });

export const useReconcileParties = (type: "customer" | "supplier", enabled: boolean) =>
  useQuery({ queryKey: ["accounting", "reconcile-parties", type], queryFn: () => api.get<PartyDifferences>(`${ACC}/reconcile/parties`, { type }), enabled });

function useRefresh() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: qka.all });
}

export function useCreateEntry() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (body: EntryInput) => api.post<Entry>(`${ACC}/journal-entries`, body), onSuccess: refresh });
}
export function useReverseEntry() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: ({ id, reason, date }: { id: string; reason: string; date?: string }) => api.post<Entry>(`${ACC}/journal-entries/${id}/reverse`, { reason, date }), onSuccess: refresh });
}
export function useSaveAccount() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Partial<AccountInput> & { active?: boolean } }) => (id ? api.patch<Account>(`${ACC}/accounts/${id}`, body) : api.post<Account>(`${ACC}/accounts`, body)),
    onSuccess: refresh,
  });
}
export function useDeleteAccount() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (id: string) => api.delete<{ ok: true }>(`${ACC}/accounts/${id}`), onSuccess: refresh });
}
export function useSetLock() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (body: { lockedThrough: string | null; reason?: string | null }) => api.put<AccountingSettings>(`${ACC}/settings/lock`, body), onSuccess: refresh });
}
export function useUpdateAccountingSettings() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Partial<Pick<AccountingSettings, "importedBills" | "valueStock">> & { startDate?: string | null; methodAccounts?: Record<string, string | null> }) => api.patch<AccountingSettings>(`${ACC}/settings`, body),
    onSuccess: refresh,
  });
}
export function useBackfill() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: { from?: string | null; dryRun?: boolean }) => api.post<SyncResult>(`${ACC}/backfill`, body),
    onSuccess: (_r, v) => {
      if (!v.dryRun) refresh();
    },
  });
}
export function useSyncNow() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: () => api.post<SyncResult>(`${ACC}/sync`), onSuccess: refresh });
}

/** PDF of a report: `/documents/accounting-report/<report>.pdf?from=&to=`. */
export const accountingPdfPath = (report: string) => `/documents/accounting-report/${report}.pdf`;

/** Paise as "1,234.00 Dr" / "Cr" for a net (debit-positive) balance. */
export function sideAmount(net: number): { amount: number; side: "dr" | "cr" | "" } {
  return net === 0 ? { amount: 0, side: "" } : { amount: Math.abs(net), side: net > 0 ? "dr" : "cr" };
}
