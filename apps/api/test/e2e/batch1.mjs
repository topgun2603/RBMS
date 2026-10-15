// Batch 1 end-to-end against the running API (http://localhost:4000) and the real database.
//   node test/e2e/batch1.mjs      (pnpm --filter @srirealtime/api test:e2e; test:e2e:all seeds and runs every script)
// Runs only in the dedicated e2e shops from `pnpm --filter @srirealtime/api seed:e2e`: e2e-store (EC, pro) for
// commerce, staff and documents; e2e-lite (BL, starter) for plan checks. Test identities sign in with the dev test OTP
// (API env TEST_OTP_CODE / TEST_OTP_TARGETS): owner e2e-owner@example.com, staff +91 9999 00xxxx. Safe to re-run.

const API = process.env.API_URL ?? "http://localhost:4000";
const OWNER = process.env.E2E_OWNER ?? "e2e-owner@example.com";
const OTP = process.env.E2E_OTP ?? "123456";
const CASHIER_PHONE = "+919999000101";
const STAFF_PHONE = "+919999000102";
const SHOP = "e2e-store";
/** BL shop on the starter plan (plan checks). */
const LITE = "e2e-lite";
const RUN = Date.now().toString(36).slice(-6).toUpperCase();
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

const results = [];
const tokens = {};

