"use client";

/**
 * React Query hooks for the v2 API (docs/billing-v2.md): online payments, credit book,
 * WhatsApp sending, inventory, purchases, suppliers and reports. Money is integer paise.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiDownload, type QueryParams } from "@srirealtime/web";
import { qk } from "./queries";
import type {
  AgeingResponse,
  CheckoutResponse,
  GstSummaryResponse,
  Invoice,
  CreditBookFilter,
  CreditBookResponse,
  LedgerResponse,
  Paged,
  PaidResponse,
  PaymentAccount,
  PaymentAccountInput,
  PaymentsReportResponse,
  Purchase,
  PurchaseInput,
  PurchaseSummary,
  PurchasesReportResponse,
  ReceiptInput,
  ReceiptResult,
  SalesRegisterResponse,
  SalesTrendPoint,
  SendResult,
  ShareLink,
  StockAdjustInput,
  StockFilter,
  StockListResponse,
  StockMovement,
  StockReportResponse,
  StockRow,
  StockSummary,
  Supplier,
  SupplierInput,
  TopCustomersResponse,
  TopItemsResponse,
} from "./types";

const INV = "/invoices";
const STOCK = "/inventory";
const PAY = "/payments";

export const qk2 = {
  paymentAccount: ["payments", "account"] as const,
  creditBook: (q: string, filter: CreditBookFilter) => ["credit-book", q, filter] as const,
  ledger: (id: string, from?: string, to?: string) => ["customers", "ledger", id, from ?? "", to ?? ""] as const,
  stock: (q: string, filter: StockFilter) => ["stock", "list", q, filter] as const,
  stockSummary: ["stock", "summary"] as const,
  movements: (itemId: string) => ["stock", "movements", itemId] as const,
  suppliers: (q: string) => ["suppliers", q] as const,
  purchases: (f: object) => ["purchases", "list", f] as const,
  purchase: (id: string) => ["purchases", "one", id] as const,
  report: (name: string, params: object) => ["reports", name, params] as const,
};

// ---------------------------------------------------------------- online payments

export function usePaymentAccount(enabled = true) {
  return useQuery({ queryKey: qk2.paymentAccount, queryFn: () => api.get<PaymentAccount>(`${PAY}/account`), enabled });
}

export function useSavePaymentAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PaymentAccountInput) => api.put<PaymentAccount>(`${PAY}/account`, body),
    onSuccess: (acc) => qc.setQueryData(qk2.paymentAccount, acc),
  });
}

export function useDeletePaymentAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<{ ok: true }>(`${PAY}/account`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk2.paymentAccount }),
  });
}

/** Public: start an online payment for a shared invoice. No tenant header, no auth. */
export const checkoutInvoice = (token: string) =>
  api.post<CheckoutResponse>(`${PAY}/checkout`, { kind: "invoice", ref: token }, { tenant: null, anonymous: true });

export const verifyPayment = (body: { orderId: string; paymentId: string; signature: string }) =>
  api.post<PaidResponse>(`${PAY}/verify`, body, { tenant: null, anonymous: true });

export const completeMockPayment = (orderId: string, method: "upi" = "upi") =>
  api.post<PaidResponse>(`${PAY}/mock/complete`, { orderId, method }, { tenant: null, anonymous: true });

// ---------------------------------------------------------------- WhatsApp / SMS

export function useSendInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, channel, to }: { id: string; channel?: "whatsapp" | "sms"; to?: string }) =>
      api.post<SendResult>(`${INV}/${id}/send`, { ...(channel ? { channel } : {}), ...(to ? { to } : {}) }),
    onSuccess: (_r, v) => void qc.invalidateQueries({ queryKey: qk.invoice(v.id) }),
  });
}

export function useRemindCustomer() {
  return useMutation({
    mutationFn: ({ customerId, channel }: { customerId: string; channel?: "whatsapp" | "sms" }) =>
      api.post<SendResult>(`${INV}/customers/${customerId}/remind`, channel ? { channel } : {}),
  });
}

// ---------------------------------------------------------------- credit book

