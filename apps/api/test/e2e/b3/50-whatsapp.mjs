// B1 WhatsApp (docs/batch3.md): mock account, Meta webhook handshake + signed inbound/status events, live inbox SSE,
// the 24 h rule, templates, STOP opt-out and a throttled campaign that skips the opted-out number. Shop e2e-bill.
import { createHmac } from "node:crypto";
import { API, RUN, call, eq, expect, fails, ok, readSse, sleep, step, testPhone, tokens } from "./lib.mjs";

const APP_SECRET = `e2e-app-secret-${RUN}-0123456789`;
const PHONE_NUMBER_ID = "100000000000777";
const sign = (raw) => `sha256=${createHmac("sha256", APP_SECRET).update(raw).digest("hex")}`;
const digits = (p) => p.replace(/\D/g, "");

/** Meta-shaped webhook body for one `value` (messages / statuses / contacts). */
const envelope = (value) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "200000000000777",
      changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "919999000000", phone_number_id: PHONE_NUMBER_ID }, ...value } }],
    },
  ],
});
const inbound = (phone, text, name = `E2E WA ${RUN}`) =>
  envelope({
    contacts: [{ profile: { name }, wa_id: digits(phone) }],
    messages: [{ from: digits(phone), id: `wamid.e2e-${RUN}-${Math.random().toString(36).slice(2)}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }],
  });

export default async function () {
  let tenantId = null;
  let verifyToken = null;
  /** POST a webhook body; `signature` = false → no header, a string → that header, default → valid HMAC. */
  const post = (payload, signature) => {
    const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
    const headers = { "content-type": "application/json" };
    if (signature !== false) headers["x-hub-signature-256"] = signature ?? sign(raw);
    return call("POST", `/v1/whatsapp/webhooks/${tenantId}`, raw, { as: null, tenant: null, headers });
  };
  const conversations = async (q) => ok(await call("GET", `/v1/whatsapp/conversations?limit=100${q ? `&q=${encodeURIComponent(q)}` : ""}`), "conversations").items;
  const findConv = async (phone) => (await conversations(digits(phone).slice(-10))).find((c) => c.phone === phone);
  const messages = async (id) => ok(await call("GET", `/v1/whatsapp/conversations/${id}/messages?limit=100`), "messages").items;
  async function poll(fn, what, ms = 20_000) {
    const until = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > until) throw new Error(`timed out: ${what}`);
      await sleep(300);
    }
  }

  const phoneIn = testPhone(5); // writes in → window open
  const phoneCold = testPhone(5); // started by staff → window closed
  const phoneStop = testPhone(5); // sends STOP
  const phoneA = testPhone(5);
  const phoneB = testPhone(5);
  let convIn = null;
  let convCold = null;
  let templates = [];
  let sentText = null;

  await step("whatsapp: connect the mock account, test it, account shows connected + webhook URL", async () => {
    const put = ok(
      await call("PUT", "/v1/whatsapp/account", {
        provider: "mock",
        phoneNumberId: PHONE_NUMBER_ID,
        wabaId: "200000000000777",
        displayNumber: "+91 99990 00000",
        token: `e2e-mock-token-${RUN}-abcdefghij`,
        appSecret: APP_SECRET,
        regenerateVerifyToken: true,
        status: "active",
      }),
      "put account",
    );
    eq(put.provider, "mock", "provider");
    const test = ok(await call("POST", "/v1/whatsapp/account/test"), "test account");
    expect(test.ok === true && test.templates > 0, `test: ${JSON.stringify(test)}`);
    const a = ok(await call("GET", "/v1/whatsapp/account"), "get account");
    expect(a.configured && a.status === "active" && a.hasToken && a.hasAppSecret, `account: ${JSON.stringify(a)}`);
    eq(a.phoneNumberId, PHONE_NUMBER_ID, "phone number id");
    expect(a.verifyToken && a.verifyToken.length >= 16, "verify token");
    const m = /\/v1\/whatsapp\/webhooks\/([0-9a-f-]{36})$/.exec(a.webhookUrl ?? "");
    expect(m, `webhook url: ${a.webhookUrl}`);
    tenantId = m[1];
    verifyToken = a.verifyToken;
    expect(!JSON.stringify(a).includes(APP_SECRET), "app secret must not be returned");
    return `status ${a.status}, ${test.templates} templates, webhook ${a.webhookUrl}`;
  });

  await step("whatsapp: webhook verification echoes the challenge; a bad token / mode is refused", async () => {
    const challenge = `ch-${RUN}-42`;
    const q = (token, mode = "subscribe") => `/v1/whatsapp/webhooks/${tenantId}?hub.mode=${mode}&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=${challenge}`;
    const good = await call("GET", q(verifyToken), undefined, { as: null, tenant: null, raw: true });
    eq(good.status, 200, "good status");
    eq(good.text, challenge, "challenge echoed");
    const bad = await call("GET", q("wrong-token"), undefined, { as: null, tenant: null });
    eq(bad.status, 403, "bad token status");
    const badMode = await call("GET", q(verifyToken, "unsubscribe"), undefined, { as: null, tenant: null });
    eq(badMode.status, 403, "bad mode status");
    return `challenge echoed; bad token ${bad.status}`;
  });

  await step("whatsapp: signed inbound message → conversation + message, live stream gets wa.message; bad signature refused", async () => {
    // Invalid signatures first: nothing may be stored.
    const body = inbound(phoneIn, `Hello from e2e ${RUN}`);
    fails(await post(body, "sha256=" + "0".repeat(64)), 401, "bad_signature", "wrong signature");
    fails(await post(body, false), 401, "bad_signature", "missing signature");
    const tampered = JSON.stringify(body);
    fails(await post(tampered.replace("Hello", "Hacked"), sign(tampered)), 401, "bad_signature", "tampered body");
    expect(!(await findConv(phoneIn)), "no conversation after refused webhooks");

    // Live stream: token, then SSE; post the signed webhook once the stream is open.
    const st = ok(await call("POST", "/v1/whatsapp/stream-token"), "stream token");
    expect(st.token, `stream token: ${JSON.stringify(st)}`);
    let posted = null;
    const sse = await readSse(`${API}/v1/whatsapp/stream?token=${encodeURIComponent(st.token)}`, {
      ms: 15_000,
      until: (ev) => ev.some((e) => e.event === "wa.message" && e.data?.message?.body === `Hello from e2e ${RUN}`),
      onOpen: async () => {
        await sleep(300);
        posted = await post(body);
      },
    });
    eq(sse.status, 200, "stream status");
    expect(sse.events.some((e) => e.event === "ready"), "ready event");
    const ev = sse.events.find((e) => e.event === "wa.message");
    expect(ev, `no wa.message event (got ${sse.events.map((e) => e.event).join(",")})`);
    eq(ev.data.message.direction, "in", "event direction");
    const r = ok(posted, "signed webhook");
    eq(r.messages, 1, "messages accepted");

    // Retried delivery of the same webhook is idempotent.
    ok(await post(body), "retry webhook");
    const used = await readSse(`${API}/v1/whatsapp/stream?token=${encodeURIComponent(st.token)}`, { ms: 3000 });
    expect(used.status === 401, `stream token is single-use: ${used.status}`);

    convIn = await findConv(phoneIn);
    expect(convIn, "conversation listed");
    expect(convIn.name === `E2E WA ${RUN}` && convIn.unreadCount === 1 && convIn.window.open, `conversation: ${JSON.stringify(convIn)}`);
    const msgs = await messages(convIn.id);
    eq(msgs.filter((m) => m.direction === "in").length, 1, "one inbound message (retry deduped)");
    eq(msgs[0].body, `Hello from e2e ${RUN}`, "message body");
    return `conversation ${convIn.displayPhone}, unread ${convIn.unreadCount}, SSE ${sse.events.map((e) => e.event).join(",")}`;
  });

  await step("whatsapp: free text inside the 24 h window is sent; mark read clears unread", async () => {
    sentText = ok(await call("POST", `/v1/whatsapp/conversations/${convIn.id}/messages`, { type: "text", body: `Thanks, e2e reply ${RUN}` }), "send text");
    expect(sentText.direction === "out" && sentText.providerId?.startsWith("wamid.mock-"), `sent: ${JSON.stringify(sentText)}`);
    // Mock driver posts sent → delivered → read statuses on its own.
    const done = await poll(async () => (await messages(convIn.id)).find((m) => m.id === sentText.id && ["sent", "delivered", "read"].includes(m.status)), "text status sent");
    const read = ok(await call("POST", `/v1/whatsapp/conversations/${convIn.id}/read`), "mark read");
    eq(read.unreadCount, 0, "unread after mark read");
    return `text ${sentText.status} → ${done.status}`;
  });

  await step("whatsapp: no inbound in 24 h → free text refused (window_closed); synced template is sent", async () => {
    convCold = ok(await call("POST", "/v1/whatsapp/conversations", { phone: phoneCold, name: `E2E Cold ${RUN}` }), "start conversation");
    eq(convCold.window.open, false, "window closed");
    fails(await call("POST", `/v1/whatsapp/conversations/${convCold.id}/messages`, { type: "text", body: "Hi" }), 409, "window_closed", "free text when closed");
    const sync = ok(await call("POST", "/v1/whatsapp/templates/sync"), "sync templates");
    templates = sync.items;
    const t = templates.find((x) => x.name === "payment_reminder" && x.language === "en");
    expect(t && t.status === "APPROVED", `templates: ${templates.map((x) => `${x.name}/${x.language}/${x.status}`).join(", ")}`);
    fails(await call("POST", `/v1/whatsapp/conversations/${convCold.id}/messages`, { type: "template", templateId: t.id, values: { "body.1": "Kumar" } }), 400, null, "missing template value");
    const sent = ok(
      await call("POST", `/v1/whatsapp/conversations/${convCold.id}/messages`, { type: "template", templateId: t.id, values: { "body.1": "Kumar", "body.2": "₹250.00" } }),
      "send template",
    );
    expect(sent.type === "template" && sent.templateName === "payment_reminder" && sent.status !== "failed", `template message: ${JSON.stringify(sent)}`);
    expect(sent.body?.includes("Kumar") && sent.body.includes("₹250.00"), `rendered body: ${sent.body}`);
    const c = await findConv(phoneCold);
    expect(c, "cold conversation now listed");
    return `${sync.items.length} templates (created ${sync.created}, updated ${sync.updated}); template ${sent.status}: "${sent.body}"`;
  });

  await step("whatsapp: delivery status webhook (delivered, read) updates the message; stale status ignored", async () => {
    const convs = await findConv(phoneCold);
    const msgs = await messages(convs.id);
    const out = msgs.find((m) => m.direction === "out" && m.type === "template");
    expect(out?.providerId, "template message with provider id");
    const ts = Math.floor(Date.now() / 1000);
    const statuses = (list) => envelope({ statuses: list.map(([status, dt]) => ({ id: out.providerId, status, timestamp: String(ts + dt), recipient_id: digits(phoneCold) })) });
    const r1 = ok(await post(statuses([["delivered", 1]])), "delivered webhook");
    eq(r1.statuses, 1, "statuses accepted");
    const r2 = ok(await post(statuses([["read", 2]])), "read webhook");
    eq(r2.statuses, 1, "read accepted");
    ok(await post(statuses([["sent", 3]])), "stale sent webhook");
    const after = (await messages(convs.id)).find((m) => m.id === out.id);
    eq(after.status, "read", "status after webhooks");
    fails(await post(statuses([["delivered", 4]]), "sha256=" + "f".repeat(64)), 401, "bad_signature", "status with bad signature");
    return `message ${out.providerId.slice(0, 22)}… → ${after.status}`;
  });

  let optedOut = null;
  await step("whatsapp: inbound STOP opts the contact out (+ opt-out reply); template refused", async () => {
    ok(await post(inbound(phoneStop, "STOP", `E2E Stop ${RUN}`)), "STOP webhook");
    const c = await poll(async () => {
      const x = await findConv(phoneStop);
      return x && x.optedOutAt ? x : null;
    }, "contact opted out");
    eq(c.optedIn, false, "optedIn");
    optedOut = c;
    const reply = await poll(async () => (await messages(c.id)).find((m) => m.direction === "out" && m.type === "text"), "opt-out reply");
    const t = templates.find((x) => x.name === "payment_reminder" && x.language === "en");
    fails(
      await call("POST", `/v1/whatsapp/conversations/${c.id}/messages`, { type: "template", templateId: t.id, values: { "body.1": "A", "body.2": "B" } }),
      409,
      "opted_out",
      "template to opted-out",
    );
    const listed = ok(await call("GET", "/v1/whatsapp/conversations?filter=opted_out&limit=100"), "opted_out filter").items;
    expect(listed.some((x) => x.id === c.id), "listed under opted_out");
    return `opted out at ${c.optedOutAt}; reply "${reply.body.slice(0, 40)}…"`;
  });

  await step("whatsapp: campaign preview excludes the opted-out number; run sends A and B, skips STOP; counts complete", async () => {
    const t = templates.find((x) => x.name === "payment_reminder" && x.language === "en");
    const audience = {
      sources: [
        {
          kind: "phones",
          items: [
            { phone: phoneStop, name: "Stop" },
            { phone: phoneA, name: `A ${RUN}` },
            { phone: phoneB, name: `B ${RUN}` },
            { phone: phoneA.replace("+91", "") }, // duplicate in local form
          ],
        },
      ],
    };
    const mapping = { params: { "body.1": { from: "name", fallback: "Customer" }, "body.2": { from: "text", value: "₹99.00" } } };
    const pv = ok(await call("POST", "/v1/whatsapp/campaigns/preview", { audience, templateId: t.id, mapping }), "preview");
    expect(pv.sendable === 2 && pv.optedOut === 1 && pv.duplicates === 1, `preview: ${JSON.stringify(pv)}`);
    expect(pv.sample.every((s) => s.missing.length === 0 && s.text?.includes("₹99.00")), `sample: ${JSON.stringify(pv.sample)}`);

    const camp = ok(await call("POST", "/v1/whatsapp/campaigns", { name: `E2E campaign ${RUN}`, templateId: t.id, mapping, audience }), "create campaign");
    eq(camp.status, "draft", "draft");
    const started = ok(await call("POST", `/v1/whatsapp/campaigns/${camp.id}/start`, {}), "start");
    expect(["running", "completed"].includes(started.status), `started: ${started.status}`);
    fails(await call("POST", `/v1/whatsapp/campaigns/${camp.id}/start`, {}), 409, null, "start twice");

    const final = await poll(
      async () => {
        const c = ok(await call("GET", `/v1/whatsapp/campaigns/${camp.id}`), "get campaign");
        return c.status === "completed" ? c : null;
      },
      "campaign completed",
      45_000,
    );
    const recips = ok(await call("GET", `/v1/whatsapp/campaigns/${camp.id}/recipients`), "recipients").items;
    const byPhone = Object.fromEntries(recips.map((r) => [r.phone, r]));
    expect(!byPhone[phoneStop] || ["skipped", "cancelled"].includes(byPhone[phoneStop].status), `opted-out recipient: ${JSON.stringify(byPhone[phoneStop])}`);
    for (const p of [phoneA, phoneB]) {
      const r = byPhone[p];
      expect(r && ["sent", "delivered", "read"].includes(r.status) && r.providerId?.startsWith("wamid.mock-"), `recipient ${p}: ${JSON.stringify(r)}`);
    }
    eq(recips.length, 2, "recipient rows (opted-out not snapshotted)");
    expect(final.counts.pending === 0 && final.counts.total === 2 && final.counts.failed === 0, `counts: ${JSON.stringify(final.counts)}`);
    // Delivery statuses from the mock roll up into the campaign counts.
    const rolled = await poll(
      async () => {
        const c = ok(await call("GET", `/v1/whatsapp/campaigns/${camp.id}`), "get campaign");
        return (c.counts.delivered ?? 0) + (c.counts.read ?? 0) >= 2 ? c : null;
      },
      "delivered/read counts",
      20_000,
    );
    const csv = await call("GET", `/v1/whatsapp/campaigns/${camp.id}/recipients?format=csv`, undefined, { raw: true });
    eq(csv.status, 200, "csv");
    expect(csv.text.includes(phoneA) && csv.text.includes(phoneB), "csv rows");
    fails(await call("DELETE", `/v1/whatsapp/campaigns/${camp.id}`), 409, null, "delete sent campaign");
    return `preview sendable ${pv.sendable} (opted out ${pv.optedOut}, dup ${pv.duplicates}); counts ${JSON.stringify(rolled.counts)}`;
  });

  await step("whatsapp: external audience sources (customers, dues) resolve through the AudiencePort", async () => {
    const src = ok(await call("GET", "/v1/whatsapp/campaigns/audience-sources"), "audience sources").items;
    expect(["wa_contacts", "phones", "customers", "dues"].every((k) => src.includes(k)), `sources: ${src.join(",")}`);
    const customers = ok(await call("POST", "/v1/whatsapp/campaigns/preview", { audience: { sources: [{ kind: "customers" }] } }), "customers preview");
    expect(customers.total > 0 && customers.sendable > 0, `customers preview: ${JSON.stringify(customers)}`);
    const dues = ok(await call("POST", "/v1/whatsapp/campaigns/preview", { audience: { sources: [{ kind: "dues", minDue: 1 }] } }), "dues preview");
    // wa_contacts = opted-in contacts only (consent): tag + opt in one; the opted-out one can't be opted in by staff.
    const tag = `e2e-${RUN.toLowerCase()}`;
    ok(await call("PUT", `/v1/whatsapp/conversations/${convIn.id}/tags`, { tags: [tag, "VIP"] }), "tags");
    const tagPreview = () => call("POST", "/v1/whatsapp/campaigns/preview", { audience: { sources: [{ kind: "wa_contacts", tags: [tag] }] } });
    eq(ok(await tagPreview(), "tag preview before opt-in").sendable, 0, "not opted in yet");
    const patched = ok(await call("PATCH", `/v1/whatsapp/conversations/${convIn.id}`, { optedIn: true }), "opt in");
    expect(patched.optedIn && patched.tags.includes("vip"), `patched: ${JSON.stringify(patched)}`);
    fails(await call("PATCH", `/v1/whatsapp/conversations/${optedOut.id}`, { optedIn: true }), 409, null, "staff opt-in of opted-out contact");
    const contacts = ok(await tagPreview(), "wa_contacts preview");
    eq(contacts.sendable, 1, "wa_contacts sendable");
    eq(contacts.sample[0]?.phone, phoneIn, "wa_contacts sample");
    return `customers ${customers.sendable}/${customers.total}, dues ${dues.sendable}/${dues.total}, tagged wa_contacts ${contacts.sendable}`;
  });

  await step("whatsapp: staff without whatsapp.manage / anonymous can't read the inbox", async () => {
    const anon = await call("GET", "/v1/whatsapp/conversations", undefined, { as: null });
    expect(anon.status === 401 || anon.status === 403, `anonymous: ${anon.status}`);
    const noShop = await call("POST", "/v1/whatsapp/stream-token", undefined, { as: null });
    expect(noShop.status === 401 || noShop.status === 403, `anonymous stream token: ${noShop.status}`);
    expect(tokens.owner, "owner token");
    return `anonymous ${anon.status}`;
  });
}
