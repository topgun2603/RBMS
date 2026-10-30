import { emptyContext, type RequestContext, type UserRef } from "@rbms/core";
import { describe, expect, it } from "vitest";
import {
  accessTo,
  assertCanCreate,
  awaitingReplyCount,
  canDelete,
  canEdit,
  createConversationSchema,
  decodeCursor,
  encodeCursor,
  isAllowedUrl,
  isBefore,
  messageInputSchema,
  pageOf,
  previewOf,
  toMessage,
  unreadCount,
  viewerFromContext,
  type Viewer,
} from "./logic";
import type { MessageRow } from "./schema";

const T = "11111111-1111-4111-8111-111111111111";
const shopper: Viewer = { tenantId: T, userId: "shopper", isStaff: false, canManage: false };
const staff: Viewer = { tenantId: T, userId: "staff", isStaff: true, canManage: false };
const manager: Viewer = { tenantId: T, userId: "manager", isStaff: true, canManage: true };

describe("viewerFromContext", () => {
  const tenant = { id: T, slug: "sri", planId: null, appId: null };
  const ctx = (user: UserRef | null): RequestContext => ({ ...emptyContext(), tenant, user });
  const u = (tenantRoles: string[], permissions: string[] = [], platformRoles: string[] = []): UserRef => ({
    id: "u",
    sessionId: "s",
    tenantRoles,
    permissions,
    platformRoles,
  });

  it("shoppers are not staff; staff manage only with chat.manage; owners and super-admins always", () => {
    expect(viewerFromContext(ctx(u([])))).toEqual({ tenantId: T, userId: "u", isStaff: false, canManage: false });
    expect(viewerFromContext(ctx(u(["member"], ["*"])))).toMatchObject({ isStaff: false, canManage: false });
    expect(viewerFromContext(ctx(u(["staff"], ["orders.manage"])))).toMatchObject({ isStaff: true, canManage: false });
    expect(viewerFromContext(ctx(u(["staff"], ["chat.manage"])))).toMatchObject({ isStaff: true, canManage: true });
    expect(viewerFromContext(ctx(u(["staff"], ["chat.*"])))).toMatchObject({ canManage: true });
    expect(viewerFromContext(ctx(u(["owner"])))).toMatchObject({ isStaff: true, canManage: true });
    expect(viewerFromContext(ctx(u([], [], ["superadmin"])))).toMatchObject({ isStaff: true, canManage: true });
  });

  it("needs a user and a tenant", () => {
    expect(() => viewerFromContext(ctx(null))).toThrow(expect.objectContaining({ status: 401 }));
    expect(() => viewerFromContext({ ...emptyContext(), user: u(["owner"]) })).toThrow(expect.objectContaining({ status: 403 }));
  });
});

describe("access rules", () => {
  it("participants see their conversations", () => {
    for (const type of ["direct", "support", "order", "group"] as const) {
      expect(accessTo({ type }, ["shopper", "x"], shopper)).toBe("participant");
      expect(accessTo({ type }, ["staff"], staff)).toBe("participant");
    }
  });

  it("chat.manage staff also see every support and order conversation, but not others' direct or group ones", () => {
    expect(accessTo({ type: "support" }, ["shopper"], manager)).toBe("manager");
    expect(accessTo({ type: "order" }, ["shopper"], manager)).toBe("manager");
    expect(accessTo({ type: "direct" }, ["a", "b"], manager)).toBeNull();
    expect(accessTo({ type: "group" }, ["a", "b"], manager)).toBeNull();
  });

  it("plain staff and other shoppers see nothing they're not in", () => {
    expect(accessTo({ type: "support" }, ["shopper"], staff)).toBeNull();
    expect(accessTo({ type: "support" }, ["someone"], shopper)).toBeNull();
    // a shopper flagged canManage by mistake is still not staff
    expect(accessTo({ type: "support" }, ["someone"], { ...shopper, canManage: true })).toBeNull();
  });

  it("shoppers can only open conversations with the shop", () => {
    expect(() => assertCanCreate(shopper, "support")).not.toThrow();
    expect(() => assertCanCreate(shopper, "order")).not.toThrow();
    expect(() => assertCanCreate(shopper, "direct", ["staff"])).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => assertCanCreate(shopper, "group", ["staff"])).toThrow(expect.objectContaining({ status: 403 }));
  });

  it("staff talk to staff/vendors directly, to shoppers only through shop-facing conversations", () => {
    expect(() => assertCanCreate(staff, "direct", ["staff"])).not.toThrow();
    expect(() => assertCanCreate(staff, "group", ["staff", "vendor"])).not.toThrow();
    expect(() => assertCanCreate(staff, "order")).not.toThrow();
    expect(() => assertCanCreate(staff, "direct", ["shopper"])).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => assertCanCreate(staff, "direct", [null])).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => assertCanCreate(staff, "support")).toThrow(expect.objectContaining({ status: 400 }));
  });

  it("edit own messages within 15 minutes; never deleted ones", () => {
    const createdAt = new Date("2026-10-15T10:00:00Z");
    const msg = { senderId: "staff", createdAt, deletedAt: null };
    expect(canEdit(msg, staff, new Date("2026-10-15T10:15:00Z"))).toBe(true);
    expect(canEdit(msg, staff, new Date("2026-10-15T10:15:00.001Z"))).toBe(false);
    expect(canEdit(msg, manager, new Date("2026-10-15T10:01:00Z"))).toBe(false);
    expect(canEdit({ ...msg, deletedAt: createdAt }, staff, createdAt)).toBe(false);
  });

  it("delete own any time; managers may remove messages in shop-facing conversations", () => {
    const msg = { senderId: "shopper", createdAt: new Date(0), deletedAt: null };
    expect(canDelete(msg, { type: "support" }, shopper)).toBe(true);
    expect(canDelete(msg, { type: "support" }, manager)).toBe(true);
    expect(canDelete(msg, { type: "support" }, staff)).toBe(false);
    expect(canDelete(msg, { type: "direct" }, manager)).toBe(false);
    expect(canDelete({ ...msg, deletedAt: new Date() }, { type: "support" }, shopper)).toBe(false);
  });
});

