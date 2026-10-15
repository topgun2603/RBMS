/**
 * Pure rules of the WhatsApp module (no database, no network): phone numbers, the 24-hour customer-service window,
 * opt-out / opt-in keywords, message status ordering, audience dedupe and the campaign throttle plan.
 */

// ------------------------------------------------------------------ phones

/**
 * An Indian mobile number as E.164 ("+919876543210"), or null when it isn't one. Copied from loyalty (packages never
 * import each other). Accepts "98765 43210", "098765-43210", "+91 98765 43210", "919876543210".
 */
export function toIndianE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!/^\+?[0-9][0-9 ()-]*$/.test(trimmed)) return null;
  let d = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    if (!d.startsWith("91")) return null;
    d = d.slice(2);
  } else if (d.length === 14 && d.startsWith("0091")) d = d.slice(4);
  else if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9][0-9]{9}$/.test(d) ? `+91${d}` : null;
}

/**
 * Normalises any number we may talk to: Indian numbers (with or without +91) become "+91XXXXXXXXXX"; other numbers
 * written with "+" or as Meta `wa_id` digits (8–15 digits incl. country code) become "+<digits>". Null otherwise.
 */
export function normalisePhone(phone: string | null | undefined, opts: { assumeInternational?: boolean } = {}): string | null {
  const indian = toIndianE164(phone);
  if (indian) return indian;
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!/^\+?[0-9][0-9 ()-]*$/.test(trimmed)) return null;
  const d = trimmed.replace(/\D/g, "");
  if ((trimmed.startsWith("+") || opts.assumeInternational) && /^[1-9][0-9]{7,14}$/.test(d)) return `+${d}`;
  return null;
}

/** "+919876543210" → "919876543210" (Cloud API `to` / `wa_id` format). */
export const waId = (e164: string) => e164.replace(/\D/g, "");

/** "+919876543210" → "+91 98765 43210" for display. */
export function formatPhone(e164: string): string {
  const m = /^\+91([6-9]\d{4})(\d{5})$/.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}

// ------------------------------------------------------------------ 24-hour window

export const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface SessionWindow {
  open: boolean;
  /** When the window closes (null when the customer never wrote). */
  expiresAt: Date | null;
  /** Milliseconds left, 0 when closed. */
  remainingMs: number;
}

/**
 * Meta's customer-service window: free-form messages (text, media) are delivered only within 24 hours of the
 * customer's last message to the shop. Outside it the shop must send an approved template.
 */
export function sessionWindow(lastInboundAt: Date | null | undefined, now: Date): SessionWindow {
  if (!lastInboundAt) return { open: false, expiresAt: null, remainingMs: 0 };
  const expiresAt = new Date(lastInboundAt.getTime() + SESSION_WINDOW_MS);
  const remainingMs = Math.max(0, expiresAt.getTime() - now.getTime());
  return { open: remainingMs > 0, expiresAt, remainingMs };
}

export const canSendFreeForm = (lastInboundAt: Date | null | undefined, now: Date) => sessionWindow(lastInboundAt, now).open;

export type OutboundKind = "text" | "image" | "document" | "template";
export type OutboundDenial = "window_closed" | "opted_out";

/**
 * May the shop send this message now?
 * - Free-form (`text|image|document`) needs an open 24 h window. A customer who opted out may still get free-form
 *   replies while *they* keep the conversation going (customer-initiated service), never business-initiated ones.
 * - Templates (business-initiated) work at any time, but never to a contact who opted out.
 */
export function outboundAllowed(input: {
  kind: OutboundKind;
  lastInboundAt: Date | null | undefined;
  optedOutAt: Date | null | undefined;
  now: Date;
}): { ok: true } | { ok: false; reason: OutboundDenial } {
  if (input.kind === "template") return input.optedOutAt ? { ok: false, reason: "opted_out" } : { ok: true };
  if (!canSendFreeForm(input.lastInboundAt, input.now)) return { ok: false, reason: "window_closed" };
  // Opted out after their last message: they asked us to stop, don't keep talking.
  if (input.optedOutAt && input.lastInboundAt && input.optedOutAt.getTime() > input.lastInboundAt.getTime()) {
    return { ok: false, reason: "opted_out" };
  }
  return { ok: true };
}

