import { CLOSED_STATUSES, JOB_FLOW, JOB_STATUSES, type JobStatus } from "./schema";

export const roundQty = (n: number) => Math.round(n * 1000) / 1000;

/** "JC-0012"; numbers past 9999 keep growing ("JC-12345"). */
export const formatJobNumber = (n: number) => `JC-${String(Math.max(0, Math.trunc(n))).padStart(4, "0")}`;

/** "JC-0012", "jc12", "12" → 12; anything else → null (for search by number). */
export function parseJobNumber(q: string): number | null {
  const m = /^\s*(?:jc[-\s]?)?0*(\d{1,9})\s*$/i.exec(q);
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------------------------- status moves

export interface MoveContext {
  /** A bill was made from the job. */
  billed?: boolean;
  /** The customer's recorded answer to the estimate (`JobMeta.approval.decision`), if any. */
  approval?: ApprovalDecision | null;
  /** Job total (paise, with GST). A zero-amount job (warranty, free alteration) may be delivered without a bill. */
  total?: number;
}

export type MoveBlock = "same" | "closed" | "not_billed" | "backwards" | "needs_approval" | "unknown";

const step = (s: JobStatus) => (JOB_FLOW as readonly JobStatus[]).indexOf(s);

/**
 * Why a move isn't allowed, or null when it is:
 * - forward any number of steps (`trial` can be skipped), but into `delivered` only once billed or when nothing is due;
 * - back one step to undo a mis-tap (`ready` → `in_progress` counts as one when the trial was skipped);
 * - `cancelled` from anything not delivered; nothing leaves `cancelled`;
 * - into `approved` only with the customer's approval recorded, and nowhere forward from `awaiting_approval` without
 *   it (record the approval, or the decline, first).
 */
export function moveBlock(from: JobStatus, to: JobStatus, ctx: MoveContext = {}): MoveBlock | null {
  if (!JOB_STATUSES.includes(from) || !JOB_STATUSES.includes(to)) return "unknown";
  if (from === to) return "same";
  if (from === "cancelled") return "closed";
  if (to === "cancelled") return from === "delivered" ? "closed" : null;
  const a = step(from);
  const b = step(to);
  if (to === "approved" && ctx.approval !== "approved") return "needs_approval";
  if (from === "awaiting_approval" && b > a && ctx.approval !== "approved") return "needs_approval";
  if (b > a) return to === "delivered" && !ctx.billed && (ctx.total ?? 0) > 0 ? "not_billed" : null;
  // Back one step to undo a mis-tap; extra work found mid-repair goes back for approval.
  if (a - b === 1 || (from === "ready" && to === "in_progress") || (to === "awaiting_approval" && from === "in_progress")) return null;
  return "backwards";
}

export const canMove = (from: JobStatus, to: JobStatus, ctx: MoveContext = {}) => moveBlock(from, to, ctx) === null;

/** Every status the job can move to now, in flow order (cancel last). */
export const allowedMoves = (from: JobStatus, ctx: MoveContext = {}): JobStatus[] => JOB_STATUSES.filter((to) => canMove(from, to, ctx));

/** The next forward step(s) for the stepper: the following status, plus `ready` when it's `trial` (skippable). */
export function nextSteps(from: JobStatus, ctx: MoveContext = {}): JobStatus[] {
  const i = step(from);
  if (i < 0) return [];
  const out = JOB_FLOW.slice(i + 1, i + 2).filter((s) => canMove(from, s, ctx)) as JobStatus[];
  if (out[0] === "trial" && canMove(from, "ready", ctx)) out.push("ready");
  return out;
}

export const isClosed = (s: JobStatus) => CLOSED_STATUSES.includes(s);

/** Past the due date and not ready yet (ready / delivered / cancelled jobs are never overdue). */
export function isOverdue(due: string | null, status: JobStatus, today: string): boolean {
  return !!due && due < today && status !== "ready" && !isClosed(status);
}

// ---------------------------------------------------------------------------------------------- money

export interface PricedLine {
  qty: number;
  /** GST-exclusive paise per unit. */
  rate: number;
  gstRate: number;
  kind?: "part" | "labour";
}

/** Paise, GST-exclusive: qty × rate. */
export const lineAmount = (l: Pick<PricedLine, "qty" | "rate">) => Math.round(l.qty * l.rate);

/** GST on a line, paise: amount × rate / 100. */
export const lineTax = (l: PricedLine) => Math.round((lineAmount(l) * l.gstRate) / 100);

export interface JobTotals {
  parts: number;
  labour: number;
  /** Before GST. */
  amount: number;
  tax: number;
  /** amount + tax. */
  total: number;
  advance: number;
  /** total − advance (negative = refund due). */
  balance: number;
}

/** The estimate: amount before GST, GST per line summed, total, advance and what's left to pay. */
export function jobTotals(lines: PricedLine[], advance = 0): JobTotals {
  let parts = 0;
  let labour = 0;
  let tax = 0;
  for (const l of lines) {
    const a = lineAmount(l);
    if (l.kind === "labour") labour += a;
    else parts += a;
    tax += lineTax(l);
  }
  const amount = parts + labour;
  const total = amount + tax;
  return { parts, labour, amount, tax, total, advance, balance: total - advance };
}

// ---------------------------------------------------------------------------------------------- approval

export const APPROVAL_DECISIONS = ["approved", "declined"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

/** How the customer gave their answer: told the counter, on a call, on WhatsApp / SMS / email, or on the tracking page. */
export const APPROVAL_CHANNELS = ["in_person", "phone", "whatsapp", "sms", "email", "online", "other"] as const;
export type ApprovalChannel = (typeof APPROVAL_CHANNELS)[number];

/** The customer's answer to the estimate, as recorded on the job (`JobMeta.approval`). */
export interface JobApproval {
  decision: ApprovalDecision;
  /** Who gave it ("Ravi", "his son, on call"); the customer's name when not told. */
  by: string;
  channel: ApprovalChannel;
  /** ISO time the customer answered. */
  at: string;
  /** The estimate total (paise, with GST) answered. */
  amount: number;
  note: string | null;
  /** Staff member who recorded it (null when the customer answered online). */
  recordedBy: string | null;
  /** Online answers: the customer's address and browser, for the record (never shown publicly). */
  ip?: string | null;
  userAgent?: string | null;
}

/** The service's own bookkeeping inside `jobcards.fields._meta`. */
export interface JobMeta {
  approval?: JobApproval | null;
  /** ISO time the job was last sent for approval (an answer before it belongs to an older estimate). */
  approvalRequestedAt?: string | null;
  /** Serial numbers / IMEIs of the units on part lines, by line id. */
  serials?: Record<string, string[]>;
}

export const META_KEY = "_meta";

/** Splits a card's stored `fields` into the template details and the service's `_meta`. */
export function splitFields(stored: Record<string, unknown> | null | undefined): { fields: Record<string, unknown>; meta: JobMeta } {
  const { [META_KEY]: raw, ...fields } = stored ?? {};
  const meta = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as JobMeta) : {};
  return { fields, meta };
}

/** Template details with the `_meta` put back (left out when empty). */
export function joinFields(fields: Record<string, unknown>, meta: JobMeta): Record<string, unknown> {
  const clean: JobMeta = {};
  if (meta.approval) clean.approval = meta.approval;
  if (meta.approvalRequestedAt) clean.approvalRequestedAt = meta.approvalRequestedAt;
  const serials = Object.fromEntries(Object.entries(meta.serials ?? {}).filter(([, v]) => v.length > 0));
  if (Object.keys(serials).length) clean.serials = serials;
  const { [META_KEY]: _drop, ...rest } = fields;
  return Object.keys(clean).length ? { ...rest, [META_KEY]: clean } : rest;
}

/** The answer to the current request (one given before the job was last sent for approval belongs to an older estimate). */
export function currentApproval(meta: JobMeta): JobApproval | null {
  const a = meta.approval ?? null;
  if (!a) return null;
  if (meta.approvalRequestedAt && a.at < meta.approvalRequestedAt) return null;
  return a;
}

/** The customer may answer on the tracking page: the job waits for approval of a priced estimate, not answered yet. */
export function canRespondOnline(status: JobStatus, total: number, approval: JobApproval | null): boolean {
  return status === "awaiting_approval" && total > 0 && !approval;
}

/** One line for the timeline: "Approved by Ravi · phone · ₹1,800.00". */
export function approvalText(a: Pick<JobApproval, "decision" | "by" | "channel" | "amount">): string {
  const rupees = (a.amount / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${a.decision === "approved" ? "Approved" : "Declined"} by ${a.by} · ${a.channel.replace(/_/g, " ")} · ₹${rupees}`;
}

// ---------------------------------------------------------------------------------------------- lookups

/** The last 4 digits of a phone number ("" when it has fewer). */
export function phoneLast4(phone: string | null | undefined): string {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length >= 4 ? d.slice(-4) : "";
}

/** "Track my repair": the digits the customer typed match the phone on the job (a job without a phone never matches). */
export function phoneMatches(phone: string | null | undefined, last4: string): boolean {
  const want = (last4 ?? "").replace(/\D/g, "");
  return want.length === 4 && phoneLast4(phone) === want;
}

// ---------------------------------------------------------------------------------------------- serials

/** Serial numbers / IMEIs as bills keep them: upper case, no spaces. */
export const normaliseSerial = (s: string) => s.replace(/\s+/g, "").toUpperCase();
/** What a bill line accepts (invoices' line schema). */
export const SERIAL_RE = /^[A-Z0-9/-]{3,40}$/;

/**
 * Why the serials of a line can't be kept, or null: only on a part picked from stock, no repeats, at most one per unit,
 * and not already on another line of the job (`elsewhere`).
 */
export function lineSerialsProblem(
  l: { kind: "part" | "labour"; itemId: string | null; qty: number; serials: string[] },
  elsewhere: Iterable<string> = [],
): string | null {
  if (l.serials.length === 0) return null;
  if (l.kind !== "part" || !l.itemId) return "Serial numbers go on parts picked from stock";
  if (new Set(l.serials).size !== l.serials.length) return "A serial number is listed twice";
  if (l.serials.length > Math.ceil(l.qty)) return "More serial numbers than units on the line";
  const other = new Set(elsewhere);
  const dup = l.serials.find((s) => other.has(s));
  return dup ? `${dup} is already on another line of this job` : null;
}
