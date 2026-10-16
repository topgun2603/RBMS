// Batch 3 · marketplace seller portal gaps: product review before going live (reject → resubmit → approve, auto
// approve), hidden from the store/search/sitemap until approved, staff product list by seller, seller stock at the
// shop's location (scoped, with a reason, audited), seller "mark packed / shipped" through the orders state machine,
// and the public marketplace settings sellers read. Two sellers (A, B) so every scoping check has a real other seller.
// Shop: e2e-store only. Runs after 10-marketplace (which leaves the shop on reviewed products).
import { call, ok, fails, eq, expect, step, signIn, testPhone, STORE, RUN, rs, sleep } from "./lib.mjs";

const T = { tenant: STORE };
const asA = { as: "mkSellerA", tenant: STORE };
const asB = { as: "mkSellerB", tenant: STORE };
const asShopper = { as: "mkSellerShopper", tenant: STORE };
const anon = { as: null, tenant: STORE };
const PRICE = 42_000; // ₹420 incl. 5% GST

async function seller(as, phone, label) {
  await signIn(as, phone, STORE, `E2E Seller ${label} ${RUN}`);
  const opts = { as, tenant: STORE };
  const applied = ok(
    await call("POST", "/v1/marketplace/public/vendors/apply", { name: `E2E MP2 ${RUN} ${label}`, contactName: "TEST NAME", contactPhone: phone }, opts),
    `apply ${label}`,
  );
  return ok(await call("POST", `/v1/marketplace/vendors/${applied.id}/approve`, undefined, T), `approve ${label}`);
}

const product = (name, extra = {}) => ({
  name,
  hsn: "6913",
  gstRate: 5,
  taxInclusive: true,
  status: "active",
  channels: ["store"],
  price: PRICE,
  ...extra,
});

async function voFor(orderId, vendorId) {
  for (let n = 0; n < 20; n++) {
    const r = ok(await call("GET", `/v1/marketplace/vendor-orders?orderId=${orderId}`, undefined, T), "vendor orders");
    const hit = r.items.find((x) => x.vendorId === vendorId);
    if (hit) return hit;
    await sleep(250);
  }
  throw new Error(`no vendor order for ${orderId}`);
}

