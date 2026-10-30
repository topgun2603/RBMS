import { createHmac, randomInt } from "node:crypto";
import { AppError, badRequest } from "@rbms/core";
import type { DeviceInfo, TerminalRow, TerminalSettings, WeighTicketLine, WeighTicketRow } from "./schema";

// ------------------------------------------------------------------ constants (docs/pos-terminals.md)

/** Pairing code alphabet: no 0/O, 1/I/L. */
export const PAIRING_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const PAIRING_CODE_LENGTH = 8;
export const PAIRING_TTL_MS = 15 * 60_000;
/** `POST /pair` attempts per IP per window. */
export const PAIR_ATTEMPTS_PER_WINDOW = 10;
export const PAIR_WINDOW_MS = 10 * 60_000;
/** Wrong PINs in a row on a terminal before it locks, and for how long. */
export const PIN_MAX_FAILURES = 5;
export const PIN_LOCK_MS = 5 * 60_000;
/** PIN session lifetime (no sliding). */
export const PIN_SESSION_TTL_MINUTES = 12 * 60;
/** `last_seen_at` is written at most this often. */
export const LAST_SEEN_INTERVAL_MS = 60_000;
/** Catalogue sync: default / max page size, how far back a delta may go, and the cursor overlap. */
export const CATALOG_DEFAULT_LIMIT = 1000;
export const CATALOG_MAX_LIMIT = 2000;
export const CATALOG_MAX_DELTA_MS = 7 * 24 * 3_600_000;
export const CATALOG_CURSOR_OVERLAP_MS = 30_000;
/** Net weight bounds (kg). */
export const MAX_NET_KG = 999.999;
export const DEFAULT_SETTINGS: Required<TerminalSettings> = { printerWidth: 80, autoPrint: false, lockAfterMinutes: 5 };

// ------------------------------------------------------------------ pairing codes

/** A random pairing code, e.g. "ABCD2345" (store and compare this form; show it with `formatPairingCode`). */
export function newPairingCode(): string {
  let out = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) out += PAIRING_ALPHABET[randomInt(0, PAIRING_ALPHABET.length)];
  return out;
}

/** "ABCD2345" → "ABCD-2345". */
export const formatPairingCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

/** What the user typed → the stored form (upper case, no dash or spaces); null when it can't be a code. */
export function normalizePairingCode(input: string): string | null {
  const c = String(input ?? "").toUpperCase().replace(/[\s-]/g, "");
  if (c.length !== PAIRING_CODE_LENGTH) return null;
  for (const ch of c) if (!PAIRING_ALPHABET.includes(ch)) return null;
  return c;
}

/** The QR payload the pairing screen shows: `srikit-pair:1:<apiOrigin>:<code>`. */
export const pairingQr = (apiOrigin: string, code: string) => `srikit-pair:1:${apiOrigin.replace(/\/+$/, "")}:${formatPairingCode(code)}`;

// ------------------------------------------------------------------ PINs

export const PIN_RE = /^\d{4,6}$/;

/** All the same digit (0000) or a run up or down (1234, 123456, 9876, 7890). */
export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true;
  const d = [...pin].map(Number);
  const steps = d.slice(1).map((x, i) => (x - d[i]! + 10) % 10);
  return steps.every((s) => s === 1) || steps.every((s) => s === 9);
}

/** Throws 400 `pin_weak` (or a validation error) for a PIN that may not be used. */
export function assertPinAllowed(pin: unknown): string {
  const p = typeof pin === "string" ? pin.trim() : "";
  if (!PIN_RE.test(p)) throw new AppError(400, "pin_weak", "A PIN is 4 to 6 digits", { reason: "format" });
  if (isWeakPin(p)) throw new AppError(400, "pin_weak", "Choose a PIN that is not a repeated digit or a simple sequence", { reason: "simple" });
  return p;
}

/** HMAC-SHA256(key, `${tenantId}:${pin}`) as hex: the only form a PIN is stored and looked up in. */
export const pinLookup = (key: string, tenantId: string, pin: string) => createHmac("sha256", key).update(`${tenantId}:${pin}`).digest("hex");

// ------------------------------------------------------------------ weigh tickets

/** "W" + 11 random digits. */
export const newTicketCode = () => `W${String(randomInt(0, 100_000_000_000)).padStart(11, "0")}`;
export const TICKET_CODE_RE = /^W\d{11}$/;

/** The next IST midnight after `now` (a ticket weighed today expires then). */
export function endOfIstDay(now: Date): Date {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const next = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + 1);
  return new Date(next - 330 * 60_000);
}

/** The IST midnight that started `now`'s day. */
export const startOfIstDay = (now: Date) => new Date(endOfIstDay(now).getTime() - 86_400_000);

export const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** What the weigh-ticket pricing needs of a catalogue item. */
export interface PriceableItem {
  itemId: string;
  name: string;
  unit: string;
  soldBy: "unit" | "weight";
  price: number;
  taxInclusive: boolean;
  gstRate: number;
  hsn: string | null;
  /** The scale PLU's packaging weight (kg), used when the line gives no tare. */
  tareKg?: number | null;
}

export interface WeighLineInput {
  itemId: string;
  weightKg?: number;
  qty?: number;
  tareKg?: number;
}

const lineError = (index: number, reason: string, message: string) => new AppError(400, "invalid_line", message, { index, reason });

/**
 * Prices one ticket line from the catalogue: weighed items at price per kg × net weight (gram-priced items per g),
 * count items at price × qty, rounded to the paisa. Throws 400 `invalid_line` `{ index, reason }`.
 */
