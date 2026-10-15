// B4 developer: API keys (principal = key uuid, audit actor), scope limits, webhooks (signature, retries, redeliver,
// test ping) and the OpenAPI listing. Shop e2e-bill only; endpoints are deleted and keys revoked at the end.
import { createHmac } from "node:crypto";
import { BILL, STORE, RUN, call, eq, expect, fails, ok, receiver, sleep, step, today } from "./lib.mjs";

const keyCall = (token, method, path, body, tenant = BILL) =>
  call(method, path, body, { as: null, tenant, headers: { authorization: `Bearer ${token}` } });

async function poll(fn, what, ms = 15_000) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(300);
  }
}

function verify(secret, entry) {
  const h = entry.headers["x-srikit-signature"];
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(h ?? "");
  expect(m, `bad signature header ${h}`);
  const expected = createHmac("sha256", secret).update(`${m[1]}.${entry.body}`, "utf8").digest("hex");
  eq(m[2], expected, "signature v1");
  expect(Math.abs(Number(m[1]) - Date.now() / 1000) < 300, `timestamp ${m[1]} too far from now`);
  return JSON.parse(entry.body);
}

const line = (description, rate) => ({ description, qty: 1, unit: "pcs", rate, gstRate: 5 });

export default async function () {
  const state = { keys: [], endpoints: [], receivers: [] };
  try {
    await body(state);
  } finally {
    for (const id of state.endpoints) await call("DELETE", `/v1/developer/endpoints/${id}`).catch(() => undefined);
    for (const id of state.keys) await call("POST", `/v1/developer/keys/${id}/revoke`).catch(() => undefined);
    for (const r of state.receivers) await r.close().catch(() => undefined);
  }
}

