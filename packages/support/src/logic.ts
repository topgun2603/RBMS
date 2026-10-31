import { listFilter, listQuerySchema, rangeOrder, splitList } from "@rbms/core";
import { z } from "zod";
import { stripHtml } from "./faq";
import {
  RELATED_TYPES,
  TICKET_CHANNELS,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type AuthorKind,
  type MessageKind,
  type MessageRow,
  type RelatedType,
  type TicketChannel,
  type TicketPriority,
  type TicketRow,
  type TicketStatus,
} from "./schema";
import { isOverdue } from "./sla";

// ------------------------------------------------------------------ numbering

/** "TKT" + 7 → "TKT-0007"; grows past 4 digits ("TKT-12345"). */
export function formatTicketNumber(prefix: string, seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) throw new RangeError(`Bad ticket sequence: ${seq}`);
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

/** "tkt-7", "#TKT-0007", "0007", "7" → 7 (the prefix is not checked); null when there is no number. */
export function parseTicketNumber(value: string): number | null {
  const m = /^#?\s*(?:[A-Za-z0-9]{1,8}-)?0*([0-9]{1,9})$/.exec(value.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? n : null;
}

// ------------------------------------------------------------------ statuses

/**
 * Allowed status moves. `open` = waiting on the shop, `pending` = waiting on the customer, `resolved` = answered (the
 * customer can reopen it by replying), `closed` = final (a new message needs a new ticket).
 */
export const TICKET_TRANSITIONS: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = {
  open: ["pending", "resolved", "closed"],
  pending: ["open", "resolved", "closed"],
  resolved: ["open", "closed"],
  closed: [],
};

export const canTransition = (from: TicketStatus, to: TicketStatus) => from === to || TICKET_TRANSITIONS[from].includes(to);

/** The timestamp columns a status change sets. Reopening clears `resolvedAt`. */
export function statusTimestamps(to: TicketStatus, now: Date): { resolvedAt?: Date | null; closedAt?: Date | null } {
  switch (to) {
    case "resolved":
      return { resolvedAt: now, closedAt: null };
    case "closed":
      return { closedAt: now };
    default:
      return { resolvedAt: null, closedAt: null };
  }
}

/**
 * Status after a message: a requester reply puts a pending or resolved ticket back to `open`; a staff reply on an open
 * ticket moves it to `pending` (waiting on the customer) unless the staff member picked a status; notes change nothing.
 * Throws-free: returns null when the message is not allowed (anything on a closed ticket except a staff note).
 */
export function statusAfterMessage(
  current: TicketStatus,
  author: Exclude<AuthorKind, "system">,
  kind: MessageKind,
  requested?: TicketStatus | null,
): TicketStatus | null {
  if (current === "closed") return author === "staff" && kind === "note" ? "closed" : null;
  if (author === "requester") return kind === "reply" ? "open" : null;
  if (kind === "note") return requested && canTransition(current, requested) ? requested : current;
  if (requested) return canTransition(current, requested) ? requested : null;
  return current === "open" ? "pending" : current;
}

// ------------------------------------------------------------------ input

const opt = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), s.nullable().optional());

export const SUPPORT_LIMITS = { subject: 200, body: 10_000, attachments: 5, tags: 20, tag: 40 } as const;

const markdownBody = z
  .string()
  .max(SUPPORT_LIMITS.body)
  .transform((s) => stripHtml(s).trim())
  .refine((s) => s.length > 0, "Write a message");

