"use client";

/**
 * Expenses (`/v1/expenses`, packages/expenses): types, React Query hooks, the GST maths the form previews and the
 * receipt upload. Money is integer paise; `amount` includes GST.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { absoluteUrl, api, ApiError, apiDownload } from "@rbms/web";
import { isValidGstin } from "@rbms/gst";

/** "credit" = not paid yet: a bill in the supplier's Payables (needs a supplier). */
export const EXPENSE_PAYMENT_METHODS = ["cash", "upi", "card", "bank", "cheque", "other", "credit"] as const;
export type ExpensePaymentMethod = (typeof EXPENSE_PAYMENT_METHODS)[number];
export type ExpenseStatus = "recorded" | "cancelled" | "draft";

export interface ExpenseCategory {
  id: string;
  name: string;
  sort: number;
  builtin: boolean;
}

export interface Expense {
  id: string;
  date: string;
  categoryId: string;
  categoryName: string;
  amount: number;
  gstRate: number;
  gstAmount: number;
  taxable: number;
  itc: number;
  vendorName: string | null;
  vendorGstin: string | null;
  paymentMethod: ExpensePaymentMethod;
  reference: string | null;
  note: string | null;
  receiptUrl: string | null;
  /** `draft` = made by a recurring expense, to check / fill and record. */
  status: ExpenseStatus;
  /** Supplier (inventory) the bill is from. */
  supplierId: string | null;
  /** null = shop-wide. */
  branchId: string | null;
  /** Credit expenses: when the supplier is to be paid. */
  dueDate: string | null;
  /** Credit expenses: paid through Payables. */
  amountPaid: number;
  /** Credit expenses: still to pay. */
  balance: number;
  recurringId: string | null;
  createdAt: string;
}

export interface ExpenseInput {
  date?: string;
  categoryId?: string;
  amount: number;
  gstRate: number;
  vendorName?: string | null;
  vendorGstin?: string | null;
  paymentMethod: ExpensePaymentMethod;
  reference?: string | null;
  note?: string | null;
  receiptUrl?: string | null;
  supplierId?: string | null;
  /** Left out = the user's current branch; null = shop-wide. */
  branchId?: string | null;
  dueDate?: string | null;
}

export interface ExpenseFilters {
  from: string;
  to: string;
  categoryId?: string;
  q?: string;
  status?: "recorded" | "cancelled" | "all";
}

export interface ExpenseList {
  items: Expense[];
  total: number;
  totals: { amount: number; gst: number; itc: number };
}

export interface SummaryBucket {
  total: number;
  gst: number;
  itc: number;
  count: number;
}

export interface ExpenseSummary extends SummaryBucket {
  from: string;
  to: string;
  byCategory: (SummaryBucket & { categoryId: string; name: string })[];
  byMonth: (SummaryBucket & { month: string })[];
}

export interface ProfitReport {
  from: string;
  to: string;
  sales: { taxable: number; tax: number };
  purchases: { taxable: number; itc: number };
  expenses: { total: number; itc: number };
  grossProfit: number;
  netProfit: number;
  /** payable = output − itc; negative = credit carried forward. */
  gst: { output: number; itc: number; payable: number };
}

// ---------------------------------------------------------------- pure maths (mirrors packages/expenses/src/logic.ts)

/** GST inside a GST-inclusive amount: amount × rate / (100 + rate), to the paisa. */
export function gstFromInclusive(amount: number, rate: number): number {
  if (!amount || !rate || rate <= 0) return 0;
  return Math.round((amount * rate) / (100 + rate));
}

/** Input tax credit: the GST, only with a valid vendor GSTIN. */
export const itcFor = (gst: number, gstin: string | null | undefined) => (isValidGstin(gstin ?? "") ? gst : 0);

// ---------------------------------------------------------------- queries

const EXP = "/expenses";
export const EXPENSES_LIMIT = 500;

export const ek = {
  all: ["expenses"] as const,
  list: (f: ExpenseFilters) => ["expenses", "list", f] as const,
  categories: ["expenses", "categories"] as const,
  summary: (from: string, to: string) => ["expenses", "summary", from, to] as const,
  profit: (from: string, to: string) => ["expenses", "profit", from, to] as const,
};

