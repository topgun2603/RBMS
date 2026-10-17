import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  canTransition,
  formatTicketNumber,
  isRequesterVisible,
  parseTicketNumber,
  publicMessages,
  publicTicketInputSchema,
  staffMessageInputSchema,
  staffTicketInputSchema,
  statusAfterMessage,
  statusCounts,
  statusTimestamps,
  tagsSchema,
  ticketListQuerySchema,
  ticketsCsv,
  TICKET_TRANSITIONS,
  toPublicTicket,
  toTicket,
  type Message,
} from "./logic";
import { TICKET_STATUSES, type TicketRow } from "./schema";
import { contactTargets, ownsTicket, sameRequester } from "./service";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const row = (patch: Partial<TicketRow> = {}): TicketRow => ({
  id: A,
  tenantId: B,
  number: "TKT-0001",
  seq: 1,
  requesterUserId: null,
  requesterName: "Priya",
  requesterPhone: "+919876543210",
  requesterEmail: null,
  subject: "Where is my order?",
  status: "open",
  priority: "normal",
  channel: "web",
  assigneeId: B,
  tags: ["delivery"],
  relatedType: "order",
  relatedId: "ORD/26-27/0001",
  firstResponseAt: null,
  resolvedAt: null,
  closedAt: null,
  slaDueAt: new Date("2026-10-15T10:00:00Z"),
  slaBreached: false,
  mergedIntoId: null,
  lastMessageAt: new Date("2026-10-15T08:00:00Z"),
  createdAt: new Date("2026-10-15T08:00:00Z"),
  updatedAt: new Date("2026-10-15T08:00:00Z"),
  ...patch,
});

describe("numbering", () => {
  it("formats TKT-0001 and grows past four digits", () => {
    expect(formatTicketNumber("TKT", 1)).toBe("TKT-0001");
    expect(formatTicketNumber("TKT", 42)).toBe("TKT-0042");
    expect(formatTicketNumber("HD", 9999)).toBe("HD-9999");
    expect(formatTicketNumber("TKT", 12345)).toBe("TKT-12345");
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(() => formatTicketNumber("TKT", bad)).toThrow(RangeError);
  });

  it("parses typed numbers for search", () => {
    expect(parseTicketNumber("TKT-0007")).toBe(7);
    expect(parseTicketNumber("#tkt-7")).toBe(7);
    expect(parseTicketNumber("0012")).toBe(12);
    expect(parseTicketNumber("12")).toBe(12);
    expect(parseTicketNumber("refund")).toBeNull();
    expect(parseTicketNumber("TKT-0000")).toBeNull();
  });
});

describe("status transitions", () => {
  it("follow the table; closed is final; same status is a no-op", () => {
    expect(TICKET_TRANSITIONS.closed).toEqual([]);
    for (const s of TICKET_STATUSES) expect(canTransition(s, s)).toBe(true);
    expect(canTransition("open", "pending")).toBe(true);
    expect(canTransition("open", "resolved")).toBe(true);
    expect(canTransition("pending", "open")).toBe(true);
    expect(canTransition("resolved", "open")).toBe(true);
    expect(canTransition("resolved", "pending")).toBe(false);
    expect(canTransition("closed", "open")).toBe(false);
    expect(canTransition("closed", "resolved")).toBe(false);
  });

  it("sets and clears the resolved/closed timestamps", () => {
    const now = new Date("2026-10-15T00:00:00Z");
    expect(statusTimestamps("resolved", now)).toEqual({ resolvedAt: now, closedAt: null });
    expect(statusTimestamps("closed", now)).toEqual({ closedAt: now });
    expect(statusTimestamps("open", now)).toEqual({ resolvedAt: null, closedAt: null });
  });

  it("messages move the status", () => {
    // Requester replies reopen.
    expect(statusAfterMessage("open", "requester", "reply")).toBe("open");
    expect(statusAfterMessage("pending", "requester", "reply")).toBe("open");
    expect(statusAfterMessage("resolved", "requester", "reply")).toBe("open");
    expect(statusAfterMessage("closed", "requester", "reply")).toBeNull();
    // Staff replies wait on the customer by default, or take the chosen status.
    expect(statusAfterMessage("open", "staff", "reply")).toBe("pending");
    expect(statusAfterMessage("pending", "staff", "reply")).toBe("pending");
    expect(statusAfterMessage("resolved", "staff", "reply")).toBe("resolved");
    expect(statusAfterMessage("open", "staff", "reply", "resolved")).toBe("resolved");
    expect(statusAfterMessage("open", "staff", "reply", "open")).toBe("open");
    expect(statusAfterMessage("resolved", "staff", "reply", "pending")).toBeNull();
    expect(statusAfterMessage("closed", "staff", "reply")).toBeNull();
    // Notes change nothing (unless asked), even on closed tickets.
    expect(statusAfterMessage("open", "staff", "note")).toBe("open");
    expect(statusAfterMessage("closed", "staff", "note")).toBe("closed");
    expect(statusAfterMessage("open", "staff", "note", "resolved")).toBe("resolved");
  });
});

