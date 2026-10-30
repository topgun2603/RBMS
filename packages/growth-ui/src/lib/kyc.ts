/** Pure KYC helpers: local format checks before a (paid) provider call, and display mapping. */
import { isValidGstin } from "@rbms/gst";
import type { KycCheck, KycCheckType, KycSubjectStatus } from "./types";

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** Upper-case without spaces: "abcde 1234 f" → "ABCDE1234F". */
export const normalizeId = (v: string) => v.toUpperCase().replace(/[\s-]/g, "");

export const isValidPan = (v: string) => PAN_RE.test(normalizeId(v));

/** GSTIN: 15 characters with a valid checksum (the PAN sits in characters 3–12). */
export const isValidShopGstin = (v: string) => isValidGstin(normalizeId(v));

/** The PAN inside a GSTIN ("33ABCDE1234F1Z5" → "ABCDE1234F"), or null. */
export const panFromGstin = (gstin: string) => {
  const g = normalizeId(gstin);
  return g.length === 15 ? g.slice(2, 12) : null;
};

/** Newest check of each type, newest first overall. */
export function latestChecks(checks: readonly KycCheck[]): KycCheck[] {
  const seen = new Set<KycCheckType>();
  const out: KycCheck[] = [];
  for (const c of [...checks].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    if (seen.has(c.type)) continue;
    seen.add(c.type);
    out.push(c);
  }
  return out;
}

export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

export const STATUS_TONE: Record<KycSubjectStatus, Tone> = {
  verified: "success",
  pending: "info",
  manual_review: "warning",
  failed: "danger",
  none: "neutral",
};

/** Name match score band (80 = the server's pass mark for payout checks). */
export const scoreBand = (score: number | null | undefined): "good" | "fair" | "poor" | null =>
  score === null || score === undefined ? null : score >= 80 ? "good" : score >= 60 ? "fair" : "poor";

/** Masked input values to show, in a stable order, skipping empties. */
export function maskedRows(input: Record<string, unknown>): { key: string; value: string }[] {
  const order = ["gstin", "pan", "name", "dob", "accountNumber", "ifsc", "vpa"];
  return Object.entries(input)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
    .map(([key, v]) => ({ key, value: typeof v === "string" ? v : JSON.stringify(v) }));
}