export default async function () {
  let A, B, lamp, pot, potReview, akM, single, mixed;

  await step("mp2: two sellers (A, B) apply and are approved; settings keep products reviewed", async () => {
    const s = ok(await call("PUT", "/v1/settings/marketplace/tenant", { autoApproveProducts: false, returnWindowDays: 0, minPayoutPaise: 0 }, T), "settings");
    eq(s.values.autoApproveProducts, false, "autoApproveProducts");
    A = await seller("mkSellerA", testPhone(2), "A");
    B = await seller("mkSellerB", testPhone(2), "B");
    expect(A.status === "active" && B.status === "active", "sellers active");
    return `${A.slug}, ${B.slug}`;
  });

  await step("mp2: sellers read the public marketplace settings (payout minimum, return window) but not staff ones", async () => {
    const r = ok(await call("GET", "/v1/settings/marketplace", undefined, asA), "settings as seller");
    eq(r.values.minPayoutPaise, 0, "minPayoutPaise");
    eq(r.values.returnWindowDays, 0, "returnWindowDays");
    eq(r.values.autoApproveProducts, false, "autoApproveProducts");
    expect(r.values.payoutProvider === undefined && r.values.defaultCommissionBps === undefined && r.values.requireKyc === undefined, `staff keys leaked: ${JSON.stringify(r.values)}`);
    return Object.keys(r.values).join(", ");
  });

  await step("mp2: A submits a product → draft + pending review; hidden from store, search, seller page and sitemap", async () => {
    lamp = ok(await call("POST", "/v1/catalog/products", product(`E2E MP2 ${RUN} Terracotta Pot`, { sku: `E2EMP2${RUN}-POT` }), asA), "A product");
    pot = lamp;
    eq(pot.status, "draft", "status after submit");
    const mine = ok(await call("GET", `/v1/marketplace/vendor/product-reviews?productIds=${pot.id}`, undefined, asA), "A reviews");
    potReview = mine.items[0];
    expect(potReview && potReview.status === "pending" && potReview.productId === pot.id, `A review ${JSON.stringify(mine).slice(0, 300)}`);
    fails(await call("GET", `/v1/catalog/public/products/${pot.slug}`, undefined, anon), 404, null, "public product");
    const search = ok(await call("GET", `/v1/catalog/public/search?q=${encodeURIComponent(`MP2 ${RUN} Terracotta`)}`, undefined, anon), "search");
    expect(!search.items.some((p) => p.id === pot.id), "unapproved product in search");
    const list = ok(await call("GET", `/v1/catalog/public/products?q=${encodeURIComponent(`MP2 ${RUN}`)}&limit=100`, undefined, anon), "public list");
    expect(!list.items.some((p) => p.id === pot.id), "unapproved product in the store list");
    const page = ok(await call("GET", `/v1/marketplace/public/vendors/${A.slug}`, undefined, anon), "seller page");
    expect(!page.products.items.some((p) => p.id === pot.id), "unapproved product on the seller page");
    const sm = await call("GET", "/v1/cms/public/seo/sitemap.xml", undefined, { ...anon, raw: true });
    if (sm.status === 200) expect(!sm.text.includes(`/p/${pot.slug}`), "unapproved product in the sitemap");
    // B never sees A's review; sellers can't decide reviews.
    const bs = ok(await call("GET", `/v1/marketplace/vendor/product-reviews?productIds=${pot.id}`, undefined, asB), "B reviews");
    eq(bs.total, 0, "B sees A's review");
    fails(await call("POST", `/v1/marketplace/product-reviews/${potReview.id}/approve`, undefined, asA), 403, null, "seller approves own product");
    return `${pot.name}: draft, review pending; sitemap ${sm.status === 200 ? "checked" : `skipped (${sm.status})`}`;
  });

  await step("mp2: staff list a seller's products by vendorId (all statuses), including drafts", async () => {
    ok(await call("POST", "/v1/catalog/products", product(`E2E MP2 ${RUN} Draft Bowl`, { status: "draft" }), asA), "A draft");
    const r = ok(await call("GET", `/v1/catalog/products?vendorId=${A.id}&limit=100`, undefined, T), "staff list by seller");
    expect(r.items.length >= 2 && r.items.every((p) => p.vendorId === A.id), `items ${r.items.map((p) => `${p.name}:${p.vendorId}`).join(", ")}`);
    expect(r.items.some((p) => p.status === "draft" && p.name.includes("Draft Bowl")), "draft missing");
    const drafts = ok(await call("GET", `/v1/catalog/products?vendorId=${A.id}&status=draft&limit=100`, undefined, T), "drafts");
    expect(drafts.items.every((p) => p.status === "draft"), "status filter");
    // A seller can't widen their list to another seller with the filter.
    const sneaky = ok(await call("GET", `/v1/catalog/products?vendorId=${A.id}&limit=100`, undefined, asB), "B with A's vendorId");
    eq(sneaky.total, 0, "B sees A's products");
    return `${r.total} product(s) of ${A.slug}, ${drafts.total} draft(s)`;
  });

  await step("mp2: staff reject with a reason → seller sees it; resubmit → pending again (reason cleared) → approve → live", async () => {
    fails(await call("POST", `/v1/marketplace/product-reviews/${potReview.id}/reject`, { reason: "" }, T), 400, null, "reject without reason");
    const rej = ok(await call("POST", `/v1/marketplace/product-reviews/${potReview.id}/reject`, { reason: "Add a clear photo of the pot" }, T), "reject");
    eq(rej.status, "rejected", "rejected");
    fails(await call("POST", `/v1/marketplace/product-reviews/${potReview.id}/approve`, undefined, T), 409, null, "approve a rejected review");
    const seen = ok(await call("GET", `/v1/marketplace/vendor/product-reviews?productIds=${pot.id}`, undefined, asA), "A sees rejection").items[0];
    expect(seen.status === "rejected" && seen.reason === "Add a clear photo of the pot", `seen ${JSON.stringify(seen)}`);
    const again = ok(await call("PATCH", `/v1/catalog/products/${pot.id}`, { status: "active", description: "Now with a photo" }, asA), "resubmit");
    eq(again.status, "draft", "still a draft while waiting");
    const re = ok(await call("GET", `/v1/marketplace/vendor/product-reviews?productIds=${pot.id}`, undefined, asA), "after resubmit").items[0];
    expect(re.status === "pending" && re.reason === null, `resubmitted ${JSON.stringify(re)}`);
    const queue = ok(await call("GET", "/v1/marketplace/product-reviews?status=pending&limit=200", undefined, T), "queue");
    expect(queue.counts.pending >= 1 && queue.items.some((r) => r.id === re.id && r.vendorName === A.name), "queue entry / vendorName");
    ok(await call("POST", `/v1/marketplace/product-reviews/${re.id}/approve`, undefined, T), "approve");
    const pub = ok(await call("GET", `/v1/catalog/public/products/${pot.slug}`, undefined, anon), "public after approval");
    eq(pub.id, pot.id, "public product");
    const search = ok(await call("GET", `/v1/catalog/public/search?q=${encodeURIComponent(`MP2 ${RUN} Terracotta`)}`, undefined, anon), "search");
    expect(search.items.some((p) => p.id === pot.id), "approved product missing from search");
    // Saving an approved product with the same content keeps it live and approved (no second review).
    const saved = ok(await call("PATCH", `/v1/catalog/products/${pot.id}`, { status: "active", description: "Now with a photo" }, asA), "save live");
    eq(saved.status, "active", "approved product stays active on save");
    const still = ok(await call("GET", `/v1/marketplace/vendor/product-reviews?productIds=${pot.id}`, undefined, asA), "after same save").items[0];
    eq(still.status, "approved", "same-content save keeps the approval");
    pot = saved;
    return `rejected ("${seen.reason}") → resubmitted → approved; live in store + search`;
  });

  await step("mp2: editing a live product (description + price) → stays live, back in the queue as a re-review with the changed fields; approve clears it", async () => {
    const reviewOf = async () => ok(await call("GET", `/v1/marketplace/vendor/product-reviews?productIds=${pot.id}`, undefined, asA), "A review").items[0];
    const v = pot.variants[0];
    // Stock-only changes are not content changes.
    ok(await call("POST", `/v1/marketplace/vendor/stock/${v.id}/adjust`, { mode: "set", qty: 4, reason: `E2E rr ${RUN}` }, asA), "stock only");
    eq((await reviewOf()).status, "approved", "stock change re-reviewed");
    const edited = ok(await call("PATCH", `/v1/catalog/products/${pot.id}`, { status: "active", description: "Hand thrown, glazed inside" }, asA), "edit description");
    eq(edited.status, "active", "edited product stays active");
    ok(await call("PATCH", `/v1/catalog/variants/${v.id}`, { price: PRICE + 2_000 }, asA), "edit price");
    const rr = await reviewOf();
    expect(
      rr.status === "pending" && rr.changedAfterApproval === true && rr.changedFields.includes("description") && rr.changedFields.includes("price"),
      `re-review ${JSON.stringify(rr)}`,
    );
    ok(await call("GET", `/v1/catalog/public/products/${pot.slug}`, undefined, anon), "still public during re-review");
    const queue = ok(await call("GET", "/v1/marketplace/product-reviews?status=pending&limit=200", undefined, T), "queue");
    const q = queue.items.find((x) => x.id === rr.id);
    expect(q?.changedAfterApproval && q.changedFields.length === 2, `queue entry ${JSON.stringify(q)}`);
    const ap = ok(await call("POST", `/v1/marketplace/product-reviews/${rr.id}/approve`, undefined, T), "approve re-review");
    expect(ap.status === "approved" && ap.changedAfterApproval === false && ap.changedFields.length === 0, `approved ${JSON.stringify(ap)}`);
    eq(ok(await call("GET", `/v1/catalog/products/${pot.id}`, undefined, asA), "product").status, "active", "still active after approval");
    return `re-review of ${rr.changedFields.join(", ")} → approved, flag cleared`;
  });

  await step("mp2: rejecting a re-review takes the live product back to draft with the reason; auto-approve skips re-reviews", async () => {
    const reviewOf = async () => ok(await call("GET", `/v1/marketplace/vendor/product-reviews?productIds=${pot.id}`, undefined, asA), "A review").items[0];
    ok(await call("PATCH", `/v1/catalog/products/${pot.id}`, { name: `E2E MP2 ${RUN} Terracotta Pot XL` }, asA), "rename");
    const rr = await reviewOf();
    expect(rr.status === "pending" && rr.changedAfterApproval && rr.changedFields.join() === "name", `re-review ${JSON.stringify(rr)}`);
    const rej = ok(await call("POST", `/v1/marketplace/product-reviews/${rr.id}/reject`, { reason: "Keep the original name" }, T), "reject re-review");
    eq(rej.status, "rejected", "rejected");
    const back = ok(await call("GET", `/v1/catalog/products/${pot.id}`, undefined, asA), "product");
    eq(back.status, "draft", "product back to draft");
    fails(await call("GET", `/v1/catalog/public/products/${pot.slug}`, undefined, anon), 404, null, "rejected re-review still public");
    const seen = await reviewOf();
    expect(seen.status === "rejected" && seen.reason === "Keep the original name", `seller sees ${JSON.stringify(seen)}`);
    // Fix, resubmit (a normal review now), approve: live again for the order steps.
    ok(await call("PATCH", `/v1/catalog/products/${pot.id}`, { name: `E2E MP2 ${RUN} Terracotta Pot`, status: "active" }, asA), "resubmit");
    const again = await reviewOf();
    expect(again.status === "pending" && again.changedAfterApproval === false, `resubmitted ${JSON.stringify(again)}`);
    ok(await call("POST", `/v1/marketplace/product-reviews/${again.id}/approve`, undefined, T), "approve");
    pot = ok(await call("GET", `/v1/catalog/products/${pot.id}`, undefined, asA), "product");
    eq(pot.status, "active", "live again");
    // With auto-approve on, edits to live products are not re-reviewed.
    ok(await call("PUT", "/v1/settings/marketplace/tenant", { autoApproveProducts: true }, T), "auto approve on");
    ok(await call("PATCH", `/v1/catalog/products/${pot.id}`, { description: "Edited while auto-approve is on" }, asA), "edit");
    const auto = await reviewOf();
    ok(await call("PUT", "/v1/settings/marketplace/tenant", { autoApproveProducts: false }, T), "auto approve off");
    eq(auto.status, "approved", "auto-approve re-review");
    return `re-review rejected → draft ("${seen.reason}") → resubmitted → approved; auto-approve edit not re-reviewed`;
  });

  await step("mp2: autoApproveProducts on → a seller product goes live at once (old behaviour); back off", async () => {
    ok(await call("PUT", "/v1/settings/marketplace/tenant", { autoApproveProducts: true }, T), "auto approve on");
    const quick = ok(await call("POST", "/v1/catalog/products", product(`E2E MP2 ${RUN} Quick Diya`), asB), "B quick product");
    eq(quick.status, "active", "auto-approved status");
    const r = ok(await call("GET", `/v1/marketplace/vendor/product-reviews?productIds=${quick.id}`, undefined, asB), "B review").items[0];
    eq(r?.status, "approved", "auto-approved review");
    ok(await call("PUT", "/v1/settings/marketplace/tenant", { autoApproveProducts: false }, T), "auto approve off");
    ok(await call("DELETE", `/v1/catalog/products/${quick.id}`, undefined, asB), "B deletes it");
    return `${quick.name}: active immediately`;
  });

  await step("mp2: A sets stock of their own variant (reason, default location); B and shop variants are refused", async () => {
    const v = pot.variants[0];
    const before = ok(await call("GET", `/v1/marketplace/vendor/stock?productIds=${pot.id}`, undefined, asA), "A stock");
    expect(before.items.length === 1 && before.items[0].variantId === v.id && before.locationId, `stock ${JSON.stringify(before).slice(0, 300)}`);
    fails(await call("POST", `/v1/marketplace/vendor/stock/${v.id}/adjust`, { mode: "set", qty: 12 }, asA), 400, null, "no reason");
    const set = ok(await call("POST", `/v1/marketplace/vendor/stock/${v.id}/adjust`, { mode: "set", qty: 12, reason: `E2E count ${RUN}` }, asA), "A set 12");
    eq(set.item.qty, 12, "qty after set");
    const add = ok(await call("POST", `/v1/marketplace/vendor/stock/${v.id}/adjust`, { mode: "add", qty: 3, reason: `E2E batch ${RUN}` }, asA), "A add 3");
    eq(add.item.qty, 15, "qty after add");
    const shop = ok(await call("GET", `/v1/inventory/stock/${v.id}?locationId=${set.locationId}`, undefined, T), "staff stock view");
    eq(shop.qty, 15, "staff sees the seller's stock at the location");
    const mv = ok(await call("GET", `/v1/inventory/stock/${v.id}/movements?limit=5`, undefined, T), "movements");
    expect(mv.items.some((m) => (m.note ?? "").includes(`E2E batch ${RUN}`) && (m.note ?? "").includes(A.name)), `movement notes ${mv.items.map((m) => m.note).join(" | ")}`);
    fails(await call("POST", `/v1/marketplace/vendor/stock/${v.id}/adjust`, { mode: "set", qty: 0, reason: "Not mine" }, asB), 404, null, "B adjusts A's variant");
    const bList = ok(await call("GET", `/v1/marketplace/vendor/stock?productIds=${pot.id}`, undefined, asB), "B lists A's product stock");
    eq(bList.total, 0, "B sees A's stock");
    const ak = ok(await call("GET", "/v1/catalog/public/products/anarkali-kurti", undefined, anon), "Anarkali Kurti (seed:e2e)");
    akM = ak.variants.find((x) => x.title === "M");
    fails(await call("POST", `/v1/marketplace/vendor/stock/${akM.id}/adjust`, { mode: "set", qty: 0, reason: "Shop item" }, asA), 404, null, "A adjusts a shop variant");
    fails(await call("POST", `/v1/inventory/stock/${v.id}/adjust`, { mode: "set", qty: 0 }, asA), 403, null, "A on the staff inventory route");
    // Audit (shops with the audit log): the seller's change is recorded with before/after.
    const audit = await call("GET", `/v1/audit?action=marketplace.vendor_stock.adjust&entityId=${v.id}&limit=5`, undefined, T);
    let audited = "audit log off";
    if (audit.status === 200) {
      expect(audit.json.items.length >= 2, `audit entries ${JSON.stringify(audit.json).slice(0, 300)}`);
      audited = `${audit.json.items.length} audit entries`;
    }
    return `qty 0 → 12 → 15 at ${set.locationId.slice(0, 8)}…; ${audited}`;
  });

  await step("mp2: shopper buys only A's pot → A marks packed → the order moves to packed; B can't; again → 409", async () => {
    await signIn("mkSellerShopper", testPhone(2), STORE, `E2E MP2 Shopper ${RUN}`);
    const address = ok(
      await call("POST", "/v1/store/me/addresses", { label: "Home", name: `E2E MP2 Shopper ${RUN}`, phone: testPhone(2), line1: "2, Avinashi Road", city: "Coimbatore", stateCode: "33", pincode: "641018" }, asShopper),
      "address",
    );
    const buy = async (lines) => {
      const cart = ok(await call("POST", "/v1/store/cart", undefined, asShopper), "cart");
      for (const [variantId, qty] of lines) ok(await call("PUT", `/v1/store/cart/${cart.token}/lines`, { variantId, qty }, asShopper), "add line");
      const quote = ok(await call("GET", `/v1/store/cart/${cart.token}?pincode=641018`, undefined, asShopper), "quote");
      const r = ok(await call("POST", "/v1/store/checkout", { cartToken: cart.token, addressId: address.id, deliveryOptionId: quote.delivery.options[0].id, paymentMethod: "cod" }, asShopper), "checkout");
      return r.order;
    };
    // Shop stock for the Anarkali line of the mixed order.
    const as = ok(await call("GET", `/v1/inventory/stock/${akM.id}`, undefined, T), "AK stock");
    ok(await call("POST", `/v1/inventory/stock/${akM.id}/adjust`, { mode: "set", qty: (as.reserved ?? 0) + 5, note: `E2E MP2 ${RUN}` }, T), "AK top up");

    single = await buy([[pot.variants[0].id, 1]]);
    const vo = await voFor(single.id, A.id);
    fails(await call("POST", `/v1/marketplace/vendor/orders/${vo.id}/packed`, undefined, asB), 404, null, "B packs A's order");
    // Sellers never confirm orders: packing waits for the shop.
    fails(await call("POST", `/v1/marketplace/vendor/orders/${vo.id}/packed`, undefined, asA), 409, "not_confirmed", "pack before the shop confirms");
    eq(ok(await call("GET", `/v1/orders/${single.id}`, undefined, T), "order").status, "placed", "order untouched");
    ok(await call("POST", `/v1/orders/${single.id}/status`, { status: "confirmed" }, T), "shop confirms");
    const packed = ok(await call("POST", `/v1/marketplace/vendor/orders/${vo.id}/packed`, undefined, asA), "A packs");
    expect(packed.packedAt, "packedAt");
    const order = ok(await call("GET", `/v1/orders/${single.id}`, undefined, T), "order");
    eq(order.status, "packed", "single-seller order status");
    eq(packed.status, "packed", "vendor order mirrors the order");
    fails(await call("POST", `/v1/marketplace/vendor/orders/${vo.id}/packed`, undefined, asA), 409, "already_done", "pack again");
    return `${single.number}: pack refused while placed → shop confirms → packed by ${A.slug}`;
  });

  await step("mp2: A marks shipped with tracking → order shipped with the tracking number; shipped again → 409", async () => {
    const vo = await voFor(single.id, A.id);
    fails(await call("POST", `/v1/marketplace/vendor/orders/${vo.id}/shipped`, { carrier: "DTDC" }, asA), 400, null, "ship without tracking");
    const tracking = `D${RUN}123`;
    const shipped = ok(await call("POST", `/v1/marketplace/vendor/orders/${vo.id}/shipped`, { carrier: "DTDC", trackingNumber: tracking }, asA), "A ships");
    expect(shipped.shippedAt && shipped.trackingNumber === tracking, `shipped ${JSON.stringify(shipped).slice(0, 300)}`);
    const order = ok(await call("GET", `/v1/orders/${single.id}`, undefined, T), "order");
    eq(order.status, "shipped", "order status");
    eq(order.fulfillment?.trackingNumber, tracking, "order tracking number");
    const mine = ok(await call("GET", `/v1/marketplace/vendor/orders?orderId=${single.id}`, undefined, asA), "A orders").items[0];
    expect(mine.status === "shipped" && mine.trackingNumber === tracking, `A sees ${JSON.stringify(mine).slice(0, 200)}`);
    fails(await call("POST", `/v1/marketplace/vendor/orders/${vo.id}/shipped`, { trackingNumber: tracking }, asA), 409, "already_done", "ship again");
    return `${single.number}: shipped (DTDC ${tracking})`;
  });

  await step("mp2: a mixed order (A's pot + the shop's Anarkali) → A packs their part; the order waits for the shop", async () => {
    mixed = await buy2();
    const vo = await voFor(mixed.id, A.id);
    ok(await call("POST", `/v1/orders/${mixed.id}/status`, { status: "confirmed" }, T), "shop confirms");
    const packed = ok(await call("POST", `/v1/marketplace/vendor/orders/${vo.id}/packed`, undefined, asA), "A packs part");
    expect(packed.packedAt && packed.status === "confirmed", `part ${JSON.stringify(packed).slice(0, 200)}`);
    const order = ok(await call("GET", `/v1/orders/${mixed.id}`, undefined, T), "order");
    eq(order.status, "confirmed", "mixed order waits for the shop");
    // The shop cancels it; the seller can't pack or ship a cancelled order.
    ok(await call("POST", `/v1/orders/${mixed.id}/status`, { status: "cancelled", note: "E2E cleanup" }, T), "cancel");
    fails(await call("POST", `/v1/marketplace/vendor/orders/${vo.id}/shipped`, { trackingNumber: "X12345" }, asA), 409, "order_closed", "ship a cancelled order");
    return `${mixed.number}: confirmed, A packed their part, order stays confirmed → cancelled by shop`;
  });

  async function buy2() {
    const address = ok(await call("GET", "/v1/store/me/addresses", undefined, asShopper), "addresses");
    const addr = (address.items ?? address)[0];
    const cart = ok(await call("POST", "/v1/store/cart", undefined, asShopper), "cart");
    ok(await call("PUT", `/v1/store/cart/${cart.token}/lines`, { variantId: pot.variants[0].id, qty: 1 }, asShopper), "add pot");
    ok(await call("PUT", `/v1/store/cart/${cart.token}/lines`, { variantId: akM.id, qty: 1 }, asShopper), "add AK");
    const quote = ok(await call("GET", `/v1/store/cart/${cart.token}?pincode=641018`, undefined, asShopper), "quote");
    const r = ok(await call("POST", "/v1/store/checkout", { cartToken: cart.token, addressId: addr.id, deliveryOptionId: quote.delivery.options[0].id, paymentMethod: "cod" }, asShopper), "checkout");
    return r.order;
  }

  await step("mp2: a seller's stock and orders never leak to a seller of another shop context (no x-tenant → refused)", async () => {
    const r = await call("GET", "/v1/marketplace/vendor/stock", undefined, { as: "mkSellerA", tenant: null });
    expect(r.status >= 400, `no tenant: ${r.status}`);
    const other = await call("GET", "/v1/marketplace/vendor/orders", undefined, { as: "mkSellerA", tenant: "e2e-bill" });
    expect(other.status === 403 || other.status === 404, `other shop: ${other.status}`);
    return `no shop → ${r.status}; e2e-bill → ${other.status}`;
  });

  void rs;
}
