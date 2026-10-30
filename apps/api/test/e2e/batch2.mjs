// Batch 2a end-to-end (online store server side) against the running API (http://localhost:4000) and the real database.
//   node test/e2e/batch2.mjs      (pnpm --filter @rbms/api test:e2e:2; test:e2e:all seeds and runs every script)
// The API must run in development (test OTP via TEST_OTP_CODE / TEST_OTP_TARGETS, mock payments and the mock carrier).
// Shops: e2e-store (EC, pro; `pnpm --filter @rbms/api seed:e2e` creates its store content), e2e-bill (BL) and
// e2e-lite (BL, starter). Owner e2e-owner@example.com (a super-admin in the e2e seed, for the custom-domain force step).
// Each run signs up a new shopper (+91 9999 00xxxx), so it is safe to re-run.
import { spawnSync } from "node:child_process";

const API = process.env.API_URL ?? "http://localhost:4000";
const OWNER = process.env.E2E_OWNER ?? "e2e-owner@example.com";
const OTP = process.env.E2E_OTP ?? "123456";
const SHOP = "e2e-store";
const SHOP_NAME = "E2E Store";
/** BL shop without the online store. */
const BILL = "e2e-bill";
/** BL shop on the starter plan (no custom domain). */
const LITE = "e2e-lite";
const RUN = Date.now().toString(36).slice(-6).toUpperCase();
/** A new shopper every run: +91 9999 00 5000–9999 (test OTP numbers; lower ones are the fixed batch-1 identities). */
const SHOPPER_PHONE = `+91999900${5000 + (Date.now() % 5000)}`;
const STORE_ORIGIN = "http://e2e-store.localhost:3003";
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
  if (raw) return { status: res.status, text: await res.text(), headers: res.headers };
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
const eq = (a, b, w) => expect(a === b, `${w}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
async function step(name, fn) {
  try {
    results.push(["PASS", name, (await fn()) ?? ""]);
  } catch (e) {
    results.push(["FAIL", name, e.message]);
  }
}
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const rs = (p) => `₹${(p / 100).toFixed(2)}`;
/** Order totals round to the rupee (GST invoice rule). */
const rupee = (p) => Math.round(p / 100) * 100;

/** Test identities get no message and no resend limits: request (as the apps do), then verify with the fixed code. */
async function signIn(as, target, tenant = null) {
  ok(await call("POST", "/v1/auth/otp/request", { target }, { as: null, tenant }), `otp request ${target}`);
  const r = await call("POST", "/v1/auth/otp/verify", { target, code: OTP }, { as: null, tenant });
  expect(r.status < 300, `otp verify ${target}: ${r.status} ${JSON.stringify(r.json).slice(0, 300)} (is TEST_OTP_CODE set for the API?)`);
  tokens[as] = r.json.token;
}
const stockOf = async (itemId) => ok(await call("GET", `/v1/inventory/stock/${itemId}`), "stock");
const shopper = { as: "shopper" };
const anon = { as: null };

// ------------------------------------------------------------------ setup
let tenantId, ak, cp, akS, akM, cpM;
await step("owner signs in; demo products found; stock topped up", async () => {
  await signIn("owner", OWNER);
  tenantId = ok(await call("GET", "/v1/tenancy/current"), "tenant").id;
  ak = ok(await call("GET", "/v1/catalog/public/products/anarkali-kurti", undefined, anon), "Anarkali Kurti (run pnpm --filter @rbms/api seed:e2e)");
  cp = ok(await call("GET", "/v1/catalog/public/products/cotton-palazzo", undefined, anon), "Cotton Palazzo");
  [akS, akM] = ["S", "M"].map((t) => ak.variants.find((v) => v.title === t));
  cpM = cp.variants.find((v) => v.title === "M");
  expect(akS && akM && cpM, "size variants missing");
  eq(akM.price, 99_900, "AK-M price");
  eq(cpM.price, 59_900, "CP-M price");
  for (const v of [akS, akM, cpM]) {
    const s = await stockOf(v.id);
    ok(await call("POST", `/v1/inventory/stock/${v.id}/adjust`, { mode: "set", qty: s.reserved + 20, note: `E2E batch2 ${RUN}` }), "top up");
  }
  return `tenant ${tenantId.slice(0, 8)}; AK-M ${rs(akM.price)}, CP-M ${rs(cpM.price)}; available 20 each`;
});

// ------------------------------------------------------------------ public store
await step("public config", async () => {
  const c = ok(await call("GET", "/v1/store/config", undefined, anon), "config");
  eq(c.shop.name, SHOP_NAME, "shop name");
  expect(c.open === true && c.codEnabled === true && c.codMaxAmount === 500_000 && c.guestCheckout === false, JSON.stringify(c).slice(0, 300));
  expect(c.policies.returns.length > 0 && c.shop.css.includes("--primary"), "policies / css");
  return `${c.shop.name}: open, COD up to ${rs(c.codMaxAmount)}, contact ${c.shop.contactPhone}`;
});
await step("home page: published sections resolved", async () => {
  const h = ok(await call("GET", "/v1/cms/public/home", undefined, anon), "home");
  const types = h.sections.map((s) => s.type);
  for (const t of ["hero", "categories", "collection", "usp", "testimonials"]) expect(types.includes(t), `home has no ${t}: ${types}`);
  const cats = h.sections.find((s) => s.type === "categories");
  expect(cats.categories?.some((c) => c.name === "Kurtis" && c.slug), `categories not resolved ${JSON.stringify(cats).slice(0, 200)}`);
  const col = h.sections.find((s) => s.type === "collection");
  expect(col.products?.length > 0 && col.products[0].slug && col.products[0].priceMin > 0, `collection not resolved ${JSON.stringify(col).slice(0, 200)}`);
  return `${types.join(", ")}; ${cats.categories.length} categories; "${col.title}" ${col.products.length} products`;
});
await step("menus: header and footer", async () => {
  const m = ok(await call("GET", "/v1/cms/public/menus", undefined, anon), "menus");
  expect(m.header.some((i) => i.href === "/collections/new-arrivals") && m.footer.some((i) => i.children?.length), JSON.stringify(m).slice(0, 300));
  return `header ${m.header.map((i) => i.label).join(" | ")}; footer ${m.footer.length} items`;
});
await step("search with facets + suggest", async () => {
  const r = ok(await call("GET", "/v1/catalog/public/search?q=kurti&limit=50", undefined, anon), "search");
  expect(r.items.some((p) => p.id === ak.id), "Anarkali Kurti not found for 'kurti'");
  expect(r.facets.categories.some((c) => c.name === "Kurtis" && c.count > 0), `category facet ${JSON.stringify(r.facets.categories)}`);
  expect(r.facets.price.min > 0 && r.facets.price.max >= r.facets.price.min, `price facet ${JSON.stringify(r.facets.price)}`);
  expect(r.facets.options.Size?.some((o) => o.value === "M"), `Size facet ${JSON.stringify(r.facets.options)}`);
  const f = ok(await call("GET", "/v1/catalog/public/search?q=kurti&opt.Size=S&sort=price-asc", undefined, anon), "filtered");
  expect(f.items.some((p) => p.id === ak.id) && !f.items.some((p) => p.id === cp.id), "Size=S filter");
  const fuzzy = ok(await call("GET", "/v1/catalog/public/search?q=palazo", undefined, anon), "typo search");
  expect(fuzzy.items.some((p) => p.id === cp.id), "trigram match for 'palazo'");
  const s = ok(await call("GET", "/v1/catalog/public/search/suggest?q=anar", undefined, anon), "suggest");
  expect(s.products.some((p) => p.slug === "anarkali-kurti"), `suggest ${JSON.stringify(s)}`);
  return `${r.total} hits; facets: ${r.facets.categories.length} categories, price ${rs(r.facets.price.min)}–${rs(r.facets.price.max)}, Size ${r.facets.options.Size.map((o) => `${o.value}:${o.count}`).join(" ")}; "palazo" → ${fuzzy.items[0].name}; suggest → ${s.products.map((p) => p.name).join(", ")}`;
});
await step("collection page + product page", async () => {
  const c = ok(await call("GET", "/v1/catalog/public/collections/new-arrivals?limit=50", undefined, anon), "collection");
  expect(c.collection.name === "New arrivals" && c.total > 0 && c.items.length > 0, JSON.stringify(c).slice(0, 200));
  const list = ok(await call("GET", "/v1/catalog/public/collections", undefined, anon), "collections");
  expect(list.items.some((x) => x.slug === "new-arrivals"), "collection list");
  expect(ak.variants.length === 3 && ak.categoryName === "Kurtis" && ak.priceMin === 99_900 && !JSON.stringify(ak).includes('"cost"'), "product page");
  return `${c.collection.name}: ${c.total} products; ${ak.name} ${ak.variants.map((v) => v.title).join("/")} in ${ak.categoryName}`;
});
await step("pincode lookup 620001 + delivery quotes", async () => {
  const p = ok(await call("GET", "/v1/delivery/public/pincode/620001", undefined, anon), "pincode");
  expect(p.stateCode === "33" && /Tiruchirappalli|Trichy/i.test(`${p.city} ${p.district}`), JSON.stringify(p));
  const small = ok(await call("POST", "/v1/delivery/public/quote", { pincode: "620001", weightGrams: 500, subtotal: 59_900, cod: true }, anon), "quote");
  expect(small.serviceable && small.options.length === 1, JSON.stringify(small));
  const o = small.options[0];
  expect(o.amount === 4_000 && o.codAllowed && o.codFee === 3_000 && o.etaDays[0] === 1 && o.etaDays[1] === 3, `TN rate ${JSON.stringify(o)}`);
  const big = ok(await call("POST", "/v1/delivery/public/quote", { pincode: "620001", weightGrams: 500, subtotal: 99_900, cod: false }, anon), "quote");
  eq(big.options[0].amount, 0, "free above ₹999");
  const blr = ok(await call("POST", "/v1/delivery/public/quote", { pincode: "560001", weightGrams: 800, subtotal: 99_900, cod: false }, anon), "quote BLR");
  expect(blr.serviceable && blr.options[0].amount === 11_000 && blr.options[0].etaDays[1] === 7, `Rest of India ${JSON.stringify(blr)}`);
  return `${p.city} (${p.state}${p.approximate ? ", offline fallback" : ""}); TN ₹40 + COD ₹30, free at ₹999; Bengaluru 800 g ${rs(blr.options[0].amount)}`;
});

// ------------------------------------------------------------------ cart
let cartToken, anonCart;
await step("cart: create, add 2 variants, WELCOME10, pincode → priced exactly", async () => {
  cartToken = ok(await call("POST", "/v1/store/cart", undefined, anon), "cart").token;
  expect(/^[A-Za-z0-9_-]{24,}$/.test(cartToken), `token ${cartToken}`);
  ok(await call("PUT", `/v1/store/cart/${cartToken}/lines`, { variantId: akM.id, qty: 1 }, anon), "add AK-M");
  let c = ok(await call("PUT", `/v1/store/cart/${cartToken}/lines`, { variantId: cpM.id, qty: 2 }, anon), "add CP-M");
  eq(c.subtotal, 219_700, "subtotal");
  c = ok(await call("POST", `/v1/store/cart/${cartToken}/coupon`, { code: "welcome10" }, anon), "coupon");
  expect(c.coupon?.code === "WELCOME10" && c.coupon.valid === true, `coupon ${JSON.stringify(c.coupon)}`);
  c = ok(await call("POST", `/v1/store/cart/${cartToken}/pincode`, { pincode: "620001" }, anon), "pincode");
  eq(c.itemCount, 3, "itemCount");
  eq(c.subtotal, 219_700, "subtotal");
  eq(c.discount, 21_970, "discount (10%)");
  eq(c.total, 197_730, "total");
  const lAK = c.lines.find((l) => l.variantId === akM.id);
  const lCP = c.lines.find((l) => l.variantId === cpM.id);
  expect(lAK.lineTotal === 99_900 && lCP.lineTotal === 119_800 && lAK.productSlug === "anarkali-kurti" && lAK.available, `lines ${JSON.stringify(c.lines).slice(0, 300)}`);
  expect(c.delivery?.serviceable && c.delivery.options[0].amount === 0, `delivery ${JSON.stringify(c.delivery)}`);
  anonCart = c;
  return `${c.itemCount} items ${rs(c.subtotal)} − ${rs(c.discount)} = ${rs(c.total)}; delivery to ${c.pincode}: ${c.delivery.options[0].name} ${rs(c.delivery.options[0].amount)}`;
});
await step("cart: qty capped by stock; unknown cart 404", async () => {
  const c = ok(await call("PUT", `/v1/store/cart/${cartToken}/lines`, { variantId: cpM.id, qty: 50 }, anon), "qty 50");
  const l = c.lines.find((x) => x.variantId === cpM.id);
  expect(l.qty === 20 && l.maxQty === 20 && l.problem === "qty_reduced", `capped ${JSON.stringify(l)}`);
  ok(await call("PUT", `/v1/store/cart/${cartToken}/lines`, { variantId: cpM.id, qty: 2 }, anon), "back to 2");
  fails(await call("GET", "/v1/store/cart/doesnotexistdoesnotexist00", undefined, anon), 404, "not_found", "unknown cart");
  return `qty 50 → 20 (qty_reduced)`;
});

// ------------------------------------------------------------------ shopper
let me, address;
await step(`shopper signs up with OTP (${SHOPPER_PHONE}) and merges the anonymous cart`, async () => {
  await signIn("shopper", SHOPPER_PHONE, SHOP);
  me = ok(await call("GET", "/v1/store/me", undefined, shopper), "me");
  expect(me.customer.phone === SHOPPER_PHONE && me.counts.orders === 0 && me.customer.totalSpent === 0, JSON.stringify(me));
  ok(await call("PATCH", "/v1/store/me", { name: `E2E Shopper ${RUN}`, email: `shopper-${RUN.toLowerCase()}@example.com` }, shopper), "patch me");
  fails(await call("GET", "/v1/staff/members", undefined, shopper), 403, null, "shopper is not staff");
  const merged = ok(await call("POST", `/v1/store/cart/${cartToken}/merge`, undefined, shopper), "merge");
  expect(merged.itemCount === 3 && merged.total === 197_730 && merged.coupon?.valid, `merged ${JSON.stringify(merged).slice(0, 300)}`);
  cartToken = merged.token;
  const again = ok(await call("POST", "/v1/store/cart", undefined, shopper), "shopper cart");
  eq(again.token, cartToken, "shopper's cart token");
  return `store customer ${me.customer.id.slice(0, 8)}; merged cart ${rs(merged.total)}`;
});
await step("addresses: add, default, list", async () => {
  address = ok(
    await call("POST", "/v1/store/me/addresses", { label: "Home", name: `E2E Shopper ${RUN}`, phone: SHOPPER_PHONE, line1: "8, Nethaji Road", city: "Tiruchirappalli", stateCode: "33", pincode: "620001" }, shopper),
    "address",
  );
  expect(address.isDefault, "first address is default");
  const second = ok(await call("POST", "/v1/store/me/addresses", { name: "Office", phone: "9999000999", line1: "1, MG Road", city: "Bengaluru", stateCode: "29", pincode: "560001" }, shopper), "address 2");
  ok(await call("POST", `/v1/store/me/addresses/${second.id}/default`, undefined, shopper), "default");
  ok(await call("POST", `/v1/store/me/addresses/${address.id}/default`, undefined, shopper), "default back");
  const list = ok(await call("GET", "/v1/store/me/addresses", undefined, shopper), "addresses");
  expect(list.total === 2 && list.items[0].id === address.id && list.items[0].isDefault && !list.items[1].isDefault, JSON.stringify(list).slice(0, 300));
  return `${list.total} addresses; default ${list.items[0].city}`;
});

// ------------------------------------------------------------------ checkout COD
let orderA, stockBefore;
await step("checkout COD → order with COD fee, stock reserved, cart cleared", async () => {
  stockBefore = { ak: await stockOf(akM.id), cp: await stockOf(cpM.id) };
  const quote = ok(await call("GET", `/v1/store/cart/${cartToken}?pincode=620001`, undefined, shopper), "cart");
  const r = ok(await call("POST", "/v1/store/checkout", { cartToken, addressId: address.id, deliveryOptionId: quote.delivery.options[0].id, paymentMethod: "cod", customerNote: "E2E" }, shopper), "checkout");
  expect(r.payment === null && r.accessToken && r.order.status === "placed" && r.order.paymentStatus === "cod", JSON.stringify(r));
  orderA = ok(await call("GET", `/v1/store/me/orders/${r.order.id}`, undefined, shopper), "my order");
  const t = orderA.totals;
  expect(t.subtotal === 219_700 && t.discount === 21_970 && t.shipping === 0 && t.codFee === 3_000, `totals ${JSON.stringify(t).slice(0, 300)}`);
  eq(orderA.total, rupee(219_700 - 21_970 + 3_000), "order total");
  expect(t.codFeeLine?.description === "COD charges", "COD line");
  expect(orderA.couponCode === "WELCOME10" && orderA.customer.accountId === me.customer.id, "coupon/account");
  const s = { ak: await stockOf(akM.id), cp: await stockOf(cpM.id) };
  expect(s.ak.reserved === stockBefore.ak.reserved + 1 && s.cp.reserved === stockBefore.cp.reserved + 2, `reserved AK ${s.ak.reserved} CP ${s.cp.reserved}`);
  const cart = ok(await call("GET", `/v1/store/cart/${cartToken}`, undefined, shopper), "cart after");
  expect(cart.itemCount === 0 && cart.coupon === null, "cart not cleared");
  return `${orderA.number}: ${rs(t.subtotal)} − ${rs(t.discount)} + COD ${rs(t.codFee)} = ${rs(orderA.total)} (round-off ${t.roundOff}); reserved AK-M +1, CP-M +2`;
});
await step("order in /me/orders and the staff list; track by token (no street address)", async () => {
  const mine = ok(await call("GET", "/v1/store/me/orders", undefined, shopper), "my orders");
  expect(mine.total === 1 && mine.items[0].id === orderA.id, JSON.stringify(mine).slice(0, 200));
  const staff = ok(await call("GET", `/v1/orders?q=${encodeURIComponent(orderA.number)}`), "staff orders");
  expect(staff.items.some((o) => o.id === orderA.id && o.channel === "store"), "staff list");
  fails(await call("GET", `/v1/store/me/orders/${orderA.id}`, undefined, { as: "owner" }), 404, "not_found", "another shopper's order");
  const tr = ok(await call("GET", `/v1/store/track/${orderA.accessToken}`, undefined, anon), "track");
  expect(tr.number === orderA.number && tr.status === "placed" && tr.shipTo.city === "Tiruchirappalli" && tr.totals.codFee === 3_000, JSON.stringify(tr).slice(0, 300));
  expect(!JSON.stringify(tr).includes("Nethaji"), "tracking exposes the street address");
  // Another shop never shows it: e2e-bill (billing app) has no store at all, so the feature check answers first.
  const other = await call("GET", `/v1/store/track/${orderA.accessToken}`, undefined, { as: null, tenant: BILL });
  expect(other.status === 403 || other.status === 404, `track in another shop: ${other.status}`);
  const summary = ok(await call("GET", "/v1/orders/summary"), "staff orders summary");
  expect(summary.today.count >= 1, `summary ${JSON.stringify(summary)}`);
  return `${mine.total} order; staff sees ${orderA.number}; tracking: ${tr.timeline.map((e) => e.status).join(" → ")}, ship to ${tr.shipTo.city} ${tr.shipTo.pincode}`;
});

let freeShip, orderB;
await step("checkout COD with a free-shipping coupon: shipping waived, COD fee still charged", async () => {
  freeShip = `E2EFS${RUN}`;
  ok(await call("POST", "/v1/coupons", { code: freeShip, type: "free_shipping", value: 0, channels: ["store"] }), "free-shipping coupon");
  ok(await call("PUT", `/v1/store/cart/${cartToken}/lines`, { variantId: cpM.id, qty: 1 }, shopper), "add CP-M");
  const c = ok(await call("POST", `/v1/store/cart/${cartToken}/coupon`, { code: freeShip }, shopper), "coupon");
  expect(c.coupon?.valid && c.coupon.freeShipping, `coupon ${JSON.stringify(c.coupon)}`);
  const q = ok(await call("POST", `/v1/store/cart/${cartToken}/pincode`, { pincode: "620001" }, shopper), "pincode");
  const opt = q.delivery.options[0];
  expect(opt.amount === 4_000 && opt.codFee === 3_000, `option ${JSON.stringify(opt)}`);
  const r = ok(await call("POST", "/v1/store/checkout", { cartToken, addressId: address.id, deliveryOptionId: opt.id, paymentMethod: "cod" }, shopper), "checkout");
  orderB = ok(await call("GET", `/v1/store/me/orders/${r.order.id}`, undefined, shopper), "order B");
  const t = orderB.totals;
  expect(t.shipping === 0 && t.shippingWaived === 4_000 && t.codFee === 3_000 && t.shippingLine === null && t.codFeeLine?.description === "COD charges", `totals ${JSON.stringify(t).slice(0, 400)}`);
  eq(orderB.total, rupee(59_900 + 3_000), "order B total");
  return `${orderB.number}: ${rs(t.subtotal)}, shipping ${rs(4_000)} waived, COD fee ${rs(t.codFee)} → ${rs(orderB.total)}`;
});

// ------------------------------------------------------------------ checkout online
let orderC;
await step("checkout online → mock payment → paid; store customer total_spent updated", async () => {
  const before = ok(await call("GET", "/v1/store/me", undefined, shopper), "me").customer.totalSpent;
  ok(await call("PUT", `/v1/store/cart/${cartToken}/lines`, { variantId: akS.id, qty: 1 }, shopper), "add AK-S");
  const q = ok(await call("GET", `/v1/store/cart/${cartToken}?pincode=620001`, undefined, shopper), "cart");
  const r = ok(await call("POST", "/v1/store/checkout", { cartToken, addressId: address.id, deliveryOptionId: q.delivery.options[0].id, paymentMethod: "online" }, shopper), "checkout online");
  expect(r.payment?.kind === "order" && r.payment.ref === r.accessToken && r.order.paymentStatus === "pending", JSON.stringify(r));
  const co = ok(await call("POST", "/v1/payments/checkout", r.payment, { as: null, tenant: null }), "payment checkout");
  eq(co.amount, r.order.total, "payment amount");
  ok(await call("POST", "/v1/payments/mock/complete", { orderId: co.orderId, method: "upi" }, { as: null, tenant: null }), "mock complete");
  orderC = ok(await call("GET", `/v1/store/me/orders/${r.order.id}`, undefined, shopper), "order C");
  expect(orderC.paymentStatus === "paid" && orderC.paid === orderC.total, `${orderC.paymentStatus} ${orderC.paid}/${orderC.total}`);
  const after = ok(await call("GET", "/v1/store/me", undefined, shopper), "me").customer;
  eq(after.totalSpent - before, orderC.total, "total_spent increase");
  eq(after.ordersCount, 3, "orders count");
  return `${orderC.number} ${rs(orderC.total)} paid via ${co.provider}; total spent ${rs(after.totalSpent)}`;
});

// ------------------------------------------------------------------ shopper cancel
await step("shopper cancels the placed COD order → stock released, coupon released", async () => {
  const c = ok(await call("POST", `/v1/store/me/orders/${orderA.id}/cancel`, { reason: "Ordered by mistake" }, shopper), "cancel");
  expect(c.status === "cancelled" && /mistake/.test(c.cancelReason ?? ""), `${c.status} ${c.cancelReason}`);
  const s = { ak: await stockOf(akM.id), cp: await stockOf(cpM.id) };
  expect(s.ak.reserved === stockBefore.ak.reserved && s.cp.reserved === stockBefore.cp.reserved + 1, `reserved AK ${s.ak.reserved} CP ${s.cp.reserved} (order B holds 1)`);
  fails(await call("POST", `/v1/store/me/orders/${orderA.id}/cancel`, { reason: "again" }, shopper), 409, "not_cancellable", "cancel twice");
  return `${orderA.number} cancelled; AK-M reservation back to ${s.ak.reserved}`;
});

// ------------------------------------------------------------------ wishlist
await step("wishlist add / list / remove", async () => {
  let w = ok(await call("POST", "/v1/store/me/wishlist", { productId: ak.id }, shopper), "add");
  expect(w.items.some((i) => i.productId === ak.id && i.slug === "anarkali-kurti" && i.priceMin === 99_900 && i.available), JSON.stringify(w).slice(0, 300));
  ok(await call("POST", "/v1/store/me/wishlist", { productId: ak.id }, shopper), "add twice");
  w = ok(await call("GET", "/v1/store/me/wishlist", undefined, shopper), "list");
  eq(w.total, 1, "wishlist size");
  ok(await call("DELETE", `/v1/store/me/wishlist/${ak.id}`, undefined, shopper), "remove");
  eq(ok(await call("GET", "/v1/store/me/wishlist", undefined, shopper), "list").total, 0, "after remove");
  return "added (idempotent), listed, removed";
});

// ------------------------------------------------------------------ reviews (1)
let reviewAK;
await step("review without a delivered order → unverified, pending", async () => {
  reviewAK = ok(await call("POST", `/v1/reviews/public/products/${ak.id}/reviews`, { rating: 4, title: "Nice fabric", body: `Good kurti (${RUN})` }, shopper), "review");
  // Public author names are shortened ("E2E S.").
  expect(reviewAK.status === "pending" && reviewAK.verified === false && reviewAK.authorName?.startsWith("E2E"), JSON.stringify(reviewAK).slice(0, 300));
  const pub = ok(await call("GET", `/v1/reviews/public/products/${ak.id}/reviews`, undefined, anon), "public");
  expect(!pub.items.some((r) => r.id === reviewAK.id), "pending review is public");
  return `${reviewAK.rating}★ by ${reviewAK.authorName}: ${reviewAK.status}`;
});

// ------------------------------------------------------------------ shipment
await step("shipment (mock) → order shipped, then delivered; invoice once with COD charges", async () => {
  const sh = ok(await call("POST", `/v1/delivery/orders/${orderB.id}/shipments`, { provider: "mock" }), "shipment");
  expect(sh.awb && sh.status === "created", JSON.stringify(sh).slice(0, 200));
  let o = ok(await call("GET", `/v1/orders/${orderB.id}`), "order");
  expect(o.fulfillment.trackingNumber === sh.awb && o.fulfillment.shipmentId === sh.id, `fulfillment ${JSON.stringify(o.fulfillment)}`);
  fails(await call("POST", `/v1/delivery/orders/${orderB.id}/shipments`, { provider: "mock" }), 409, null, "second shipment");
  const seen = [];
  let st = sh;
  for (let i = 0; i < 6 && st.status !== "delivered"; i++) {
    st = ok(await call("POST", `/v1/delivery/shipments/${sh.id}/mock-advance`), "advance");
    o = ok(await call("GET", `/v1/orders/${orderB.id}`), "order");
    seen.push(`${st.status}→${o.status}`);
  }
  expect(seen.some((x) => x.endsWith("→shipped")), `never shipped: ${seen}`);
  expect(st.status === "delivered" && o.status === "delivered" && o.invoiceId && o.paymentStatus === "paid", `final ${st.status} ${o.status} ${o.invoiceId} ${o.paymentStatus}`);
  fails(await call("POST", `/v1/delivery/shipments/${sh.id}/mock-advance`), 409, null, "advance after delivered");
  const bills = ok(await call("GET", `/v1/invoices?q=${encodeURIComponent(`E2E Shopper ${RUN}`)}`), "invoices");
  expect(bills.total === 1 && bills.items[0].id === o.invoiceId, `invoices for the shopper: ${bills.total}`);
  const inv = ok(await call("GET", `/v1/invoices/${o.invoiceId}`), "invoice");
  expect(inv.lines.some((l) => l.description === "COD charges") && inv.total === o.total, `invoice lines ${inv.lines.map((l) => l.description)} total ${inv.total}/${o.total}`);
  return `${seen.join(", ")}; ${inv.number} ${rs(inv.total)} (${inv.lines.map((l) => l.description).join(" + ")})`;
});
await step("COD collected on delivery adds to total_spent", async () => {
  const c = ok(await call("GET", "/v1/store/me", undefined, shopper), "me").customer;
  eq(c.totalSpent, orderB.total + orderC.total, "total spent (online + COD)");
  return `total spent ${rs(c.totalSpent)} = ${rs(orderC.total)} online + ${rs(orderB.total)} COD`;
});

// ------------------------------------------------------------------ reviews (2)
let reviewCP;
await step("review of a delivered product → verified, auto-approved; ratings", async () => {
  reviewCP = ok(await call("POST", `/v1/reviews/public/products/${cp.id}/reviews`, { rating: 5, body: `Very comfortable (${RUN})` }, shopper), "review");
  expect(reviewCP.verified === true && reviewCP.status === "approved" && reviewCP.orderId === orderB.id, JSON.stringify(reviewCP).slice(0, 300));
  const pub = ok(await call("GET", `/v1/reviews/public/products/${cp.id}/reviews`, undefined, anon), "public");
  expect(pub.items.some((r) => r.id === reviewCP.id) && pub.summary.count >= 1, "approved review not public");
  const rt = ok(await call("GET", `/v1/reviews/public/ratings?productIds=${cp.id},${ak.id}`, undefined, anon), "ratings");
  const r = (Array.isArray(rt) ? rt : rt.items).find((x) => x.productId === cp.id);
  expect(r && r.count >= 1 && r.average > 0, `ratings ${JSON.stringify(rt)}`);
  return `verified ${reviewCP.rating}★ approved; ${cp.name} average ${r.average} (${r.count})`;
});
await step("staff moderation: approve the pending review", async () => {
  const list = ok(await call("GET", `/v1/reviews?status=pending&productId=${ak.id}`), "pending");
  expect(list.items.some((r) => r.id === reviewAK.id), "pending review not listed");
  const a = ok(await call("POST", `/v1/reviews/${reviewAK.id}/approve`), "approve");
  eq(a.status, "approved", "status");
  ok(await call("POST", `/v1/reviews/${reviewAK.id}/reply`, { reply: "Thank you!" }), "reply");
  const pub = ok(await call("GET", `/v1/reviews/public/products/${ak.id}/reviews`, undefined, anon), "public");
  expect(pub.items.some((r) => r.id === reviewAK.id && r.reply === "Thank you!"), "approved review not public");
  fails(await call("GET", "/v1/reviews", undefined, shopper), 403, null, "shopper moderation");
  return `${list.total} pending → approved with a reply`;
});

// ------------------------------------------------------------------ analytics
await step("analytics: text/plain beacon from the store origin + rollup → overview counts", async () => {
  const pre = await call("OPTIONS", "/v1/analytics/public/events", undefined, {
    as: null,
    headers: { origin: STORE_ORIGIN, "access-control-request-method": "POST", "access-control-request-headers": "content-type,x-tenant" },
  });
  expect(pre.headers.get("access-control-allow-origin") === STORE_ORIGIN, `CORS preflight ${pre.status} ${pre.headers.get("access-control-allow-origin")}`);
  const before = ok(await call("GET", `/v1/analytics/overview?from=${today}&to=${today}`), "overview");
  const sid = `s-${RUN}-${Date.now()}`;
  const body = JSON.stringify({
    anonymousId: `a-${RUN}-e2e`,
    sessionId: sid,
    events: [
      { type: "page_view", path: "/", referrer: "https://www.google.com/search?q=kurti", utm: { source: "e2e" } },
      { type: "search", path: "/search", query: "kurti" },
      { type: "product_view", path: "/p/anarkali-kurti", productId: ak.id },
      { type: "add_to_cart", productId: ak.id, variantId: akS.id, value: 99_900 },
      { type: "begin_checkout", value: 99_900 },
      { type: "purchase", value: orderC.total },
    ],
  });
  const r = ok(
    await call("POST", "/v1/analytics/public/events", body, {
      as: null,
      headers: { "content-type": "text/plain;charset=UTF-8", origin: STORE_ORIGIN, "user-agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128 Mobile Safari/537.36" },
    }),
    "ingest",
  );
  eq(r.accepted, 6, "accepted");
  const bot = ok(await call("POST", "/v1/analytics/public/events", body, { as: null, headers: { "content-type": "text/plain", "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" } }), "bot");
  eq(bot.accepted, 0, "bot events");
  await sleep(2_500); // ingest buffers ~2 s
  const job = spawnSync("pnpm --filter @rbms/api job analytics.rollup", { encoding: "utf8", shell: true });
  expect(job.status === 0, `rollup job failed: ${job.stderr?.slice(-400) || job.stdout?.slice(-400)}`);
  const rolled = /"rows":(\d+)/.exec(job.stdout)?.[1];
  expect(Number(rolled) > 0, `rollup wrote no rows: ${job.stdout.slice(-300)}`);
  const after = ok(await call("GET", `/v1/analytics/overview?from=${today}&to=${today}`), "overview");
  const d = (k) => after[k] - before[k];
  expect(d("pageViews") === 1 && d("productViews") === 1 && d("addToCart") === 1 && d("checkouts") === 1 && d("purchases") === 1 && d("sessions") === 1, `deltas pv ${d("pageViews")} prod ${d("productViews")} atc ${d("addToCart")} co ${d("checkouts")} buy ${d("purchases")} sess ${d("sessions")}`);
  eq(d("revenue"), orderC.total, "revenue delta");
  expect(after.topProducts.some((p) => p.productId === ak.id && p.name === ak.name), "top product name");
  expect(after.topSearches.some((s) => s.query === "kurti") && after.devices.some((x) => x.device === "mobile"), "searches/devices");
  return `+1 session, +1 page view, +1 product view, +1 add-to-cart, +1 purchase (${rs(d("revenue"))}); rollup rows ${rolled}; visitors today ${after.visitors}`;
});

await step("analytics: funnel, sources and devices from beacons (desktop Google landing, iPad direct, iPhone utm)", async () => {
  const before = ok(await call("GET", `/v1/analytics/overview?from=${today}&to=${today}`), "overview");
  const at = new Date().toISOString();
  const beacon = (sid, ua, events) =>
    call("POST", "/v1/analytics/public/events", JSON.stringify({ anonymousId: `a-${RUN}-${sid}-e2e`, sessionId: `s-${RUN}-${sid}-${Date.now()}`, events }), {
      as: null,
      headers: { "content-type": "text/plain;charset=UTF-8", origin: STORE_ORIGIN, "user-agent": ua },
    });
  const sent = [
    // Landing on a product page from Google: the product view is queued before the page view, same millisecond.
    await beacon("fg", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36", [
      { type: "product_view", path: "/p/anarkali-kurti", productId: ak.id, at },
      { type: "page_view", path: "/p/anarkali-kurti", referrer: "https://www.google.com/", at },
      { type: "add_to_cart", productId: ak.id, value: 99_900 },
      { type: "begin_checkout", value: 99_900 },
    ]),
    await beacon("fd", "Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1", [
      { type: "page_view", path: "/" },
    ]),
    await beacon("fi", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1", [
      { type: "page_view", path: "/?utm_source=e2e-insta", utm: { source: "e2e-insta" } },
      { type: "product_view", path: "/p/anarkali-kurti", productId: ak.id },
    ]),
  ];
  eq(sent.map((r) => r.json?.accepted).join(","), "4,1,2", "accepted");
  await sleep(2_500); // ingest buffers ~2 s; today's overview is computed from raw events
  const after = ok(await call("GET", `/v1/analytics/overview?from=${today}&to=${today}`), "overview");
  const by = (o, list, k, v) => Object.fromEntries(o[list].map((x) => [x[k], x[v]]));
  const delta = (list, k, v) => {
    const a = by(after, list, k, v);
    const b = by(before, list, k, v);
    return Object.fromEntries(Object.keys(a).map((key) => [key, a[key] - (b[key] ?? 0)]).filter(([, n]) => n));
  };
  const funnel = delta("funnel", "step", "count");
  const sources = delta("sources", "source", "sessions");
  const devices = delta("devices", "device", "sessions");
  eq(JSON.stringify(funnel), JSON.stringify({ visit: 3, product_view: 2, add_to_cart: 1, begin_checkout: 1 }), "funnel deltas");
  eq(JSON.stringify(Object.entries(sources).sort()), JSON.stringify([["direct", 1], ["e2e-insta", 1], ["google.com", 1]]), "source deltas");
  eq(JSON.stringify(Object.entries(devices).sort()), JSON.stringify([["desktop", 1], ["mobile", 1], ["tablet", 1]]), "device deltas");
  return `funnel +${Object.values(funnel).join("/+")}; sources ${JSON.stringify(sources)}; devices ${JSON.stringify(devices)}`;
});

// ------------------------------------------------------------------ permissions, onboarding, expenses
await step("staff permission registry lists the store modules' permissions", async () => {
  const g = ok(await call("GET", "/v1/staff/permissions"), "permissions");
  const keys = (g.items ?? g).flatMap((m) => m.permissions.map((p) => p.key));
  for (const k of ["cms.manage", "reviews.manage", "expenses.manage", "orders.manage", "settings.manage"]) expect(keys.includes(k), `registry lacks ${k}`);
  return `${keys.length} permissions incl. cms.manage, reviews.manage, expenses.manage`;
});

await step("onboarding status for e2e-store", async () => {
  const o = ok(await call("GET", "/v1/onboarding"), "onboarding");
  const by = Object.fromEntries(o.steps.map((s) => [s.key, s]));
  for (const k of ["business-profile", "branding", "first-product", "first-sale", "delivery-zone", "store-published"]) expect(by[k]?.done === true, `${k} not done: ${JSON.stringify(by[k])}`);
  expect(by.payments && by.payments.done === false, "payments step (no Razorpay account)");
  return `${o.completed}/${o.total}: ${o.steps.map((s) => `${s.key}${s.done ? "✓" : "·"}`).join(" ")}`;
});
await step("expenses: one with GST + profit report", async () => {
  const before = ok(await call("GET", `/v1/expenses/reports/profit?from=${today}&to=${today}`), "profit");
  const cats = ok(await call("GET", "/v1/expenses/categories"), "categories").items;
  const pack = cats.find((c) => c.name === "Packaging");
  expect(pack, `categories ${cats.map((c) => c.name)}`);
  const e = ok(
    await call("POST", "/v1/expenses", { date: today, categoryId: pack.id, amount: 118_000, gstRate: 18, vendorName: `E2E Boxes ${RUN}`, vendorGstin: "33AABFR1234K1ZI", paymentMethod: "upi", reference: RUN }),
    "expense",
  );
  expect(e.gstAmount === 18_000 && e.status === "recorded", JSON.stringify(e).slice(0, 300));
  const p = ok(await call("GET", `/v1/expenses/reports/profit?from=${today}&to=${today}`), "profit");
  expect(p.expenses.total - before.expenses.total === 118_000 && p.expenses.itc - before.expenses.itc === 18_000, `expenses ${JSON.stringify(p.expenses)}`);
  expect(p.sales.taxable > 0 && p.netProfit === p.grossProfit - (p.expenses.total - p.expenses.itc), `report ${JSON.stringify(p).slice(0, 400)}`);
  expect(p.purchases.taxable === 0 && p.purchases.itc === 0, "EC has no purchases");
  return `sales ${rs(p.sales.taxable)} + tax ${rs(p.sales.tax)}; expenses ${rs(p.expenses.total)} (ITC ${rs(p.expenses.itc)}); net ${rs(p.netProfit)}; GST payable ${rs(p.gst.payable)}`;
});

// ------------------------------------------------------------------ SEO
await step("sitemap.xml has product URLs on the store base URL; robots.txt", async () => {
  const s = await call("GET", "/v1/cms/public/seo/sitemap.xml", undefined, { as: null, raw: true });
  expect(s.status === 200 && /xml/.test(s.headers.get("content-type") ?? ""), `sitemap ${s.status} ${s.headers.get("content-type")}`);
  for (const u of ["http://e2e-store.localhost:3003/", "http://e2e-store.localhost:3003/p/anarkali-kurti", "http://e2e-store.localhost:3003/collections/new-arrivals", "http://e2e-store.localhost:3003/about"]) {
    expect(s.text.includes(`<loc>${u}</loc>`), `sitemap lacks ${u}`);
  }
  expect(s.text.includes("<lastmod>"), "no lastmod");
  const r = await call("GET", "/v1/cms/public/seo/robots.txt", undefined, { as: null, raw: true });
  expect(r.status === 200 && r.text.includes("Sitemap: http://e2e-store.localhost:3003/sitemap.xml") && r.text.includes("Disallow: /checkout"), r.text);
  return `${(s.text.match(/<loc>/g) ?? []).length} URLs; robots → ${r.text.split("\n").find((l) => l.startsWith("Sitemap"))}`;
});

// ------------------------------------------------------------------ custom domain
await step("custom domain: add → instructions → verify (DNS miss) → super-admin force; below-plan shop too", async () => {
  const domain = `e2e-${RUN.toLowerCase()}.example.com`;
  const d = ok(await call("POST", "/v1/tenancy/domains", { domain }), "add domain");
  const ins = ok(await call("GET", `/v1/tenancy/domains/${d.id}/instructions`), "instructions");
  const txt = ins.records.find((x) => x.type === "TXT");
  const cname = ins.records.find((x) => x.type === "CNAME");
  expect(ins.status === "pending" && txt.host === `_srikit-verify.${domain}` && /^srikit-verify-/.test(txt.value) && cname.value === "stores.srikit.in", JSON.stringify(ins));
  const miss = fails(await call("POST", `/v1/tenancy/domains/${d.id}/verify`, {}), 400, null, "verify without DNS");
  expect(miss.error.details?.txt === false, `details ${JSON.stringify(miss.error)}`);
  const forced = ok(await call("POST", `/v1/tenancy/domains/${d.id}/verify`, { force: true }), "force verify");
  expect(forced.verified === true, JSON.stringify(forced));
  // e2e-lite (starter) has no custom-domain: owners get 402, the platform team can still set one up.
  const kf = ok(await call("GET", "/v1/features", undefined, { tenant: LITE }), "e2e-lite features");
  expect(!kf.enabled.includes("custom-domain"), "e2e-lite has custom-domain");
  const kd = ok(await call("POST", "/v1/tenancy/domains", { domain: `k-${domain}` }, { tenant: LITE }), "super-admin adds e2e-lite domain");
  const kv = ok(await call("POST", `/v1/tenancy/domains/${kd.id}/verify`, { force: true }, { tenant: LITE }), "super-admin force on e2e-lite");
  expect(kv.verified === true, "e2e-lite domain not verified");
  // Clean up so the store keeps its subdomain URL and re-runs start fresh.
  ok(await call("DELETE", `/v1/tenancy/domains/${d.id}`), "delete");
  ok(await call("DELETE", `/v1/tenancy/domains/${kd.id}`, undefined, { tenant: LITE }), "delete e2e-lite domain");
  return `${domain}: TXT ${txt.host}, CNAME → ${cname.value}; DNS miss → 400 (txt ${miss.error.details.txt}, cname ${miss.error.details.cname}); force → verified; e2e-lite (no plan feature) force → verified`;
});

// ------------------------------------------------------------------ host hooks
await step("carrier webhook is reachable without tenant/feature hooks (401 on a bad token)", async () => {
  const r = await call("POST", `/v1/delivery/webhooks/courier/${tenantId}`, { awb: "X" }, { as: null, tenant: null, headers: { "x-api-key": "wrong-token-wrong-token" } });
  fails(r, 401, null, "webhook");
  const r2 = await call("POST", `/v1/delivery/webhooks/shiprocket/${tenantId}`, { awb: "X" }, { as: null, tenant: null });
  fails(r2, 401, null, "webhook (contract path)");
  return `courier + shiprocket paths → 401 ${r.json.error.code}`;
});

for (const [s, n, o] of results) console.log(`${s}  ${n}${o ? "  →  " + o : ""}`);
const passed = results.filter((r) => r[0] === "PASS").length;
console.log(`\n${passed}/${results.length} passed (run ${RUN}, shopper ${SHOPPER_PHONE})`);
process.exitCode = passed === results.length ? 0 : 1;
