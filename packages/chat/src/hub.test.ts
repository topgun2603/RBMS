import { describe, expect, it } from "vitest";
import { ChatHub, StreamConnection, type ChatEnvelope } from "./hub";
import type { Viewer } from "./logic";
import { MemoryPubSub } from "./pubsub";
import { parseSse } from "./sse";

const T = "t1";
const v = (userId: string, canManage = false, isStaff = canManage, tenantId = T): Viewer => ({ tenantId, userId, isStaff, canManage });

function conn(viewer: Viewer) {
  const frames: string[] = [];
  const c = new StreamConnection(viewer, (f) => frames.push(f));
  return { c, events: () => parseSse(frames.join("")) };
}

const env = (patch: Partial<ChatEnvelope>): ChatEnvelope => ({
  tenantId: T,
  event: "message",
  data: { n: 1 },
  recipients: [],
  shopFacing: false,
  ...patch,
});

describe("ChatHub", () => {
  it("delivers to recipients' streams in the same tenant, every tab, once each", async () => {
    const pubsub = new MemoryPubSub();
    const hub = new ChatHub(pubsub);
    await hub.start();
    await hub.start(); // idempotent
    expect(pubsub.listeners("chat.events")).toBe(1);

    const a1 = conn(v("a"));
    const a2 = conn(v("a"));
    const b = conn(v("b"));
    const otherTenant = conn(v("a", false, false, "t2"));
    const mgr = conn(v("m", true));
    for (const x of [a1, a2, b, otherTenant, mgr]) {
      hub.add(x.c);
      x.c.goLive();
    }

    await hub.publish(env({ recipients: ["a"], id: "1_x" }));
    expect(a1.events()).toEqual([{ event: "message", data: '{"n":1}', id: "1_x" }]);
    expect(a2.events()).toHaveLength(1);
    expect(b.events()).toHaveLength(0);
    expect(otherTenant.events()).toHaveLength(0);
    expect(mgr.events()).toHaveLength(0); // not shop-facing

    // shop-facing: managers get it too, but a manager who is also a recipient gets it once
    await hub.publish(env({ recipients: ["a", "m"], shopFacing: true, event: "read" }));
    expect(mgr.events().map((e) => e.event)).toEqual(["read"]);
    expect(b.events()).toHaveLength(0);

    // exclude (typing): not echoed to the typist, even as manager
    await hub.publish(env({ recipients: ["a", "m"], shopFacing: true, event: "typing", exclude: ["m"] }));
    expect(mgr.events()).toHaveLength(1);
    expect(a1.events().map((e) => e.event)).toEqual(["message", "read", "typing"]);

    expect(hub.connections).toBe(5);
    expect(hub.presence.isOnline(T, "a")).toBe(true);
    hub.remove(a1.c);
    hub.remove(a2.c);
    hub.remove(a2.c); // twice is harmless
    expect(hub.presence.isOnline(T, "a")).toBe(false);
    expect(hub.managerOnline(T)).toBe(true);
    hub.remove(mgr.c);
    expect(hub.managerOnline(T)).toBe(false);

    await hub.stop();
    expect(pubsub.listeners("chat.events")).toBe(0);
  });

  it("buffers live events during replay and drops the ones already replayed", () => {
    const hub = new ChatHub(new MemoryPubSub());
    const a = conn(v("a"));
    hub.add(a.c);
    hub.dispatch(env({ recipients: ["a"], id: "2_dup", data: "dup" }));
    hub.dispatch(env({ recipients: ["a"], event: "typing", data: "t" }));
    expect(a.events()).toHaveLength(0); // still buffering
    a.c.send("event: message\nid: 2_dup\ndata: replayed\n\n");
    a.c.goLive(new Set(["2_dup"]));
    expect(a.events().map((e) => e.data)).toEqual(["replayed", "t"]);
    hub.dispatch(env({ recipients: ["a"], data: "live" }));
    expect(a.events().map((e) => e.data)).toEqual(["replayed", "t", "live"]);
  });

  it("ignores junk on the channel and survives a writer that throws", async () => {
    const pubsub = new MemoryPubSub();
    const hub = new ChatHub(pubsub);
    await hub.start();
    await pubsub.publish("chat.events", "not json");
    const bad = new StreamConnection(v("a"), () => {
      throw new Error("socket gone");
    });
    const good = conn(v("a"));
    hub.add(bad);
    hub.add(good.c);
    bad.goLive();
    good.c.goLive();
    await hub.publish(env({ recipients: ["a"] }));
    expect(bad.isClosed).toBe(true);
    expect(good.events()).toHaveLength(1);
  });

  it("falls back to local delivery when publishing fails", async () => {
    const hub = new ChatHub({ publish: async () => Promise.reject(new Error("redis down")), subscribe: async () => () => {} });
    const a = conn(v("a"));
    hub.add(a.c);
    a.c.goLive();
    await hub.publish(env({ recipients: ["a"] }));
    expect(a.events()).toHaveLength(1);
  });
});

describe("MemoryPubSub", () => {
  it("fans out per channel and unsubscribes", async () => {
    const ps = new MemoryPubSub();
    const got: string[] = [];
    const un1 = await ps.subscribe("c", (m) => got.push(`1:${m}`));
    await ps.subscribe("c", (m) => got.push(`2:${m}`));
    await ps.subscribe("other", (m) => got.push(`o:${m}`));
    await ps.publish("c", "x");
    await un1();
    await ps.publish("c", "y");
    await ps.publish("none", "z");
    expect(got).toEqual(["1:x", "2:x", "2:y"]);
  });
});
