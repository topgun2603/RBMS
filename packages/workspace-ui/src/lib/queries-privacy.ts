"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@srirealtime/web";

/** Client for /v1/consent (DPDP): notice, customers' rights requests, retention and the breach register. docs/privacy-dpdp.md. */

export interface NoticeSection {
  id: string;
  heading: string;
  paragraphs: string[];
  items?: string[];
}
export interface NoticeText {
  title: string;
  intro: string;
  sections: NoticeSection[];
  reviewNote: string;
}
export interface NoticePreview {
  content: { en: NoticeText; ta: NoticeText };
  contact: { name: string; role: string; phone: string; email: string; address: string };
  responseDays: number;
  current: { version: number; label: string; createdAt: string };
  versions: { version: number; label: string; createdAt: string }[];
}

export interface PrivacySettings {
  grievanceName: string;
  grievanceRole: string;
  grievancePhone: string;
  grievanceEmail: string;
  grievanceAddress: string;
  responseDays: number;
  retention: Record<string, { enabled: boolean; days: number }>;
  noticeExtra: string;
}

export const RIGHTS_TYPES = ["access", "correction", "erasure", "withdraw_consent", "nominate", "grievance"] as const;
export type RightsType = (typeof RIGHTS_TYPES)[number];
export const RIGHTS_STATUSES = ["open", "in_progress", "completed", "rejected", "cancelled"] as const;
export type RightsStatus = (typeof RIGHTS_STATUSES)[number];

export interface RightsRequest {
  id: string;
  type: RightsType;
  status: RightsStatus;
  source: "store" | "counter";
  subjectName: string | null;
  subjectPhone: string | null;
  subjectEmail: string | null;
  details: string | null;
  nominee: { name: string; phone?: string | null; relation?: string | null } | null;
  purposes: string[] | null;
  dueAt: string;
  overdue: boolean;
  completedAt: string | null;
  resolution: string | null;
  hasResult: boolean;
  createdAt: string;
}
export interface RightsEvent {
  id: string;
  actorId: string | null;
  action: string;
  note: string | null;
  meta: unknown;
  createdAt: string;
}
export interface RightsList {
  items: RightsRequest[];
  total: number;
  limit: number;
  offset: number;
  facets: { status: Record<string, number>; type: Record<string, number> };
  overdueCount: number;
}

export interface RetentionItem {
  key: string;
  scope: "shop" | "platform";
  action: "delete" | "anonymise";
  enabled: boolean;
  days: number;
  defaultDays: number;
  minDays: number;
  managedBy: { job: string; days: number } | null;
  lastRun: { at: string; affected: number; status: string } | null;
  cutoff?: string | null;
  affected?: number | null;
  error?: string;
}
export interface RetentionView {
  items: RetentionItem[];
  runs: { id: string; category: string; dryRun: boolean; affected: number; days: number; status: string; error: string | null; trigger: string; createdAt: string }[];
}

export const BREACH_DATA_TYPES = ["phone", "email", "address", "purchases", "health", "id_documents", "payment", "staff", "credentials", "other"] as const;
export const BREACH_CHECKLIST = ["contain", "preserve_evidence", "assess", "intimate_board", "notify_people", "report_board", "fix_cause", "review"] as const;
export interface Breach {
  id: string;
  tenantId: string | null;
  reference: string;
  title: string;
  description: string;
  severity: "low" | "medium" | "high";
  status: "open" | "contained" | "reported" | "closed";
  occurredAt: string | null;
  discoveredAt: string;
  dataTypes: string[];
  peopleAffected: number | null;
  containment: string;
  cause: string;
  boardIntimatedAt: string | null;
  boardReportedAt: string | null;
  boardReference: string | null;
  peopleNotifiedAt: string | null;
  peopleNotifiedNote: string | null;
  checklist: Record<string, string>;
  closedAt: string | null;
  countdown: { deadlineAt: string; hoursLeft: number | null; state: "ok" | "due_soon" | "overdue" | "done" };
  createdAt: string;
}
export interface BreachDetail {
  incident: Breach;
  checklistKeys: string[];
  drafts: { people: { en: string; ta: string }; board: { en: string; ta: string } };
}

const k = ["privacy"] as const;

