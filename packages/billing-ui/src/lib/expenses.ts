"use client";

/**
 * Expenses (`/v1/expenses`, packages/expenses): types, React Query hooks, the GST maths the form previews and the
 * receipt upload. Money is integer paise; `amount` includes GST.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { absoluteUrl, api, ApiError, apiDownload } from "@srirealtime/web";
import { isValidGstin } from "@srirealtime/gst";

export const EXPENSE_PAYMENT_METHODS = ["cash", "upi", "card", "bank", "cheque", "other"] as const;
export type ExpensePaymentMethod = (typeof EXPENSE_PAYMENT_METHODS)[number];

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
  status: "recorded" | "cancelled";
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