async function body(state) {
  let key, token;
  await step("developer: owner creates an API key (token shown once)", async () => {
    const j = ok(
      await call("POST", "/v1/developer/keys", { name: `E2E ${RUN} key`, scopes: ["invoices.create", "customers.create", "payments.receive"] }),
      "create key",
    );
    key = j.key;
    token = j.token;
    state.keys.push(key.id);
    expect(/^sk_test_[0-9A-Za-z]{32}$/.test(token), `token ${token}`);
    expect(!("keyHash" in key) && !("token" in key), "key view leaks secrets");
    eq(key.prefix, token.slice(0, 12), "prefix");
    const list = ok(await call("GET", "/v1/developer/keys"), "list keys");
    const mine = list.items.find((k) => k.id === key.id);
    expect(mine && !JSON.stringify(mine).includes(token), "listed key exposes token");
    return `${key.prefix}… scopes ${key.scopes.join(",")}`;
  });

  await step("developer: unknown scope → 400", async () => {
    fails(await call("POST", "/v1/developer/keys", { name: "bad", scopes: ["nope.nothing"] }), 400, null, "bad scope");
  });

  let keyBill, keyCustomer;
  await step("developer: bill created with only the API key (no x-tenant, then with x-tenant)", async () => {
    keyCustomer = ok(await keyCall(token, "POST", "/v1/invoices/customers", { name: `E2E ${RUN} API customer`, stateCode: "33" }, null), "customer via key");
    keyBill = ok(
      await keyCall(token, "POST", "/v1/invoices", { customerId: keyCustomer.id, date: today(), issue: true, lines: [line(`E2E ${RUN} API line`, 10000)] }, null),
      "bill via key (no x-tenant)",
    );
    expect(keyBill.number && keyBill.status === "issued", `bill ${keyBill.number} ${keyBill.status}`);
    const b2 = ok(
      await keyCall(token, "POST", "/v1/invoices", { customer: { name: `E2E ${RUN} walk-in` }, date: today(), issue: true, lines: [line(`E2E ${RUN} API line 2`, 5000)] }),
      "bill via key (x-tenant e2e-bill)",
    );
    const got = ok(await keyCall(token, "GET", `/v1/invoices/${keyBill.id}`, undefined, null), "get via key");
    eq(got.id, keyBill.id, "get bill");
    return `${keyBill.number} ${keyBill.total}, ${b2.number}`;
  });

  await step("developer: audit log records the bill with actor = key id", async () => {
    const row = await poll(async () => {
      const j = ok(await call("GET", `/v1/audit?actorUserId=${key.id}&entityType=invoices&limit=50`), "audit");
      return j.items.find((r) => r.action?.startsWith("invoices.post"));
    }, "audit row");
    eq(row.actorUserId, key.id, "actorUserId");
    const k = ok(await call("GET", "/v1/developer/keys"), "keys").items.find((x) => x.id === key.id);
    expect(k.lastUsedAt, "lastUsedAt not set");
    return `${row.action} at ${row.createdAt}; lastUsedAt ${k.lastUsedAt}`;
  });

  await step("developer: key can't reach key management / super-admin / audit", async () => {
    fails(await keyCall(token, "GET", "/v1/developer/keys"), 403, null, "GET keys");
    fails(await keyCall(token, "POST", "/v1/developer/keys", { name: "x", scopes: ["invoices.create"] }), 403, null, "POST keys");
    fails(await keyCall(token, "GET", "/v1/tenancy/tenants"), 403, null, "tenancy/tenants");
    fails(await keyCall(token, "GET", "/v1/audit/platform"), 403, null, "audit/platform");
    fails(await keyCall(token, "GET", "/v1/audit"), 403, null, "audit");
    fails(await keyCall(token, "GET", "/v1/developer/endpoints"), 403, null, "endpoints (no developer.manage)");
  });

  await step("developer: key for e2e-bill with x-tenant e2e-store → 403; bad key → 401", async () => {
    fails(await keyCall(token, "GET", "/v1/invoices", undefined, STORE), 403, null, "other shop");
    fails(await keyCall(`sk_test_${"x".repeat(32)}`, "GET", "/v1/invoices"), 401, "invalid_api_key", "unknown key");
  });

  await step("developer: revoked key → 401 invalid_api_key", async () => {
    const j = ok(await call("POST", "/v1/developer/keys", { name: `E2E ${RUN} revoke me`, scopes: ["invoices.create"] }), "key 2");
    state.keys.push(j.key.id);
    ok(await keyCall(j.token, "GET", "/v1/invoices?limit=1"), "key 2 works");
    eq(ok(await call("POST", `/v1/developer/keys/${j.key.id}/revoke`), "revoke").status, "revoked", "status");
    fails(await keyCall(j.token, "GET", "/v1/invoices?limit=1"), 401, "invalid_api_key", "revoked key");
  });

  // ---------------------------------------------------------------- webhooks
  const r1 = await receiver();
  state.receivers.push(r1);
  let ep1, secret1;
  await step("webhooks: create endpoint (secret shown once)", async () => {
    const j = ok(
      await call("POST", "/v1/developer/endpoints", {
        url: `${r1.url}/hook`,
        events: ["invoice.issued", "invoice.paid", "payment.received", "customer.created"],
        description: `E2E ${RUN}`,
      }),
      "create endpoint",
    );
    ep1 = j.endpoint;
    secret1 = j.secret;
    state.endpoints.push(ep1.id);
    expect(/^whsec_/.test(secret1), `secret ${secret1}`);
    expect(!("secretEnc" in ep1), "endpoint view leaks secret");
    const got = ok(await call("GET", `/v1/developer/endpoints/${ep1.id}`), "get endpoint");
    expect(!JSON.stringify(got).includes(secret1), "get exposes secret");
    fails(await call("POST", "/v1/developer/endpoints", { url: `${r1.url}/x`, events: ["nope.event"] }), 400, null, "bad event");
    return `${ep1.url} ${ep1.events.join(",")}`;
  });

  let bill;
  await step("webhooks: customer + bill + payment → signed deliveries", async () => {
    const cust = ok(await call("POST", "/v1/invoices/customers", { name: `E2E ${RUN} webhook customer`, stateCode: "33" }), "customer");
    bill = ok(await call("POST", "/v1/invoices", { customerId: cust.id, date: today(), issue: true, lines: [line(`E2E ${RUN} hook line`, 20000)] }), "bill");
    ok(await call("POST", `/v1/invoices/${bill.id}/payments`, { amount: bill.total, method: "cash", date: today() }), "payment");
    const find = (type, pred) =>
      r1.waitFor((e) => {
        if (e.headers["x-srikit-event"] !== type) return false;
        try {
          return pred(JSON.parse(e.body).data);
        } catch {
          return false;
        }
      });
    const out = [];
    const checks = [
      ["customer.created", (d) => d.id === cust.id, (d) => eq(d.name, cust.name, "customer name")],
      ["invoice.issued", (d) => d.id === bill.id, (d) => eq(d.number, bill.number, "number")],
      ["payment.received", (d) => d.invoiceId === bill.id, (d) => eq(d.amount, bill.total, "amount")],
      ["invoice.paid", (d) => d.id === bill.id, (d) => eq(d.status, "paid", "status")],
    ];
    for (const [type, pred, check] of checks) {
      const e = await find(type, pred);
      const p = verify(secret1, e);
      eq(p.type, type, "payload type");
      eq(p.tenant?.slug, BILL, "payload tenant");
      check(p.data);
      eq(e.headers["user-agent"], "Srikit-Webhooks/1.0", "user agent");
      expect(e.headers["x-srikit-delivery"], "no delivery header");
      out.push(`${type}✓`);
      state[type] = e.headers["x-srikit-delivery"];
    }
    return out.join(" ");
  });

  await step("webhooks: delivery log shows succeeded", async () => {
    const id = state["invoice.issued"];
    const d = await poll(async () => {
      const x = ok(await call("GET", `/v1/developer/deliveries/${id}`), "delivery");
      return x.status === "succeeded" ? x : null;
    }, "succeeded delivery");
    eq(d.attempts, 1, "attempts");
    eq(d.responseStatus, 200, "responseStatus");
    eq(d.payload.data.id, bill.id, "payload");
    const list = ok(await call("GET", `/v1/developer/deliveries?endpointId=${ep1.id}&status=succeeded&limit=100`), "list");
    expect(list.items.some((x) => x.id === id), "delivery missing from list");
    expect(!("payload" in list.items[0]), "list includes payload");
    return `${list.total} succeeded on endpoint`;
  });

  await step("webhooks: test ping", async () => {
    const d = ok(await call("POST", `/v1/developer/endpoints/${ep1.id}/test`), "ping");
    eq(d.status, "succeeded", "ping status");
    eq(d.type, "ping", "ping type");
    const e = await r1.waitFor((x) => x.headers["x-srikit-delivery"] === d.id);
    const p = verify(secret1, e);
    eq(p.data.endpointId, ep1.id, "ping endpointId");
  });

  // failing endpoint
  const r2 = await receiver(() => ({ status: 500, body: "boom" }));
  state.receivers.push(r2);
  await step("webhooks: failing endpoint → pending, attempts 1, 500, retry ≈ +1 min; redeliver → succeeded", async () => {
    const j = ok(await call("POST", "/v1/developer/endpoints", { url: `${r2.url}/fail`, events: ["invoice.issued"], description: `E2E ${RUN} failing` }), "endpoint 2");
    state.endpoints.push(j.endpoint.id);
    const b = ok(await call("POST", "/v1/invoices", { customer: { name: `E2E ${RUN} fail` }, date: today(), issue: true, lines: [line(`E2E ${RUN} fail line`, 3000)] }), "bill");
    const e = await r2.waitFor((x) => {
      try {
        return JSON.parse(x.body).data.id === b.id;
      } catch {
        return false;
      }
    });
    verify(j.secret, e);
    const id = e.headers["x-srikit-delivery"];
    const d = await poll(async () => {
      const x = ok(await call("GET", `/v1/developer/deliveries/${id}`), "delivery");
      return x.attempts >= 1 && x.lastAttemptAt ? x : null;
    }, "failed attempt recorded");
    eq(d.status, "pending", "status");
    eq(d.attempts, 1, "attempts");
    eq(d.responseStatus, 500, "responseStatus");
    eq(d.responseBody, "boom", "responseBody");
    const delay = new Date(d.nextAttemptAt).getTime() - new Date(d.lastAttemptAt).getTime();
    expect(Math.abs(delay - 60_000) < 5_000, `next attempt in ${delay} ms`);
    r2.setResponder(() => ({ status: 200, body: "ok now" }));
    const re = ok(await call("POST", `/v1/developer/deliveries/${id}/redeliver`), "redeliver");
    eq(re.status, "succeeded", "redeliver status");
    eq(re.eventId, d.eventId, "same event id");
    expect(re.id !== id, "redeliver is a new delivery");
    const ep = ok(await call("GET", `/v1/developer/endpoints/${j.endpoint.id}`), "endpoint");
    eq(ep.consecutiveFailures, 0, "failures reset");
    return `retry in ${Math.round(delay / 1000)} s; redelivered as ${re.id}`;
  });

  // ---------------------------------------------------------------- OpenAPI
  await step("openapi: /v1/invoices listed once with permission/feature metadata", async () => {
    const doc = ok(await call("GET", "/v1/developer/openapi.json"), "openapi");
    eq(doc.openapi, "3.1.0", "version");
    const paths = Object.keys(doc.paths);
    const trailing = paths.filter((p) => p.length > 1 && p.endsWith("/"));
    eq(trailing.length, 0, `trailing-slash paths ${trailing.slice(0, 5)}`);
    const inv = doc.paths["/v1/invoices"];
    expect(inv?.post && inv?.get, "POST/GET /v1/invoices missing");
    expect(inv.post["x-permission"]?.includes("invoices.create"), `POST x-permission ${JSON.stringify(inv.post["x-permission"])}`);
    expect(inv.post["x-feature"]?.length, "POST x-feature missing");
    eq(inv.post.operationId, "post_invoices", "operationId");
    const ops = Object.values(doc.paths).flatMap((m) => Object.values(m).map((o) => o.operationId));
    eq(new Set(ops).size, ops.length, "unique operationIds");
    // A suffixed id is fine for a different path that slugs the same ("/vendor/orders" vs "/vendor-orders"); one whose
    // base is gone means two routes (e.g. "/v1/x" and "/v1/x/") collapsed onto one entry and the later one won.
    const all = new Set(ops);
    const dupes = ops.filter((o) => o.endsWith("_") && !all.has(o.replace(/_+$/, "")));
    eq(dupes.length, 0, `collapsed duplicate routes ${dupes.slice(0, 5)}`);
    const checks = [
      ["/v1/invoices/customers", "post", "customers.create"],
      ["/v1/invoices/{id}", "patch", "invoices.create"],
      ["/v1/invoices/{id}/payments", "post", "payments.receive"],
      ["/v1/invoices/{id}/cancel", "post", "invoices.cancel"],
      ["/v1/invoices/reports/sales-register", "get", "reports.view"],
    ];
    for (const [p, m, perm] of checks)
      expect(doc.paths[p]?.[m]?.["x-permission"]?.includes(perm), `${m.toUpperCase()} ${p} x-permission ${JSON.stringify(doc.paths[p]?.[m]?.["x-permission"])}`);
    eq(doc.paths["/v1/developer/keys"]?.get?.["x-api-key"], false, "keys x-api-key");
    return `${paths.length} paths, ${ops.length} operations`;
  });
}