async function call(method, path, body, { as = "owner", tenant = SHOP, raw = false, headers = {} } = {}) {
  const h = { ...headers };
  const isText = typeof body === "string";
  if (body !== undefined && !isText) h["content-type"] = "application/json";
  if (as && tokens[as]) h.authorization = `Bearer ${tokens[as]}`;
  if (tenant) h["x-tenant"] = tenant;
  const res = await fetch(API + path, { method, headers: h, body: body === undefined ? undefined : isText ? body : JSON.stringify(body) });
  if (raw) return { status: res.status, buf: Buffer.from(await res.arrayBuffer()), headers: res.headers };
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}
const expect = (c, m) => {
  if (!c) throw new Error(m);
};
const ok = (r, w) => {
  expect(r.status < 300, `${w}: ${r.status} ${JSON.stringify(r.json).slice(0, 400)}`);
  return r.json;
};
const fails = (r, status, code, w) => {
  expect(r.status === status && (!code || r.json?.error?.code === code), `${w}: expected ${status} ${code ?? ""}, got ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json;
};
async function step(name, fn) {
  try {
    results.push(["PASS", name, (await fn()) ?? ""]);
  } catch (e) {
    results.push(["FAIL", name, e.message]);
  }
}
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const rs = (p) => `₹${(p / 100).toFixed(2)}`;

/** Test identities get no message and no resend limits: request (as the apps do), then verify with the fixed code. */
async function signIn(as, target) {
  ok(await call("POST", "/v1/auth/otp/request", { target }, { as: null, tenant: null }), `otp request ${target}`);
  const r = await call("POST", "/v1/auth/otp/verify", { target, code: OTP }, { as: null, tenant: null });
  expect(r.status < 300, `otp verify ${target}: ${r.status} ${JSON.stringify(r.json).slice(0, 300)} (is TEST_OTP_CODE set for the API?)`);
  tokens[as] = r.json.token;
}
const stockAt = async (itemId, locationId) =>
  ok(await call("GET", `/v1/inventory/stock/${itemId}${locationId ? `?locationId=${locationId}` : ""}`), "stock");
const address = { name: "E2E Buyer", line1: "8, Nethaji Road", city: "Tiruchirappalli", stateCode: "33", pincode: "620001" };

// ------------------------------------------------------------------ sign in
await step("owner signs in (test OTP)", async () => {
  await signIn("owner", OWNER);
  return "ok";
});

// ------------------------------------------------------------------ catalogue
let category, product, variantS, variantM, variantL;
const PRICE = 100_000; // ₹1,000 incl. 5% GST
await step("catalogue: category + product with Size variants", async () => {
  category = ok(await call("POST", "/v1/catalog/categories", { name: `E2E Kurtis ${RUN}` }), "category");
  product = ok(
    await call("POST", "/v1/catalog/products", {
      name: `E2E Kurti ${RUN}`,
      categoryId: category.id,
      hsn: "6204",
      gstRate: 5,
      taxInclusive: true,
      options: [{ name: "Size", values: ["S", "M", "L"] }],
      variants: ["S", "M", "L"].map((size) => ({ sku: `E2E${RUN}-${size}`, optionValues: { Size: size }, price: PRICE, mrp: 120_000, cost: 60_000, weightGrams: 250 })),
    }),
    "product",
  );
  expect(product.variants.length === 3, `variants ${product.variants.length}`);
  [variantS, variantM, variantL] = ["S", "M", "L"].map((s) => product.variants.find((v) => v.title === s));
  expect(variantS && variantM && variantL, "variant titles");
  return `${product.slug}: ${product.variants.map((v) => `${v.title}=${v.sku}`).join(", ")}`;
});
await step("catalogue: SKU lookup (case-insensitive)", async () => {
  const v = ok(await call("GET", `/v1/catalog/variants/lookup?code=${encodeURIComponent(`e2e${RUN.toLowerCase()}-m`)}`), "lookup");
  expect(v.id === variantM.id && v.rate === Math.round((PRICE * 100) / 105), `lookup ${JSON.stringify(v).slice(0, 200)}`);
  return `${v.name} rate ${rs(v.rate)} (exclusive of ${rs(v.price)})`;
});
await step("catalogue: public listing hides cost", async () => {
  const list = ok(await call("GET", `/v1/catalog/public/products?q=${encodeURIComponent(`E2E Kurti ${RUN}`)}`, undefined, { as: null }), "public list");
  const hit = list.items.find((p) => p.id === product.id);
  expect(hit, "product not in public listing");
  const detail = await call("GET", `/v1/catalog/public/products/${product.slug}`, undefined, { as: null });
  ok(detail, "public detail");
  expect(detail.json.variants.length === 3, "public variants");
  expect(!JSON.stringify(detail.json).includes('"cost"'), "public product exposes cost");
  expect(!JSON.stringify(list.json ?? list).includes('"cost"'), "public listing exposes cost");
  return `listed ${hit.name} ${rs(hit.priceMin)}; variants without cost`;
});

// ------------------------------------------------------------------ billing items facade
let item;
await step("billing items facade: list + create → appears in the catalogue", async () => {
  const list = ok(await call("GET", "/v1/invoices/items?limit=200"), "items");
  expect(list.items.some((i) => i.name === "Silk dupatta"), "migrated legacy item missing from /v1/invoices/items");
  item = ok(await call("POST", "/v1/invoices/items", { name: `E2E Blouse stitching ${RUN}`, hsn: "9988", unit: "pcs", rate: 35_000, gstRate: 12 }), "create item");
  expect(item.rate === 35_000 && item.gstRate === 12, JSON.stringify(item));
  const v = ok(await call("GET", `/v1/catalog/variants?ids=${item.id}`), "variants").items[0];
  expect(v && v.price === 35_000 && v.isDefault && v.channels.includes("billing") && v.channels.includes("store"), `catalog variant ${JSON.stringify(v)}`);
  const again = ok(await call("GET", `/v1/invoices/items?q=${encodeURIComponent(`Blouse stitching ${RUN}`)}`), "items q");
  expect(again.items.length === 1 && again.items[0].id === item.id, "item not listed");
  return `${list.total} items; new item = variant ${item.id.slice(0, 8)} of product "${v.productName}"`;
});

// ------------------------------------------------------------------ inventory
let mainLoc, warehouse;
await step("inventory: default location exists", async () => {
  const locs = ok(await call("GET", "/v1/inventory/locations"), "locations").items;
  mainLoc = locs.find((l) => l.isDefault);
  expect(mainLoc, "no default location");
  return `${mainLoc.name} (${mainLoc.code}); ${locs.length} locations`;
});
await step("inventory: opening stock S=10, M=10 at the default location", async () => {
  for (const v of [variantS, variantM]) ok(await call("POST", `/v1/inventory/stock/${v.id}/adjust`, { mode: "set", qty: 10, unitCost: 57_143, note: "E2E opening" }), "adjust");
  const s = await stockAt(variantS.id);
  expect(s.qty === 10 && s.available === 10, `S ${s.qty}/${s.available}`);
  return "ok";
});
await step("inventory: transfer 3 × S to a new warehouse", async () => {
  warehouse = ok(await call("POST", "/v1/inventory/locations", { name: `E2E Warehouse ${RUN}`, code: `W${RUN}`, type: "warehouse" }), "location");
  const t = ok(await call("POST", "/v1/inventory/transfers", { fromLocationId: mainLoc.id, toLocationId: warehouse.id, lines: [{ itemId: variantS.id, qty: 3 }], note: "E2E" }), "transfer");
  const [atMain, atWh, total] = [await stockAt(variantS.id, mainLoc.id), await stockAt(variantS.id, warehouse.id), await stockAt(variantS.id)];
  expect(atMain.qty === 7 && atWh.qty === 3 && total.qty === 10, `main ${atMain.qty}, warehouse ${atWh.qty}, total ${total.qty}`);
  const transfers = ok(await call("GET", `/v1/inventory/transfers?locationId=${warehouse.id}`), "transfers");
  expect(transfers.items.some((x) => x.id === t.id), "transfer not listed");
  return `main 7, warehouse 3, total 10`;
});
await step("inventory: order for more than available → 409 insufficient_stock", async () => {
  const r = await call("POST", "/v1/orders", { customer: { name: `E2E Short ${RUN}` }, shippingAddress: address, lines: [{ variantId: variantS.id, qty: 8 }], paymentMethod: "cash" });
  const j = fails(r, 409, "insufficient_stock", "short order");
  const short = JSON.stringify(j.error.details);
  expect(short.includes(variantS.id) && short.includes('"available":7'), `details ${short}`);
  return short;
});

// ------------------------------------------------------------------ orders
const welcome = { id: null };
let orderA, orderB, orderC;
await step("orders: manual order with WELCOME10 → stock reserved, coupon redeemed", async () => {
  const c = ok(await call("GET", "/v1/coupons?q=WELCOME10"), "coupons").items.find((x) => x.code === "WELCOME10");
  expect(c, "WELCOME10 missing (run pnpm --filter @srirealtime/api seed:e2e)");
  welcome.id = c.id;
  orderA = ok(
    await call("POST", "/v1/orders", {
      customer: { name: `E2E Buyer A ${RUN}`, phone: "+919999000201" },
      shippingAddress: address,
      lines: [{ variantId: variantM.id, qty: 2 }],
      couponCode: "welcome10",
      paymentMethod: "cod",
    }),
    "order A",
  );
  expect(orderA.status === "placed" && orderA.couponCode === "WELCOME10", `${orderA.status} ${orderA.couponCode}`);
  expect(orderA.totals.subtotal === 2 * PRICE && orderA.totals.discount === 20_000, `totals ${JSON.stringify(orderA.totals).slice(0, 200)}`);
  const s = await stockAt(variantM.id);
  expect(s.qty === 10 && s.reserved === 2 && s.available === 8, `M qty ${s.qty} reserved ${s.reserved} available ${s.available}`);
  const red = ok(await call("GET", `/v1/coupons/${welcome.id}/redemptions`), "redemptions").items.find((x) => x.refId === orderA.id);
  expect(red?.status === "active", `redemption ${JSON.stringify(red)}`);
  return `${orderA.number} total ${rs(orderA.total)} (discount ${rs(orderA.totals.discount)}); M reserved 2`;
});
await step("orders: confirm → pack → ship → deliver; invoice once, stock reduced once", async () => {
  ok(await call("POST", `/v1/orders/${orderA.id}/status`, { status: "confirmed" }), "confirmed");
  ok(await call("POST", `/v1/orders/${orderA.id}/status`, { status: "packed" }), "packed");
  ok(await call("POST", `/v1/orders/${orderA.id}/status`, { status: "shipped", fulfillment: { carrier: "DTDC", trackingNumber: `E2E${RUN}` } }), "shipped");
  orderA = ok(await call("POST", `/v1/orders/${orderA.id}/status`, { status: "delivered" }), "delivered");
  expect(orderA.status === "delivered" && orderA.invoiceId, `status ${orderA.status} invoice ${orderA.invoiceId}`);
  expect(orderA.paymentStatus === "paid", `COD not paid on delivery: ${orderA.paymentStatus}`);
  fails(await call("POST", `/v1/orders/${orderA.id}/status`, { status: "delivered" }), 409, null, "deliver twice");
  await call("POST", `/v1/orders/${orderA.id}/invoice`); // retrying must not make a second invoice
  const bills = ok(await call("GET", `/v1/invoices?q=${encodeURIComponent(`E2E Buyer A ${RUN}`)}`), "invoices");
  expect(bills.total === 1 && bills.items[0].id === orderA.invoiceId, `invoices for the order: ${bills.total}`);
  const inv = ok(await call("GET", `/v1/invoices/${orderA.invoiceId}`), "invoice");
  expect(inv.status === "paid" && inv.total === orderA.total, `invoice ${inv.status} ${inv.total} vs ${orderA.total}`);
  // Tax-inclusive line: the order line and the invoice line total exactly what was charged (no ₹0.01 drift).
  const charged = 2 * PRICE - orderA.totals.discount;
  expect(orderA.lines[0].total === charged, `order line total ${orderA.lines[0].total} vs charged ${charged}`);
  expect(inv.lines[0].total === charged, `invoice line total ${inv.lines[0].total} vs charged ${charged}`);
  const s = await stockAt(variantM.id);
  expect(s.qty === 8 && s.reserved === 0 && s.available === 8, `M after delivery: qty ${s.qty} reserved ${s.reserved}`);
  return `${inv.number} ${rs(inv.total)} ${inv.status}; M qty 8 reserved 0`;
});
await step("orders: cancel → reservation and coupon released", async () => {
  orderB = ok(await call("POST", "/v1/orders", { customer: { name: `E2E Buyer B ${RUN}`, phone: "+919999000202" }, shippingAddress: address, lines: [{ variantId: variantM.id, qty: 1 }], couponCode: "WELCOME10", paymentMethod: "cod" }), "order B");
  let s = await stockAt(variantM.id);
  expect(s.reserved === 1 && s.available === 7, `M reserved ${s.reserved}`);
  orderB = ok(await call("POST", `/v1/orders/${orderB.id}/status`, { status: "cancelled", note: "E2E cancel" }), "cancel");
  s = await stockAt(variantM.id);
  expect(s.qty === 8 && s.reserved === 0 && s.available === 8, `M after cancel: qty ${s.qty} reserved ${s.reserved}`);
  const reds = ok(await call("GET", `/v1/coupons/${welcome.id}/redemptions`), "redemptions").items;
  expect(reds.find((x) => x.refId === orderB.id)?.status === "released", "B redemption not released");
  expect(reds.find((x) => x.refId === orderA.id)?.status === "active", "A redemption changed");
  return `${orderB.number} cancelled; M available 8; redemption released`;
});
await step("orders: online order paid via mock checkout (purpose order)", async () => {
  orderC = ok(await call("POST", "/v1/orders", { customer: { name: `E2E Buyer C ${RUN}`, phone: "+919999000203" }, shippingAddress: address, lines: [{ variantId: variantL.id, qty: 1, price: PRICE }], paymentMethod: "online", allowBackorder: true }), "order C");
  expect(orderC.paymentStatus !== "paid", orderC.paymentStatus);
  const co = ok(await call("POST", "/v1/payments/checkout", { kind: "order", ref: orderC.accessToken }, { as: null, tenant: null }), "checkout");
  expect(co.amount === orderC.total, `checkout ${co.amount} vs ${orderC.total}`);
  ok(await call("POST", "/v1/payments/mock/complete", { orderId: co.orderId, method: "upi" }, { as: null, tenant: null }), "mock complete");
  const o = ok(await call("GET", `/v1/orders/${orderC.id}`), "order C");
  expect(o.paymentStatus === "paid" && o.paid === o.total, `payment ${o.paymentStatus} ${o.paid}/${o.total}`);
  return `${o.number} ${rs(o.total)} paid via ${co.provider}`;
});

// ------------------------------------------------------------------ coupons
await step("coupons: invalid reasons", async () => {
  const mk = async (suffix, extra) => ok(await call("POST", "/v1/coupons", { code: `E2E${RUN}${suffix}`, type: "percent", value: 10, ...extra }), `coupon ${suffix}`);
  await mk("OFF", { active: false });
  await mk("MIN", { minOrder: 1_000_000 });
  await mk("SOON", { startsAt: new Date(Date.now() + 86_400_000).toISOString() });
  await mk("MAN", { channels: ["manual"] });
  const reason = async (code) => ok(await call("POST", "/v1/coupons/public/validate", { code, subtotal: 100_000 }, { as: null }), `validate ${code}`).reason;
  const got = {
    not_found: await reason(`NOPE${RUN}`),
    inactive: await reason(`E2E${RUN}OFF`),
    min_order: await reason(`E2E${RUN}MIN`),
    not_started: await reason(`E2E${RUN}SOON`),
    wrong_channel: await reason(`E2E${RUN}MAN`),
  };
  for (const [want, have] of Object.entries(got)) expect(want === have, `expected ${want}, got ${have}`);
  const good = ok(await call("POST", "/v1/coupons/public/validate", { code: "WELCOME10", subtotal: 100_000 }, { as: null }), "validate WELCOME10");
  expect(good.valid === true && good.discount === 10_000, JSON.stringify(good));
  return Object.values(got).join(", ");
});
await step("coupons: usage limit 1", async () => {
  ok(await call("POST", "/v1/coupons", { code: `E2E${RUN}ONE`, type: "flat", value: 5_000, usageLimit: 1, channels: ["store", "manual"] }), "coupon ONE");
  const d = ok(await call("POST", "/v1/orders", { customer: { name: `E2E Buyer D ${RUN}` }, shippingAddress: address, lines: [{ variantId: variantM.id, qty: 1 }], couponCode: `E2E${RUN}ONE` }), "order D");
  const v = ok(await call("POST", "/v1/coupons/public/validate", { code: `E2E${RUN}ONE`, subtotal: 100_000 }, { as: null }), "validate").reason;
  expect(v === "usage_limit", `reason ${v}`);
  const e = await call("POST", "/v1/orders", { customer: { name: `E2E Buyer E ${RUN}` }, shippingAddress: address, lines: [{ variantId: variantM.id, qty: 1 }], couponCode: `E2E${RUN}ONE` });
  expect(e.status >= 400 && e.status < 500, `second use: ${e.status}`);
  ok(await call("POST", `/v1/orders/${d.id}/status`, { status: "cancelled" }), "cancel D");
  return `first order ${d.number} ok; validate → usage_limit; second order ${e.status} ${e.json?.error?.code}`;
});

// ------------------------------------------------------------------ staff
const ROLE = "e2e-cashier";
const CASHIER_PERMS = ["invoices.create", "payments.receive", "customers.create", "catalogue.view"];
async function ensureMember(phone, roleKeys) {
  const r = await call("POST", "/v1/staff/invites", { target: phone, roleKeys });
  if (r.status === 409) {
    const m = ok(await call("GET", "/v1/staff/members"), "members").items.find((x) => x.phone === phone);
    expect(m, `member ${phone} not listed`);
    return ok(await call("PATCH", `/v1/staff/members/${m.userId}`, { roleKeys, active: true }), "patch member");
  }
  return ok(r, `invite ${phone}`);
}
let cashierBill;
await step("staff: Cashier role + invite by phone", async () => {
  const r = await call("POST", "/v1/staff/roles", { key: ROLE, name: "Cashier (E2E)", permissions: CASHIER_PERMS });
  if (r.status === 409) ok(await call("PATCH", `/v1/staff/roles/${ROLE}`, { permissions: CASHIER_PERMS }), "patch role");
  else ok(r, "create role");
  const m = await ensureMember(CASHIER_PHONE, [ROLE]);
  expect(m.roles.includes(`role:${ROLE}`) && m.roles.includes("staff"), `roles ${m.roles}`);
  await ensureMember(STAFF_PHONE, []);
  return `${CASHIER_PHONE} → ${m.roles.join(", ")}`;
});
await step("staff: cashier signs in (OTP), bills and receives payment, cannot cancel or discount", async () => {
  await signIn("cashier", CASHIER_PHONE);
  const line = { description: `E2E counter sale ${RUN}`, qty: 1, rate: 50_000, gstRate: 5 };
  cashierBill = ok(await call("POST", "/v1/invoices", { customer: { name: `E2E Walk-in ${RUN}` }, date: today, issue: true, lines: [line] }, { as: "cashier" }), "cashier bill");
  ok(await call("POST", `/v1/invoices/${cashierBill.id}/payments`, { amount: 10_000, method: "cash", date: today }, { as: "cashier" }), "cashier payment");
  const c = fails(await call("POST", `/v1/invoices/${cashierBill.id}/cancel`, { reason: "E2E" }, { as: "cashier" }), 403, "permission_denied", "cashier cancel");
  expect(c.error.details?.permission === "invoices.cancel", JSON.stringify(c.error));
  fails(await call("POST", "/v1/invoices", { date: today, lines: [{ ...line, discount: 1_000 }] }, { as: "cashier" }), 403, "permission_denied", "cashier discount");
  fails(await call("POST", "/v1/catalog/products", { name: "x", price: 100 }, { as: "cashier" }), 403, "permission_denied", "cashier catalogue write");
  return `${cashierBill.number} by cashier; cancel → 403 ${c.error.details.permission}`;
});
await step("staff: plain staff (default role) keeps daily billing work", async () => {
  await signIn("staff", STAFF_PHONE);
  const b = ok(await call("POST", "/v1/invoices", { customer: { name: `E2E Staff sale ${RUN}` }, date: today, issue: true, lines: [{ description: "E2E item", qty: 2, rate: 20_000, discount: 1_000, gstRate: 5 }] }, { as: "staff" }), "staff bill");
  ok(await call("POST", `/v1/invoices/${b.id}/payments`, { amount: b.total, method: "upi", date: today }, { as: "staff" }), "staff payment");
  ok(await call("POST", "/v1/invoices/customers", { name: `E2E Staff customer ${RUN}`, phone: "+919999000204" }, { as: "staff" }), "staff customer");
  ok(await call("GET", "/v1/invoices/summary", undefined, { as: "staff" }), "staff summary");
  ok(await call("GET", "/v1/orders", undefined, { as: "staff" }), "staff orders view");
  fails(await call("POST", `/v1/invoices/${b.id}/cancel`, {}, { as: "staff" }), 403, "permission_denied", "staff cancel");
  return `${b.number} with discount, paid; cancel → 403`;
});
await step("owner cancels the cashier's bill", async () => {
  const j = ok(await call("POST", `/v1/invoices/${cashierBill.id}/cancel`, { reason: "E2E cleanup" }), "owner cancel");
  expect(j.status === "cancelled", j.status);
  return j.status;
});

// ------------------------------------------------------------------ audit
await step("audit: the actions above are logged", async () => {
  // The host writes audit rows in onResponse, i.e. just after the response went out: give the last ones a moment.
  let j;
  for (let i = 0; i < 10; i++) {
    j = ok(await call("GET", "/v1/audit?limit=500"), "audit");
    if (j.items.some((e) => e.entityId === cashierBill.id && /cancel/.test(e.action))) break;
    await sleep(200);
  }
  const has = (pred, what) => expect(j.items.some(pred), `audit has no ${what}`);
  has((e) => e.entityId === orderA.id && /status/.test(e.action), "order status change");
  has((e) => e.entityId === cashierBill.id && /cancel/.test(e.action), "invoice cancel");
  has((e) => /^staff\.role\.(create|update)$/.test(e.action), "staff role create/update");
  has((e) => /^staff\.member\.(invite|update)$/.test(e.action), "staff member invite/update");
  has((e) => /coupons/.test(e.action), "coupon create");
  has((e) => /transfers/.test(e.action), "stock transfer");
  const mine = j.items.filter((e) => [orderA.id, cashierBill.id, product.id].includes(e.entityId));
  return `${j.total} events; e.g. ${mine.slice(0, 3).map((e) => e.action).join(" | ")}`;
});

// ------------------------------------------------------------------ documents
const isPdf = (r, w) => {
  expect(r.status === 200 && r.headers.get("content-type") === "application/pdf", `${w}: ${r.status} ${r.buf.toString("utf8", 0, 200)}`);
  expect(r.buf.subarray(0, 4).toString() === "%PDF", `${w}: not a PDF`);
  return `${(r.buf.length / 1024).toFixed(0)} KB`;
};
await step("documents: invoice A4, thermal receipt, packing slip, public invoice", async () => {
  const a4 = isPdf(await call("GET", `/v1/documents/invoice/${orderA.invoiceId}.pdf`, undefined, { raw: true }), "invoice");
  const thermal = isPdf(await call("GET", `/v1/documents/invoice-thermal/${orderA.invoiceId}.pdf?locale=ta`, undefined, { raw: true }), "thermal");
  const slip = isPdf(await call("GET", `/v1/documents/packing-slip/${orderA.id}.pdf`, undefined, { raw: true }), "packing slip");
  const share = ok(await call("POST", `/v1/invoices/${orderA.invoiceId}/share`), "share");
  const pub = isPdf(await call("GET", `/v1/documents/public/invoice/${share.token}.pdf`, undefined, { raw: true, as: null, tenant: null }), "public invoice");
  const missing = await call("GET", `/v1/documents/invoice/00000000-0000-4000-8000-000000000000.pdf`, undefined, { raw: true });
  expect(missing.status === 404, `unknown invoice → ${missing.status}`);
  return `invoice ${a4}, thermal ${thermal}, slip ${slip}, public ${pub}`;
});

// ------------------------------------------------------------------ import / export
await step("import: products CSV preview → commit → products and stock exist", async () => {
  const csv = [
    "Name,Variant,SKU,Category,HSN,GST %,Price,MRP,Tax inclusive,Opening stock",
    `E2E Imported Tee ${RUN},S,IMP${RUN}-S,E2E Imports ${RUN},6109,5,499,599,yes,4`,
    `E2E Imported Tee ${RUN},M,IMP${RUN}-M,E2E Imports ${RUN},6109,5,499,599,yes,6`,
    `E2E Imported Mug ${RUN},,IMP${RUN}-MUG,E2E Imports ${RUN},6912,18,"1,250.00",,no,10`,
    "Broken row,,BAD,,,7,abc,,maybe,",
  ].join("\r\n");
  const p = ok(await call("POST", "/v1/import/catalog.products/preview", "﻿" + csv, { headers: { "content-type": "text/csv", "x-file-name": "products.csv" } }), "preview");
  expect(p.totals.rows === 4 && p.totals.valid === 3 && p.totals.invalid === 1, `totals ${JSON.stringify(p.totals)}`);
  ok(await call("POST", `/v1/import/${p.jobId}/commit`, { skipInvalid: true }), "commit");
  let st;
  for (let i = 0; i < 40; i++) {
    st = ok(await call("GET", `/v1/import/${p.jobId}`), "status");
    if (st.status === "done" || st.status === "failed") break;
    await sleep(250);
  }
  expect(st.status === "done" && st.created === 3, `job ${JSON.stringify(st).slice(0, 300)}`);
  const tee = ok(await call("GET", `/v1/catalog/variants/lookup?code=IMP${RUN}-M`), "lookup tee");
  expect(tee.price === 49_900 && tee.taxInclusive && tee.productName === `E2E Imported Tee ${RUN}`, JSON.stringify(tee).slice(0, 200));
  const mug = ok(await call("GET", `/v1/catalog/variants/lookup?code=IMP${RUN}-MUG`), "lookup mug");
  expect(mug.price === 125_000 && mug.gstRate === 18, JSON.stringify(mug).slice(0, 200));
  const s = await stockAt(tee.id);
  expect(s.qty === 6, `tee M stock ${s.qty}`);
  const prod = ok(await call("GET", `/v1/catalog/products/${tee.productId}`), "product");
  expect(prod.variants.length === 2 && prod.categoryId, `tee variants ${prod.variants.length}, category ${prod.categoryId}`);
  return `job ${st.status}: created ${st.created}, failed ${st.failed}; tee M stock ${s.qty}`;
});
await step("export: customers.csv and products.xlsx", async () => {
  const r = await call("GET", "/v1/export/invoices.customers.csv", undefined, { raw: true });
  expect(r.status === 200 && r.headers.get("content-type").includes("text/csv"), `customers.csv ${r.status} ${r.buf.toString("utf8", 0, 200)}`);
  const text = r.buf.toString("utf8").replace(/^﻿/, "");
  expect(text.split(/\r?\n/)[0].startsWith("Name,Phone"), `header ${text.slice(0, 80)}`);
  expect(text.includes(`E2E Staff customer ${RUN}`), "new customer missing from export");
  const x = await call("GET", "/v1/export/catalog.products.xlsx", undefined, { raw: true });
  expect(x.status === 200 && x.buf.subarray(0, 2).toString() === "PK", `products.xlsx ${x.status}`);
  return `${text.split(/\r?\n/).filter(Boolean).length - 1} customers; products.xlsx ${(x.buf.length / 1024).toFixed(0)} KB`;
});

// ------------------------------------------------------------------ features
await step("features: e2e-store (EC) has no credit book", async () => {
  const f = ok(await call("GET", "/v1/features"), "features");
  expect(!f.enabled.includes("invoices.credit-book") && f.enabled.includes("orders") && f.enabled.includes("catalogue.variants"), `enabled ${f.enabled}`);
  const r = fails(await call("GET", "/v1/invoices/credit-book"), 403, "feature_disabled", "credit book");
  return `credit book → 403 ${r.error.details?.reason}`;
});
await step("features: e2e-lite (starter) has no purchases", async () => {
  const f = ok(await call("GET", "/v1/features", undefined, { tenant: LITE }), "features");
  expect(!f.enabled.includes("inventory.purchases") && f.enabled.includes("inventory"), `enabled ${f.enabled}`);
  const r = fails(await call("GET", "/v1/inventory/purchases", undefined, { tenant: LITE }), 402, "plan_limit", "purchases");
  const v = await call("POST", "/v1/catalog/products", { name: "x", options: [{ name: "Size", values: ["S"] }], variants: [{ price: 100, optionValues: { Size: "S" } }] }, { tenant: LITE });
  expect(v.status === 403 || v.status === 402, `${LITE} variants → ${v.status}`);
  return `purchases → 402 ${r.error.details?.reason}; variants → ${v.status}`;
});

for (const [s, n, o] of results) console.log(`${s}  ${n}${o ? "  →  " + o : ""}`);
const passed = results.filter((r) => r[0] === "PASS").length;
console.log(`\n${passed}/${results.length} passed (run ${RUN})`);
process.exitCode = passed === results.length ? 0 : 1;
