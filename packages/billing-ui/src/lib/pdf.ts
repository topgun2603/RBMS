"use client";

import * as React from "react";
import { toast } from "@rbms/ui";
import { ApiError, apiUrl, currentTenantSlug, describeError, getToken, useI18n, type QueryParams } from "@rbms/web";

/** PDF paths of `/v1/documents` (packages/documents/src/routes.ts). */
export const PDF_PATHS = {
  invoice: (id: string) => `/documents/invoice/${id}.pdf`,
  invoiceThermal: (id: string) => `/documents/invoice-thermal/${id}.pdf`,
  statement: (customerId: string) => `/documents/statement/${customerId}.pdf`,
  purchase: (id: string) => `/documents/purchase/${id}.pdf`,
  purchaseOrder: (id: string) => `/documents/purchase-order/${id}.pdf`,
  creditNote: (id: string) => `/documents/credit-note/${id}.pdf`,
  creditNoteThermal: (id: string) => `/documents/credit-note-thermal/${id}.pdf`,
  debitNote: (id: string) => `/documents/debit-note/${id}.pdf`,
  quotation: (id: string) => `/documents/quotation/${id}.pdf`,
  quotationThermal: (id: string) => `/documents/quotation-thermal/${id}.pdf`,
  transferNote: (id: string) => `/documents/transfer-note/${id}.pdf`,
} as const;

/** Fetches a PDF with the session's bearer token and shop header. Errors become ApiError (403 → "no access"). */
export async function fetchPdf(path: string, query: QueryParams = {}): Promise<{ blob: Blob; filename: string | null }> {
  const headers = new Headers({ accept: "application/pdf" });
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const slug = currentTenantSlug();
  if (slug) headers.set("x-tenant", slug);
  let res: Response;
  try {
    res = await fetch(apiUrl(path, query), { headers, credentials: "include" });
  } catch (err) {
    throw new ApiError(0, "network_error", err instanceof Error ? err.message : "Network error");
  }
  if (!res.ok) {
    type ErrBody = { code?: string; message?: string; details?: unknown };
    const e: ErrBody | null = await res
      .json()
      .then((j: { error?: ErrBody }) => j.error ?? null)
      .catch(() => null);
    throw new ApiError(res.status, e?.code ?? `http_${res.status}`, e?.message ?? res.statusText ?? "Download failed", e?.details);
  }
  const cd = res.headers.get("content-disposition") ?? "";
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  return { blob: await res.blob(), filename: m?.[1] ? decodeURIComponent(m[1]) : null };
}

export type PdfMode = "download" | "open";

/**
 * `run(path, query, { mode, fallbackName })`: fetches the PDF in the UI's language (`?locale=ta` in Tamil) and either
 * saves it or opens it in a new tab (to print). `busy` holds the key of the running request.
 */
export function usePdf() {
  const { t, locale } = useI18n();
  const [busy, setBusy] = React.useState<string | null>(null);
  const run = React.useCallback(
    async (key: string, path: string, opts: { query?: QueryParams; mode: PdfMode; fallbackName: string }) => {
      // Open the tab synchronously so pop-up blockers allow it; it gets the PDF once fetched.
      const win = opts.mode === "open" ? window.open("", "_blank") : null;
      setBusy(key);
      try {
        const { blob, filename } = await fetchPdf(path, { ...opts.query, locale: locale === "ta" ? "ta" : undefined });
        const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
        if (win) win.location.href = url;
        else {
          const a = document.createElement("a");
          a.href = url;
          a.download = filename ?? opts.fallbackName;
          document.body.appendChild(a);
          a.click();
          a.remove();
          toast.success(t("billing.pdf.downloaded"));
        }
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (err) {
        win?.close();
        toast.error(err instanceof ApiError && err.status === 403 && err.code !== "feature_disabled" ? t("billing.pdf.forbidden") : describeError(err, t));
      } finally {
        setBusy(null);
      }
    },
    [locale, t],
  );
  return { run, busy };
}
