"use client";

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiDownload, type QueryParams } from "@srirealtime/web";
import type {
  AuditEvent,
  AuditFilters,
  Exporter,
  ImportJob,
  Importer,
  InviteInput,
  Mapping,
  MemberPatch,
  OnboardingStatus,
  Paged,
  PermissionGroup,
  PreviewResult,
  Role,
  RoleInput,
  StaffMember,
} from "./types";

export const AUDIT_PAGE = 50;

export const wk = {
  members: ["staff", "members"] as const,
  roles: ["staff", "roles"] as const,
  permissions: ["staff", "permissions"] as const,
  audit: (f: AuditFilters) => ["audit", f] as const,
  importers: ["import", "importers"] as const,
  exporters: ["export", "exporters"] as const,
  jobs: ["import", "jobs"] as const,
  job: (id: string) => ["import", "job", id] as const,
  onboarding: ["onboarding"] as const,
};

// ---------------------------------------------------------------- staff

export function useMembers(enabled = true) {
  return useQuery({
    queryKey: wk.members,
    queryFn: () => api.get<Paged<StaffMember>>("/staff/members").then((r) => r.items),
    enabled,
    retry: (n, err) => (err as { status?: number }).status !== 403 && n < 2,
  });
}

export function useRoles(enabled = true) {
  return useQuery({ queryKey: wk.roles, queryFn: () => api.get<Paged<Role>>("/staff/roles").then((r) => r.items), enabled });
}

export function usePermissionGroups(enabled = true) {
  return useQuery({
    queryKey: wk.permissions,
    queryFn: () => api.get<{ items: PermissionGroup[] }>("/staff/permissions").then((r) => r.items),
    enabled,
    staleTime: 10 * 60_000,
  });
}

export function useInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: InviteInput) => api.post<StaffMember>("/staff/invites", body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: wk.members }),
  });
}

export function useUpdateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, body }: { userId: string; body: MemberPatch }) => api.patch<StaffMember>(`/staff/members/${userId}`, body),
    onMutate: async ({ userId, body }) => {
      // Optimistic switch flip / role change; rolled back on error.
      await qc.cancelQueries({ queryKey: wk.members });
      const prev = qc.getQueryData<StaffMember[]>(wk.members);
      if (prev) qc.setQueryData<StaffMember[]>(wk.members, prev.map((m) => (m.userId === userId ? { ...m, ...body } : m)));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(wk.members, ctx.prev),
    onSuccess: (m) => qc.setQueryData<StaffMember[]>(wk.members, (list) => list?.map((x) => (x.userId === m.userId ? m : x))),
    onSettled: () => void qc.invalidateQueries({ queryKey: wk.members }),
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.delete<{ ok: true }>(`/staff/members/${userId}`),
    onSuccess: (_r, userId) => qc.setQueryData<StaffMember[]>(wk.members, (list) => list?.filter((m) => m.userId !== userId)),
  });
}

export function useSaveRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, body, isNew }: { key: string; body: RoleInput; isNew: boolean }) =>
      isNew
        ? api.post<Role>("/staff/roles", body)
        : api.patch<Role>(`/staff/roles/${key}`, { name: body.name, description: body.description ?? "", permissions: body.permissions }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: wk.roles }),
  });
}

export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => api.delete<{ ok: true }>(`/staff/roles/${key}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: wk.roles });
      void qc.invalidateQueries({ queryKey: wk.members });
    },
  });
}

// ---------------------------------------------------------------- audit

const auditParams = (f: AuditFilters): QueryParams => ({ ...f });

export function useAuditLog(filters: AuditFilters) {
  return useInfiniteQuery({
    queryKey: wk.audit(filters),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      api.get<Paged<AuditEvent>>("/audit", { ...auditParams(filters), limit: AUDIT_PAGE, offset: pageParam }, { signal }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return last.items.length === AUDIT_PAGE && loaded < last.total ? loaded : undefined;
    },
    placeholderData: keepPreviousData,
  });
}

export const downloadAuditCsv = (filters: AuditFilters) => apiDownload("/audit", { ...auditParams(filters), format: "csv" }, "audit-log.csv");

// ---------------------------------------------------------------- import / export

export function useImporters() {
  return useQuery({ queryKey: wk.importers, queryFn: () => api.get<{ items: Importer[] }>("/import/importers").then((r) => r.items), staleTime: 5 * 60_000 });
}

export function useExporters(enabled = true) {
  return useQuery({
    queryKey: wk.exporters,
    queryFn: () => api.get<{ items: Exporter[] }>("/export/exporters").then((r) => r.items),
    staleTime: 5 * 60_000,
    enabled,
  });
}

export function useImportJobs() {
  return useQuery({ queryKey: wk.jobs, queryFn: () => api.get<Paged<ImportJob>>("/import/jobs", { limit: 20 }) });
}

/** Polls a job every second while it is queued or running. */
export function useImportJob(jobId: string | null, initial?: ImportJob) {
  return useQuery({
    queryKey: wk.job(jobId ?? ""),
    queryFn: ({ signal }) => api.get<ImportJob>(`/import/${jobId}`, undefined, { signal }),
    enabled: !!jobId,
    initialData: initial && initial.jobId === jobId ? initial : undefined,
    refetchInterval: (q) => (q.state.data && (q.state.data.status === "queued" || q.state.data.status === "running") ? 1000 : false),
  });
}

export function usePreviewImport() {
  return useMutation({
    mutationFn: ({ key, file }: { key: string; file: File }) => {
      const form = new FormData();
      form.append("file", file, file.name);
      return api.post<PreviewResult>(`/import/${key}/preview`, form);
    },
  });
}

export function useCommitImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, mapping }: { jobId: string; mapping?: Mapping }) =>
      api.post<ImportJob>(`/import/${jobId}/commit`, { mapping, skipInvalid: true }),
    onSuccess: (job) => {
      qc.setQueryData(wk.job(job.jobId), job);
      void qc.invalidateQueries({ queryKey: wk.jobs });
    },
  });
}

export const downloadTemplate = (key: string) => apiDownload(`/import/${key}/template.xlsx`, {}, `${key.replace(/\./g, "-")}-template.xlsx`);
export const downloadExport = (key: string, format: "csv" | "xlsx") => apiDownload(`/export/${key}.${format}`, {}, `${key.replace(/\./g, "-")}.${format}`);

// ---------------------------------------------------------------- onboarding

export function useOnboarding(enabled = true) {
  return useQuery({
    queryKey: wk.onboarding,
    queryFn: () => api.get<OnboardingStatus>("/onboarding"),
    enabled,
    staleTime: 30_000,
    retry: (n, err) => (err as { status?: number }).status !== 403 && n < 2,
  });
}

export function useOnboardingAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { kind: "skip" | "unskip"; key: string } | { kind: "dismiss" }) =>
      a.kind === "dismiss" ? api.post<OnboardingStatus>("/onboarding/dismiss") : api.post<OnboardingStatus>(`/onboarding/${a.key}/${a.kind}`),
    onSuccess: (s) => {
      if (s && typeof s === "object" && "steps" in s) qc.setQueryData(wk.onboarding, s);
      else void qc.invalidateQueries({ queryKey: wk.onboarding });
    },
  });
}
