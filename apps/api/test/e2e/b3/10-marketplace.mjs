// Batch 3 · marketplace (docs/batch3.md A1 + A4): seller onboarding, KYC through the mock provider, vendor-scoped
// catalogue, order → vendor_orders split, delivery → settlement → mock payout, ledger back to 0. Shop: e2e-store only.
import { call, ok, fails, eq, expect, step, signIn, testPhone, STORE, RUN, rs } from "./lib.mjs";

const T = { tenant: STORE };
const asVendor = { as: "mkVendor", tenant: STORE };
const asShopper = { as: "mkShopper", tenant: STORE };
const anon = { as: null, tenant: STORE };

/** Copy of packages/marketplace/src/logic.ts allocate(): largest-remainder proportional split. */
function allocate(total, weights) {
  const n = weights.length;
  if (n === 0) return [];
  if (total < 0) return allocate(-total, weights).map((v) => (v === 0 ? 0 : -v));
  let w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  let base = w.reduce((s, x) => s + x, 0);
  if (base <= 0) {
    w = weights.map(() => 1);
    base = n;
  }
  const out = new Array(n).fill(0);
  const rem = [];
  let given = 0;
  for (let i = 0; i < n; i++) {
    if (w[i] <= 0) continue;
    const exact = (total * w[i]) / base;
    const floor = Math.floor(exact);
    out[i] = floor;
    given += floor;
    rem.push({ i, frac: exact - floor });
  }
  rem.sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; given < total; k = (k + 1) % rem.length, given++) out[rem[k].i] += 1;
  return out;
}
const commissionOf = (base, bps) => (base <= 0 || bps <= 0 ? 0 : Math.floor((Math.trunc(base) * bps + 5_000) / 10_000));

const BPS = 1000;
const PRICE = 50_000; // ₹500 incl. 5% GST

