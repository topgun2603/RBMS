"use client";

/**
 * Stock valuation and profit reports (`/v1/valuation`, apps/api/src/kit-valuation.ts, docs/valuation-reports.md): types
 * and React Query hooks. Money is integer paise.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type QueryParams } from "@srirealtime/web";

export const VAL = "/valuation";
export const PURCHASES_PERMISSION = "inventory.purchases";
export const BRANCHES_FEATURE = "multi-branch";

export type ValuationMethod = "average" | "fifo";

export interface ValuationSettings {
  method: ValuationMethod;
  methodToday: ValuationMethod;
  history: { method: ValuationMethod; from: string; at: string; by: string | null; note: string | null }[];
  layersBuilt: boolean;
  allowedFrom: string[];
}

export interface ValuationRow {
  key: string;
  label: string;
  itemId: string | null;
  locationId: string | null;
  location: string | null;
  category: string | null;
  sku: string | null;
  qty: number;
  avgCost: number | null;
  avgValue: number;
  fifoQty: number;
  fifoValue: number;
  value: number;
}

export interface ValuationReport {
  asOf: string;
  method: ValuationMethod;
  groupBy: "item" | "category" | "location";
  rows: ValuationRow[];
  totals: { qty: number; avgValue: number; fifoValue: number; value: number };
  mismatches: number;
}

export type ProfitGroup = "item" | "category" | "brand" | "staff" | "branch" | "month";
export const PROFIT_GROUPS: ProfitGroup[] = ["item", "category", "brand", "staff", "branch", "month"];

export interface ProfitRow {
  key: string;
  label: string;
  qty: number;
  sales: number;
  returns: number;
  netSales: number;
  cogs: number;
  grossProfit: number;
  margin: number | null;
  flag: "negative" | "low" | "no_cost" | null;
}

export interface ProfitReport {
  from: string;
  to: string;
  groupBy: ProfitGroup;
  rows: ProfitRow[];
  totals: Omit<ProfitRow, "key" | "label" | "flag">;
  itemCostLines: number;
  noCostLines: number;
  landedOnSold: number;
  lowMargin: number;
}

export type SalesView = "staff" | "hour" | "weekday" | "heatmap" | "category" | "brand" | "payment" | "branch";
export const SALES_VIEWS: SalesView[] = ["staff", "heatmap", "hour", "weekday", "category", "brand", "payment", "branch"];

export interface SalesRow {
  key: string;
  label: string;
  bills: number;
  sales: number;
  returns: number;
  netSales: number;
  gst: number;
  amount?: number;
}

export interface SalesReport {
  from: string;
  to: string;
  view: SalesView;
  rows: SalesRow[];
  totals: Omit<SalesRow, "key" | "label">;
  cells?: { weekday: number; hour: number; bills: number; netSales: number }[];
}

export interface BranchColumn {
  id: string | null;
  name: string;
  sales: number;
  returns: number;
  netSales: number;
  cogs: number;
  grossProfit: number;
  purchases: number;
  expenses: number;
  stockValue: number;
}

export interface BranchView {
  from: string;
  to: string;
  branches: BranchColumn[];
  total: Omit<BranchColumn, "id" | "name">;
  method: ValuationMethod;
}

export type ChargeKind = "freight" | "customs" | "insurance" | "loading" | "other";
export const CHARGE_KINDS: ChargeKind[] = ["freight", "customs", "insurance", "loading", "other"];
export type ChargeBasis = "value" | "qty" | "weight";

export interface ChargeInput {
  kind: ChargeKind;
  label?: string | null;
  amount: number;
  gstRate: number;
  claimable: boolean;
  basis: ChargeBasis;
}

export interface PurchaseCharge extends ChargeInput {
  gst: number;
}

export interface LandedVoucher {
  id: string;
  number: string;
  date: string;
  purchaseId: string;
  chargePurchaseId: string | null;
  ownsChargeBill: boolean;
  kind: ChargeKind;
  description: string | null;
  amount: number;
  gst: number;
  claimable: boolean;
  basis: ChargeBasis;
  allocations: { itemId: string; description: string; qty: number; remaining: number; share: number; toStock: number; toSold: number }[];
  toStock: number;
  toSold: number;
  status: "posted" | "cancelled";
}

export interface LandedVoucherInput {
  purchaseId: string;
  date?: string;
  kind: ChargeKind;
  description?: string;
  basis: ChargeBasis;
  claimable: boolean;
  amount?: number;
  gstRate?: number;
  supplierName?: string;
  billNumber?: string;
  paid?: boolean;
  paymentMode?: "cash" | "upi" | "bank" | "cheque" | "card" | "other";
  chargePurchaseId?: string;
}

const qk = {
  all: ["valuation"] as const,
  settings: () => ["valuation", "settings"] as const,
  report: (name: string, p: QueryParams) => ["valuation", "report", name, p] as const,
  vouchers: (purchaseId: string) => ["valuation", "vouchers", purchaseId] as const,
  weights: (ids: string[]) => ["valuation", "weights", ids] as const,
};

function useVal<T>(name: string, path: string, params: QueryParams, enabled = true) {
  return useQuery({ queryKey: qk.report(name, params), queryFn: ({ signal }) => api.get<T>(path, params, { signal }), placeholderData: keepPreviousData, enabled });
}

export const useValuationSettings = (enabled = true) => useQuery({ queryKey: qk.settings(), queryFn: ({ signal }) => api.get<ValuationSettings>(`${VAL}/settings`, {}, { signal }), enabled });

export function useSetValuationMethod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { method: ValuationMethod; from: string; note?: string }) => api.put<ValuationSettings>(`${VAL}/settings`, b),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.all }),
  });
}

export const useStockValuation = (p: { asOf: string; groupBy: "item" | "category" | "location"; locationId?: string }, enabled = true) =>
  useVal<ValuationReport>("stock", `${VAL}/stock`, p, enabled);
export const useItemProfit = (p: { from: string; to: string; groupBy: ProfitGroup; lowMargin?: number }, enabled = true) => useVal<ProfitReport>("profit", `${VAL}/item-profit`, p, enabled);
export const useSalesAnalysis = (p: { from: string; to: string; view: SalesView }, enabled = true) => useVal<SalesReport>("sales", `${VAL}/sales`, p, enabled);
export const useBranchView = (p: { from: string; to: string }, enabled = true) => useVal<BranchView>("branches", `${VAL}/branches`, p, enabled);

/** Which of these items have a weight (the "by weight" basis is offered only then). */
export const useItemWeights = (ids: string[]) =>
  useQuery({
    queryKey: qk.weights(ids),
    queryFn: ({ signal }) => api.get<{ withWeight: string[] }>(`${VAL}/item-weights`, { ids: ids.join(",") }, { signal }),
    enabled: ids.length > 0,
    staleTime: 60_000,
  });

export const useLandedVouchers = (purchaseId: string) =>
  useQuery({ queryKey: qk.vouchers(purchaseId), queryFn: ({ signal }) => api.get<{ items: LandedVoucher[] }>(`${VAL}/landed-costs`, { purchaseId }, { signal }) });

export function useLandedVoucherAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { kind: "create"; body: LandedVoucherInput } | { kind: "cancel"; id: string }) =>
      a.kind === "create" ? api.post<LandedVoucher>(`${VAL}/landed-costs`, a.body) : api.post<LandedVoucher>(`${VAL}/landed-costs/${a.id}/cancel`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.all });
      void qc.invalidateQueries({ queryKey: ["purchases"] });
    },
  });
}

/** PDFs: sales views and cost reports (documents module). */
export const salesPdfPath = (view: SalesView) => `/documents/sales-analysis/sales-${view}.pdf`;
export const profitPdfPath = (report: "item-profit" | "branches" | "stock-valuation") => `/documents/profit-report/${report}.pdf`;
