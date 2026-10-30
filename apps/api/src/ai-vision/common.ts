import { GST_RATES, isValidDate, isValidGstin, normalizeGstin } from "@rbms/gst";

/**
 * Deterministic checks for what the vision helpers read (docs/ai.md "Scan a supplier bill"). The model is never trusted:
 * every field is cleaned and validated here, and anything that fails is dropped and reported as a flag the form shows.
 */

/** Most paise a single amount may hold (same cap as the purchase and expense schemas). */
export const MAX_PAISE = 2_000_000_000;
export const MAX_QTY = 1_000_000;
/** The slabs GST can have in law (2026). The app's own pickers support GST_RATES; others are reported as unsupported. */
export const ALLOWED_GST_RATES = [0, 0.1, 0.25, 1.5, 3, 5, 12, 18, 28, 40] as const;

export type FlagSeverity = "error" | "warn" | "info";
export interface Flag {
  /** Stable code the UI translates: `billing.ai.flag.<code>`. */
  code: string;
  severity: FlagSeverity;
  /** Field path the form can highlight, e.g. "supplier.gstin", "invoice.date", "lines.2.rate". */
  field?: string;
  /** 0-based line the flag is about. */
  line?: number;
  params?: Record<string, string | number>;
}

export class Flags {
  readonly list: Flag[] = [];
  add(code: string, severity: FlagSeverity, extra: Omit<Flag, "code" | "severity"> = {}) {
    this.list.push({ code, severity, ...extra });
  }
}

/** Text a bill or receipt must not make us act on: instructions aimed at an AI. Matched case-insensitively on cleaned text. */
const INJECTION = [
  /ignore\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier|preceding)/i,
  /disregard\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier|instructions|rules)/i,
  /forget\s+(everything|all|your)\s+(previous|prior|instructions|rules)?/i,
  /\b(system|developer)\s+(prompt|message|instruction)s?\b/i,
  /you\s+are\s+now\b/i,
  /\bnew\s+instructions?\b/i,
  /\b(act|behave)\s+as\s+(an?\s+)?(ai|assistant|model|admin)/i,
  /\boverride\b.{0,30}\b(total|amount|price|rate|instruction)/i,
  /\b(set|change|make)\s+(the\s+)?(total|amount|grand\s*total|rate|price|quantity|qty)\s+(to|as|=)/i,
  /\b(reveal|print|show|output|repeat)\b.{0,30}\b(prompt|instructions|api\s*key|secret)/i,
  /<\s*\/?\s*(system|assistant|instructions?)\s*>/i,
  /\bassistant\s*:/i,
  /\bjailbreak\b/i,
];
export const looksLikeInjection = (s: string) => INJECTION.some((re) => re.test(s));

// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿]/g;