// ------------------------------------------------------------------ opt-out / opt-in keywords

/** Whole-message keywords (after normalising). English, Tamil and common Tanglish spellings. */
export const OPT_OUT_KEYWORDS = [
  "stop",
  "stop all",
  "stopall",
  "unsubscribe",
  "opt out",
  "optout",
  "quit",
  "நிறுத்து",
  "நிறுத்துங்கள்",
  "நிறுத்தவும்",
  "நிறுத்துக",
  "செய்தி வேண்டாம்",
  "niruthu",
  "nirutthu",
  "niruththu",
] as const;

export const OPT_IN_KEYWORDS = [
  "start",
  "subscribe",
  "unstop",
  "opt in",
  "optin",
  "தொடங்கு",
  "தொடங்கவும்",
  "தொடங்குங்கள்",
  "மீண்டும் தொடங்கு",
  "thodangu",
] as const;

/**
 * Lower-case, NFC, punctuation and emoji removed (letters, combining marks — needed for Tamil vowel signs — and digits
 * kept), whitespace collapsed. "  STOP!! " → "stop", "நிறுத்து." → "நிறுத்து".
 */
export function normaliseKeyword(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type KeywordAction = "opt_out" | "opt_in";

/**
 * Detects an opt-out / opt-in keyword. Only a message that *is* the keyword counts ("stop" yes, "please don't stop
 * my order" no), so ordinary chat never unsubscribes anyone. Opt-out wins if a word is in both lists.
 */
export function detectKeyword(
  text: string | null | undefined,
  extra: { optOut?: readonly string[]; optIn?: readonly string[] } = {},
): KeywordAction | null {
  if (!text) return null;
  const t = normaliseKeyword(text);
  if (!t || t.length > 60) return null;
  const out = new Set([...OPT_OUT_KEYWORDS, ...(extra.optOut ?? [])].map(normaliseKeyword));
  if (out.has(t)) return "opt_out";
  const inn = new Set([...OPT_IN_KEYWORDS, ...(extra.optIn ?? [])].map(normaliseKeyword));
  if (inn.has(t)) return "opt_in";
  return null;
}

// ------------------------------------------------------------------ message status

export const OUTBOUND_STATUSES = ["queued", "sent", "delivered", "read", "failed"] as const;
export type OutboundStatus = (typeof OUTBOUND_STATUSES)[number];

const RANK: Record<OutboundStatus, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 1.5 };

/**
 * Webhook statuses arrive out of order and repeat. A status replaces the current one only when it moves forward:
 * queued → sent → delivered → read. `failed` replaces queued/sent but never delivered/read (a late failure for a
 * message already delivered is a stale retry).
 */
export function nextStatus(current: OutboundStatus, incoming: OutboundStatus): OutboundStatus {
  if (current === incoming) return current;
  if (current === "failed") return incoming === "delivered" || incoming === "read" ? incoming : current;
  return RANK[incoming] > RANK[current] ? incoming : current;
}

// ------------------------------------------------------------------ audience

export interface AudienceMember {
  phone: string;
  name?: string | null;
  /** Values for template variables (`{ amount: "₹1,250", due_date: "20 Oct" }`). */
  variables?: Record<string, string | number | null | undefined>;
}

export interface ResolvedRecipient {
  phone: string;
  name: string | null;
  variables: Record<string, string>;
}

export interface DedupeResult {
  recipients: ResolvedRecipient[];
  /** Entries without a usable number. */
  invalid: number;
  /** Entries dropped because the number was already in the list. */
  duplicates: number;
}

/**
 * Normalises numbers to +91 E.164, drops invalid ones and keeps the first occurrence of each number. Later
 * occurrences only fill a missing name and add variables the first one didn't have.
 */
