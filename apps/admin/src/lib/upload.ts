"use client";

import { absoluteUrl, api, ApiError } from "./api";
import type { UploadedFile, UploadSignResponse } from "./types";

export interface UploadOptions {
  purpose?: string;
  visibility?: "public" | "private";
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

/**
 * Uploads flow: POST /uploads/sign → PUT bytes to the signed URL (XHR, for progress) →
 * POST /uploads/:id/complete. Resolves with the stored file.
 */
export async function uploadFile(file: File, opts: UploadOptions = {}): Promise<UploadedFile> {
  const sign = await api.post<UploadSignResponse>("/uploads/sign", {
    filename: file.name,
    contentType: file.type || "application/octet-stream",
    size: file.size,
    visibility: opts.visibility ?? "private",
    ...(opts.purpose ? { purpose: opts.purpose } : {}),
  });

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(sign.upload.method || "PUT", absoluteUrl(sign.upload.url));
    for (const [k, v] of Object.entries(sign.upload.headers ?? {})) {
      // Browsers refuse to set some headers (e.g. content-length); skip those.
      if (k.toLowerCase() === "content-length" || k.toLowerCase() === "host") continue;
      xhr.setRequestHeader(k, v);
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new ApiError(xhr.status, "upload_failed", xhr.statusText || "Upload failed"));
    xhr.onerror = () => reject(new ApiError(0, "network_error", "Upload failed"));
    xhr.onabort = () => reject(new DOMException("Upload aborted", "AbortError"));
    opts.signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });

  opts.onProgress?.(100);
  return api.post<UploadedFile>(`/uploads/${sign.fileId}/complete`);
}
