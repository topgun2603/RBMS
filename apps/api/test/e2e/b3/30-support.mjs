// A3 support: guest OTP tickets, staff replies vs internal notes, resolve, guest rate limit, signed-in tickets, FAQ.
import { RUN, STORE, call, eq, expect, fails, ok, signIn, step, testPhone } from "./lib.mjs";

const owner = { as: "owner", tenant: STORE };
/** A per-run client address (the API trusts x-forwarded-for) so the per-IP guest limit doesn't carry over between runs. */
const rnd = () => 1 + Math.floor(Math.random() * 250);
const IP = `10.${rnd()}.${rnd()}.${rnd()}`;
/** Bad-token probes count against the per-IP limit too: keep them off the guest's address. */
const OTHER_IP = `10.${rnd()}.${rnd()}.${rnd()}`;
const guestOpts = (token) => ({ as: null, tenant: STORE, headers: { "x-guest-token": token, "x-forwarded-for": IP } });

async function guestToken(phone) {
  ok(await call("POST", "/v1/auth/otp/request", { target: phone }, { as: null, tenant: STORE }), "otp request");
  const v = ok(await call("POST", "/v1/auth/guest/verify", { target: phone, code: "123456" }, { as: null, tenant: STORE }), "guest verify");
  expect(typeof v.guestToken === "string" && v.guestToken.length > 10, `no guest token: ${JSON.stringify(v)}`);
  return v;
}