/** Plain, single-line, length-limited text: control and bidi characters and markup removed. null when nothing is left. */
export function cleanText(v: string | null | undefined, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v
    .replace(CONTROL, " ")
    .replace(/<[^>]{0,200}>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
  return s || null;
}

/**
 * Clean a text field and drop it when it reads like an instruction to an AI. `flags` gets one `injection` entry per
 * dropped field (the owner is told the document contained instructions that were ignored).
 */
export function safeText(v: string | null | undefined, max: number, flags: Flags, field: string, line?: number): string | null {
  const s = cleanText(v, max);
  if ((s && looksLikeInjection(s)) || (typeof v === "string" && looksLikeInjection(v.slice(0, 2000)))) {
    flags.add("injection", "warn", { field, ...(line !== undefined ? { line } : {}) });
    return null;
  }
  return s;
}

export const toPaise = (rupees: number | null | undefined): number | null =>
  typeof rupees === "number" && Number.isFinite(rupees) ? Math.round(rupees * 100) : null;

/** An amount in paise that must be 0..MAX_PAISE; anything else (negative, huge, not a number) becomes null and is flagged. */
export function paiseField(rupees: number | null | undefined, flags: Flags, field: string, opts: { line?: number; allowZero?: boolean; allowNegative?: boolean } = {}): number | null {
  if (rupees === null || rupees === undefined) return null;
  const p = toPaise(rupees);
  const bad = p === null || Math.abs(p) > MAX_PAISE || (!opts.allowNegative && p < 0);
  if (bad) {
    flags.add("amount_invalid", "error", { field, ...(opts.line !== undefined ? { line: opts.line } : {}) });
    return null;
  }
  return p;
}

const SHIFT_DAYS = 86_400_000;

/** A real calendar date, not in the future (a day of slack for time zones). Returns the date or null with a flag. */
export function dateField(v: string | null | undefined, today: string, flags: Flags, field: string, opts: { maxAgeDays?: number } = {}): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !isValidDate(s)) {
    flags.add("date_invalid", "error", { field, params: { value: s.slice(0, 20) } });
    return null;
  }
  const t = Date.parse(`${s}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (t > now + SHIFT_DAYS) {
    flags.add("date_future", "error", { field, params: { value: s } });
    return null;
  }
  const max = opts.maxAgeDays ?? 366 * 3;
  if (now - t > max * SHIFT_DAYS) flags.add("date_old", "warn", { field, params: { value: s } });
  return s;
}

/** GSTIN: uppercase, 15 characters, checksum. Returns the normalised value when valid, else null with a flag. */
export function gstinField(v: string | null | undefined, flags: Flags, field: string): { value: string | null; valid: boolean } {
  const raw = typeof v === "string" ? normalizeGstin(v.replace(/[^0-9A-Za-z\s]/g, "")) : "";
  if (!raw) return { value: null, valid: false };
  if (!isValidGstin(raw)) {
    flags.add("gstin_invalid", "error", { field, params: { value: raw.slice(0, 15) } });
    return { value: null, valid: false };
  }
  return { value: raw, valid: true };
}

/** 4-8 digit HSN/SAC. Anything else is dropped with a flag. */
export function hsnField(v: string | null | undefined, flags: Flags, field: string, line: number): string | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const digits = String(v).replace(/[\s.-]/g, "");
  if (!/^\d{4,8}$/.test(digits)) {
    flags.add("hsn_invalid", "warn", { field, line, params: { value: String(v).slice(0, 12) } });
    return null;
  }
  return digits;
}

/** GST percent in the app's supported set. Known-but-unsupported slabs and unknown numbers are reported separately. */
export function gstRateField(v: number | null | undefined, flags: Flags, field: string, line: number): number | null {
  if (v === null || v === undefined) return null;
  if ((GST_RATES as readonly number[]).includes(v)) return v;
  const known = (ALLOWED_GST_RATES as readonly number[]).includes(v);
  flags.add(known ? "gst_rate_unsupported" : "gst_rate_invalid", "error", { field, line, params: { value: v } });
  return null;
}

/** "YYYY-MM" (or "MM/YYYY", "MM/YY") to the last day of that month, YYYY-MM-DD. */
export function expiryField(v: string | null | undefined, flags: Flags, field: string, line: number): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  let y: number;
  let m: number;
  let d: number | null = null;
  let match = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(s);
  if (match) {
    y = Number(match[1]);
    m = Number(match[2]);
    d = match[3] ? Number(match[3]) : null;
  } else if ((match = /^(\d{1,2})[/-](\d{2}|\d{4})$/.exec(s))) {
    m = Number(match[1]);
    y = Number(match[2]);
    if (y < 100) y += 2000;
  } else {
    flags.add("expiry_invalid", "warn", { field, line, params: { value: s.slice(0, 12) } });
    return null;
  }
  if (m < 1 || m > 12 || y < 2000 || y > 2100) {
    flags.add("expiry_invalid", "warn", { field, line, params: { value: s.slice(0, 12) } });
    return null;
  }
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = d && d >= 1 && d <= last ? d : last;
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Lower-case words and numbers only, for comparing names. */
export const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokens = (s: string) => new Set(normName(s).split(" ").filter((t) => t.length > 0 && t !== "and"));

/** 0..1 similarity of two names: word overlap, with a penalty when the numbers in them (sizes, strengths) differ. */
export function nameSimilarity(a: string, b: string): number {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = tokens(na);
  const tb = tokens(nb);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  let score = union ? inter / union : 0;
  const nums = (x: Set<string>) => [...x].filter((t) => /\d/.test(t)).sort().join(",");
  if (nums(ta) !== nums(tb)) score = Math.min(score, 0.45);
  return score;
}
