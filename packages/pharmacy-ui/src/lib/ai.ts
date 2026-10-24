/**
 * Pharmacy AI helpers (docs/ai.md "Phase 3 part A"): prescription scan, interaction check, near-expiry plan. The API only
 * drafts; nothing is saved until the pharmacist presses the normal buttons.
 */
import { useMutation } from "@tanstack/react-query";
import { ApiError, api } from "@srirealtime/web";
import type { MedicineSchedule } from "./types";

export const RX_SCAN_CREDITS = 40;

export interface MatchRef {
  itemId: string;
  name: string;
  composition: string | null;
  schedule: MedicineSchedule;
  stock: number;
  /** GST-exclusive paise per sold unit. */
  rate: number;
  gstRate: number;
  hsn: string | null;
  unit: string;
  packSize: number;
  packUnit: string;
  manufacturer: string | null;
}

export type LineStatus = "matched" | "choose" | "out_of_stock" | "no_match" | "unreadable" | "blocked";

export interface RxLine {
  n: number;
  written: string | null;
  strength: string | null;
  form: string | null;
  dose: string | null;
  duration: string | null;
  confidence: "high" | "medium" | "low";
  status: LineStatus;
  select: boolean;
  why: string | null;
  schedule: MedicineSchedule | null;
  match: MatchRef | null;
  substitutes: MatchRef[];
  candidates: MatchRef[];
  units: number | null;
  qty: number | null;
  qtyNote: { units: number; fromDose: boolean; packSize: number } | null;
}

export interface Flag {
  code: string;
  severity: "error" | "warn" | "info";
  line?: number;
  params?: Record<string, string | number>;
}

export interface RxDraft {
  readable: boolean;
  notes: string | null;
  doctor: { name: string | null; regNo: string | null; clinic: string | null };
  date: string | null;
  patient: { name: string | null; age: number | null };
  lines: RxLine[];
  flags: Flag[];
  lowFields: string[];
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

export interface CheckResult {
  duplicates: { ingredient: string; items: { id: string; name: string }[] }[];
  interactions: { id: string; severity: "major" | "moderate"; a: { id: string; name: string }; b: { id: string; name: string }; note: string; noteTa: string; text: string; source: "ai" | "table" }[];
  unchecked: { id: string; name: string }[];
  advisory: { en: string; ta: string };
  runId: string | null;
  credits: number;
  aiNote: string | null;
}

export type PlanAction = "write_off" | "return" | "discount" | "move_front" | "sell_first";

export interface PlanRow {
  batchId: string;
  itemId: string;
  itemName: string;
  batchNo: string;
  expiry: string;
  supplier: string | null;
  qty: number;
  daysLeft: number;
  expired: boolean;
  value: number;
  dailyRate: number;
  likelySold: number;
  atRiskQty: number;
  atRiskValue: number;
  daysOfStock: number | null;
  action: PlanAction;
  maxDiscountPct: number | null;
  suggestDiscountPct: number | null;
}

export interface PlanResult {
  today: string;
  within: number;
  returnMinDays: number | null;
  totals: { batches: number; qty: number; value: number; atRiskValue: number };
  groups: { action: PlanAction; batches: number; qty: number; value: number; atRiskQty: number; atRiskValue: number; reason: string; reasonSource: "ai" | "template" }[];
  rows: PlanRow[];
  returnList: { supplier: string; value: number; rows: PlanRow[] }[];
  runId: string | null;
  credits: number;
  aiNote: string | null;
}

export const useScanRx = () => useMutation({ mutationFn: (body: ScanPayload) => api.post<ScanResult<RxDraft>>("/ai/pharmacy/rx-scan", body) });
export const useCheckBill = () => useMutation({ mutationFn: (body: { itemIds: string[]; lang: "en" | "ta"; explain?: boolean }) => api.post<CheckResult>("/ai/pharmacy/check", body) });
export const usePlan = () => useMutation({ mutationFn: (body: { within: number; returnMinDays?: number | null; lang: "en" | "ta"; explain?: boolean }) => api.post<PlanResult>("/ai/pharmacy/expiry-plan", body) });
export const lookupMeds = (q: string) => api.get<{ items: MatchRef[] }>("/ai/pharmacy/lookup", { q });

// ------------------------------------------------------------------ photo preparation

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

async function shrinkPhoto(file: File): Promise<{ mediaType: string; data: string }> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => {
    throw new ScanFileError(/hei[cf]/i.test(file.type + file.name) ? "type" : "unreadable");
  });
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ScanFileError("unreadable");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) throw new ScanFileError("unreadable");
    return { mediaType: "image/jpeg", data: await toBase64(blob) };
  } finally {
    bmp.close();
  }
}

/** Chosen files to the request body: one PDF, or up to MAX_PAGES photos (shrunk to JPEG). */
export async function prepareScan(files: File[]): Promise<ScanPayload> {
  if (files.length === 0) throw new ScanFileError("unreadable");
  const pdfs = files.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
  if (pdfs.length > 0) {
    if (files.length > 1) throw new ScanFileError("mixed");
    if (pdfs[0]!.size > MAX_PDF_BYTES) throw new ScanFileError("tooBig");
    return { pdf: { data: await toBase64(pdfs[0]!) } };
  }
  if (files.length > MAX_PAGES) throw new ScanFileError("tooMany");
  if (files.some((f) => !/^image\//.test(f.type))) throw new ScanFileError("type");
  return { images: await Promise.all(files.map(shrinkPhoto)) };
}

export type ScanErrorKind = "off" | "credits" | "unreadable" | "badImage" | "busy" | "other";
const OFF = new Set(["ai_off", "ai_feature_off", "ai_not_available", "ai_disabled"]);
export function scanErrorKind(err: unknown): ScanErrorKind {
  if (!(err instanceof ApiError)) return "other";
  if (OFF.has(err.code)) return "off";
  if (err.code === "ai_credits_exhausted" || err.status === 402) return "credits";
  if (err.code === "ai_unreadable_image") return "unreadable";
  if (err.code === "ai_bad_image" || err.status === 413 || err.code === "ai_input_too_large") return "badImage";
  if (err.code === "ai_busy" || err.status === 503 || err.status === 502) return "busy";
  return "other";
}