export const useNoticePreview = () => useQuery({ queryKey: [...k, "notice"], queryFn: () => api.get<NoticePreview>("/consent/notice/preview"), staleTime: 15_000 });
export const usePrivacySettings = () => useQuery({ queryKey: [...k, "settings"], queryFn: () => api.get<{ values: PrivacySettings }>("/settings/privacy").then((r) => r.values), staleTime: 15_000 });
export function useSavePrivacySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: Partial<PrivacySettings>) => api.put<{ values: PrivacySettings }>("/settings/privacy/tenant", b),
    onSettled: () => void qc.invalidateQueries({ queryKey: k }),
  });
}

export const useRights = (query: Record<string, string | number | undefined>) =>
  useQuery({ queryKey: [...k, "rights", query], queryFn: () => api.get<RightsList>("/consent/rights", query), staleTime: 10_000 });
export const useRight = (id: string | null) =>
  useQuery({ queryKey: [...k, "right", id], queryFn: () => api.get<{ request: RightsRequest; result: unknown; events: RightsEvent[] }>(`/consent/rights/${id}`), enabled: !!id });
export function useRightsAction() {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: k });
  return {
    create: useMutation({ mutationFn: (b: Record<string, unknown>) => api.post<{ request: RightsRequest }>("/consent/rights/counter", b), onSettled: done }),
    status: useMutation({ mutationFn: (b: { id: string; status: RightsStatus; note?: string }) => api.post<unknown>(`/consent/rights/${b.id}/status`, { status: b.status, note: b.note }), onSettled: done }),
    note: useMutation({ mutationFn: (b: { id: string; note: string }) => api.post<unknown>(`/consent/rights/${b.id}/note`, { note: b.note }), onSettled: done }),
    locate: useMutation({ mutationFn: (id: string) => api.post<{ items: { handler: string; id: string; label: string }[] }>(`/consent/rights/${id}/locate`, {}), onSettled: done }),
    access: useMutation({ mutationFn: (id: string) => api.post<unknown>(`/consent/rights/${id}/access`, {}), onSettled: done }),
    erase: useMutation({ mutationFn: (id: string) => api.post<{ result: { anonymised: string[]; kept: string[] } }>(`/consent/rights/${id}/erase`, { confirm: true }), onSettled: done }),
  };
}

export const useRetention = () => useQuery({ queryKey: [...k, "retention"], queryFn: () => api.get<RetentionView>("/consent/retention"), staleTime: 10_000 });
export function useRetentionActions() {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: [...k, "retention"] });
  return {
    preview: useMutation({ mutationFn: () => api.post<{ items: RetentionItem[] }>("/consent/retention/preview", {}), onSettled: done }),
    run: useMutation({ mutationFn: () => api.post<{ items: RetentionItem[] }>("/consent/retention/run", { confirm: true }), onSettled: done }),
  };
}

export const useBreaches = (all = false) => useQuery({ queryKey: [...k, "breaches", all], queryFn: () => api.get<{ items: Breach[]; openOverdue: number }>("/consent/breaches", all ? { all: 1 } : undefined), staleTime: 15_000 });
export const useBreach = (id: string | null) => useQuery({ queryKey: [...k, "breach", id], queryFn: () => api.get<BreachDetail>(`/consent/breaches/${id}`), enabled: !!id });
export function useBreachActions() {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: [...k, "breach"] }).then(() => qc.invalidateQueries({ queryKey: [...k, "breaches"] }));
  return {
    create: useMutation({ mutationFn: (b: Record<string, unknown>) => api.post<{ incident: Breach }>("/consent/breaches", b), onSettled: done }),
    update: useMutation({ mutationFn: (b: { id: string } & Record<string, unknown>) => api.patch<{ incident: Breach }>(`/consent/breaches/${b.id}`, { ...b, id: undefined }), onSettled: done }),
    tick: useMutation({ mutationFn: (b: { id: string; key: string; done: boolean }) => api.post<unknown>(`/consent/breaches/${b.id}/checklist`, { key: b.key, done: b.done }), onSettled: done }),
    board: useMutation({ mutationFn: (b: { id: string; stage: "intimation" | "report"; reference?: string }) => api.post<unknown>(`/consent/breaches/${b.id}/board`, { stage: b.stage, reference: b.reference }), onSettled: done }),
    notified: useMutation({ mutationFn: (b: { id: string; note?: string }) => api.post<unknown>(`/consent/breaches/${b.id}/people-notified`, { note: b.note }), onSettled: done }),
    close: useMutation({ mutationFn: (id: string) => api.post<unknown>(`/consent/breaches/${id}/close`, {}), onSettled: done }),
  };
}
