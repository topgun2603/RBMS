import type { Db } from "@rbms/db";
import { describe, expect, it, vi } from "vitest";
import { StreamConnection } from "./hub";
import { toMessage, type Viewer } from "./logic";
import type { ChatNotification } from "./ports";
import { isOffline, NotifyThrottle, Presence } from "./presence";
import type { ConversationRow, MessageRow, ParticipantRow } from "./schema";
import { ChatService } from "./service";

describe("isOffline", () => {
  it("no stream for 60 s", () => {
    expect(isOffline(undefined, 0)).toBe(true); // never connected
    expect(isOffline({ open: 1, lastClosedAt: null }, 1e9)).toBe(false);
    expect(isOffline({ open: 0, lastClosedAt: 1000 }, 60_999)).toBe(false); // closed 59.999 s ago
    expect(isOffline({ open: 0, lastClosedAt: 1000 }, 61_000)).toBe(true);
    expect(isOffline({ open: 0, lastClosedAt: null }, 0)).toBe(true);
    expect(isOffline({ open: 0, lastClosedAt: 1000 }, 2000, 500)).toBe(true);
  });
});

describe("Presence", () => {
  it("tracks several tabs and the moment the last one closed", () => {
    let now = 0;
    const p = new Presence(() => now);
    expect(p.isOffline("t", "u")).toBe(true);
    p.connected("t", "u");
    p.connected("t", "u");
    expect(p.isOnline("t", "u")).toBe(true);
    now = 10_000;
    p.disconnected("t", "u");
    expect(p.isOnline("t", "u")).toBe(true); // one tab still open
    now = 20_000;
    p.disconnected("t", "u");
    expect(p.state("t", "u")).toEqual({ open: 0, lastClosedAt: 20_000 });
    now = 79_999;
    expect(p.isOffline("t", "u")).toBe(false);
    now = 80_000;
    expect(p.isOffline("t", "u")).toBe(true);
    expect(p.isOffline("t2", "u")).toBe(true); // per tenant
    p.disconnected("t", "nobody"); // harmless
  });
});

describe("NotifyThrottle", () => {
  it("one per key per cooldown, resettable", () => {
    let now = 0;
    const th = new NotifyThrottle(600_000, () => now);
    expect(th.take("k")).toBe(true);
    expect(th.take("k")).toBe(false);
    expect(th.take("other")).toBe(true);
    now = 599_999;
    expect(th.take("k")).toBe(false);
    now = 600_000;
    expect(th.take("k")).toBe(true);
    th.reset("k");
    expect(th.take("k")).toBe(true);
  });
});

describe("offline notification decision", () => {
  const T = "11111111-1111-4111-8111-111111111111";
  const conv: ConversationRow = {
    id: "c1",
    tenantId: T,
    type: "support",
    subjectType: null,
    subjectId: null,
    title: null,
    lastMessageAt: null,
    lastMessagePreview: null,
    createdBy: "shopper",
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
  const part = (userId: string, kind: ParticipantRow["kind"], muted = false): ParticipantRow => ({
    tenantId: T,
    conversationId: "c1",
    userId,
    kind,
    muted,
    lastReadAt: null,
    joinedAt: new Date(0),
  });
  const row = (senderId: string): MessageRow => ({
    id: "00000000-0000-4000-8000-000000000001",
    tenantId: T,
    conversationId: "c1",
    senderId,
    body: "hello",
    attachments: [],
    replyTo: null,
    editedAt: null,
    deletedAt: null,
    createdAt: new Date(0),
  });
  const shopper: Viewer = { tenantId: T, userId: "shopper", isStaff: false, canManage: false };
  const staffA: Viewer = { tenantId: T, userId: "staffA", isStaff: true, canManage: true };

  function setup() {
    let now = 1_000_000;
    const sent: ChatNotification[] = [];
    const notifier = { notify: vi.fn(async (n: ChatNotification) => void sent.push(n)) };
    const directory = { kindOf: async () => null, names: async (_t: string, ids: string[]) => Object.fromEntries(ids.map((i) => [i, `Name ${i}`])) };
    const service = new ChatService({ db: {} as Db, notifier, directory, now: () => new Date(now) });
    return { service, sent, notifier, tick: (ms: number) => (now += ms) };
  }

  it("notifies offline, unmuted recipients once per cooldown; never the sender", async () => {
    const { service, sent, tick } = setup();
    const parts = [part("shopper", "shopper"), part("staffA", "staff"), part("staffB", "staff", true)];
    await service.notifyOffline(shopper, conv, parts, toMessage(row("shopper")), "hello");
    expect(sent).toEqual([
      expect.objectContaining({ audience: "user", recipientUserId: "staffA", template: "chat.message", senderName: "Name shopper", preview: "hello" }),
    ]);
    await service.notifyOffline(shopper, conv, parts, toMessage(row("shopper")), "again");
    expect(sent).toHaveLength(1); // cooldown
    tick(10 * 60_000);
    await service.notifyOffline(shopper, conv, parts, toMessage(row("shopper")), "later");
    expect(sent).toHaveLength(2);
  });

  it("skips recipients with an open stream or one closed less than 60 s ago", async () => {
    const { service, sent, tick } = setup();
    const conn = new StreamConnection(staffA, () => {});
    service.hub.add(conn);
    const parts = [part("shopper", "shopper"), part("staffA", "staff")];
    await service.notifyOffline(shopper, conv, parts, toMessage(row("shopper")), "hi");
    expect(sent).toHaveLength(0);
    service.hub.remove(conn);
    tick(30_000);
    await service.notifyOffline(shopper, conv, parts, toMessage(row("shopper")), "hi");
    expect(sent).toHaveLength(0);
    tick(30_000);
    await service.notifyOffline(shopper, conv, parts, toMessage(row("shopper")), "hi");
    expect(sent.map((n) => n.recipientUserId)).toEqual(["staffA"]);
  });

  it("asks the shop when a shopper writes and no staff has joined and no manager is online", async () => {
    const { service, sent } = setup();
    await service.notifyOffline(shopper, conv, [part("shopper", "shopper")], toMessage(row("shopper")), "anyone?");
    expect(sent).toEqual([expect.objectContaining({ audience: "shop", recipientUserId: null, conversationId: "c1" })]);

    const online = setup();
    online.service.hub.add(new StreamConnection(staffA, () => {}));
    await online.service.notifyOffline(shopper, conv, [part("shopper", "shopper")], toMessage(row("shopper")), "anyone?");
    expect(online.sent).toHaveLength(0);

    // staff replying in a support conversation never triggers the shop audience
    const reply = setup();
    await reply.service.notifyOffline(staffA, conv, [part("shopper", "shopper"), part("staffA", "staff")], toMessage(row("staffA")), "hi");
    expect(reply.sent.map((n) => [n.audience, n.recipientUserId])).toEqual([["user", "shopper"]]);
  });

  it("a failing notifier doesn't throw", async () => {
    const service = new ChatService({ db: {} as Db, notifier: { notify: async () => Promise.reject(new Error("down")) } });
    await expect(service.notifyOffline(shopper, conv, [part("staffA", "staff")], toMessage(row("shopper")), "x")).resolves.toBeUndefined();
  });
});