export default async function () {
  const phone = testPhone(3);
  const tag = `E2E B3 ${RUN}`;
  let guest, ticket, guestCreated = 0;
  const replyText = `${tag} staff reply`;
  const noteText = `${tag} internal note (secret)`;

  await step("support: guest verifies the phone by OTP (no account)", async () => {
    guest = await guestToken(phone);
    eq(guest.phone, phone, "verified phone");
    fails(await call("POST", "/v1/support/public/tickets", { subject: "No token", body: "x", name: "X" }, { as: null, tenant: STORE }), 401, null, "no token");
    fails(await call("POST", "/v1/support/public/tickets", { subject: "Bad token", body: "x", name: "X" }, { ...guestOpts("not-a-real-token-123"), headers: { "x-guest-token": "not-a-real-token-123", "x-forwarded-for": OTHER_IP } }), 401, null, "bad token");
    return `token until ${guest.expiresAt}`;
  });

  await step("support: guest raises a ticket", async () => {
    const r = ok(
      await call("POST", "/v1/support/public/tickets", { subject: `${tag} order not delivered`, body: "My order has not arrived yet.", name: `${tag} Guest` }, guestOpts(guest.guestToken)),
      "create ticket",
    );
    guestCreated++;
    ticket = r.ticket;
    expect(/^TKT-\d+/.test(ticket.number), `number ${ticket.number}`);
    eq(ticket.status, "open", "status");
    eq(r.items.length, 1, "first message");
    return ticket.number;
  });

  await step("support: guest lists own tickets", async () => {
    const r = ok(await call("GET", "/v1/support/public/tickets", undefined, guestOpts(guest.guestToken)), "list own");
    expect(r.items.some((t) => t.id === ticket.id), "own ticket missing");
    return `${r.total} ticket(s)`;
  });

  await step("support: owner lists tickets, replies and adds an internal note", async () => {
    const l = ok(await call("GET", `/v1/support/tickets?q=${encodeURIComponent(ticket.number)}`, undefined, owner), "staff list");
    const t = l.items.find((x) => x.id === ticket.id);
    expect(t, `ticket ${ticket.number} not in the staff list (${l.total})`);
    eq(t.requester.phone, phone, "requester phone");
    const rep = ok(await call("POST", `/v1/support/tickets/${ticket.id}/messages`, { kind: "reply", body: replyText }, owner), "reply");
    eq(rep.message.kind, "reply", "reply kind");
    expect(rep.ticket.firstResponseAt, "first response recorded");
    ok(await call("POST", `/v1/support/tickets/${ticket.id}/messages`, { kind: "note", body: noteText }, owner), "note");
    const th = ok(await call("GET", `/v1/support/tickets/${ticket.id}`, undefined, owner), "staff thread");
    expect(th.messages.some((m) => m.kind === "note" && m.body === noteText), "staff sees the note");
    return `status ${rep.ticket.status}, ${th.messages.length} messages (staff view)`;
  });

  await step("support: guest sees the reply but not the note, and replies", async () => {
    const th = ok(await call("GET", `/v1/support/public/tickets/${ticket.id}/messages`, undefined, guestOpts(guest.guestToken)), "public thread");
    expect(th.items.some((m) => m.body === replyText && m.from === "staff"), "reply missing");
    expect(!JSON.stringify(th).includes("secret"), "internal note leaked to the guest");
    const r = ok(await call("POST", `/v1/support/public/tickets/${ticket.id}/messages`, { body: "Thanks, waiting." }, guestOpts(guest.guestToken)), "guest reply");
    eq(r.items.length, 3, "public thread after reply");
    return `public ${r.items.length} messages, status ${r.ticket.status}`;
  });

  await step("support: owner resolves the ticket", async () => {
    const t = ok(await call("POST", `/v1/support/tickets/${ticket.id}/status`, { status: "resolved" }, owner), "resolve");
    eq(t.status, "resolved", "status");
    expect(t.resolvedAt, "resolvedAt");
    const own = ok(await call("GET", "/v1/support/public/tickets", undefined, guestOpts(guest.guestToken)), "own");
    eq(own.items.find((x) => x.id === ticket.id)?.status, "resolved", "guest sees resolved");
    return "resolved";
  });

  await step("support: another guest cannot read this ticket", async () => {
    const other = await guestToken(testPhone(3));
    fails(await call("GET", `/v1/support/public/tickets/${ticket.id}/messages`, undefined, guestOpts(other.guestToken)), 404, null, "other guest");
    return "404";
  });

  await step("support: 6th guest ticket from the same phone within an hour → 429", async () => {
    const statuses = [];
    while (guestCreated < 5) {
      const r = await call("POST", "/v1/support/public/tickets", { subject: `${tag} extra ${guestCreated}`, body: "Another question", name: `${tag} Guest` }, guestOpts(guest.guestToken));
      ok(r, `ticket ${guestCreated + 1}`);
      statuses.push(r.status);
      guestCreated++;
    }
    const r = await call("POST", "/v1/support/public/tickets", { subject: `${tag} one too many`, body: "Again", name: `${tag} Guest` },
      // from a fresh address: the per-phone limit, not the per-IP one
      { ...guestOpts(guest.guestToken), headers: { "x-guest-token": guest.guestToken, "x-forwarded-for": `10.${rnd()}.${rnd()}.${rnd()}` } });
    fails(r, 429, "rate_limited", "6th ticket");
    return `5 created, 6th 429`;
  });

  await step("support: signed-in shopper raises a ticket", async () => {
    const sp = testPhone(3);
    await signIn("supShopper", sp, STORE, `${tag} Shopper`);
    const me = { as: "supShopper", tenant: STORE };
    const r = ok(await call("POST", "/v1/support/public/tickets", { subject: `${tag} signed-in question`, body: "Do you deliver to Madurai?" }, me), "create");
    expect(/^TKT-\d+/.test(r.ticket.number), "number");
    const own = ok(await call("GET", "/v1/support/public/tickets", undefined, me), "own");
    eq(own.total, 1, "one own ticket");
    const st = ok(await call("GET", `/v1/support/tickets/${r.ticket.id}`, undefined, owner), "staff get");
    eq(st.ticket.requester.phone, sp, "requester phone from profile");
    return `${r.ticket.number} by ${st.ticket.requester.name}`;
  });

  let cat, art, draft;
  const word = `zq${RUN.toLowerCase()}`;
  await step("support: owner creates a FAQ category and a draft article (hidden publicly)", async () => {
    cat = ok(await call("POST", "/v1/support/faq/categories", { name: `${tag} Delivery` }, owner), "category");
    art = ok(
      await call("POST", "/v1/support/faq/articles", { title: `${tag} How long does delivery take`, body: `Delivery takes 3 to 5 days. Code ${word}.`, categoryId: cat.id }, owner),
      "article",
    );
    eq(art.status, "draft", "draft");
    draft = ok(await call("POST", "/v1/support/faq/articles", { title: `${tag} Unpublished draft`, body: `Draft ${word} hidden` }, owner), "draft");
    fails(await call("GET", `/v1/support/public/faq/${art.slug}`, undefined, { as: null, tenant: STORE }), 404, null, "draft article public");
    const s = ok(await call("GET", `/v1/support/public/faq/search?q=${word}`, undefined, { as: null, tenant: STORE }), "search");
    eq(s.total, 0, "drafts not searchable");
    return `${cat.slug}, ${art.slug}`;
  });

  await step("support: published article in index, search, by slug; helpful vote", async () => {
    const p = ok(await call("POST", `/v1/support/faq/articles/${art.id}/publish`, {}, owner), "publish");
    eq(p.status, "published", "published");
    const anon = { as: null, tenant: STORE };
    const idx = ok(await call("GET", "/v1/support/public/faq", undefined, anon), "index");
    const group = idx.items.find((g) => g.category?.id === cat.id);
    expect(group?.articles.some((a) => a.slug === art.slug), "article missing from the index");
    expect(!JSON.stringify(idx).includes(draft.slug), "draft listed in the index");
    const s = ok(await call("GET", `/v1/support/public/faq/search?q=${word}`, undefined, anon), "search");
    eq(s.items.map((a) => a.slug).join(","), art.slug, "search hits");
    const one = ok(await call("GET", `/v1/support/public/faq/${art.slug}`, undefined, anon), "by slug");
    eq(one.article.title, art.title, "title");
    eq(one.category?.id, cat.id, "category");
    const v = ok(await call("POST", `/v1/support/public/faq/${art.slug}/helpful`, { helpful: true }, anon), "helpful");
    eq(v.helpfulYes, 1, "helpful yes");
    const n = ok(await call("POST", `/v1/support/public/faq/${art.slug}/helpful`, { helpful: false }, anon), "not helpful");
    eq(n.helpfulNo, 1, "helpful no");
    fails(await call("POST", `/v1/support/public/faq/${draft.slug}/helpful`, { helpful: true }, anon), 404, null, "vote on draft");
    return `${art.slug}: +${n.helpfulYes} / -${n.helpfulNo}`;
  });

  await step("support: unpublished article disappears again", async () => {
    ok(await call("POST", `/v1/support/faq/articles/${art.id}/unpublish`, {}, owner), "unpublish");
    fails(await call("GET", `/v1/support/public/faq/${art.slug}`, undefined, { as: null, tenant: STORE }), 404, null, "unpublished");
    return "404";
  });
}
