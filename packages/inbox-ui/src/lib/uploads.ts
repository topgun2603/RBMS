"use client";

import { absoluteUrl, api, ApiError } from "@rbms/web";
import type { UploadedFile, UploadSignResponse } from "./types";

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const FILE_MAX_BYTES = 16 * 1024 * 1024;

/**
 * Uploads flow: POST /uploads/sign → PUT the bytes to the signed URL (XHR, for progress) → POST /uploads/:id/complete.
 * Public files, so the URL can be sent in a chat message or to WhatsApp (Meta fetches media by link).
 */
export async function uploadFile(
  file: File,
  opts: { purpose: string; onProgress?: (pct: number) => void; signal?: AbortSignal },
): Promise<UploadedFile> {
  const sign = await api.post<UploadSignResponse>("/uploads/sign", {
    filename: file.name || "file",
    contentType: file.type || "application/octet-stream",
    size: file.size,
    visibility: "public",
    purpose: opts.purpose,
  });
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(sign.upload.method || "PUT", absoluteUrl(sign.upload.url));
    for (const [k, v] of Object.entries(sign.upload.headers ?? {})) {
      if (k.toLowerCase() === "content-length" || k.toLowerCase() === "host") continue;
      xhr.setRequestHeader(k, v);
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError(xhr.status, "upload_failed", xhr.statusText || "Upload failed")));
    xhr.onerror = () => reject(new ApiError(0, "network_error", "Upload failed"));
    xhr.onabort = () => reject(new DOMException("Upload aborted", "AbortError"));
    opts.signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
  opts.onProgress?.(100);
  const done = await api.post<UploadedFile>(`/uploads/${sign.fileId}/complete`);
  return { ...done, url: absoluteUrl(done.url), thumbUrl: absoluteUrl(done.thumbUrl) };
}
