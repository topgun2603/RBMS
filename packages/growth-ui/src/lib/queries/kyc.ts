"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { absoluteUrl, api, ApiError } from "@rbms/web";
import { retry4xx } from "../http";
import type { KycCheck, KycCheckType, KycDocument, KycDocumentKind, KycSubject, KycSubjectType } from "../types";

export const kk = {
  subject: (type: KycSubjectType, id: string) => ["kyc", "subject", type, id] as const,
};

export function useKycSubject(type: KycSubjectType, id: string | null | undefined) {
  return useQuery({
    queryKey: kk.subject(type, id ?? ""),
    queryFn: () => api.get<KycSubject>(`/kyc/subjects/${type}/${id}`),
    enabled: !!id,
    retry: retry4xx,
    // DigiLocker / provider checks may stay pending for a while: poll gently while any is pending.
    refetchInterval: (q) => (q.state.data?.checks.some((c) => c.status === "pending") ? 15_000 : false),
  });
}

export function useSubmitCheck(type: KycSubjectType, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { type: KycCheckType; input: Record<string, string> }) =>
      api.post<{ check: KycCheck; subject: Omit<KycSubject, "checks" | "documents"> }>("/kyc/checks", { subjectType: type, subjectId: id, ...b }),
    onSettled: () => void qc.invalidateQueries({ queryKey: kk.subject(type, id) }),
  });
}

export function useAddDocument(type: KycSubjectType, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { kind: KycDocumentKind; fileUrl: string }) => api.post<KycDocument>("/kyc/documents", { subjectType: type, subjectId: id, ...b }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: kk.subject(type, id) }),
  });
}

export function useRemoveDocument(type: KycSubjectType, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (docId: string) => api.delete<{ ok: true }>(`/kyc/documents/${docId}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: kk.subject(type, id) }),
  });
}

interface UploadSignResponse {
  fileId: string;
  upload: { url: string; method: "PUT"; headers: Record<string, string> };
}

/** Uploads a KYC document privately (sign → PUT → complete) and resolves with its URL. */
export async function uploadKycFile(file: File, onProgress?: (pct: number) => void): Promise<string> {
  const sign = await api.post<UploadSignResponse>("/uploads/sign", {
    filename: file.name,
    contentType: file.type || "application/octet-stream",
    size: file.size,
    visibility: "private",
    purpose: "kyc",
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
  return done.url;
}
