/**
 * Restaurant AI helpers (docs/ai.md "Phase 3 part A"): menu from a photo, recipes with food cost, daily prep forecast.
 * The API only drafts; nothing is created or saved until the owner confirms.
 */
import { useMutation } from "@tanstack/react-query";
import { ApiError, api } from "@rbms/web";

export const MENU_SCAN_CREDITS = 60;

export interface Flag {
  code: string;
  severity: "error" | "warn" | "info";
  line?: number;
  params?: Record<string, string | number>;
}

export interface DraftPortion {
  label: string;
  /** Paise as printed (GST included); null = not read. */
  price: number | null;
}

export interface DraftDish {
  n: number;
  name: string;
  nameTa: string | null;
  category: string | null;
  description: string | null;
  veg: boolean | null;
  egg: boolean;
  mark: "veg" | "egg" | "nonveg" | "unknown";
  portions: DraftPortion[];
  confidence: "high" | "medium" | "low";
  duplicateOf: { id: string; name: string; similarity: number } | null;
  select: boolean;
  why: string | null;
  newCategory: boolean;
}

export interface MenuDraft {
  readable: boolean;
  notes: string | null;
  dishes: DraftDish[];
  defaults: { hsn: string; gstRate: number; source: "shop" | "default" };
  flags: Flag[];
}

export interface DishCostRow {
  itemId: string;
  productId: string;
  name: string;
  portion: string;
  category: string | null;
  veg: boolean | null;
  rate: number;
  gstRate: number;
  hasRecipe: boolean;
  source: string | null;
  lineCount: number;
  cost: number | null;
  foodCostPct: number | null;
  overTarget: boolean;
  incomplete: boolean;
}

export interface CostedLine {
  name: string;
  qty: number;
  unit: string;
  price: { price: number | null; unit: string; source: string | null } | null;
  cost: number | null;
  problem: "no_price" | "unit_mismatch" | null;
}

export interface RecipeDetail {
  dish: { itemId: string; name: string; portion: string; rate: number; category: string | null };
  recipe: { itemId: string; note: string | null; source: string; lines: { ingredientId: string; name: string; qty: number; unit: string; ingredient: { unit: string; price: number | null; itemId: string | null } }[] } | null;
  cost: { lines: CostedLine[]; cost: number; incomplete: boolean; sellingPrice: number; foodCostPct: number | null; targetPct: number; overTarget: boolean; margin: number } | null;
  target: number;
}

export interface RecipeDraft {
  recognised: boolean;
  note: string | null;
  ingredients: { name: string; qty: number; unit: string }[];
  flags: Flag[];
  runId: string | null;
  credits: number;
}

export interface PrepResult {
  forecast: {
    forDate: string;
    weekday: number;
    festival: { name: string; nameTa: string; when: "day" | "eve" } | null;
    festivalFactor: number;
    festivalSource: "shop" | "owner" | "none";
    rainFactor: number;
    dishes: { itemId: string; name: string; samples: number; kept: number; dropped: number; base: number; trend: number; expected: number; prep: number; lastWeek: number | null; low: boolean }[];
    skipped: string[];
  };
  totals: { ingredient: string; qty: number; unit: string; dishes: number }[];
  withoutRecipe: string[];
  note: string;
  noteSource: "ai" | "template";
  runId: string | null;
  credits: number;
  aiNote: string | null;
  weeksChecked: number;
}

export const useScanMenu = () => useMutation({ mutationFn: (body: ScanPayload) => api.post<ScanResult<MenuDraft>>("/ai/restaurant/menu-scan", body) });
export const createMenu = (dishes: { name: string; nameTa: string | null; category: string | null; description: string | null; veg: boolean | null; egg: boolean; portions: { label: string; price: number }[] }[]) =>
  api.post<{ results: { name: string; status: "created" | "duplicate" | "failed"; productId?: string; error?: string }[]; created: number }>("/ai/restaurant/menu-create", { dishes });
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