export function useExpenses(f: ExpenseFilters) {
  return useQuery({
    queryKey: ek.list(f),
    queryFn: ({ signal }) => api.get<ExpenseList>(EXP, { ...f, limit: EXPENSES_LIMIT }, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useExpenseCategories(enabled = true) {
  return useQuery({
    queryKey: ek.categories,
    queryFn: () => api.get<{ items: ExpenseCategory[] }>(`${EXP}/categories`).then((r) => r.items),
    enabled,
    staleTime: 60_000,
  });
}

export function useExpenseSummary(from: string, to: string) {
  return useQuery({
    queryKey: ek.summary(from, to),
    queryFn: ({ signal }) => api.get<ExpenseSummary>(`${EXP}/summary`, { from, to }, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useProfitReport(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ek.profit(from, to),
    queryFn: ({ signal }) => api.get<ProfitReport>(`${EXP}/reports/profit`, { from, to }, { signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

function useChanged() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ek.all });
}

export function useSaveExpense() {
  const changed = useChanged();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: ExpenseInput }) => (id ? api.patch<Expense>(`${EXP}/${id}`, body) : api.post<Expense>(EXP, body)),
    onSuccess: changed,
  });
}

export function useCancelExpense() {
  const changed = useChanged();
  return useMutation({ mutationFn: (id: string) => api.delete<Expense>(`${EXP}/${id}`), onSuccess: changed });
}

export function useSaveCategory() {
  const changed = useChanged();
  return useMutation({
    mutationFn: ({ id, name }: { id?: string; name: string }) =>
      id ? api.patch<ExpenseCategory>(`${EXP}/categories/${id}`, { name }) : api.post<ExpenseCategory>(`${EXP}/categories`, { name }),
    onSuccess: changed,
  });
}

export function useDeleteCategory() {
  const changed = useChanged();
  return useMutation({ mutationFn: (id: string) => api.delete<{ ok: true }>(`${EXP}/categories/${id}`), onSuccess: changed });
}

export const downloadExpensesCsv = (f: ExpenseFilters) => apiDownload(EXP, { ...f, format: "csv" }, `expenses-${f.from}-to-${f.to}.csv`);

/** Records a draft (made by a recurring expense) with the fields filled in. */
export function useRecordExpense() {
  const changed = useChanged();
  return useMutation({ mutationFn: ({ id, body }: { id: string; body: Partial<ExpenseInput> }) => api.post<Expense>(`${EXP}/${id}/record`, body), onSuccess: changed });
}

/** Open credit expenses of a supplier (for choosing what a supplier payment settles). Empty without expenses access. */
export function useSupplierDueExpenses(supplierId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["expenses", "due", supplierId],
    queryFn: () =>
      api
        .get<ExpenseList>(EXP, { supplierId, unpaid: "true", status: "recorded", sort: "date", limit: 200 })
        .then((r) => r.items)
        .catch(() => [] as Expense[]),
    enabled: enabled && !!supplierId,
  });
}

// ---------------------------------------------------------------- expense report

export const EXPENSE_REPORT_GROUPS = ["category", "supplier", "branch", "month"] as const;
export type ExpenseReportGroup = (typeof EXPENSE_REPORT_GROUPS)[number];

export interface ExpenseReportRow {
  /** Category / supplier / branch id ("" = no supplier / shop-wide), or "YYYY-MM". */
  key: string;
  label: string;
  count: number;
  total: number;
  gst: number;
  itc: number;
  /** total − itc. */
  net: number;
  unpaid: number;
}

export interface ExpenseReport {
  from: string;
  to: string;
  groupBy: ExpenseReportGroup;
  rows: ExpenseReportRow[];
  totals: Omit<ExpenseReportRow, "key" | "label">;
}

export function useExpenseReport(p: { from: string; to: string; groupBy: ExpenseReportGroup }, enabled = true) {
  return useQuery({
    queryKey: ["expenses", "report", p] as const,
    queryFn: ({ signal }) => api.get<ExpenseReport>(`${EXP}/reports/expenses`, p, { signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export const downloadExpenseReportCsv = (p: { from: string; to: string; groupBy: ExpenseReportGroup }) =>
  apiDownload(`${EXP}/reports/expenses`, { ...p, format: "csv" }, `expenses-by-${p.groupBy}-${p.from}-to-${p.to}.csv`);

// ---------------------------------------------------------------- recurring expenses (`/v1/expenses/recurring`)

export const RECURRING_FREQUENCIES = ["weekly", "monthly", "quarterly", "yearly"] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];
export type RecurringStatus = "active" | "paused" | "ended";
export type RecurringMode = "auto" | "draft";

export interface RecurringExpense {
  id: string;
  name: string;
  categoryId: string;
  supplierId: string | null;
  branchId: string | null;
  vendorName: string | null;
  vendorGstin: string | null;
  /** null = ask each time. */
  amount: number | null;
  askEachTime: boolean;
  gstRate: number;
  paymentMethod: ExpensePaymentMethod;
  dueDays: number | null;
  note: string | null;
  mode: RecurringMode;
  frequency: RecurringFrequency;
  interval: number;
  dayOfMonth: number | null;
  weekday: number | null;
  startDate: string;
  endDate: string | null;
  nextRunDate: string | null;
  status: RecurringStatus;
  count: number;
  lastRunAt: string | null;
}

export interface RecurringExpenseRun {
  id: string;
  runDate: string;
  status: "created" | "draft" | "skipped" | "locked";
  expenseId: string | null;
  error: string | null;
  trigger: string;
}

export interface RecurringExpenseDetail extends RecurringExpense {
  runs: RecurringExpenseRun[];
  upcoming: string[];
}

export interface RecurringExpenseInput {
  name: string;
  categoryId?: string;
  supplierId?: string | null;
  branchId?: string | null;
  vendorName?: string | null;
  vendorGstin?: string | null;
  amount: number | null;
  gstRate: number;
  paymentMethod: ExpensePaymentMethod;
  dueDays?: number | null;
  note?: string | null;
  mode: RecurringMode;
  frequency: RecurringFrequency;
  interval: number;
  dayOfMonth?: number | null;
  weekday?: number | null;
  startDate: string;
  endDate?: string | null;
}

const REC = `${EXP}/recurring`;

export const rk = {
  list: ["expenses", "recurring", "list"] as const,
  one: (id: string) => ["expenses", "recurring", "one", id] as const,
  summary: ["expenses", "recurring", "summary"] as const,
};

export function useRecurringExpenses(enabled = true) {
  return useQuery({
    queryKey: rk.list,
    queryFn: ({ signal }) => api.get<{ items: RecurringExpense[]; total: number }>(REC, { limit: 200 }, { signal }),
    enabled,
  });
}

export function useRecurringExpense(id: string | null) {
  return useQuery({ queryKey: rk.one(id ?? ""), queryFn: () => api.get<RecurringExpenseDetail>(`${REC}/${id}`), enabled: !!id });
}

/** Drafts waiting to be filled and what is due in the next 7 days. */
export function useRecurringSummary(enabled = true) {
  return useQuery({
    queryKey: rk.summary,
    queryFn: () => api.get<{ drafts: number; dueSoon: { id: string; name: string; nextRunDate: string; amount: number | null }[] }>(`${REC}/summary`),
    enabled,
    staleTime: 30_000,
  });
}

/** The next dates of a schedule (the form's preview); errors (a bad schedule) show as no dates. */
export function useRecurringPreview(p: { frequency: RecurringFrequency; interval: number; dayOfMonth?: number | null; weekday?: number | null; startDate: string; endDate?: string | null }, enabled: boolean) {
  return useQuery({
    queryKey: ["expenses", "recurring", "preview", p] as const,
    queryFn: ({ signal }) => api.get<{ dates: string[] }>(`${REC}/preview`, { ...p, dayOfMonth: p.dayOfMonth ?? undefined, weekday: p.weekday ?? undefined, endDate: p.endDate || undefined }, { signal }),
    enabled: enabled && /^\d{4}-\d{2}-\d{2}$/.test(p.startDate),
    retry: false,
    placeholderData: keepPreviousData,
  });
}

export function useSaveRecurringExpense() {
  const changed = useChanged();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: RecurringExpenseInput }) =>
      id ? api.patch<RecurringExpenseDetail>(`${REC}/${id}`, body) : api.post<RecurringExpenseDetail>(REC, body),
    onSuccess: changed,
  });
}

export type RecurringAction = "pause" | "resume" | "skip" | "end" | "run";

export function useRecurringAction() {
  const changed = useChanged();
  return useMutation({ mutationFn: ({ id, action }: { id: string; action: RecurringAction }) => api.post<unknown>(`${REC}/${id}/${action}`), onSuccess: changed });
}

export function useDeleteRecurringExpense() {
  const changed = useChanged();
  return useMutation({ mutationFn: (id: string) => api.delete<{ ok: true }>(`${REC}/${id}`), onSuccess: changed });
}

// ---------------------------------------------------------------- receipt upload (`/v1/uploads`)

interface UploadSignResponse {
  fileId: string;
  upload: { url: string; method: "PUT"; headers: Record<string, string> };
}

/** sign → PUT the bytes (XHR for progress) → complete. Resolves with the absolute file URL. */
export async function uploadReceipt(file: File, onProgress?: (pct: number) => void): Promise<string> {
  const sign = await api.post<UploadSignResponse>("/uploads/sign", {
    filename: file.name,
    contentType: file.type || "application/octet-stream",
    size: file.size,
    visibility: "public",
    purpose: "receipt",
  });
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(sign.upload.method || "PUT", absoluteUrl(sign.upload.url));
    for (const [k, v] of Object.entries(sign.upload.headers ?? {})) {
      if (k.toLowerCase() === "content-length" || k.toLowerCase() === "host") continue;
      xhr.setRequestHeader(k, v);
    }
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError(xhr.status, "upload_failed", xhr.statusText || "Upload failed")));
    xhr.onerror = () => reject(new ApiError(0, "network_error", "Upload failed"));
    xhr.send(file);
  });
  const done = await api.post<{ url: string }>(`/uploads/${sign.fileId}/complete`);
  return absoluteUrl(done.url);
}
