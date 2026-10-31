"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "@rbms/web";
import type { ApprovalChannel, ApprovalDecision, BillResult, Job, JobPriority, JobsSummary, JobStatus, JobSummary, JobTemplate, LineKind, SerialUnit, ShopItem } from "./types";
import { BOARD_STATUSES } from "./types";

const J = "/jobcards";

/** Never retry 4xx (no access, feature off, not found). */
export const retry4xx = (count: number, err: unknown) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2;
export const isStatus = (err: unknown, ...statuses: number[]) => err instanceof ApiError && statuses.includes(err.status);

/** Query keys. Lists start with these prefixes so mutations can invalidate them. */
export const jk = {
  all: ["jobcards"] as const,
  list: ["jobcards", "list"] as const,
  board: ["jobcards", "board"] as const,
  job: (id: string) => ["jobcards", "job", id] as const,
  summary: ["jobcards", "summary"] as const,
  items: (q: string) => ["jobcards", "shop-items", q] as const,
  units: (itemId: string) => ["jobcards", "serial-units", itemId] as const,
};

/** Every job still in the shop, for the board (the API's max page). */
export function useBoard(params: { q?: string; template?: string }) {
  return useQuery({
    queryKey: [...jk.board, params],
    queryFn: ({ signal }) =>
      api.get<{ items: JobSummary[]; total: number }>(J, { status: BOARD_STATUSES.join(","), limit: 200, sort: "due", q: params.q || undefined, template: params.template || undefined }, { signal }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
    retry: retry4xx,
  });
}

export function useJob(id: string) {
  return useQuery({ queryKey: jk.job(id), queryFn: () => api.get<Job>(`${J}/${id}`), retry: retry4xx });
}

export function useJobsSummary() {
  return useQuery({ queryKey: jk.summary, queryFn: () => api.get<JobsSummary>(`${J}/summary`), refetchInterval: 60_000, retry: retry4xx });
}

/** Billing items (catalogue variants) matching `q`, for the parts picker. */
export function useShopItems(q: string, enabled = true) {
  return useQuery({
    queryKey: jk.items(q),
    queryFn: ({ signal }) => api.get<{ items: ShopItem[] }>("/invoices/items", { q: q || undefined, limit: 12 }, { signal }),
    placeholderData: keepPreviousData,
    enabled,
    retry: retry4xx,
  });
}

/**
 * Units of a stock item on the shelf (in stock or returned) for the serial picker on part lines (serials module:
 * needs `serials.view` or `serials.manage`; off → empty).
 */
export function useSerialUnits(itemId: string | null, enabled = true) {
  return useQuery({
    queryKey: jk.units(itemId ?? ""),
    queryFn: ({ signal }) => api.get<{ items: SerialUnit[]; total: number }>("/serials/units", { itemId: itemId!, status: "in_stock,returned", limit: 200 }, { signal }),
    enabled: enabled && !!itemId,
    retry: retry4xx,
  });
}

export interface LineBody {
  kind: LineKind;
  itemId?: string | null;
  description: string;
  qty: number;
  rate: number;
  gstRate: number;
  hsn?: string | null;
  unit?: string | null;
  /** Serials of the units on a part line (replaces the line's list). */
  serials?: string[];
}

export interface ApprovalBody {
  decision: ApprovalDecision;
  by?: string | null;
  channel?: Exclude<ApprovalChannel, "online">;
  at?: string;
  note?: string | null;
}

export interface CardBody {
  customerName?: string;
  customerPhone?: string | null;
  dueDate?: string | null;
  assigneeName?: string | null;
  priority?: JobPriority;
  advance?: number;
  notes?: string | null;
  fields?: Record<string, unknown>;
}

export interface CreateBody extends CardBody {
  template: JobTemplate;
  customerName: string;
}

function useRefresh() {
  const qc = useQueryClient();
  return (job?: Job) => {
    if (job) qc.setQueryData(jk.job(job.id), job);
    return qc.invalidateQueries({ queryKey: jk.all });
  };
}

export function useCreateJob() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (body: CreateBody) => api.post<Job>(J, body), onSuccess: (j) => refresh(j) });
}

export function useJobActions(id: string) {
  const refresh = useRefresh();
  const done = (j: Job) => refresh(j);
  return {
    update: useMutation({ mutationFn: (b: CardBody) => api.patch<Job>(`${J}/${id}`, b), onSuccess: done }),
    move: useMutation({ mutationFn: (b: { status: JobStatus; note?: string | null }) => api.post<Job>(`${J}/${id}/status`, b), onSuccess: done }),
    note: useMutation({ mutationFn: (note: string) => api.post<Job>(`${J}/${id}/notes`, { note }), onSuccess: done }),
    cancel: useMutation({ mutationFn: (reason: string) => api.post<Job>(`${J}/${id}/cancel`, { reason }), onSuccess: done }),
    approval: useMutation({ mutationFn: (b: ApprovalBody) => api.post<Job>(`${J}/${id}/approval`, b), onSuccess: done }),
    addLine: useMutation({ mutationFn: (b: LineBody) => api.post<Job>(`${J}/${id}/lines`, b), onSuccess: done }),
    updateLine: useMutation({ mutationFn: ({ lineId, ...b }: Partial<LineBody> & { lineId: string }) => api.patch<Job>(`${J}/${id}/lines/${lineId}`, b), onSuccess: done }),
    removeLine: useMutation({ mutationFn: (lineId: string) => api.delete<Job>(`${J}/${id}/lines/${lineId}`), onSuccess: done }),
    bill: useMutation({ mutationFn: () => api.post<{ job: Job; bill: BillResult }>(`${J}/${id}/bill`, {}), onSuccess: (r) => done(r.job) }),
  };
}