describe("unreadCount", () => {
  const at = (s: string) => new Date(`2026-10-15T10:00:${s}Z`);
  const msgs = [
    { senderId: "a", createdAt: at("01"), deletedAt: null },
    { senderId: "me", createdAt: at("02"), deletedAt: null },
    { senderId: "a", createdAt: at("03"), deletedAt: null },
    { senderId: "b", createdAt: at("04"), deletedAt: at("05") },
    { senderId: "b", createdAt: at("06"), deletedAt: null },
  ];

  it("counts others' live messages after last read", () => {
    expect(unreadCount(msgs, "me", null)).toBe(3);
    expect(unreadCount(msgs, "me", at("01"))).toBe(2);
    expect(unreadCount(msgs, "me", at("03"))).toBe(1);
    expect(unreadCount(msgs, "me", at("06"))).toBe(0);
    expect(unreadCount(msgs, "a", null)).toBe(2); // me's and b's live one; b's deleted one doesn't count
    expect(unreadCount([], "me", null)).toBe(0);
  });

  it("managers who haven't joined see how many messages wait for a staff reply", () => {
    const thread = [
      { senderId: "shopper", createdAt: at("01"), deletedAt: null },
      { senderId: "staff1", createdAt: at("02"), deletedAt: null },
      { senderId: "shopper", createdAt: at("03"), deletedAt: null },
      { senderId: "shopper", createdAt: at("04"), deletedAt: at("05") },
      { senderId: "shopper", createdAt: at("06"), deletedAt: null },
    ];
    expect(awaitingReplyCount(thread, "mgr", new Set(["staff1"]))).toBe(2);
    expect(awaitingReplyCount(thread, "mgr", new Set())).toBe(4); // no staff participant: every live message waits
    expect(awaitingReplyCount([...thread, { senderId: "staff1", createdAt: at("07"), deletedAt: null }], "mgr", new Set(["staff1"]))).toBe(0);
  });
});