describe("visibility", () => {
  const msg = (patch: Partial<Message>): Message => ({
    id: "m",
    ticketId: A,
    authorId: B,
    authorKind: "staff",
    kind: "reply",
    body: "Hi",
    attachments: [],
    createdAt: new Date(0),
    ...patch,
  });

  it("internal notes and system lines never reach the requester", () => {
    const thread = [
      msg({ id: "1", authorKind: "requester", authorId: null, body: "Where is it?" }),
      msg({ id: "2", kind: "note", body: "Courier lost it, call them" }),
      msg({ id: "3", body: "It ships today" }),
      msg({ id: "4", kind: "note", authorKind: "system", body: "Merged TKT-0002" }),
      msg({ id: "5", kind: "reply", authorKind: "system", body: "auto" }),
    ];
    const pub = publicMessages(thread);
    expect(pub.map((m) => m.id)).toEqual(["1", "3"]);
    expect(pub.map((m) => m.from)).toEqual(["requester", "staff"]);
    expect(JSON.stringify(pub)).not.toContain("Courier lost it");
    expect(pub[1]).not.toHaveProperty("authorId");
    expect(pub[1]).not.toHaveProperty("kind");
    expect(isRequesterVisible({ kind: "note", authorKind: "staff" })).toBe(false);
  });

  it("public tickets hide assignee, tags, priority and SLA", () => {
    const t = toTicket(row(), new Date("2026-10-15T11:00:00Z"));
    expect(t).toMatchObject({ overdue: true, assigneeId: B, related: { type: "order", id: "ORD/26-27/0001" } });
    const pub = toPublicTicket(t, "TKT-0009");
    for (const k of ["assigneeId", "tags", "priority", "slaDueAt", "slaBreached", "overdue", "requester", "firstResponseAt", "mergedIntoId"]) {
      expect(pub).not.toHaveProperty(k);
    }
    expect(pub).toMatchObject({ number: "TKT-0001", status: "open", mergedInto: "TKT-0009" });
  });

  it("requesters own tickets by account or verified phone", () => {
    const user = { kind: "user" as const, userId: A };
    const guest = { kind: "guest" as const, phone: "+919876543210", name: null };
    expect(ownsTicket(row({ requesterUserId: A }), user)).toBe(true);
    expect(ownsTicket(row({ requesterUserId: B }), user)).toBe(false);
    expect(ownsTicket(row({ requesterUserId: null }), user)).toBe(false);
    expect(ownsTicket(row(), guest)).toBe(true);
    expect(ownsTicket(row({ requesterPhone: "+919000000000" }), guest)).toBe(false);
    expect(ownsTicket(row({ requesterPhone: null }), guest)).toBe(false);
  });

  it("only the same customer's tickets merge", () => {
    expect(sameRequester(row(), row({ requesterName: "Other" }))).toBe(true);
    expect(sameRequester(row({ requesterPhone: null, requesterUserId: A }), row({ requesterPhone: null, requesterUserId: A }))).toBe(true);
    expect(sameRequester(row({ requesterPhone: null, requesterEmail: "P@x.in" }), row({ requesterPhone: null, requesterEmail: "p@x.in" }))).toBe(true);
    expect(sameRequester(row(), row({ requesterPhone: "+919000000000" }))).toBe(false);
    expect(sameRequester(row({ requesterPhone: null }), row({ requesterPhone: null }))).toBe(false);
  });

  it("message targets: WhatsApp for Indian mobiles, email when known", () => {
    expect(contactTargets({ phone: "98765 43210", email: "a@b.in" })).toEqual([
      { channel: "whatsapp", to: "+919876543210" },
      { channel: "email", to: "a@b.in" },
    ]);
    expect(contactTargets({ phone: "12345" })).toEqual([]);
  });
});

