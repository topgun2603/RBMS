/**
 * Scan a supplier bill / expense receipt with AI (docs/ai.md): the drafts the API returns, the hooks that call it and
 * the photo preparation done in the browser. The API only drafts: nothing is saved until the person saves the form.
 */
import { useMutation } from "@tanstack/react-query";
import { ApiError, api } from "@rbms/web";

export const SCAN_BILL_CREDITS = 40;
export const SCAN_RECEIPT_CREDITS = 15;

export interface ScanFlag {
  code: string;
  severity: "error" | "warn" | "info";
  field?: string;
  line?: number;
  params?: Record<string, string | number>;
}

export interface BillLineDraft {
  description: string;
  code: string | null;
  hsn: string | null;
  qty: number | null;
  unit: string | null;
  /** Paise per unit, excluding GST. */
  rate: number | null;
  discount: number;
  gstRate: number | null;
  mrp: number | null;
  batchNo: string | null;
  /** YYYY-MM-DD */
  expiry: string | null;
  packSize: string | null;
  itemId: string | null;
  itemName: string | null;
  match: "exact" | "fuzzy" | "none";
  createNew: boolean;
  lowFields: string[];
}

export interface BillDraft {
  supplier: {
    name: string | null;
    gstin: string | null;
    gstinValid: boolean;
    address: string | null;
    stateCode: string | null;
    match: { id: string; name: string; by: "gstin" | "name" } | null;
  };
  invoice: { number: string | null; date: string | null; placeOfSupply: string | null };
  lines: BillLineDraft[];
  printed: { taxable: number | null; cgst: number | null; sgst: number | null; igst: number | null; cess: number | null; roundOff: number | null; total: number | null };
  computed: { taxable: number; cgst: number; sgst: number; igst: number; total: number };
  interState: boolean | null;
  lowFields: string[];
  flags: ScanFlag[];
  notes: string | null;
}

export interface ReceiptDraft {
  vendor: string | null;
  vendorGstin: string | null;
  date: string | null;
  amount: number | null;
  gstRate: number | null;
  gstAmount: number | null;
  categoryId: string | null;
  categoryName: string | null;
  paymentMode: "cash" | "upi" | "card" | "bank" | "cheque" | "other" | null;
  note: string | null;
  lowFields: string[];
  flags: ScanFlag[];
}

export interface ScanResult<T> {
  draft: T;
  runId: string;
  credits: number;
  provider: "claude" | "mock";
}

export interface ScanPayload {
  images?: { mediaType: string; data: string }[];
  pdf?: { data: string };
}

export function useScanBill() {
  return useMutation({ mutationFn: (body: ScanPayload) => api.post<ScanResult<BillDraft>>("/ai/scan/purchase-bill", body) });
}
export function useScanReceipt() {
  return useMutation({ mutationFn: (body: ScanPayload) => api.post<ScanResult<ReceiptDraft>>("/ai/scan/receipt", body) });
}

// ------------------------------------------------------------------ photo preparation

/** Longest side sent to the model. Bigger photos are shrunk: the model reads 1568 px at best, and a phone photo is 12 MP. */
const MAX_SIDE = 1800;
const MAX_PDF_BYTES = 14 * 1024 * 1024;
export const MAX_PAGES = 6;

export class ScanFileError extends Error {
  constructor(readonly kind: "type" | "tooBig" | "unreadable" | "mixed" | "tooMany") {
    super(kind);
  }
}

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new ScanFileError("unreadable"));
    r.readAsDataURL(blob);
  });

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close?: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      // fall through to an <img> (older Safari)
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new ScanFileError("unreadable"));
      img.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** One photo to a JPEG no bigger than MAX_SIDE. HEIC/HEIF is read where the browser can decode it (Safari, phones); otherwise it is refused with a clear message. */
export async function shrinkPhoto(file: File): Promise<{ mediaType: string; data: string }> {
  const d = await decode(file).catch(() => {
    throw new ScanFileError(/hei[cf]/i.test(file.type + file.name) ? "type" : "unreadable");
  });
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(d.width, d.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(d.width * scale));
    canvas.height = Math.max(1, Math.round(d.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ScanFileError("unreadable");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(d.source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) throw new ScanFileError("unreadable");
    return { mediaType: "image/jpeg", data: await toBase64(blob) };
  } finally {
    d.close?.();
  }
}

/** Files chosen by the person to the request body: one PDF, or up to MAX_PAGES photos (the pages of one bill). */
export async function prepareScan(files: File[]): Promise<ScanPayload> {
  if (files.length === 0) throw new ScanFileError("unreadable");
  const pdfs = files.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
  if (pdfs.length > 0) {
    if (files.length > 1) throw new ScanFileError("mixed");
    const f = pdfs[0]!;
    if (f.size > MAX_PDF_BYTES) throw new ScanFileError("tooBig");
    return { pdf: { data: await toBase64(f) } };
  }
  if (files.length > MAX_PAGES) throw new ScanFileError("tooMany");
  if (files.some((f) => !/^image\//.test(f.type) && !/\.(jpe?g|png|webp|gif|heic|heif)$/i.test(f.name))) throw new ScanFileError("type");
  return { images: await Promise.all(files.map(shrinkPhoto)) };
}

// ------------------------------------------------------------------ errors

export type ScanErrorKind = "off" | "credits" | "unreadable" | "badImage" | "busy" | "other";
const OFF = new Set(["ai_off", "ai_feature_off", "ai_not_available", "ai_disabled"]);

/** Which message to show for a failed scan. `off` also gets a link to Settings > AI. */
export function scanErrorKind(err: unknown): ScanErrorKind {
  if (!(err instanceof ApiError)) return "other";
  if (OFF.has(err.code)) return "off";
  if (err.code === "ai_credits_exhausted" || err.status === 402) return "credits";
  if (err.code === "ai_unreadable_image") return "unreadable";
  if (err.code === "ai_bad_image" || err.status === 413 || err.code === "ai_input_too_large") return "badImage";
  if (err.code === "ai_busy" || err.status === 503 || err.status === 502) return "busy";
  return "other";
}
