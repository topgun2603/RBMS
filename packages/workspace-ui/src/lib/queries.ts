"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiDownload, type QueryParams } from "@rbms/web";
import type {
  ExportJob,
  Exporter,
  ImportJob,
  ImportOptions,
  ImportSource,
  Importer,
  InviteInput,
  Mapping,
  MemberPatch,
  MessagesSettings,
  MessagesSettingsView,
  OnboardingStatus,
  Paged,
  PermissionGroup,
  PreviewResult,
  Role,
  RoleInput,
  SentMessage,
  StaffMember,
  TestSendResult,
} from "./types";

export const wk = {
  members: ["staff", "members"] as const,
  roles: ["staff", "roles"] as const,
  permissions: ["staff", "permissions"] as const,
  /** Activity log table (useServerTable appends the request params). */
  audit: ["audit", "list"] as const,
  importers: ["import", "importers"] as const,
  exporters: ["export", "exporters"] as const,
  /** Import history table (useServerTable appends the request params); commits invalidate it. */
  jobs: ["import", "jobs"] as const,
  job: (id: string) => ["import", "job", id] as const,
  sources: ["import", "sources"] as const,
  exportAll: ["export", "all"] as const,
  onboarding: ["onboarding"] as const,
  messages: ["messages", "settings"] as const,
  sentMessages: ["messages", "log"] as const,
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

/** CSV of the activity log with the table's filters and sort (paging dropped: every match up to the server's cap). */
export function downloadAuditCsv(params: QueryParams) {
  const { limit: _limit, offset: _offset, ...rest } = params;
  return apiDownload("/audit", { ...rest, format: "csv" }, "audit-log.csv");
}

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

/** Software people switch from (Vyapar, Tally, Busy, Marg, Excel) with what to export from each. */
export function useImportSources() {
  return useQuery({ queryKey: wk.sources, queryFn: () => api.get<{ items: ImportSource[] }>("/import/sources").then((r) => r.items), staleTime: 30 * 60_000 });
}

export function usePreviewImport() {
  return useMutation({
    mutationFn: ({ key, file, source }: { key: string; file: File; source?: string }) => {
      const form = new FormData();
      form.append("file", file, file.name);
      return api.post<PreviewResult>(`/import/${key}/preview${source && source !== "auto" ? `?source=${encodeURIComponent(source)}` : ""}`, form);
    },
  });
}

/** Undo a finished import batch. */
export function useRollbackImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => api.post<ImportJob>(`/import/${jobId}/rollback`, {}),
    onSuccess: (job) => {
      qc.setQueryData(wk.job(job.jobId), job);
      void qc.invalidateQueries({ queryKey: wk.jobs });
    },
  });
}

export function useCommitImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, mapping, options }: { jobId: string; mapping?: Mapping; options?: ImportOptions }) =>
      api.post<ImportJob>(`/import/${jobId}/commit`, { mapping, skipInvalid: true, ...(options ? { options } : {}) }),
    onSuccess: (job) => {
      qc.setQueryData(wk.job(job.jobId), job);
      void qc.invalidateQueries({ queryKey: wk.jobs });
    },
  });
}

export const downloadTemplate = (key: string, source?: string) =>
  apiDownload(`/import/${key}/template.xlsx`, source && source !== "auto" ? { source } : {}, `${key.replace(/\./g, "-")}-template.xlsx`);
/** Server-built error report of a job (row, problem and the original cells). */
export const downloadImportErrors = (jobId: string, name: string) => apiDownload(`/import/${jobId}/errors.csv`, {}, name);

/** Past "export all my data" jobs of the shop (owner only). Polls while one is running. */
export function useExportAll(enabled = true) {
  return useQuery({
    queryKey: wk.exportAll,
    queryFn: () => api.get<{ items: ExportJob[] }>("/export/all").then((r) => r.items),
    enabled,
    refetchInterval: (q) => (q.state.data?.some((j) => j.status === "queued" || j.status === "running") ? 2000 : false),
  });
}

export function useStartExportAll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ExportJob>("/export/all", {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: wk.exportAll }),
  });
}

export const downloadExportAll = (id: string, name: string) => apiDownload(`/export/all/${id}/file`, {}, name || "data.zip");
export const downloadTallyVouchers = (q: { kind: "sale" | "purchase"; from: string; to: string; format: "xml" | "xlsx" }) =>
  apiDownload(`/export/tally/vouchers.${q.format}`, { kind: q.kind, from: q.from, to: q.to }, `tally-${q.kind}-vouchers.${q.format}`);
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

// ---------------------------------------------------------------- customer messages

export function useMessagesSettings(enabled = true) {
  return useQuery({ queryKey: wk.messages, queryFn: () => api.get<MessagesSettingsView>("/messages/settings"), enabled });
}

export function useSaveMessagesSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<MessagesSettings>) => api.put<MessagesSettingsView>("/messages/settings", body),
    onSuccess: (v) => qc.setQueryData(wk.messages, v),
  });
}

export function useSendTestMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { event: string; channel?: "whatsapp" | "sms" | "email" }) => api.post<{ results: TestSendResult[] }>("/messages/test", body),
    onSettled: () => qc.invalidateQueries({ queryKey: wk.sentMessages }),
  });
}

export function useSentMessages(limit: number, enabled = true) {
  return useQuery({
    queryKey: [...wk.sentMessages, limit],
    queryFn: () => api.get<{ items: SentMessage[] }>("/messages/log", { limit }).then((r) => r.items),
    enabled,
    refetchInterval: 30_000,
  });
}