export const attachmentUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .url("Attachments must be links")
  .refine((u) => /^https?:\/\//i.test(u), "Attachments must be http(s) links");

const attachments = z
  .array(attachmentUrlSchema)
  .max(SUPPORT_LIMITS.attachments, `At most ${SUPPORT_LIMITS.attachments} attachments`)
  .transform((l) => [...new Set(l)])
  .default([]);

/** Lower-case, trimmed, spaces → "-", deduped. */
export const tagsSchema = z
  .array(z.string().trim().min(1).max(SUPPORT_LIMITS.tag))
  .max(SUPPORT_LIMITS.tags)
  .transform((l) => [...new Set(l.map((t) => t.toLowerCase().replace(/\s+/g, "-")))]);

const related = z.object({ type: z.enum(RELATED_TYPES), id: z.string().trim().min(1).max(64) });

/** `POST /public/tickets`. Guests must give a name; their phone comes from the verified token, never the body. */
export const publicTicketInputSchema = z.object({
  subject: z.string().trim().min(3, "Add a subject").max(SUPPORT_LIMITS.subject),
  body: markdownBody,
  name: opt(z.string().trim().max(120)),
  email: opt(z.string().trim().toLowerCase().email().max(200)),
  related: related.nullable().optional(),
  attachments,
});
export type PublicTicketInput = z.input<typeof publicTicketInputSchema>;

/** `POST /tickets` (staff, e.g. a phone call). Needs a requester user id, or a name with a phone or email. */
export const staffTicketInputSchema = z
  .object({
    subject: z.string().trim().min(3).max(SUPPORT_LIMITS.subject),
    body: markdownBody,
    requesterUserId: z.string().uuid().nullable().optional(),
    name: opt(z.string().trim().max(120)),
    phone: opt(z.string().trim().max(20)),
    email: opt(z.string().trim().toLowerCase().email().max(200)),
    priority: z.enum(TICKET_PRIORITIES).default("normal"),
    channel: z.enum(TICKET_CHANNELS).default("phone"),
    assigneeId: z.string().uuid().nullable().optional(),
    tags: tagsSchema.default([]),
    related: related.nullable().optional(),
    attachments,
  })
  .refine((t) => t.requesterUserId || (t.name && (t.phone || t.email)), "Give the customer's name and phone or email");
export type StaffTicketInput = z.input<typeof staffTicketInputSchema>;

export const requesterMessageInputSchema = z.object({ body: markdownBody, attachments });
export type RequesterMessageInput = z.input<typeof requesterMessageInputSchema>;

export const staffMessageInputSchema = z.object({
  kind: z.enum(["reply", "note"]).default("reply"),
  body: markdownBody,
  attachments,
  /** Set the status in the same step ("reply and resolve"). */
  status: z.enum(TICKET_STATUSES).optional(),
});
export type StaffMessageInput = z.input<typeof staffMessageInputSchema>;

export const assignInputSchema = z.object({ assigneeId: z.string().uuid().nullable() });
export const statusInputSchema = z.object({ status: z.enum(TICKET_STATUSES) });
export const priorityInputSchema = z.object({ priority: z.enum(TICKET_PRIORITIES) });
export const tagsInputSchema = z.object({ tags: tagsSchema });
export const mergeInputSchema = z.object({ intoId: z.string().uuid() });

/** Sort names of the older desk (`recent`, `oldest`) → the list keys; `due` is a key itself. */
export const LEGACY_TICKET_SORTS: Readonly<Record<string, string>> = { recent: "-updated", oldest: "created" };

/** One assignee value: a user id, `me` (the viewer) or `none` (unassigned). */
const assigneeValue = z.union([z.literal("me"), z.literal("none"), z.string().uuid()]);

/**
 * `GET /tickets` (docs/CONVENTIONS.md → "Lists and tables"). Lists are comma-separated. `assignee`: user ids, `me`
 * and/or `none` (ORed). `overdue`: past the first-response deadline (true) or not (false). `from`/`to`: IST dates on
 * `created_at`. `sort`: see `TICKET_SORT` (default `-updated` = latest activity first). Limits stay 50 / 500 (CSV).
 */
export const ticketListQuerySchema = listQuerySchema({ defaultLimit: 50, maxLimit: 500 })
  .extend({
    status: listFilter.oneOf(TICKET_STATUSES),
    priority: listFilter.oneOf(TICKET_PRIORITIES),
    channel: listFilter.oneOf(TICKET_CHANNELS),
    assignee: z.preprocess(splitList, z.array(assigneeValue).max(50).optional()),
    tag: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().toLowerCase().max(SUPPORT_LIMITS.tag).optional()),
    overdue: listFilter.bool(),
    from: listFilter.date(),
    to: listFilter.date(),
    sort: z.preprocess(
      (v) => (typeof v === "string" ? (LEGACY_TICKET_SORTS[v.trim()] ?? v) : v),
      z.string().trim().max(64).optional(),
    ),
  })
  .superRefine(rangeOrder("from", "to"));
export type TicketListQuery = z.input<typeof ticketListQuerySchema>;
export type TicketListParams = z.output<typeof ticketListQuerySchema>;

/** IST date "2026-10-15" → the UTC instant of its midnight. */
export const istMidnight = (date: string) => new Date(Date.parse(`${date}T00:00:00+05:30`));

// ------------------------------------------------------------------ output

export interface TicketRequester {
  userId: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
}

