/** Pure branch helpers (rules mirrored from packages/branches/src/logic.ts and @rbms/gst). */
import { financialYear, formatInvoiceNumber, isValidGstin, stateFromGstin } from "@rbms/gst";

export const BRANCH_CODE_RE = /^[A-Z0-9][A-Z0-9_-]{0,15}$/;
export const PREFIX_RE = /^[A-Z0-9](?:[A-Z0-9-]{0,4}[A-Z0-9])?$/;
export const PINCODE_RE = /^\d{6}$/;

export const normalizeCode = (v: string) => v.trim().toUpperCase();

/** Upper-case, A-Z 0-9 and "-", max 6, no leading/trailing "-" (what the server stores). */
export function sanitizePrefix(v: string): string {
  return v
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/^-+/, "")
    .slice(0, 6)
    .replace(/-+$/, "");
}

/** A free prefix from the branch code ("MDU-NORTH" → "MDU-NO", taken → "MDU-N2"). */
export function suggestPrefix(code: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((x) => x.toUpperCase()));
  const base = sanitizePrefix(code.replace(/_/g, "-")) || "INV";
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const s = String(n);
    const c = `${base.slice(0, 6 - s.length).replace(/-+$/, "")}${s}`;
    if (!used.has(c)) return c;
  }
  return base;
}

/** The first bill number of a series with this prefix, for today's financial year: "MDU/26-27/0001". */
export function sampleBillNumber(prefix: string, today: string): string {
  return formatInvoiceNumber(sanitizePrefix(prefix) || "INV", financialYear(today), 1);
}

export type GstCheck =
  | { ok: true; stateCode: string | null }
  | { ok: false; field: "gstin" | "stateCode"; code: "invalid_gstin" | "state_mismatch" | "state_required" };

/**
 * GSTIN + state rules for a branch: the GSTIN (optional) must be valid, and its first two digits name the state, so a
 * chosen state must match it. Without a GSTIN the state is free (and optional).
 */
export function checkBranchGst(gstinRaw: string, stateCode: string): GstCheck {
  const gstin = gstinRaw.replace(/\s+/g, "").toUpperCase();
  if (!gstin) return { ok: true, stateCode: stateCode || null };
  if (!isValidGstin(gstin)) return { ok: false, field: "gstin", code: "invalid_gstin" };
  const fromGstin = stateFromGstin(gstin);
  if (stateCode && fromGstin && stateCode !== fromGstin) return { ok: false, field: "stateCode", code: "state_mismatch" };
  return { ok: true, stateCode: fromGstin ?? (stateCode || null) };
}

/** Bar width in percent of the largest value (0 when all are 0); at least 2% for any non-zero value. */
export function barPercent(value: number, max: number): number {
  if (!(max > 0) || !(value > 0)) return 0;
  return Math.max(2, Math.round((value / max) * 1000) / 10);
}

export type RangePreset = "this_month" | "last_month" | "last_30" | "this_fy";

/** IST date range for a summary preset, inclusive, as YYYY-MM-DD (≤ 366 days, as the API requires). */
export function presetRange(p: RangePreset, today: string): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  switch (p) {
    case "this_month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "last_month": {
      const start = new Date(Date.UTC(y, m - 2, 1));
      const end = new Date(Date.UTC(y, m - 1, 0));
      return { from: iso(start), to: iso(end) };
    }
    case "last_30": {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 29);
      return { from: iso(d), to: today };
    }
    case "this_fy": {
      const fyStart = m >= 4 ? y : y - 1;
      return { from: `${fyStart}-04-01`, to: today };
    }
  }
}