export function dedupeAudience(members: Iterable<AudienceMember>): DedupeResult {
  const byPhone = new Map<string, ResolvedRecipient>();
  let invalid = 0;
  let duplicates = 0;
  for (const m of members) {
    const phone = normalisePhone(m.phone);
    if (!phone) {
      invalid++;
      continue;
    }
    const vars: Record<string, string> = {};
    for (const [k, v] of Object.entries(m.variables ?? {})) if (v !== null && v !== undefined && String(v) !== "") vars[k] = String(v);
    const name = m.name?.trim() || null;
    const existing = byPhone.get(phone);
    if (existing) {
      duplicates++;
      if (!existing.name && name) existing.name = name;
      for (const [k, v] of Object.entries(vars)) if (!(k in existing.variables)) existing.variables[k] = v;
      continue;
    }
    byPhone.set(phone, { phone, name, variables: vars });
  }
  return { recipients: [...byPhone.values()], invalid, duplicates };
}

// ------------------------------------------------------------------ throttle plan

export interface CampaignBatch {
  /** 0-based batch number. */
  batch: number;
  /** Index of the first recipient (in send order). */
  offset: number;
  size: number;
  /** Delay from the campaign start. */
  delayMs: number;
  at: Date;
}

/**
 * Splits `count` recipients into one batch per minute of at most `ratePerMinute` messages. Batch i starts i minutes
 * after `start`. Inside a batch the sender spaces messages evenly (`spacingMs`).
 */
export function planBatches(count: number, ratePerMinute: number, start: Date): CampaignBatch[] {
  const rate = Math.max(1, Math.floor(ratePerMinute));
  const out: CampaignBatch[] = [];
  for (let offset = 0, batch = 0; offset < count; offset += rate, batch++) {
    const delayMs = batch * 60_000;
    out.push({ batch, offset, size: Math.min(rate, count - offset), delayMs, at: new Date(start.getTime() + delayMs) });
  }
  return out;
}

/** Gap between two messages of one batch so a batch takes about a minute (capped at 1 s; 0 for big rates). */
export function spacingMs(ratePerMinute: number): number {
  const gap = Math.floor(60_000 / Math.max(1, Math.floor(ratePerMinute)));
  return Math.min(1000, Math.max(0, gap - 50));
}

/** Minutes a campaign of `count` messages takes at `ratePerMinute`. */
export const estimateMinutes = (count: number, ratePerMinute: number) => (count <= 0 ? 0 : Math.ceil(count / Math.max(1, Math.floor(ratePerMinute))));

// ------------------------------------------------------------------ campaign counts

export const RECIPIENT_STATUSES = ["pending", "sent", "delivered", "read", "failed", "skipped", "cancelled"] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

export interface CampaignCounts {
  total: number;
  pending: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  skipped: number;
  cancelled: number;
}

export const emptyCounts = (): CampaignCounts => ({ total: 0, pending: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0, cancelled: 0 });

/**
 * Funnel counts from per-status row counts. `sent` counts everything that left (sent + delivered + read),
 * `delivered` includes read — the numbers a shop owner expects ("sent 100, delivered 92, read 60").
 */
export function campaignCounts(byStatus: Partial<Record<RecipientStatus, number>>): CampaignCounts {
  const c = emptyCounts();
  for (const s of RECIPIENT_STATUSES) c.total += byStatus[s] ?? 0;
  c.pending = byStatus.pending ?? 0;
  c.read = byStatus.read ?? 0;
  c.delivered = (byStatus.delivered ?? 0) + c.read;
  c.sent = (byStatus.sent ?? 0) + c.delivered;
  c.failed = byStatus.failed ?? 0;
  c.skipped = byStatus.skipped ?? 0;
  c.cancelled = byStatus.cancelled ?? 0;
  return c;
}

/** Maps a message status onto a recipient status. */
export const recipientStatusFor = (s: OutboundStatus): RecipientStatus => (s === "queued" ? "pending" : s);

/** "Hello there, how…" — first `max` characters for list previews. */
export function preview(text: string | null | undefined, max = 120): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
