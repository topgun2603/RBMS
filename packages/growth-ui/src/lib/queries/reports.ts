"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@rbms/web";
import { apiFile, retry4xx } from "../http";
import { fileSlug } from "../report-spec";
import type { DatasetInfo, ReportFormat, ReportSchedule, ReportSpec, RunResult, SavedReport, ScheduleInput } from "../types";

const R = "/reports";

export const rk = {
  all: ["reports"] as const,
  datasets: ["reports", "datasets"] as const,
  saved: ["reports", "saved"] as const,
  savedOne: (id: string) => ["reports", "saved", id] as const,
  run: (spec: ReportSpec | null) => ["reports", "run", spec] as const,
  schedules: (reportId?: string) => ["reports", "schedules", reportId ?? null] as const,
  schedulesAll: ["reports", "schedules"] as const,
};

export function useDatasets() {
  return useQuery({
    queryKey: rk.datasets,
    queryFn: () => api.get<{ items: DatasetInfo[] }>(`${R}/datasets`).then((r) => r.items),
    staleTime: 5 * 60_000,
    retry: retry4xx,
  });
}

export function useSavedReports(enabled = true) {
  return useQuery({
    queryKey: rk.saved,
    queryFn: () => api.get<{ items: SavedReport[] }>(`${R}/saved`).then((r) => r.items),
    enabled,
    retry: retry4xx,
  });
}

export function useSavedReport(id: string | undefined) {
  return useQuery({
    queryKey: rk.savedOne(id ?? ""),
    queryFn: () => api.get<SavedReport>(`${R}/saved/${id}`),
    enabled: !!id,
    retry: retry4xx,
  });
}

/** Live preview. `spec` null = don't run. Keeps the last result on screen while the next one loads. */
export function useRunReport(spec: ReportSpec | null) {
  return useQuery({
    queryKey: rk.run(spec),
    queryFn: ({ signal }) => api.post<RunResult>(`${R}/run`, spec, { signal }),
    enabled: !!spec,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: retry4xx,
  });
}

export interface SavedInput {
  name: string;
  description?: string | null;
  spec: ReportSpec;
  shared: boolean;
}

export function useSaveReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: SavedInput }) =>
      id ? api.patch<SavedReport>(`${R}/saved/${id}`, body) : api.post<SavedReport>(`${R}/saved`, body),
    onSuccess: (row) => {
      qc.setQueryData(rk.savedOne(row.id), row);
      void qc.invalidateQueries({ queryKey: rk.saved, exact: true });
    },
  });
}

export function useDeleteReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`${R}/saved/${id}`),
    onSuccess: (_r, id) => {
      qc.setQueryData<SavedReport[]>(rk.saved, (old) => old?.filter((r) => r.id !== id));
      qc.removeQueries({ queryKey: rk.savedOne(id) });
      // Its schedules go with it.
      void qc.invalidateQueries({ queryKey: rk.schedulesAll });
    },
  });
}

export function useSchedules(reportId?: string, enabled = true) {
  return useQuery({
    queryKey: rk.schedules(reportId),
    queryFn: () => api.get<{ items: ReportSchedule[] }>(`${R}/schedules`, { reportId }).then((r) => r.items),
    enabled,
    retry: retry4xx,
  });
}

export function useSaveSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: ScheduleInput }) => {
      if (id) {
        const { reportId: _omit, ...patch } = body;
        return api.patch<ReportSchedule>(`${R}/schedules/${id}`, patch);
      }
      return api.post<ReportSchedule>(`${R}/schedules`, body);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: rk.schedulesAll }),
  });
}

export function useToggleSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch<ReportSchedule>(`${R}/schedules/${id}`, { active }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: rk.schedulesAll }),
  });
}

export function useDeleteSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`${R}/schedules/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: rk.schedulesAll }),
  });
}

export interface RunNowResult {
  schedule: ReportSchedule;
  result: { status: "ok" | "failed" | "skipped"; rowCount: number; sentTo: string[]; error?: string | null };
}

export function useRunScheduleNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<RunNowResult>(`${R}/schedules/${id}/run-now`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: rk.schedulesAll }),
  });
}

/** CSV/XLSX of the current (unsaved) spec. */
export const downloadSpec = (spec: ReportSpec, format: ReportFormat, title?: string) =>
  apiFile(`${R}/run`, { body: { spec, ...(title ? { title } : {}) }, query: { format }, fallbackName: `${fileSlug(title ?? spec.dataset)}.${format}` });

/** CSV/XLSX of a saved report. */
export const downloadSaved = (report: Pick<SavedReport, "id" | "name">, format: ReportFormat) =>
  apiFile(`${R}/saved/${report.id}/run`, { method: "POST", query: { format }, fallbackName: `${fileSlug(report.name)}.${format}` });
