"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@rbms/web";
import type { RecurringDetail, RecurringFrequency, RecurringInput, RecurringRun, RecurringSummary } from "./types-recurring";

/** Routes of recurring bills (packages/invoices/src/recurring-routes.ts). */
export const RECURRING_PATH = "/recurring";

export const qkRecurring = {
  root: ["recurring"] as const,
  summary: ["recurring", "summary"] as const,
  detail: (id: string) => ["recurring", "detail", id] as const,
  preview: (p: unknown) => ["recurring", "preview", p] as const,
};

export function useRecurringSummary() {
  return useQuery({ queryKey: qkRecurring.summary, queryFn: () => api.get<RecurringSummary>(`${RECURRING_PATH}/summary`), staleTime: 30_000 });
}

export function useRecurring(id: string) {
  return useQuery({ queryKey: qkRecurring.detail(id), queryFn: () => api.get<RecurringDetail>(`${RECURRING_PATH}/${id}`), enabled: !!id });
}

export interface PreviewParams {
  frequency: RecurringFrequency;
  interval: number;
  dayOfMonth?: number | null;
  weekday?: number | null;
  startDate: string;
  endDate?: string | null;
  maxCount?: number | null;
}

/** The next dates a schedule bills on (the form's preview). */
export function useRecurringPreview(p: PreviewParams | null) {
  const query: Record<string, string> = {};
  if (p) for (const [k, v] of Object.entries(p)) if (v !== null && v !== undefined && v !== "") query[k] = String(v);
  return useQuery({
    queryKey: qkRecurring.preview(query),
    queryFn: () => api.get<{ dates: string[] }>(`${RECURRING_PATH}/preview`, query),
    enabled: !!p && /^\d{4}-\d{2}-\d{2}$/.test(p.startDate),
    staleTime: 60_000,
    retry: false,
  });
}

function useChanged() {
  const qc = useQueryClient();
  return (opts: { billed?: boolean } = {}) => {
    void qc.invalidateQueries({ queryKey: qkRecurring.root });
    if (opts.billed) for (const key of [["invoices"], ["customers"], ["credit-book"]]) void qc.invalidateQueries({ queryKey: key });
  };
}

export function useCreateRecurring() {
  const changed = useChanged();
  return useMutation({ mutationFn: (body: RecurringInput) => api.post<RecurringDetail>(`${RECURRING_PATH}/`, body), onSuccess: () => changed() });
}

export function useUpdateRecurring() {
  const changed = useChanged();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Omit<RecurringInput, "customerId">> }) => api.patch<RecurringDetail>(`${RECURRING_PATH}/${id}`, body),
    onSuccess: () => changed(),
  });
}

export type RecurringAction = "pause" | "resume" | "skip" | "end";

export function useRecurringAction() {
  const changed = useChanged();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: RecurringAction }) => api.post<RecurringDetail>(`${RECURRING_PATH}/${id}/${action}`, {}),
    onSuccess: () => changed(),
  });
}

export function useRunRecurringNow() {
  const changed = useChanged();
  return useMutation({
    mutationFn: (id: string) => api.post<{ run: RecurringRun; profile: RecurringDetail }>(`${RECURRING_PATH}/${id}/run`, {}),
    onSuccess: () => changed({ billed: true }),
  });
}

export function useDeleteRecurring() {
  const changed = useChanged();
  return useMutation({ mutationFn: (id: string) => api.delete(`${RECURRING_PATH}/${id}`), onSuccess: () => changed() });
}