describe("input", () => {
  it("strips raw HTML from bodies and needs text", () => {
    const t = publicTicketInputSchema.parse({ subject: " Late order ", body: "<script>x()</script>**Help** <b>me</b>" });
    expect(t).toMatchObject({ subject: "Late order", body: "x()**Help** me", attachments: [] });
    expect(() => publicTicketInputSchema.parse({ subject: "Late", body: "<br/>" })).toThrow(ZodError);
    expect(() => publicTicketInputSchema.parse({ subject: "x", body: "hi" })).toThrow(ZodError);
    expect(() => publicTicketInputSchema.parse({ subject: "Late", body: "hi", attachments: ["javascript:alert(1)"] })).toThrow(ZodError);
  });

  it("staff messages default to replies; tags are normalised", () => {
    expect(staffMessageInputSchema.parse({ body: "Done" })).toEqual({ kind: "reply", body: "Done", attachments: [] });
    expect(staffMessageInputSchema.parse({ kind: "note", body: "x", status: "resolved" }).kind).toBe("note");
    expect(() => staffMessageInputSchema.parse({ kind: "secret", body: "x" })).toThrow(ZodError);
    expect(tagsSchema.parse(["Refund", " refund ", "Late Delivery"])).toEqual(["refund", "late-delivery"]);
  });

  it("staff tickets need a requester", () => {
    expect(() => staffTicketInputSchema.parse({ subject: "Call", body: "x" })).toThrow(ZodError);
    expect(staffTicketInputSchema.parse({ subject: "Call", body: "x", name: "Ravi", phone: "9876543210" })).toMatchObject({ channel: "phone", priority: "normal" });
  });

  it("list queries take comma lists, me/none and booleans", () => {
    expect(ticketListQuerySchema.parse({ status: "open,pending", assignee: "me", overdue: "true" })).toMatchObject({
      status: ["open", "pending"],
      assignee: ["me"],
      overdue: true,
      limit: 50,
      offset: 0,
    });
    expect(() => ticketListQuerySchema.parse({ status: "lost" })).toThrow(ZodError);
    expect(() => ticketListQuerySchema.parse({ assignee: "bob" })).toThrow(ZodError);
  });

  it("counts every status", () => {
    expect(statusCounts([{ status: "open", count: "3" }, { status: "closed", count: 1 }, { status: "weird", count: 9 }])).toEqual({ open: 3, pending: 0, resolved: 0, closed: 1 });
  });
});

describe("csv", () => {
  it("one row per ticket with IST times and formula-safe text", () => {
    const csv = ticketsCsv([toTicket(row({ subject: "=HYPERLINK(1)" }), new Date("2026-10-15T09:00:00Z"))]);
    expect(csv.startsWith("﻿Ticket,Created (IST)")).toBe(true);
    const [, line] = csv.trim().split("\r\n");
    expect(line).toContain("TKT-0001,2026-10-15 13:30,'=HYPERLINK(1),open,normal,web,Priya,'+919876543210");
  });
});