export default async function () {
  const vendorPhone = testPhone(1);
  const shopperPhone = testPhone(1);
  let vendor, vendorUser, product, ak, akM, order, expected;

  await step("marketplace: owner sets e2e-store settings (mock payouts, 0-day window, KYC required, 10 %)", async () => {
    const want = { returnWindowDays: 0, payoutProvider: "mock", minPayoutPaise: 0, requireKyc: true, acceptApplications: true, defaultCommissionBps: BPS };
    const r = ok(await call("PUT", "/v1/settings/marketplace/tenant", want, T), "settings");
    for (const [k, v] of Object.entries(want)) eq(r.values[k], v, `settings.${k}`);
    const back = ok(await call("GET", "/v1/settings/marketplace", undefined, T), "settings get");
    eq(back.values.payoutProvider, "mock", "stored provider");
    return Object.entries(want).map(([k, v]) => `${k}=${v}`).join(", ");
  });

  await step(`marketplace: ${vendorPhone} applies to sell; owner sees it pending and approves`, async () => {
    vendorUser = await signIn("mkVendor", vendorPhone, STORE, `E2E Seller ${RUN}`);
    const name = `E2E B3 ${RUN} Crafts`;
    const applied = ok(
      await call("POST", "/v1/marketplace/public/vendors/apply", { name, contactName: "TEST NAME", contactPhone: vendorPhone, description: "E2E seller" }, asVendor),
      "apply",
    );
    expect(applied.status === "pending" && applied.role === "owner", `applied ${JSON.stringify(applied).slice(0, 300)}`);
    fails(await call("POST", "/v1/marketplace/public/vendors/apply", { name: `${name} 2`, contactName: "TEST NAME", contactPhone: vendorPhone }, asVendor), 409, null, "second application");
    const pending = ok(await call("GET", "/v1/marketplace/vendors?status=pending&limit=100", undefined, T), "pending list");
    expect(pending.items.some((v) => v.id === applied.id), "applicant not in the pending list");
    fails(await call("POST", `/v1/marketplace/vendors/${applied.id}/approve`, undefined, asVendor), 403, null, "applicant can't approve");
    vendor = ok(await call("POST", `/v1/marketplace/vendors/${applied.id}/approve`, undefined, T), "approve");
    eq(vendor.status, "active", "status after approve");
    const me = ok(await call("GET", "/v1/marketplace/vendor/me", undefined, asVendor), "vendor me");
    expect(me.id === vendor.id && me.status === "active" && me.role === "owner", `me ${JSON.stringify(me).slice(0, 200)}`);
    return `${vendor.name} (${vendor.slug}) pending → active`;
  });

  await step("marketplace: vendor KYC (PAN + bank, mock) → verified, mirrored on the vendor; payout account verified", async () => {
    const pan = ok(
      await call("POST", "/v1/kyc/checks", { subjectType: "vendor", subjectId: vendor.id, type: "pan", input: { pan: "ABCDE1234F", name: "TEST NAME" } }, asVendor),
      "pan check",
    );
    eq(pan.check.status, "verified", "pan check");
    const acct = `5010${String(Date.now()).slice(-8)}1`; // never ends in 0000/9999
    const bank = ok(
      await call(
        "POST",
        "/v1/kyc/checks",
        { subjectType: "vendor", subjectId: vendor.id, type: "bank_account", input: { accountNumber: acct, ifsc: "HDFC0001234", name: "TEST NAME" } },
        asVendor,
      ),
      "bank check",
    );
    eq(bank.check.status, "verified", "bank check");
    expect(!JSON.stringify(bank).includes(acct), "full account number leaked in the check response");
    const subj = ok(await call("GET", `/v1/kyc/subjects/vendor/${vendor.id}`, undefined, asVendor), "subject");
    const status = subj.status ?? subj.subject?.status;
    eq(status, "verified", "kyc subject status");
    const v = ok(await call("GET", `/v1/marketplace/vendors/${vendor.id}`, undefined, T), "vendor");
    eq(v.kycStatus, "verified", "vendor.kycStatus");

    // Payout account: the seller enters it (pending until checked), staff save it (verified).
    const payout = { type: "bank", holderName: "TEST NAME", accountNumber: acct, ifsc: "hdfc0001234" };
    const mine = ok(await call("PUT", "/v1/marketplace/vendor/payout-account", payout, asVendor), "vendor payout account");
    expect(mine.payoutAccountStatus === "pending" && mine.payoutAccount.last4 === acct.slice(-4), JSON.stringify(mine));
    const staff = ok(await call("PUT", `/v1/marketplace/vendors/${vendor.id}/payout-account`, payout, T), "staff payout account");
    eq(staff.payoutAccountStatus, "verified", "payout account status");
    return `KYC ${status} (${subj.verifiedName ?? subj.subject?.verifiedName ?? "?"}); payout account bank ****${acct.slice(-4)} verified`;
  });

  await step("marketplace: vendor creates a product (vendorId set), can't touch shop products, lists only theirs; seller page", async () => {
    product = ok(
      await call(
        "POST",
        "/v1/catalog/products",
        { name: `E2E B3 ${RUN} Clay Lamp`, hsn: "6913", gstRate: 5, taxInclusive: true, status: "active", channels: ["store"], price: PRICE, sku: `E2EB3${RUN}-LAMP` },
        asVendor,
      ),
      "vendor product",
    );
    eq(product.vendorId, vendor.id, "product.vendorId");
    const variant = product.variants[0];
    // Shop owner tops up the seller's stock.
    const s = ok(await call("GET", `/v1/inventory/stock/${variant.id}`, undefined, T), "stock");
    ok(await call("POST", `/v1/inventory/stock/${variant.id}/adjust`, { mode: "set", qty: (s.reserved ?? 0) + 10, note: `E2E B3 ${RUN}` }, T), "top up");

    ak = ok(await call("GET", "/v1/catalog/public/products/anarkali-kurti", undefined, anon), "Anarkali Kurti (seed:e2e)");
    akM = ak.variants.find((v) => v.title === "M");
    expect(akM, "Anarkali M variant");
    const as = ok(await call("GET", `/v1/inventory/stock/${akM.id}`, undefined, T), "AK stock");
    ok(await call("POST", `/v1/inventory/stock/${akM.id}/adjust`, { mode: "set", qty: (as.reserved ?? 0) + 20, note: `E2E B3 ${RUN}` }, T), "AK top up");

    const patch = await call("PATCH", `/v1/catalog/products/${ak.id}`, { name: "hacked" }, asVendor);
    expect(patch.status === 403 || patch.status === 404, `vendor PATCH of a shop product: ${patch.status}`);
    const get = await call("GET", `/v1/catalog/products/${ak.id}`, undefined, asVendor);
    expect(get.status === 403 || get.status === 404, `vendor GET of a shop product: ${get.status}`);
    const list = ok(await call("GET", "/v1/catalog/products?limit=100", undefined, asVendor), "vendor list");
    expect(list.items.length > 0 && list.items.every((p) => p.vendorId === vendor.id), `vendor list: ${list.items.map((p) => `${p.name}:${p.vendorId}`).join(", ")}`);
    expect(list.items.some((p) => p.id === product.id), "own product missing in list");
    const edited = ok(await call("PATCH", `/v1/catalog/products/${product.id}`, { description: "Hand made" }, asVendor), "own patch");
    eq(edited.vendorId, vendor.id, "vendorId kept");
    // A shopper (not a seller) is refused on the catalogue staff routes.
    await signIn("mkShopper", shopperPhone, STORE, `E2E B3 Shopper ${RUN}`);
    fails(await call("GET", "/v1/catalog/products", undefined, asShopper), 403, null, "shopper on catalogue");

    const page = ok(await call("GET", `/v1/marketplace/public/vendors/${vendor.slug}`, undefined, anon), "public seller page");
    expect(page.id === vendor.id && page.products.items.some((p) => p.id === product.id), `seller page ${JSON.stringify(page).slice(0, 300)}`);
    return `${product.name} ${rs(PRICE)} (vendor ${vendor.slug}); shop product → ${patch.status}; vendor lists ${list.total}; seller page ${page.products.total} product(s)`;
  });

  await step("marketplace: shopper buys the seller's lamp + Anarkali M (COD, Bengaluru: paid shipping) → one vendor order with exact split", async () => {
    const cart = ok(await call("POST", "/v1/store/cart", undefined, asShopper), "cart");
    const token = cart.token;
    ok(await call("PUT", `/v1/store/cart/${token}/lines`, { variantId: product.variants[0].id, qty: 2 }, asShopper), "add lamp");
    ok(await call("PUT", `/v1/store/cart/${token}/lines`, { variantId: akM.id, qty: 1 }, asShopper), "add AK-M");
    const address = ok(
      await call("POST", "/v1/store/me/addresses", { label: "Home", name: `E2E B3 Shopper ${RUN}`, phone: shopperPhone, line1: "1, MG Road", city: "Bengaluru", stateCode: "29", pincode: "560001" }, asShopper),
      "address",
    );
    const quote = ok(await call("GET", `/v1/store/cart/${token}?pincode=560001`, undefined, asShopper), "quote");
    expect(quote.itemCount === 3, `cart items ${quote.itemCount}`);
    const r = ok(await call("POST", "/v1/store/checkout", { cartToken: token, addressId: address.id, deliveryOptionId: quote.delivery.options[0].id, paymentMethod: "cod" }, asShopper), "checkout");
    order = ok(await call("GET", `/v1/orders/${r.order.id}`, undefined, T), "order");

    // Expected split (packages/marketplace/src/logic.ts splitOrder): groups in first-line order.
    const keys = [];
    const groups = new Map();
    for (const l of order.lines) {
      const k = l.productId === product.id ? vendor.id : null;
      if (!groups.has(k)) {
        groups.set(k, []);
        keys.push(k);
      }
      groups.get(k).push(l);
    }
    const grouped = keys.map((k) => groups.get(k));
    const gross = grouped.map((ls) => ls.reduce((s, l) => s + Math.round(l.qty * l.price), 0));
    const t = order.totals;
    const subtotals = allocate(t.subtotal, gross);
    const discounts = allocate(t.discount ?? 0, subtotals);
    const shipping = allocate(t.shipping ?? 0, subtotals.map((s, i) => s - discounts[i]));
    const i = keys.indexOf(vendor.id);
    const subtotal = subtotals[i];
    const commission = commissionOf(subtotal - discounts[i], BPS);
    expected = { subtotal, discount: discounts[i], shippingShare: shipping[i], commission, net: subtotal - discounts[i] + shipping[i] - commission };
    eq(subtotal, 2 * PRICE, "vendor subtotal = vendor line totals");
    expect((t.shipping ?? 0) > 0 && expected.shippingShare > 0, `shipping ${t.shipping}, share ${expected.shippingShare} (Rest of India rate expected)`);
    let vos;
    for (let n = 0; n < 20; n++) {
      vos = ok(await call("GET", `/v1/marketplace/vendor-orders?orderId=${order.id}`, undefined, T), "vendor orders");
      if (vos.total > 0) break;
      await new Promise((s) => setTimeout(s, 250));
    }
    eq(vos.total, 1, "vendor orders for the order");
    const vo = vos.items[0];
    eq(vo.vendorId, vendor.id, "vendor order seller");
    expect(vo.lines.length === 1 && vo.lines[0].productId === product.id && vo.lines[0].qty === 2, `lines ${JSON.stringify(vo.lines).slice(0, 300)}`);
    for (const k of ["subtotal", "discount", "shippingShare", "commission", "net"]) eq(vo[k], expected[k], `vendor order ${k}`);
    eq(vo.status, "placed", "vendor order status");
    eq(vo.settlementStatus, "pending", "settlement");
    const mine = ok(await call("GET", "/v1/marketplace/vendor/orders", undefined, asVendor), "vendor/orders");
    expect(mine.items.some((x) => x.orderId === order.id && x.net === expected.net), "vendor doesn't see the order");
    expect(mine.items.every((x) => x.vendorId === vendor.id), "vendor sees other sellers' orders");
    return `${order.number}: subtotal ${rs(t.subtotal)}, shipping ${rs(t.shipping ?? 0)}; seller ${rs(vo.subtotal)} + ship ${rs(vo.shippingShare)} − ${rs(vo.commission)} commission = net ${rs(vo.net)}`;
  });

  await step("marketplace: order delivered → eligible → mock payout run pays the net; ledger back to 0", async () => {
    for (const status of ["confirmed", "packed", "shipped", "delivered"]) {
      const o = ok(await call("POST", `/v1/orders/${order.id}/status`, { status }, T), `status ${status}`);
      eq(o.status, status, "order status");
    }
    let vo;
    for (let n = 0; n < 20; n++) {
      vo = ok(await call("GET", `/v1/marketplace/vendor-orders?orderId=${order.id}`, undefined, T), "vendor orders").items[0];
      if (vo.status === "delivered") break;
      await new Promise((s) => setTimeout(s, 250));
    }
    eq(vo.status, "delivered", "vendor order follows the order");
    expect(vo.eligibleAt && new Date(vo.eligibleAt).getTime() <= Date.now() + 1000, `eligibleAt ${vo.eligibleAt}`);

    const run = ok(await call("POST", "/v1/marketplace/payouts/run", { vendorId: vendor.id }, T), "payouts run");
    const p = run.created.find((x) => x.vendorId === vendor.id);
    expect(p, `no payout created: ${JSON.stringify(run).slice(0, 400)}`);
    eq(p.status, "paid", "payout status");
    eq(p.amount, expected.net, "payout amount");
    eq(p.provider, "mock", "payout provider");
    const vo2 = ok(await call("GET", `/v1/marketplace/vendor-orders?orderId=${order.id}`, undefined, T), "vendor orders").items[0];
    eq(vo2.settlementStatus, "settled", "settlement after payout");

    const ledger = ok(await call("GET", `/v1/marketplace/ledger?vendorId=${vendor.id}&limit=100`, undefined, T), "ledger");
    const byType = Object.fromEntries(["sale", "commission", "payout"].map((k) => [k, ledger.items.filter((e) => e.type === k).reduce((s, e) => s + e.amount, 0)]));
    eq(byType.sale, expected.subtotal - expected.discount + expected.shippingShare, "ledger sale");
    eq(byType.commission, -expected.commission, "ledger commission");
    eq(byType.payout, -expected.net, "ledger payout");
    eq(ledger.items.reduce((s, e) => s + e.amount, 0), 0, "ledger sum");
    if (ledger.balance) eq(ledger.balance.balance, 0, "ledger balance");

    const again = ok(await call("POST", "/v1/marketplace/payouts/run", { vendorId: vendor.id }, T), "second run");
    expect(!again.created.some((x) => x.vendorId === vendor.id), "second run paid again");
    const vp = ok(await call("GET", "/v1/marketplace/vendor/payouts", undefined, asVendor), "vendor payouts");
    expect(vp.items.length === 1 && vp.items[0].id === p.id && vp.items[0].status === "paid", `vendor payouts ${JSON.stringify(vp).slice(0, 300)}`);
    const me = ok(await call("GET", "/v1/marketplace/vendor/me", undefined, asVendor), "vendor me");
    eq(me.balance.balance, 0, "vendor balance");
    return `payout ${rs(p.amount)} ${p.status} (${p.provider}); ledger sale ${rs(byType.sale)}, commission ${rs(byType.commission)}, payout ${rs(byType.payout)} → 0`;
  });
}
