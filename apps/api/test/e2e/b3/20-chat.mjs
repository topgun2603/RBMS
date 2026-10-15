// A2 chat: shopper ↔ shop support conversation, SSE streams (stream token + Authorization header), unread counts.
import { API, RUN, STORE, call, eq, expect, fails, ok, readSse, signIn, step, testPhone, tokens } from "./lib.mjs";

const ORIGIN = "http://e2e-store.localhost:3003";
const owner = { as: "owner", tenant: STORE };
const shopper = { as: "chatShopper", tenant: STORE };

/** Opens a stream and, once `ready` arrives, runs `action`; stops when `want(events)` holds. */
async function streamWhile(url, headers, action, want, ms = 10_000) {
  let fired = false;
  let actionError = null;
  const r = await readSse(url, {
    headers,
    ms,
    until: (events) => {
      if (!fired && events.some((e) => e.event === "ready")) {
        fired = true;
        Promise.resolve()
          .then(action)
          .catch((e) => (actionError = e));
      }
      return want(events);
    },
  });
  if (actionError) throw actionError;
  return r;
}

const convOf = async (who, id) => {
  const list = ok(await call("GET", "/v1/chat/conversations", undefined, who), "list conversations");
  return list.items.find((c) => c.id === id);
};

export default async function () {
  const phone = testPhone(2);
  let conv;
  const first = `E2E B3 ${RUN} hello from the shopper`;
  const reply = `E2E B3 ${RUN} owner reply`;

  await step("chat: shopper signs in and opens a support conversation", async () => {
    await signIn("chatShopper", phone, STORE, `E2E B3 ${RUN} Chat`);
    const c = ok(await call("POST", "/v1/chat/conversations", { type: "support", title: `E2E B3 ${RUN}` }, shopper), "create");
    eq(c.type, "support", "type");
    eq(c.created, true, "created");
    const again = ok(await call("POST", "/v1/chat/conversations", { type: "support" }, shopper), "create again");
    eq(again.id, c.id, "support conversation reused");
    eq(again.created, false, "not created twice");
    conv = c;
    return `${phone} → ${c.id}`;
  });

  await step("chat: shopper cannot open a direct conversation", async () => {
    fails(await call("POST", "/v1/chat/conversations", { type: "direct", userId: "00000000-0000-4000-8000-000000000000" }, shopper), 403, null, "direct");
    return "403";
  });

  await step("chat: owner (chat.manage) sees the support conversation", async () => {
    const c = await convOf(owner, conv.id);
    expect(c, "conversation missing from the owner's list");
    eq(c.joined, false, "owner not joined yet");
    return `listed, ${c.participants.length} participant(s)`;
  });

  await step("chat: stream token SSE with CORS receives the shopper's message", async () => {
    const t = ok(await call("POST", "/v1/chat/stream-token", {}, owner), "stream token");
    expect(typeof t.token === "string", `no token: ${JSON.stringify(t)}`);
    const url = `${API}/v1/chat/stream?token=${encodeURIComponent(t.token)}`;
    const r = await streamWhile(
      url,
      { origin: ORIGIN },
      async () => ok(await call("POST", `/v1/chat/conversations/${conv.id}/messages`, { body: first }, shopper), "shopper sends"),
      (events) => events.some((e) => e.event === "message" && e.data?.message?.body === first),
    );
    eq(r.status, 200, "stream status");
    expect(String(r.headers.get("content-type")).startsWith("text/event-stream"), `content-type ${r.headers.get("content-type")}`);
    eq(r.headers.get("access-control-allow-origin"), ORIGIN, "CORS allow-origin on the SSE reply");
    const msg = r.events.find((e) => e.event === "message" && e.data?.message?.body === first);
    expect(msg, `no message event; got ${r.events.map((e) => e.event).join(",")}`);
    eq(msg.data.conversationId, conv.id, "event conversation");
    expect(msg.id, "message event has an id (Last-Event-ID cursor)");

    const reuse = await call("GET", `/v1/chat/stream?token=${encodeURIComponent(t.token)}`, undefined, { as: null, tenant: null });
    expect(reuse.status >= 400, `token reuse should fail, got ${reuse.status}`);
    return `events ${r.events.map((e) => e.event).join(",")}; reuse → ${reuse.status}`;
  });

  await step("chat: owner unread 1, then 0 after read", async () => {
    const before = await convOf(owner, conv.id);
    eq(before.unread, 1, "owner unread before");
    ok(await call("POST", `/v1/chat/conversations/${conv.id}/read`, {}, owner), "owner read");
    const after = await convOf(owner, conv.id);
    eq(after.unread, 0, "owner unread after");
    eq(after.joined, true, "owner joined by reading");
    return "1 → 0";
  });

  await step("chat: owner replies; shopper unread 1, then 0 after read", async () => {
    const m = ok(await call("POST", `/v1/chat/conversations/${conv.id}/messages`, { body: reply }, owner), "owner reply");
    eq(m.body, reply, "reply body");
    const before = await convOf(shopper, conv.id);
    expect(before, "shopper's conversation missing");
    eq(before.unread, 1, "shopper unread before");
    ok(await call("POST", `/v1/chat/conversations/${conv.id}/read`, {}, shopper), "shopper read");
    const after = await convOf(shopper, conv.id);
    eq(after.unread, 0, "shopper unread after");
    const msgs = ok(await call("GET", `/v1/chat/conversations/${conv.id}/messages`, undefined, shopper), "messages");
    eq(msgs.items.map((x) => x.body).join(" | "), `${first} | ${reply}`, "thread");
    return "1 → 0";
  });

  await step("chat: shopper stream with Authorization header receives the owner's message", async () => {
    const body = `E2E B3 ${RUN} second owner message`;
    const r = await streamWhile(
      `${API}/v1/chat/stream`,
      { authorization: `Bearer ${tokens.chatShopper}`, "x-tenant": STORE },
      async () => ok(await call("POST", `/v1/chat/conversations/${conv.id}/messages`, { body }, owner), "owner sends"),
      (events) => events.some((e) => e.event === "message" && e.data?.message?.body === body),
    );
    eq(r.status, 200, "status");
    expect(
      r.events.some((e) => e.event === "message" && e.data?.message?.body === body),
      `no message event; got ${r.events.map((e) => e.event).join(",")}`,
    );
    return `events ${r.events.map((e) => e.event).join(",")}`;
  });

  await step("chat: shopper edits and deletes own message; cannot edit the owner's", async () => {
    const m = ok(await call("POST", `/v1/chat/conversations/${conv.id}/messages`, { body: "typo" }, shopper), "send");
    const ed = ok(await call("PATCH", `/v1/chat/messages/${m.id}`, { body: "fixed" }, shopper), "edit");
    eq(ed.body, "fixed", "edited body");
    expect(ed.editedAt, "editedAt set");
    const del = ok(await call("DELETE", `/v1/chat/messages/${m.id}`, undefined, shopper), "delete");
    expect(del.deletedAt, "deletedAt set");
    const msgs = ok(await call("GET", `/v1/chat/conversations/${conv.id}/messages`, undefined, shopper), "messages");
    const ownerMsg = msgs.items.find((x) => x.body === reply);
    fails(await call("PATCH", `/v1/chat/messages/${ownerMsg.id}`, { body: "hack" }, shopper), 403, null, "edit others");
    return "edit + delete ok, others' 403";
  });

  await step("chat: another shopper cannot see the conversation", async () => {
    await signIn("chatOther", testPhone(2), STORE);
    const r = await call("GET", `/v1/chat/conversations/${conv.id}/messages`, undefined, { as: "chatOther", tenant: STORE });
    fails(r, 404, null, "other shopper");
    return "404";
  });
}
