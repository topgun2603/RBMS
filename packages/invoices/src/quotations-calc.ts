/** Pure quotation rules (no database): derived status, who may do what, advance and the dashboard figures. */
import { sanitizePrefix } from "@rbms/gst";
import { addDaysISO } from "./ledger";
import type { QuotationDisplayStatus, QuotationStatus } from "./schema";

export const DEFAULT_QUOTATION_PREFIX = "QT";
export const DEFAULT_VALIDITY_DAYS = 15;
export const MAX_VALIDITY_DAYS = 365;

/** Shop settings of the "quotations" namespace (apps/api app-settings.ts), with defaults filled in. */
export interface QuotationSettings {
  prefix: string;
  validityDays: number;
  /** Default terms and conditions printed on a quotation; editable per quotation. */
  terms: string | null;
  /** Advance % new quotations start with (1-100), editable per quotation; null = no advance. */
  advancePercent: number | null;
}

/** Fills a possibly partial settings object: capital-letter prefix, validity 1-365 days, advance 1-100 % or none. */
export function normalizeQuotationSettings(raw: Partial<Record<keyof QuotationSettings, unknown>> | null | undefined): QuotationSettings {
  const days = Number(raw?.validityDays);
  const advance = raw?.advancePercent == null || raw.advancePercent === "" ? NaN : Number(raw.advancePercent);
  const terms = typeof raw?.terms === "string" ? raw.terms.trim() : "";
  const prefix = sanitizePrefix(typeof raw?.prefix === "string" && raw.prefix.trim() ? raw.prefix : DEFAULT_QUOTATION_PREFIX);
  return {
    prefix: prefix || DEFAULT_QUOTATION_PREFIX,
    validityDays: Number.isInteger(days) && days >= 1 && days <= MAX_VALIDITY_DAYS ? days : DEFAULT_VALIDITY_DAYS,
    terms: terms || null,
    advancePercent: Number.isInteger(advance) && advance >= 1 && advance <= 100 ? advance : null,
  };
}

/** The date a quotation made on `date` is valid until: `days` days later (the date itself counts as day 0). */
export function defaultValidUntil(date: string, days: number = DEFAULT_VALIDITY_DAYS): string {
  return addDaysISO(date, days);
}

/** What staff and the customer see: a sent quotation past its valid-until date is "expired" (stored status stays "sent"). */
export function quotationDisplayStatus(q: { status: QuotationStatus; validUntil: string }, today: string): QuotationDisplayStatus {
  if (q.status === "sent" && q.validUntil < today) return "expired";
  return q.status;
}

/** Days left (0 = last day, negative = days past); null when the quotation is no longer waiting for an answer. */
export function quotationDaysLeft(q: { status: QuotationStatus; validUntil: string }, today: string): number | null {
  if (q.status !== "sent" && q.status !== "draft") return null;
  const ms = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((ms(q.validUntil) - ms(today)) / 86_400_000);
}

/** The advance (paise) to ask for: `percent` of the total, rounded to the paisa; 0 without a percentage. */
export function quotationAdvance(total: number, percent: number | null | undefined): number {
  if (!percent || percent <= 0 || total <= 0) return 0;
  return Math.min(Math.round((total * Math.min(percent, 100)) / 100), total);
}

interface Gate {
  status: QuotationStatus;
  latest: boolean;
  validUntil: string;
}

/** Why the customer can't accept / decline now, or null. `code` is the API error code. */
export function quotationRespondProblem(q: Gate, today: string): { code: string; message: string } | null {
  if (!q.latest) return { code: "quotation_revised", message: "This quotation was revised; please use the newer one" };
  if (q.status === "accepted" || q.status === "declined") return { code: "quotation_answered", message: "This quotation has already been answered" };
  if (q.status === "converted") return { code: "quotation_converted", message: "This quotation has already been billed" };
  if (q.status === "cancelled") return { code: "quotation_cancelled", message: "This quotation was withdrawn" };
  if (q.status === "draft") return { code: "quotation_not_sent", message: "This quotation is not ready yet" };
  if (q.validUntil < today) return { code: "quotation_expired", message: "This quotation has expired; please ask the shop for a new one" };
  return null;
}

/** Drafts are edited in place; anything sent out is revised instead. */
export function quotationEditProblem(q: Pick<Gate, "status" | "latest">): string | null {
  if (!q.latest) return "Only the latest revision can be edited";
  if (q.status !== "draft") return "Only drafts can be edited; revise the quotation instead";
  return null;
}

/** A revision is a new version of a quotation that already went out (or was answered / expired). */
export function quotationReviseProblem(q: Pick<Gate, "status" | "latest">): string | null {
  if (!q.latest) return "Only the latest revision can be revised";
  if (q.status === "draft") return "Edit the draft directly";
  if (q.status === "converted") return "This quotation was already billed; make a new one instead";
  if (q.status === "cancelled") return "This quotation is cancelled";
  return null;
}

/** Billing / ordering needs the latest revision of a quotation that is neither cancelled nor already billed. */
export function quotationConvertProblem(q: Pick<Gate, "status" | "latest">, targetGone = false): string | null {
  if (!q.latest) return "Only the latest revision can be billed";
  if (q.status === "cancelled") return "This quotation is cancelled";
  if (q.status === "converted" && !targetGone) return "This quotation was already converted";
  return null;
}

export function quotationCancelProblem(q: Pick<Gate, "status" | "latest">): string | null {
  if (!q.latest) return "Only the latest revision can be cancelled";
  if (q.status === "cancelled") return "This quotation is already cancelled";
  if (q.status === "converted") return "This quotation was already converted";
  return null;
}

/** Share / send needs a live quotation: not cancelled or billed, and the newest revision. */
export function quotationShareProblem(q: Pick<Gate, "status" | "latest">): string | null {
  if (!q.latest) return "This revision was replaced by a newer one";
  if (q.status === "cancelled") return "This quotation is cancelled";
  return null;
}

/**
 * Conversion rate in percent: of the quotations that went out to a customer (`wentOut`, whatever happened to them
 * since), how many were billed or ordered. 0 when nothing went out. Rounded to one decimal.
 */
export function conversionRate(counts: { wentOut: number; converted: number }): number {
  if (counts.wentOut <= 0) return 0;
  return Math.round((Math.min(counts.converted, counts.wentOut) / counts.wentOut) * 1000) / 10;
}