export function priceLine(item: PriceableItem | undefined, input: WeighLineInput, index: number): WeighTicketLine {
  if (!item) throw lineError(index, "item_not_found", "This item isn't sold at the counter");
  const base = { itemId: item.itemId, name: item.name, unit: item.unit, unitPrice: item.price, taxInclusive: item.taxInclusive, gstRate: item.gstRate, hsn: item.hsn };
  if (item.soldBy === "weight") {
    if (typeof input.weightKg !== "number" || !Number.isFinite(input.weightKg)) throw lineError(index, "weight_required", "Weigh this item");
    const tare = typeof input.tareKg === "number" ? input.tareKg : (item.tareKg ?? 0);
    if (!Number.isFinite(tare) || tare < 0) throw lineError(index, "invalid_tare", "The tare can't be negative");
    const net = round3(input.weightKg - tare);
    if (!(net > 0) || net > MAX_NET_KG) throw lineError(index, "invalid_weight", "The net weight must be more than 0 and at most 999.999 kg");
    const grams = item.unit.trim().toLowerCase() === "g" || item.unit.trim().toLowerCase() === "gm";
    const qty = grams ? round3(net * 1000) : net;
    return { ...base, qty, amount: Math.round(item.price * qty), tareKg: round3(tare) };
  }
  const qty = typeof input.qty === "number" ? input.qty : 1;
  if (!Number.isFinite(qty) || qty <= 0 || qty > 99_999 || round3(qty) !== qty) throw lineError(index, "invalid_qty", "Enter a quantity above 0 (up to 3 decimals)");
  return { ...base, qty, amount: Math.round(item.price * qty) };
}

// ------------------------------------------------------------------ catalogue cursors

/** The sync cursor: a time (ms), quantised to the minute and set back by the overlap, so a page's ETag is stable. */
export function cursorFor(now: Date): number {
  return Math.floor((now.getTime() - CATALOG_CURSOR_OVERLAP_MS) / 60_000) * 60_000;
}

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const unb64 = (s: string): unknown => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

export const encodeCursor = (ms: number) => b64({ v: 1, t: ms });

/** A `since` cursor → ms; null for a missing or unreadable one (the sync starts over). */
export function decodeCursor(s: string | undefined | null): number | null {
  if (!s) return null;
  try {
    const v = unb64(s) as { v?: number; t?: number };
    return v?.v === 1 && typeof v.t === "number" && Number.isFinite(v.t) ? v.t : null;
  } catch {
    return null;
  }
}

export interface PageToken {
  /** Cursor of the sync this page belongs to. */
  c: number;
  /** `since` of the sync (null = full). */
  s: number | null;
  /** Last item id of the previous page. */
  a: string;
}

export const encodePageToken = (t: PageToken) => b64({ v: 1, ...t });

/** Throws 400 for a malformed page token. */
export function decodePageToken(s: string): PageToken {
  try {
    const v = unb64(s) as Partial<PageToken> & { v?: number };
    if (v?.v === 1 && typeof v.c === "number" && (v.s === null || typeof v.s === "number") && typeof v.a === "string" && /^[0-9a-f-]{36}$/i.test(v.a)) {
      return { c: v.c, s: v.s, a: v.a };
    }
  } catch {
    /* fallthrough */
  }
  throw badRequest("Invalid page token", { field: "after" });
}

// ------------------------------------------------------------------ views

export interface TerminalView {
  id: string;
  name: string;
  role: "pos" | "weighing";
  branchId: string | null;
  locationId: string | null;
  settings: Required<TerminalSettings>;
  paired: boolean;
  device: DeviceInfo | null;
  pairedAt: Date | null;
  lastSeenAt: Date | null;
  pairingPending: boolean;
  createdAt: Date;
}

export const settingsOf = (s: TerminalSettings | null | undefined): Required<TerminalSettings> => ({
  printerWidth: s?.printerWidth === 58 ? 58 : 80,
  autoPrint: s?.autoPrint === true,
  lockAfterMinutes: typeof s?.lockAfterMinutes === "number" && s.lockAfterMinutes >= 1 && s.lockAfterMinutes <= 60 ? Math.round(s.lockAfterMinutes) : 5,
});

export function toTerminal(r: TerminalRow, now: Date): TerminalView {
  const paired = Boolean(r.deviceTokenHash);
  return {
    id: r.id,
    name: r.name,
    role: r.role,
    branchId: r.branchId,
    locationId: r.locationId,
    settings: settingsOf(r.settings),
    paired,
    device: paired ? (r.device ?? null) : null,
    pairedAt: paired ? r.pairedAt : null,
    lastSeenAt: r.lastSeenAt,
    pairingPending: Boolean(r.pairingCodeHash && r.pairingExpiresAt && r.pairingExpiresAt > now),
    createdAt: r.createdAt,
  };
}

export interface WeighTicketView {
  id: string;
  code: string;
  terminalId: string;
  status: "open" | "used" | "cancelled";
  lines: WeighTicketLine[];
  total: number;
  note: string | null;
  createdAt: Date;
  expiresAt: Date;
  usedInvoiceId: string | null;
}

export const toTicket = (r: WeighTicketRow): WeighTicketView => ({
  id: r.id,
  code: r.code,
  terminalId: r.terminalId,
  status: r.status,
  lines: r.lines,
  total: r.total,
  note: r.note,
  createdAt: r.createdAt,
  expiresAt: r.expiresAt,
  usedInvoiceId: r.usedInvoiceId,
});
