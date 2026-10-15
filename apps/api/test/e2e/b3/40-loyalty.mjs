// A5 loyalty: points earned on paid bills (e2e-bill) and delivered store orders (e2e-store), redeemed as a discount
// on bills (mixed GST rates, exclusive) and at checkout (tax-inclusive), and given back / taken back on cancel.
import { BILL, RUN, STORE, call, eq, expect, fails, ok, rs, signIn, step, testPhone, today } from "./lib.mjs";

// Same rule as packages/loyalty/src/logic.ts earnPoints.
const earnPoints = (amountPaise, earnPer100, multiplier = 1) =>
  amountPaise > 0 && earnPer100 > 0 && multiplier > 0 ? Math.max(0, Math.floor((amountPaise * earnPer100 * multiplier) / 10_000 + 1e-9)) : 0;
const tierFor = (spend, tiers) => {
  const sorted = [...tiers].sort((a, b) => a.minSpend - b.minSpend);
  let t = sorted[0];
  for (const x of sorted) if (spend >= x.minSpend) t = x;
  return t;
};
const multiplierOf = (member, tiers) => (tiers.find((t) => t.name === member?.tier) ?? tierFor(member?.lifetimeSpend ?? 0, tiers)).multiplier;
const maxPointsFor = (amount, balance, s) => Math.min(balance, Math.floor(Math.floor((amount * s.maxRedeemPercent) / 100 + 1e-9) / s.pointValuePaise));

async function memberOf(tenant, phone) {
  const r = ok(await call("GET", `/v1/loyalty/members?q=${encodeURIComponent(phone.slice(3))}`, undefined, { tenant }), "members");
  return r.items.find((m) => m.memberKey === phone) ?? null;
}
const detail = async (tenant, id) => ok(await call("GET", `/v1/loyalty/members/${id}?limit=200`, undefined, { tenant }), "member detail");
const adjust = async (tenant, id, points) =>
  ok(await call("POST", `/v1/loyalty/members/${id}/adjust`, { points, reason: `E2E loyalty ${RUN}` }, { tenant }), "adjust");
const lineTax = (l) => l.cgst + l.sgst + l.igst;