/** Staff view. */
export interface Ticket {
  id: string;
  number: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  channel: TicketChannel;
  requester: TicketRequester;
  assigneeId: string | null;
  tags: string[];
  related: { type: RelatedType; id: string } | null;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  slaDueAt: Date | null;
  /** Past the first-response deadline right now. */
  overdue: boolean;
  /** The first-response deadline was missed at some point. */
  slaBreached: boolean;
  mergedIntoId: string | null;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** What the requester sees: no assignee, tags, SLA or internal fields. */
export interface PublicTicket {
  id: string;
  number: string;
  subject: string;
  status: TicketStatus;
  channel: TicketChannel;
  related: { type: RelatedType; id: string } | null;
  /** Number of the ticket this one was merged into (the conversation continues there). */
  mergedInto: string | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  ticketId: string;
  authorId: string | null;
  authorKind: AuthorKind;
  kind: MessageKind;
  body: string;
  attachments: string[];
  createdAt: Date;
}

/** A requester-visible message: replies only, without the staff author's id. */
export interface PublicMessage {
  id: string;
  /** "requester" = you, "staff" = the shop. */
  from: "requester" | "staff";
  body: string;
  attachments: string[];
  createdAt: Date;
}

export const toTicket = (r: TicketRow, now: Date): Ticket => ({
  id: r.id,
  number: r.number,
  subject: r.subject,
  status: r.status,
  priority: r.priority,
  channel: r.channel,
  requester: { userId: r.requesterUserId, name: r.requesterName, phone: r.requesterPhone, email: r.requesterEmail },
  assigneeId: r.assigneeId,
  tags: r.tags ?? [],
  related: r.relatedType && r.relatedId ? { type: r.relatedType, id: r.relatedId } : null,
  firstResponseAt: r.firstResponseAt,
  resolvedAt: r.resolvedAt,
  closedAt: r.closedAt,
  slaDueAt: r.slaDueAt,
  overdue: isOverdue(r, now),
  slaBreached: r.slaBreached,
  mergedIntoId: r.mergedIntoId,
  lastMessageAt: r.lastMessageAt,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

export const toPublicTicket = (t: Ticket, mergedInto: string | null = null): PublicTicket => ({
  id: t.id,
  number: t.number,
  subject: t.subject,
  status: t.status,
  channel: t.channel,
  related: t.related,
  mergedInto,
  resolvedAt: t.resolvedAt,
  closedAt: t.closedAt,
  lastMessageAt: t.lastMessageAt,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
});

export const toMessage = (r: MessageRow): Message => ({
  id: r.id,
  ticketId: r.ticketId,
  authorId: r.authorId,
  authorKind: r.authorKind,
  kind: r.kind,
  body: r.body,
  attachments: r.attachments ?? [],
  createdAt: r.createdAt,
});

/** Is this message shown to the requester? Notes and system messages never are. */
export const isRequesterVisible = (m: Pick<Message, "kind" | "authorKind">) => m.kind === "reply" && m.authorKind !== "system";

/** The requester's view of a thread: internal notes and system lines removed, author ids dropped. */
export function publicMessages(messages: readonly Message[]): PublicMessage[] {
  return messages.filter(isRequesterVisible).map((m) => ({
    id: m.id,
    from: m.authorKind === "requester" ? "requester" : "staff",
    body: m.body,
    attachments: m.attachments,
    createdAt: m.createdAt,
  }));
}

/** `{ open, pending, resolved, closed }` from grouped rows (missing statuses are 0). */
export function statusCounts(rows: readonly { status: string; count: number | string }[]): Record<TicketStatus, number> {
  const out: Record<TicketStatus, number> = { open: 0, pending: 0, resolved: 0, closed: 0 };
  for (const r of rows) if ((TICKET_STATUSES as readonly string[]).includes(r.status)) out[r.status as TicketStatus] += Number(r.count) || 0;
  return out;
}

/** Short plain-text preview of a markdown message for WhatsApp/SMS templates. */
export function messagePreview(body: string, max = 300): string {
  const plain = body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

// ------------------------------------------------------------------ csv

export type CsvValue = string | number | boolean | null | undefined;

const csvCell = (v: CsvValue): string => {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV with a UTF-8 BOM (Excel) and CRLF line ends, like orders/invoices. */
export function toCsv(headers: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  return `﻿${[headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** "2026-10-15 11:30" in IST. */
export function istDateTime(d: Date | string | null): string {
  if (!d) return "";
  const t = new Date(new Date(d).getTime() + 330 * 60_000).toISOString();
  return `${t.slice(0, 10)} ${t.slice(11, 16)}`;
}

export function ticketsCsv(items: readonly Ticket[]): string {
  return toCsv(
    ["Ticket", "Created (IST)", "Subject", "Status", "Priority", "Channel", "Customer", "Phone", "Email", "Assignee", "Tags", "First response (IST)", "SLA due (IST)", "SLA missed", "Resolved (IST)"],
    items.map((t) => [
      t.number,
      istDateTime(t.createdAt),
      t.subject,
      t.status,
      t.priority,
      t.channel,
      t.requester.name,
      t.requester.phone,
      t.requester.email,
      t.assigneeId,
      t.tags.join(" "),
      istDateTime(t.firstResponseAt),
      istDateTime(t.slaDueAt),
      t.slaBreached || t.overdue ? "yes" : "no",
      istDateTime(t.resolvedAt),
    ]),
  );
}

export function csvDisposition(name: string, from?: string | null, to?: string | null): string {
  const parts = [name, from, to].filter(Boolean).join("-").replace(/[^A-Za-z0-9._-]/g, "_");
  return `attachment; filename="${parts}.csv"`;
}

/** Indian mobile → "+91XXXXXXXXXX", else null (same rules as orders/invoices). */
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
