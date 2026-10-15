"use client";

import { ApiError, apiUrl, currentTenantSlug, getToken, LOCALE_KEY, readStored } from "@srirealtime/web";

/** PDF paths under /v1/documents (docs/commerce-batch1.md §6). */
export const docPath = {
  packingSlip: (orderId: string) => `/documents/packing-slip/${orderId}.pdf`,
  shippingLabel: (orderId: string) => `/documents/shipping-label/${orderId}.pdf`,
  invoice: (invoiceId: string) => `/documents/invoice/${invoiceId}.pdf`,
};

/** Fetches a PDF with the signed-in member's token and shop header. */
export async function fetchPdf(path: string): Promise<Blob> {
  const headers = new Headers({ accept: "application/pdf" });
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const slug = currentTenantSlug();
  if (slug) headers.set("x-tenant", slug);
  const locale = readStored(LOCALE_KEY);
  let res: Response;
  try {
    res = await fetch(apiUrl(path, locale ? { locale } : undefined), { headers, credentials: "include" });
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
  return res.blob();
}

/** Opens a blank tab synchronously (inside the click, so popup blockers allow it); null when blocked. */
function openBlank(title: string): Window | null {
  const w = window.open("", "_blank");
  if (!w) return null;
  try {
    w.document.title = title;
    w.document.body.style.cssText = "margin:0;font:14px system-ui,sans-serif;display:grid;place-items:center;height:100vh;color:#666";
    w.document.body.textContent = title;
  } catch {
    // cross-origin edge cases: the PDF still replaces it below
  }
  return w;
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Opens one PDF in a new tab (fetched with auth, shown from a blob URL). Call it straight from a click handler.
 * When the browser blocks the tab, the file is downloaded instead.
 */
export async function openPdf(path: string, opts: { loadingTitle: string; fileName: string }): Promise<void> {
  const w = openBlank(opts.loadingTitle);
  try {
    const blob = await fetchPdf(path);
    const url = URL.createObjectURL(blob);
    if (w && !w.closed) w.location.href = url;
    else saveBlob(blob, opts.fileName);
    window.setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
  } catch (err) {
    if (w && !w.closed) w.close();
    throw err;
  }
}

/**
 * Several PDFs at once (bulk packing slips): one tab with each PDF stacked in its own frame, so popup blockers see a
 * single window. Resolves with how many failed to load.
 */
export async function openPdfs(items: { path: string; title: string }[], opts: { loadingTitle: string; pageTitle: string }): Promise<number> {
  if (items.length === 1) {
    await openPdf(items[0]!.path, { loadingTitle: opts.loadingTitle, fileName: `${items[0]!.title}.pdf` });
    return 0;
  }
  const w = openBlank(opts.loadingTitle);
  const results = await Promise.allSettled(items.map((i) => fetchPdf(i.path)));
  const ok = results.flatMap((r, i) => (r.status === "fulfilled" ? [{ url: URL.createObjectURL(r.value), title: items[i]!.title }] : []));
  const failed = results.length - ok.length;
  if (ok.length === 0) {
    if (w && !w.closed) w.close();
    const first = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    throw first?.reason ?? new Error("Download failed");
  }
  if (!w || w.closed) {
    // Blocked: fall back to downloading each file.
    results.forEach((r, i) => r.status === "fulfilled" && saveBlob(r.value, `${items[i]!.title}.pdf`));
    return failed;
  }
  const doc = w.document;
  doc.title = opts.pageTitle;
  doc.body.style.cssText = "margin:0;background:#525659;font:13px system-ui,sans-serif";
  doc.body.textContent = "";
  for (const item of ok) {
    const h = doc.createElement("div");
    h.textContent = item.title;
    h.style.cssText = "color:#fff;padding:8px 12px";
    const frame = doc.createElement("iframe");
    frame.src = item.url;
    frame.title = item.title;
    frame.style.cssText = "display:block;width:100%;height:92vh;border:0;background:#fff";
    doc.body.append(h, frame);
  }
  return failed;
}