export default async function () {
  const S = {};
  const phone = testPhone(4);
  let bill1, member, p1;

  await step("loyalty: settings on e2e-bill and e2e-store", async () => {
    for (const [k, tenant] of [["bill", BILL], ["store", STORE]]) {
      let s = ok(await call("GET", "/v1/loyalty/settings", undefined, { tenant }), `settings ${tenant}`);
      // Keep the scenario meaningful: points redeemable on a ~₹3,500 bill.
      if (!(s.earnPer100 > 0 && s.maxRedeemPercent >= 20 && s.minRedeemPoints <= 200 && s.pointValuePaise === 100)) {
        s = ok(await call("PUT", "/v1/loyalty/settings", { earnPer100: 1, pointValuePaise: 100, minRedeemPoints: 100, maxRedeemPercent: 50 }, { tenant }), "put settings");
      }
      S[k] = s;
    }
    const s = S.bill;
    return `earn ${s.earnPer100}/₹100, point ${rs(s.pointValuePaise)}, min ${s.minRedeemPoints}, max ${s.maxRedeemPercent}%, tiers ${s.tiers.map((t) => `${t.name}≥${rs(t.minSpend)}×${t.multiplier}`).join(", ")}`;
  });

  // ------------------------------------------------------------------ 1. earn on a paid bill
  await step("loyalty: bill paid in full → member created with exact earned points; re-paying doesn't double-earn", async () => {
    expect(!(await memberOf(BILL, phone)), "member exists before the first bill");
    bill1 = ok(
      await call("POST", "/v1/invoices", {
        customer: { name: `E2E Loyal ${RUN}`, phone },
        date: today(),
        issue: true,
        lines: [{ description: "E2E loyalty silk saree", qty: 1, rate: 123_456, gstRate: 5 }],
      }),
      "bill1",
    );
    eq(bill1.status, "issued", "bill1 status");
    const pay = ok(await call("POST", `/v1/invoices/${bill1.id}/payments`, { amount: bill1.total, method: "cash", date: today() }), "pay bill1");
    eq(pay.status, "paid", "bill1 paid");
    member = await memberOf(BILL, phone);
    expect(member, "no loyalty member after the paid bill");
    p1 = earnPoints(bill1.total, S.bill.earnPer100, tierFor(0, S.bill.tiers).multiplier);
    eq(member.pointsBalance, p1, "earned points");
    eq(member.lifetimeSpend, bill1.total, "lifetime spend");
    // Remove the payment and pay again: the bill turns paid a second time, the earn is idempotent per bill.
    const paymentId = pay.payments[0].id;
    const un = ok(await call("DELETE", `/v1/invoices/${bill1.id}/payments/${paymentId}`), "delete payment");
    expect(un.status !== "paid", `status after removing the payment: ${un.status}`);
    eq(ok(await call("POST", `/v1/invoices/${bill1.id}/payments`, { amount: bill1.total, method: "upi", date: today() }), "pay again").status, "paid", "paid again");
    // and an extra payment on a paid bill is refused
    expect((await call("POST", `/v1/invoices/${bill1.id}/payments`, { amount: 100, method: "cash", date: today() })).status >= 400, "overpayment accepted");
    const again = await memberOf(BILL, phone);
    eq(again.pointsBalance, p1, "balance after paying twice");
    const d = await detail(BILL, member.id);
    const earns = d.ledger.items.filter((e) => e.type === "earn" && e.refId === bill1.id);
    eq(earns.length, 1, "earn entries for bill1");
    eq(earns[0].amountPaise, bill1.total, "earn basis");
    return `${bill1.number} ${rs(bill1.total)} → ${p1} points (floor(${bill1.total}×${S.bill.earnPer100}/10000)), member ${phone} ${again.tier}; re-paid: still ${again.pointsBalance}`;
  });

  // ------------------------------------------------------------------ 2. redeem on a bill
  const lines = [
    { description: "E2E loyalty cotton saree", hsn: "5208", qty: 1, rate: 150_000, gstRate: 5 },
    { description: "E2E loyalty stitching", hsn: "998821", qty: 2, rate: 85_050, gstRate: 18 },
  ];
  let G, N, redeemed, before;
  await step("loyalty: quote, then bill with loyaltyPoints (5% + 18%) → discount exact, GST on reduced taxable", async () => {
    expect(member, "no member from step 1");
    await adjust(BILL, member.id, 1000);
    before = (await memberOf(BILL, phone)).pointsBalance;
    eq(before, p1 + 1000, "balance after +1000");
    // The same bill without points, as a draft (G).
    G = ok(await call("POST", "/v1/invoices", { customer: { name: `E2E Loyal ${RUN}`, phone }, date: today(), lines }), "draft G");
    // Drafts of a shop share the (tenant, branch, fy, seq) unique key while seq is null (NULLS NOT DISTINCT), so a
    // second draft can't exist next to G: remove it before issuing the points bill.
    ok(await call("DELETE", `/v1/invoices/${G.id}`), "delete draft G");
    const q = ok(await call("POST", "/v1/loyalty/quote", { phone, amount: G.total }), "quote");
    const expMax = maxPointsFor(G.total, before, S.bill);
    expect(q.canRedeem === true && q.balance === before && q.maxPoints === expMax && q.maxDiscount === expMax * S.bill.pointValuePaise, `quote ${JSON.stringify(q).slice(0, 300)} expected max ${expMax}`);
    eq(q.earnPreview, earnPoints(G.total, S.bill.earnPer100, multiplierOf(q.member, S.bill.tiers)), "earn preview");
    N = Math.min(500, expMax);
    expect(N >= Math.max(1, S.bill.minRedeemPoints), `N ${N} below the minimum`);
    redeemed = ok(await call("POST", "/v1/invoices", { customer: { name: `E2E Loyal ${RUN}`, phone }, date: today(), lines, issue: true, loyaltyPoints: N }), "bill with points");
    const discount = N * S.bill.pointValuePaise;
    expect(redeemed.totals.loyalty && redeemed.totals.loyalty.points === N && redeemed.totals.loyalty.discount === discount, `totals.loyalty ${JSON.stringify(redeemed.totals.loyalty)}`);
    eq(redeemed.total, G.total - discount, "total = G − discount");
    const sum = redeemed.lines.reduce((s, l) => s + l.taxable + lineTax(l), 0);
    eq(sum, redeemed.total - redeemed.totals.roundOff, "Σ taxable + GST = total − roundOff");
    eq(redeemed.lines.length, G.lines.length, "line count");
    const notes = [];
    redeemed.lines.forEach((l, i) => {
      const g = G.lines[i];
      expect(l.taxable < g.taxable, `line ${i} taxable not reduced: ${l.taxable} vs ${g.taxable}`);
      eq(l.total - l.taxable, lineTax(l), `line ${i} total − taxable = GST`);
      const exact = (l.taxable * l.gstRate) / 100;
      expect(Math.abs(lineTax(l) - Math.round(exact)) <= 1, `line ${i} GST ${lineTax(l)} vs ${exact}`);
      expect(l.igst === 0 && Math.abs(l.cgst - l.sgst) <= 1, `line ${i} cgst/sgst ${l.cgst}/${l.sgst}`);
      notes.push(`${l.gstRate}%: taxable ${rs(g.taxable)}→${rs(l.taxable)}, GST ${rs(lineTax(g))}→${rs(lineTax(l))} (round(taxable×rate)=${Math.round(exact)})`);
    });
    eq(redeemed.totals.taxable, redeemed.lines.reduce((s, l) => s + l.taxable, 0), "totals.taxable");
    const after = (await memberOf(BILL, phone)).pointsBalance;
    eq(after, before - N, "balance after redeem");
    return `G ${rs(G.total)} (roundOff ${G.totals.roundOff}); ${N} pts = ${rs(discount)} → ${redeemed.number} ${rs(redeemed.total)} (roundOff ${redeemed.totals.roundOff}); ${notes.join("; ")}; balance ${before}→${after}`;
  });

  await step("loyalty: points without a phone → 400; more than allowed → 409 (create and /issue)", async () => {
    fails(
      await call("POST", "/v1/invoices", { customer: { name: `E2E Walk-in ${RUN}` }, date: today(), lines, issue: true, loyaltyPoints: 100 }),
      400,
      "loyalty_phone_required",
      "no phone",
    );
    fails(await call("POST", "/v1/invoices", { customer: { name: `E2E Loyal ${RUN}`, phone }, date: today(), lines, loyaltyPoints: 100 }), 400, "loyalty_on_issue", "points on a draft");
    const bal = (await memberOf(BILL, phone)).pointsBalance;
    const cap = maxPointsFor(G.total, bal, S.bill);
    const r = fails(await call("POST", "/v1/invoices", { customer: { name: `E2E Loyal ${RUN}`, phone }, date: today(), lines, issue: true, loyaltyPoints: cap + 1 }), 409, "loyalty_redeem", "too many points");
    // A draft issued with more points than the balance stays a draft; the balance is untouched.
    const d = ok(await call("POST", "/v1/invoices", { customer: { name: `E2E Loyal ${RUN}`, phone }, date: today(), lines }), "draft");
    try {
      fails(await call("POST", `/v1/invoices/${d.id}/issue`, { loyaltyPoints: bal + 1 }), 409, "loyalty_redeem", "issue with more than the balance");
      eq(ok(await call("GET", `/v1/invoices/${d.id}`), "draft").status, "draft", "still a draft");
    } finally {
      await call("DELETE", `/v1/invoices/${d.id}`);
    }
    eq((await memberOf(BILL, phone)).pointsBalance, bal, "balance after refusals");
    return `cap ${cap} (${r.error.details?.reason ?? r.error.message}); balance unchanged ${bal}`;
  });

  // ------------------------------------------------------------------ 3. cancel → reversal
  await step("loyalty: cancelling the redeemed bill gives points back; cancelling the paid bill takes the earn back", async () => {
    const b0 = (await memberOf(BILL, phone)).pointsBalance;
    ok(await call("POST", `/v1/invoices/${redeemed.id}/cancel`, { reason: `E2E loyalty ${RUN}` }), "cancel redeemed");
    const b1 = (await memberOf(BILL, phone)).pointsBalance;
    eq(b1, b0 + N, "balance after cancelling the redeemed bill");
    ok(await call("POST", `/v1/invoices/${bill1.id}/cancel`, { reason: `E2E loyalty ${RUN}` }), "cancel bill1");
    const m = await memberOf(BILL, phone);
    eq(m.pointsBalance, b1 - p1, "balance after cancelling the paid bill");
    eq(m.lifetimeSpend, 0, "lifetime spend after cancelling");
    // Cancelling again is refused or a no-op; the balance stays.
    await call("POST", `/v1/invoices/${bill1.id}/cancel`, { reason: "again" });
    eq((await memberOf(BILL, phone)).pointsBalance, m.pointsBalance, "balance after a second cancel");
    const d = await detail(BILL, member.id);
    const rev = (id) => d.ledger.items.filter((e) => e.type === "reverse" && e.refId === id);
    expect(rev(redeemed.id).length === 1 && rev(redeemed.id)[0].points === N, `reverse of the redeemed bill ${JSON.stringify(rev(redeemed.id))}`);
    expect(rev(bill1.id).length === 1 && rev(bill1.id)[0].points === -p1, `reverse of bill1 ${JSON.stringify(rev(bill1.id))}`);
    return `+${N} back (${b0}→${b1}), −${p1} taken back → ${m.pointsBalance}; ledger: ${d.ledger.items.map((e) => `${e.type}${e.points >= 0 ? "+" : ""}${e.points}`).join(", ")}`;
  });

  // ------------------------------------------------------------------ 4. checkout on e2e-store
  const shopperPhone = testPhone(4);
  const sh = { as: "loyalShopper", tenant: STORE };
  const st = { tenant: STORE };
  let akM, address, opt, cartToken, sMember;
  const fillCart = async () => {
    cartToken = ok(await call("POST", "/v1/store/cart", undefined, sh), "cart").token;
    ok(await call("PUT", `/v1/store/cart/${cartToken}/lines`, { variantId: akM.id, qty: 1 }, sh), "add AK-M");
    const q = ok(await call("GET", `/v1/store/cart/${cartToken}?pincode=620001`, undefined, sh), "cart quote");
    opt = q.delivery.options[0];
    return q;
  };
  const checkout = async (extra = {}) => {
    const r = ok(await call("POST", "/v1/store/checkout", { cartToken, addressId: address.id, deliveryOptionId: opt.id, paymentMethod: "cod", ...extra }, sh), "checkout");
    return ok(await call("GET", `/v1/orders/${r.order.id}`, undefined, st), "order");
  };

  await step("loyalty: store shopper gets points (staff adjust on e2e-store)", async () => {
    await signIn("loyalShopper", shopperPhone, STORE);
    ok(await call("PATCH", "/v1/store/me", { name: `E2E Loyal Shopper ${RUN}` }, sh), "name");
    address = ok(
      await call("POST", "/v1/store/me/addresses", { label: "Home", name: `E2E Loyal Shopper ${RUN}`, phone: shopperPhone, line1: "8, Nethaji Road", city: "Tiruchirappalli", stateCode: "33", pincode: "620001" }, sh),
      "address",
    );
    const ak = ok(await call("GET", "/v1/catalog/public/products/anarkali-kurti", undefined, { as: null, tenant: STORE }), "Anarkali Kurti");
    akM = ak.variants.find((v) => v.title === "M");
    eq(akM.price, 99_900, "AK-M price");
    const s = ok(await call("GET", `/v1/inventory/stock/${akM.id}`, undefined, st), "stock");
    ok(await call("POST", `/v1/inventory/stock/${akM.id}/adjust`, { mode: "set", qty: s.reserved + 20, note: `E2E loyalty ${RUN}` }, st), "top up");
    expect(!(await memberOf(STORE, shopperPhone)), "shopper already a member");
    eq(ok(await call("GET", "/v1/loyalty/me", undefined, sh), "me").enrolled, false, "not enrolled yet");
    // A member row exists once the customer earns: a small paid counter bill on e2e-store with the shopper's phone.
    const b = ok(await call("POST", "/v1/invoices", { customer: { name: `E2E Loyal Shopper ${RUN}`, phone: shopperPhone }, date: today(), issue: true, lines: [{ description: "E2E loyalty starter", qty: 1, rate: 10_000, gstRate: 5 }] }, st), "starter bill");
    ok(await call("POST", `/v1/invoices/${b.id}/payments`, { amount: b.total, method: "cash", date: today() }, st), "pay starter");
    sMember = await memberOf(STORE, shopperPhone);
    expect(sMember, "no member on e2e-store");
    const earned = earnPoints(b.total, S.store.earnPer100, tierFor(0, S.store.tiers).multiplier);
    eq(sMember.pointsBalance, earned, "starter points");
    const a = await adjust(STORE, sMember.id, 1000);
    eq(a.member.pointsBalance, earned + 1000, "after adjust");
    sMember = a.member;
    return `${shopperPhone}: ${earned} from ${b.number} ${rs(b.total)} + 1000 adjust = ${sMember.pointsBalance}`;
  });

  let orderNo, orderP, P;
  await step("loyalty: COD checkout with loyaltyPoints → discount exact, total = same cart without points − discount", async () => {
    const q0 = await fillCart();
    orderNo = await checkout();
    expect(!orderNo.totals.loyalty, `loyalty on an order without points ${JSON.stringify(orderNo.totals.loyalty)}`);
    ok(await call("POST", `/v1/orders/${orderNo.id}/status`, { status: "cancelled", note: "E2E comparison order" }, st), "cancel comparison");
    const bal = (await memberOf(STORE, shopperPhone)).pointsBalance;
    const q = await fillCart();
    eq(q.total, q0.total, "same cart");
    const quote = ok(await call("POST", "/v1/loyalty/quote", { amount: akM.price }, sh), "shopper quote");
    const cap = maxPointsFor(akM.price, bal, S.store);
    expect(quote.canRedeem && quote.balance === bal && quote.maxPoints === cap && quote.member?.memberKey === shopperPhone, `quote ${JSON.stringify(quote).slice(0, 300)} expected ${cap}`);
    // more than allowed is refused and nothing is redeemed
    const tooMany = await call("POST", "/v1/store/checkout", { cartToken, addressId: address.id, deliveryOptionId: opt.id, paymentMethod: "cod", loyaltyPoints: cap + 1 }, sh);
    expect(tooMany.status === 409 || tooMany.status === 400, `too many points at checkout: ${tooMany.status} ${JSON.stringify(tooMany.json).slice(0, 200)}`);
    eq((await memberOf(STORE, shopperPhone)).pointsBalance, bal, "balance after refused checkout");
    P = Math.min(300, cap);
    orderP = await checkout({ loyaltyPoints: P });
    const discount = P * S.store.pointValuePaise;
    expect(orderP.totals.loyalty?.points === P && orderP.totals.loyalty?.discount === discount, `order totals.loyalty ${JSON.stringify(orderP.totals.loyalty)}`);
    eq(orderP.total, orderNo.total - discount, "order total = without points − discount");
    eq((await memberOf(STORE, shopperPhone)).pointsBalance, bal - P, "balance after checkout");
    const line = orderP.lines[0];
    return `without points ${orderNo.number} ${rs(orderNo.total)}; ${P} pts = ${rs(discount)} → ${orderP.number} ${rs(orderP.total)} (line ${rs(line.total)}: taxable ${rs(line.taxable)} + GST ${rs(line.total - line.taxable)}); balance ${bal}→${bal - P}`;
  });

  await step("loyalty: delivered order → invoice total = order total, earns once on the net amount", async () => {
    const bal = (await memberOf(STORE, shopperPhone)).pointsBalance;
    const m0 = await memberOf(STORE, shopperPhone);
    const mult = multiplierOf(m0, S.store.tiers);
    const o = ok(await call("POST", `/v1/orders/${orderP.id}/status`, { status: "delivered" }, st), "deliver");
    eq(o.status, "delivered", "status");
    const order = ok(await call("GET", `/v1/orders/${orderP.id}`, undefined, st), "order");
    expect(order.invoiceId && order.paymentStatus === "paid", `invoice ${order.invoiceId} payment ${order.paymentStatus}`);
    const inv = ok(await call("GET", `/v1/invoices/${order.invoiceId}`, undefined, st), "order invoice");
    eq(inv.total, order.total, "invoice total = order total");
    eq(inv.status, "paid", "invoice paid");
    const net = order.total - order.refunded;
    const earned = earnPoints(net, S.store.earnPer100, mult);
    const m = await memberOf(STORE, shopperPhone);
    eq(m.pointsBalance, bal + earned, "balance after delivery");
    const d = await detail(STORE, sMember.id);
    const earns = d.ledger.items.filter((e) => e.type === "earn" && e.refId === orderP.id);
    expect(earns.length === 1 && earns[0].amountPaise === net && earns[0].points === earned, `order earns ${JSON.stringify(earns)}`);
    expect(!d.ledger.items.some((e) => e.type === "earn" && e.refId === inv.id), "the order's invoice earned points too");
    return `${order.number} delivered → ${inv.number} ${rs(inv.total)} paid; earned ${earned} on ${rs(net)} (once); balance ${m.pointsBalance}`;
  });

  await step("loyalty: order cancelled after redeeming gives the points back; /loyalty/me shows balance and history", async () => {
    const bal = (await memberOf(STORE, shopperPhone)).pointsBalance;
    await fillCart();
    const P2 = Math.max(S.store.minRedeemPoints, 100);
    const o = await checkout({ loyaltyPoints: P2 });
    eq(o.totals.loyalty?.points, P2, "points on the order");
    eq((await memberOf(STORE, shopperPhone)).pointsBalance, bal - P2, "after redeem");
    const c = ok(await call("POST", `/v1/store/me/orders/${o.id}/cancel`, { reason: "E2E loyalty cancel" }, sh), "shopper cancels");
    eq(c.status, "cancelled", "cancelled");
    eq((await memberOf(STORE, shopperPhone)).pointsBalance, bal, "balance after cancel");
    const me = ok(await call("GET", "/v1/loyalty/me", undefined, sh), "me");
    expect(me.enrolled && me.member.memberKey === shopperPhone && me.member.pointsBalance === bal, `me ${JSON.stringify(me.member)}`);
    const types = me.history.map((e) => `${e.type}:${e.refType}`);
    for (const t of ["earn:invoice", "adjust", "redeem:order", "earn:order", "reverse:order"]) expect(types.some((x) => x.startsWith(t)), `history has no ${t}: ${types}`);
    const rev = me.history.find((e) => e.type === "reverse" && e.refId === o.id);
    expect(rev && rev.points === P2, `reverse entry ${JSON.stringify(rev)}`);
    // The comparison order (no points) left no loyalty entries.
    expect(!me.history.some((e) => e.refId === orderNo.id), "comparison order has loyalty entries");
    return `${o.number}: −${P2} then +${P2} back; me: ${me.member.pointsBalance} pts (${rs(me.member.pointsValue)}), ${me.member.tier}, history ${types.join(", ")}`;
  });
}