describe("cursors and pages", () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

  it("round-trips and rejects junk", () => {
    const m = { createdAt: new Date("2026-10-15T10:00:00.123Z"), id: id(7) };
    const c = encodeCursor(m);
    expect(c).toBe(`${m.createdAt.getTime()}_${id(7)}`);
    expect(decodeCursor(c)).toEqual({ at: m.createdAt, id: id(7) });
    expect(decodeCursor(c.toUpperCase())).toEqual({ at: m.createdAt, id: id(7) });
    for (const bad of [null, "", "abc", "123", `x_${id(1)}`, "123_not-a-uuid", `12_${id(1)}_x`]) expect(decodeCursor(bad)).toBeNull();
  });

  it("orders by time then id", () => {
    const c = { at: new Date(1000), id: id(5) };
    expect(isBefore({ createdAt: new Date(999), id: id(9) }, c)).toBe(true);
    expect(isBefore({ createdAt: new Date(1000), id: id(4) }, c)).toBe(true);
    expect(isBefore({ createdAt: new Date(1000), id: id(5) }, c)).toBe(false);
    expect(isBefore({ createdAt: new Date(1000), id: id(6) }, c)).toBe(false);
  });

  it("pages newest-first rows into oldest-first pages with a cursor to the next older page", () => {
    // 7 messages, ids 1..7 at t = 1..7 s; the DB returns newest first with limit + 1
    const all = Array.from({ length: 7 }, (_, i) => ({ id: id(i + 1), createdAt: new Date((i + 1) * 1000) }));
    const fetch = (before: string | null, limit: number) => {
      const c = decodeCursor(before);
      return all
        .filter((m) => !c || isBefore(m, c))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit + 1);
    };
    const p1 = pageOf(fetch(null, 3), 3);
    expect(p1.rows.map((r) => r.id)).toEqual([id(5), id(6), id(7)]);
    expect(p1.nextCursor).toBe(encodeCursor(all[4]!));
    const p2 = pageOf(fetch(p1.nextCursor, 3), 3);
    expect(p2.rows.map((r) => r.id)).toEqual([id(2), id(3), id(4)]);
    const p3 = pageOf(fetch(p2.nextCursor, 3), 3);
    expect(p3.rows.map((r) => r.id)).toEqual([id(1)]);
    expect(p3.nextCursor).toBeNull();
    // exactly `limit` rows left → no further page
    expect(pageOf(fetch(null, 7), 7).nextCursor).toBeNull();
    expect(pageOf([], 10)).toEqual({ rows: [], nextCursor: null });
  });
});

describe("inputs", () => {
  it("accepts http(s) and site-relative attachment URLs only", () => {
    for (const ok of ["https://cdn.example.com/a.jpg", "http://localhost:4000/uploads/x.png", "/uploads/t/abc.jpg", "/a?b=c"]) {
      expect([ok, isAllowedUrl(ok)]).toEqual([ok, true]);
    }
    for (const bad of ["javascript:alert(1)", "data:image/png;base64,AAA", "//evil.com/x", "/\\evil.com", "ftp://x/y", "uploads/x.jpg", "https://", "https://a b.com/x", "", `/${"a".repeat(2001)}`]) {
      expect([bad, isAllowedUrl(bad)]).toEqual([bad, false]);
    }
  });

  it("messages need text or an attachment; body ≤ 4000 after trimming", () => {
    expect(messageInputSchema.parse({ body: "  hi  " })).toEqual({ body: "hi", attachments: [] });
    expect(messageInputSchema.parse({ attachments: [{ url: "/u/x.jpg", type: "image" }] }).attachments).toEqual([{ url: "/u/x.jpg", type: "image" }]);
    expect(messageInputSchema.safeParse({ body: "   " }).success).toBe(false);
    expect(messageInputSchema.safeParse({}).success).toBe(false);
    expect(messageInputSchema.safeParse({ body: "x".repeat(4000) }).success).toBe(true);
    expect(messageInputSchema.safeParse({ body: "x".repeat(4001) }).success).toBe(false);
    expect(messageInputSchema.safeParse({ body: "hi", attachments: [{ url: "javascript:x" }] }).success).toBe(false);
    expect(messageInputSchema.safeParse({ body: "hi", attachments: Array(11).fill({ url: "/a" }) }).success).toBe(false);
    expect(messageInputSchema.safeParse({ body: "hi", replyTo: "nope" }).success).toBe(false);
  });

  it("validates conversation kinds", () => {
    expect(createConversationSchema.parse({ type: "support" })).toEqual({ type: "support" });
    expect(createConversationSchema.safeParse({ type: "order" }).success).toBe(false);
    expect(createConversationSchema.safeParse({ type: "group", title: "x", userIds: [] }).success).toBe(false);
    expect(createConversationSchema.safeParse({ type: "nope" }).success).toBe(false);
  });

  it("previews", () => {
    expect(previewOf("  hello \n  world ", [])).toBe("hello world");
    expect(previewOf("x".repeat(200), [])).toHaveLength(140);
    expect(previewOf("", [{ url: "/a", type: "image" }])).toBe("[photo]");
    expect(previewOf("", [{ url: "/a", type: "file" }])).toBe("[attachment]");
  });

  it("deleted messages are tombstones", () => {
    const row: MessageRow = {
      id: "00000000-0000-4000-8000-000000000001",
      tenantId: T,
      conversationId: "c",
      senderId: "a",
      body: "secret",
      attachments: [{ url: "/a", type: "image" }],
      replyTo: null,
      editedAt: null,
      deletedAt: new Date(2000),
      createdAt: new Date(1000),
    };
    expect(toMessage(row)).toMatchObject({ body: "", attachments: [], deletedAt: new Date(2000).toISOString(), cursor: `1000_${row.id}` });
    expect(toMessage({ ...row, deletedAt: null })).toMatchObject({ body: "secret", deletedAt: null });
  });
});
