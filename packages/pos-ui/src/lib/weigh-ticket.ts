import { lineAmount } from "@srirealtime/gst";
import type { CartLine } from "./cart";
import type { WeighTicket } from "./terminal-types";

/**
 * Weigh tickets at the POS (docs/pos-terminals.md → Weigh tickets): a ticket code goes in the cart as fixed lines at
 * the server's prices (only "remove the whole ticket" is allowed), and after the bill is created each ticket is
 * marked used. Pure and unit tested.
 */

/** "W" + 11 digits (scanners may send lower case). */
export const isTicketCode = (code: string) => /^W\d{11}$/i.test(code.trim());
export const normalizeTicketCode = (code: string) => code.trim().toUpperCase();

/** The cart lines of a ticket: fixed qty and price, tagged with the ticket. */
export function ticketLines(ticket: WeighTicket, newKey: () => string): CartLine[] {
  return ticket.lines.map((l) => ({
    key: newKey(),
    itemId: l.itemId,
    name: l.name,
    hsn: l.hsn,
    unit: l.unit,
    price: l.unitPrice,
    listPrice: l.unitPrice,
    taxInclusive: l.taxInclusive,
    gstRate: l.gstRate,
    qty: l.qty,
    discount: 0,
    ticket: { id: ticket.id, code: ticket.code },
  }));
}

let seq = 0;
const key = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

export type AddTicketResult = { ok: true; lines: CartLine[]; keys: string[] } | { ok: false; reason: "duplicate" | "notOpen" | "expired" | "empty" };

/** Adds a ticket's lines unless it is already in the cart or not open. */
export function addTicket(lines: readonly CartLine[], ticket: WeighTicket, newKey: () => string = key, now = Date.now()): AddTicketResult {
  if (ticket.status !== "open") return { ok: false, reason: "notOpen" };
  // The counter resolver answers tickets in any state: check the day ourselves.
  const exp = Date.parse(ticket.expiresAt);
  if (Number.isFinite(exp) && exp <= now) return { ok: false, reason: "expired" };
  if (lines.some((l) => l.ticket?.id === ticket.id)) return { ok: false, reason: "duplicate" };
  const added = ticketLines(ticket, newKey);
  if (added.length === 0) return { ok: false, reason: "empty" };
  return { ok: true, lines: [...lines, ...added], keys: added.map((l) => l.key) };
}

/** Removing any line of a ticket removes the whole ticket. */
export function removeLineOrTicket(lines: readonly CartLine[], lineKey: string): CartLine[] {
  const line = lines.find((l) => l.key === lineKey);
  if (!line) return [...lines];
  if (line.ticket) return lines.filter((l) => l.ticket?.id !== line.ticket!.id);
  return lines.filter((l) => l.key !== lineKey);
}

/** Ticket ids on the bill (each once, in cart order). */
export const ticketIdsOf = (lines: readonly CartLine[]) => [...new Set(lines.flatMap((l) => (l.ticket ? [l.ticket.id] : [])))];

/** True when the cart's line amounts equal the ticket's (the server's) amounts: the bill charges exactly the ticket. */
export const ticketMatches = (ticket: WeighTicket) => ticket.lines.every((l) => lineAmount(l.qty, l.unitPrice) === l.amount);

/** Idempotency key for marking a ticket used by a bill (same key on a retry = no double use). */
export const ticketUseKey = (invoiceId: string, ticketId: string) => `pos-ticket-use:${invoiceId}:${ticketId}`;

/**
 * After the bill: POST /weigh-tickets/:id/use for each ticket. A ticket the server says is already used by another
 * bill is reported, never retried; the bill itself stands.
 */
export async function markTicketsUsed(
  invoiceId: string,
  ticketIds: readonly string[],
  use: (ticketId: string, body: { invoiceId: string }, idempotencyKey: string) => Promise<unknown>,
): Promise<{ used: string[]; failed: { id: string; code: string }[] }> {
  const used: string[] = [];
  const failed: { id: string; code: string }[] = [];
  for (const id of ticketIds) {
    try {
      await use(id, { invoiceId }, ticketUseKey(invoiceId, id));
      used.push(id);
    } catch (err) {
      failed.push({ id, code: (err as { code?: string } | null)?.code ?? "error" });
    }
  }
  return { used, failed };
}

/** GET /weigh-tickets/by-code failure → message kind. */
export function ticketErrorOf(err: unknown): "notFound" | "used" | "expired" | "cancelled" | "network" | "other" {
  const e = (err && typeof err === "object" ? err : {}) as { status?: number; code?: string };
  if (e.status === 0 || e.status === 502 || e.status === 503 || e.status === 504) return "network";
  if (e.code === "ticket_not_found" || e.status === 404) return "notFound";
  if (e.code === "ticket_used") return "used";
  if (e.code === "ticket_expired" || e.status === 410) return "expired";
  if (e.code === "ticket_cancelled") return "cancelled";
  return "other";
}

// ---------------------------------------------------------------- printed ticket

export interface TicketPrintRow {
  kind: "line" | "detail" | "rule" | "total";
  left: string;
  right?: string;
}

export interface TicketPrintModel {
  shop: string;
  terminal: string;
  code: string;
  time: string;
  rows: TicketPrintRow[];
  /** Printable width in mm (58 mm paper → 48, 80 mm → 72). */
  widthMm: number;
  paperMm: 58 | 80;
}

/**
 * The ticket as printed: shop, terminal, one row per line (name, then "1.234 kg × ₹80.00/kg" and the amount; tare when
 * used), the total, the time, and the code under the barcode. `money` / `qty` format numbers (paise / kg).
 */
export function ticketPrintModel(
  ticket: WeighTicket,
  opts: { shop: string; terminal: string; paperMm: 58 | 80; time: string; money: (paise: number) => string; qty: (q: number) => string; labels: { tare: string; total: string } },
): TicketPrintModel {
  const rows: TicketPrintRow[] = [];
  for (const l of ticket.lines) {
    rows.push({ kind: "line", left: l.name, right: opts.money(l.amount) });
    rows.push({ kind: "detail", left: `${opts.qty(l.qty)} ${l.unit} × ${opts.money(l.unitPrice)}/${l.unit}` });
    if (l.tareKg) rows.push({ kind: "detail", left: `${opts.labels.tare} ${opts.qty(l.tareKg)} kg` });
  }
  rows.push({ kind: "rule", left: "" });
  rows.push({ kind: "total", left: opts.labels.total, right: opts.money(ticket.total) });
  return {
    shop: opts.shop,
    terminal: opts.terminal,
    code: ticket.code,
    time: opts.time,
    rows,
    paperMm: opts.paperMm,
    widthMm: opts.paperMm === 58 ? 48 : 72,
  };
}
