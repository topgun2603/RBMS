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
  /** Job total (paise, with GST). A zero-amount job (warranty, free alteration) may be delivered without a bill. */
  total?: number;
}

export type MoveBlock = "same" | "closed" | "not_billed" | "backwards" | "unknown";

const step = (s: JobStatus) => (JOB_FLOW as readonly JobStatus[]).indexOf(s);

/**
 * Why a move isn't allowed, or null when it is:
 * - forward any number of steps (`trial` can be skipped), but into `delivered` only once billed or when nothing is due;
 * - back one step to undo a mis-tap (`ready` → `in_progress` counts as one when the trial was skipped);
 * - `cancelled` from anything not delivered; nothing leaves `cancelled`.
 */
export function moveBlock(from: JobStatus, to: JobStatus, ctx: MoveContext = {}): MoveBlock | null {
  if (!JOB_STATUSES.includes(from) || !JOB_STATUSES.includes(to)) return "unknown";
  if (from === to) return "same";
  if (from === "cancelled") return "closed";
  if (to === "cancelled") return from === "delivered" ? "closed" : null;
  const a = step(from);
  const b = step(to);
  if (b > a) return to === "delivered" && !ctx.billed && (ctx.total ?? 0) > 0 ? "not_billed" : null;
  if (a - b === 1 || (from === "ready" && to === "in_progress")) return null;
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