export function useCreditBook(q: string, filter: CreditBookFilter) {
  return useQuery({
    queryKey: qk2.creditBook(q, filter),
    queryFn: ({ signal }) => api.get<CreditBookResponse>(`${INV}/credit-book`, { q, filter }, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useLedger(customerId: string, from?: string, to?: string) {
  return useQuery({
    queryKey: qk2.ledger(customerId, from, to),
    queryFn: ({ signal }) => api.get<LedgerResponse>(`${INV}/customers/${customerId}/ledger`, { from, to }, { signal }),
    enabled: !!customerId,
    placeholderData: keepPreviousData,
  });
}

/** Everything a receipt touches: ledger, credit book, customer balances, bills and the dashboard. */
function useMoneyChanged() {
  const qc = useQueryClient();
  return () => {
    for (const key of [["customers"], ["credit-book"], ["invoices"], ["reports"]]) void qc.invalidateQueries({ queryKey: key });
  };
}

export function useReceivePayment() {
  const changed = useMoneyChanged();
  return useMutation({
    mutationFn: ({ customerId, body }: { customerId: string; body: ReceiptInput }) =>
      api.post<ReceiptResult>(`${INV}/customers/${customerId}/receipts`, body),
    onSuccess: () => changed(),
  });
}

export function useDeleteReceipt() {
  const changed = useMoneyChanged();
  return useMutation({
    mutationFn: ({ customerId, receiptId }: { customerId: string; receiptId: string }) =>
      api.delete<unknown>(`${INV}/customers/${customerId}/receipts/${receiptId}`),
    onSuccess: () => changed(),
  });
}

export function useShareStatement() {
  return useMutation({
    mutationFn: (customerId: string) => api.post<ShareLink>(`${INV}/customers/${customerId}/statement/share`),
  });
}

// ---------------------------------------------------------------- inventory

export function useStock(q: string, filter: StockFilter, enabled = true) {
  return useQuery({
    queryKey: qk2.stock(q, filter),
    queryFn: ({ signal }) => api.get<StockListResponse>(`${STOCK}/stock`, { q, filter }, { signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useStockSummary(enabled = true) {
  return useQuery({ queryKey: qk2.stockSummary, queryFn: () => api.get<StockSummary>(`${STOCK}/summary`), enabled, retry: 0 });
}

function useStockChanged() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["stock"] });
    void qc.invalidateQueries({ queryKey: ["items"] });
    void qc.invalidateQueries({ queryKey: ["reports"] });
  };
}

export function useUpdateStockSettings() {
  const changed = useStockChanged();
  return useMutation({
    mutationFn: ({ itemId, body }: { itemId: string; body: { track?: boolean; reorderLevel?: number } }) =>
      api.patch<StockRow>(`${STOCK}/stock/${itemId}`, body),
    onSuccess: () => changed(),
  });
}

export function useAdjustStock() {
  const changed = useStockChanged();
  return useMutation({
    mutationFn: ({ itemId, body }: { itemId: string; body: StockAdjustInput }) => api.post<StockRow>(`${STOCK}/stock/${itemId}/adjust`, body),
    onSuccess: () => changed(),
  });
}

export function useMovements(itemId: string | null, limit = 50) {
  return useQuery({
    queryKey: qk2.movements(itemId ?? ""),
    queryFn: ({ signal }) => api.get<Paged<StockMovement>>(`${STOCK}/stock/${itemId}/movements`, { limit, offset: 0 }, { signal }),
    enabled: !!itemId,
  });
}

// suppliers

export function useSuppliers(q: string) {
  return useQuery({
    queryKey: qk2.suppliers(q),
    queryFn: ({ signal }) => api.get<Paged<Supplier>>(`${STOCK}/suppliers`, { q, limit: 100 }, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useSaveSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: SupplierInput }) =>
      id ? api.patch<Supplier>(`${STOCK}/suppliers/${id}`, body) : api.post<Supplier>(`${STOCK}/suppliers`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["suppliers"] }),
  });
}

export function useDeleteSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`${STOCK}/suppliers/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["suppliers"] }),
  });
}

// purchases

export interface PurchaseFilters {
  q?: string;
  supplierId?: string;
  from?: string;
  to?: string;
}

export function usePurchases(f: PurchaseFilters) {
  return useQuery({
    queryKey: qk2.purchases(f),
    queryFn: ({ signal }) => api.get<Paged<PurchaseSummary>>(`${STOCK}/purchases`, { ...f, limit: 100 }, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function usePurchase(id: string) {
  return useQuery({ queryKey: qk2.purchase(id), queryFn: () => api.get<Purchase>(`${STOCK}/purchases/${id}`), enabled: !!id });
}

function usePurchaseChanged() {
  const qc = useQueryClient();
  const stock = useStockChanged();
  return (p?: Purchase) => {
    if (p?.id) qc.setQueryData(qk2.purchase(p.id), p);
    void qc.invalidateQueries({ queryKey: ["purchases", "list"] });
    void qc.invalidateQueries({ queryKey: ["suppliers"] });
    stock();
  };
}

export function useCreatePurchase() {
  const changed = usePurchaseChanged();
  return useMutation({
    mutationFn: (body: PurchaseInput) => api.post<Purchase>(`${STOCK}/purchases`, body),
    onSuccess: (p) => changed(p),
  });
}

export function usePurchaseAction() {
  const changed = usePurchaseChanged();
  return useMutation({
    mutationFn: (a: { kind: "cancel"; id: string } | { kind: "paid"; id: string; paid: boolean }) =>
      a.kind === "cancel"
        ? api.post<Purchase>(`${STOCK}/purchases/${a.id}/cancel`)
        : api.post<Purchase>(`${STOCK}/purchases/${a.id}/paid`, { paid: a.paid }),
    onSuccess: (p) => changed(p),
  });
}

// ---------------------------------------------------------------- reports

function useReport<T>(name: string, path: string, params: QueryParams, enabled = true) {
  return useQuery({
    queryKey: qk2.report(name, params),
    queryFn: ({ signal }) => api.get<T>(path, params, { signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export const useSalesTrend = (days = 30) =>
  useReport<{ items: SalesTrendPoint[] }>("sales-trend", `${INV}/reports/sales-trend`, { days });
export const useSalesRegister = (from: string, to: string, enabled = true) =>
  useReport<SalesRegisterResponse>("sales-register", `${INV}/reports/sales-register`, { from, to }, enabled);
export const useGstSummary = (from: string, to: string, enabled = true) =>
  useReport<GstSummaryResponse>("gst-summary", `${INV}/reports/gst-summary`, { from, to }, enabled);
export const usePaymentsReport = (from: string, to: string, enabled = true) =>
  useReport<PaymentsReportResponse>("payments", `${INV}/reports/payments`, { from, to }, enabled);
export const useAgeing = (asOf?: string, enabled = true) =>
  useReport<AgeingResponse>("ageing", `${INV}/reports/ageing`, { asOf }, enabled);
export const useTopItems = (from: string, to: string, enabled = true) =>
  useReport<TopItemsResponse>("top-items", `${INV}/reports/top-items`, { from, to, limit: 10 }, enabled);
export const useTopCustomers = (from: string, to: string, enabled = true) =>
  useReport<TopCustomersResponse>("top-customers", `${INV}/reports/top-customers`, { from, to, limit: 10 }, enabled);
export const usePurchasesReport = (from: string, to: string, enabled = true) =>
  useReport<PurchasesReportResponse>("purchases", `${STOCK}/reports/purchases`, { from, to }, enabled);
export const useStockReport = (enabled = true) => useReport<StockReportResponse>("stock", `${STOCK}/reports/stock`, {}, enabled);

/** `format=csv` download of any report/list endpoint. */
export const downloadCsv = (path: string, params: QueryParams, fallbackName: string) =>
  apiDownload(path, { ...params, format: "csv" }, fallbackName);

export const REPORT_PATHS = {
  salesRegister: `${INV}/reports/sales-register`,
  gstSummary: `${INV}/reports/gst-summary`,
  payments: `${INV}/reports/payments`,
  ageing: `${INV}/reports/ageing`,
  purchases: `${STOCK}/reports/purchases`,
  stock: `${STOCK}/reports/stock`,
  ledger: (customerId: string) => `${INV}/customers/${customerId}/ledger`,
} as const;

/** Invoice responses may carry warnings (v2): pull them out safely. */
export const invoiceWarnings = (inv: Pick<Invoice, "warnings"> | null | undefined) => inv?.warnings ?? [];
