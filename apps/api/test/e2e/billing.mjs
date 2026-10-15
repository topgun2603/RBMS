// Billing v2 end-to-end: inventory, credit book, WhatsApp, online payment (mock), reports.
//   node test/e2e/billing.mjs      (pnpm --filter @srirealtime/api test:e2e:billing; test:e2e:all seeds and runs every script)
// Shop: e2e-bill (BL, pro) from `pnpm --filter @srirealtime/api seed:e2e`. The owner e2e-owner@example.com signs in with
// the dev test OTP (API env TEST_OTP_CODE / TEST_OTP_TARGETS); customers and the supplier use test numbers (+91 9999 00xxxx).
// Each run adds its own customer, bills and purchase, so it is safe to re-run.

const API = process.env.API_URL ?? "http://localhost:4000";
const SHOP = "e2e-bill";
const email = process.env.E2E_OWNER ?? "e2e-owner@example.com";
const OTP = process.env.E2E_OTP ?? "123456";
const MEENA_PHONE = "+919999000301";
const BUYER_PHONE = "+919999000302";
const SUPPLIER_PHONE = "+919999000303";
let token = null;
const results = [];
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() + 330 * 60_000 - n * 86_400_000).toISOString().slice(0, 10);

async function call(method, path, body, { auth = true, tenant = SHOP, raw = false } = {}) {
  const h = {};
  if (body !== undefined) h["content-type"] = "application/json";
  if (auth && token) h.authorization = `Bearer ${token}`;
  if (tenant) h["x-tenant"] = tenant;
  const res = await fetch(API + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (raw) return { status: res.status, text, headers: res.headers };
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}
const expect = (c, m) => { if (!c) throw new Error(m); };
const ok = (r, w) => { expect(r.status < 300, `${w}: ${r.status} ${JSON.stringify(r.json).slice(0, 500)}`); return r.json; };
async function step(name, fn) { try { results.push(["PASS", name, (await fn()) ?? ""]); } catch (e) { results.push(["FAIL", name, e.message]); } }
const rs = (p) => `₹${(p / 100).toFixed(2)}`;

await step("sign in (test OTP)", async () => {
  ok(await call("POST", "/v1/auth/otp/request", { target: email }, { tenant: null }), "request");
  token = ok(await call("POST", "/v1/auth/otp/verify", { target: email, code: OTP }, { tenant: null }), "verify (is TEST_OTP_CODE set for the API?)").token;
  return "ok";
});

// ---------- inventory
let items, silk, cotton;
await step("items", async () => {
  items = ok(await call("GET", "/v1/invoices/items"), "items").items;
  silk = items.find((i) => i.name === "Silk saree"); cotton = items.find((i) => i.name === "Cotton saree");
  return `${items.length} items`;
});
let silkBefore;
await step("opening stock: silk +10", async () => {
  const before = ok(await call("GET", "/v1/inventory/stock?q=Silk"), "stock").items.find((s) => s.itemId === silk.id);
  silkBefore = before?.qty ?? 0;
  const j = ok(await call("POST", `/v1/inventory/stock/${silk.id}/adjust`, { mode: "add", qty: 10, note: "Opening count", unitCost: 520000 }), "adjust");
  expect(j.qty === silkBefore + 10, `qty ${j.qty}`);
  silkBefore = j.qty;
  return `silk qty ${j.qty} status ${j.status}`;
});
await step("reorder level → low status", async () => {
  ok(await call("PATCH", `/v1/inventory/stock/${cotton.id}`, { reorderLevel: 8 }), "patch");
  const j = ok(await call("GET", "/v1/inventory/stock?filter=low"), "low");
  return `low: ${j.items.map((s) => `${s.name}(${s.qty})`).join(", ") || "none"}; value ${rs(j.totals.stockValue)}`;
});
let supplier;
await step("supplier (Erode, TN)", async () => { supplier = ok(await call("POST", "/v1/inventory/suppliers", { name: "Erode Handlooms", phone: SUPPLIER_PHONE, stateCode: "33" }), "supplier"); return supplier.id; });
let purchase;
await step("purchase 5 cotton sarees @ ₹600 (ITC)", async () => {
  purchase = ok(await call("POST", "/v1/inventory/purchases", { supplierId: supplier.id, billNumber: `EH-${Date.now() % 10000}`, date: today, lines: [{ itemId: cotton.id, description: cotton.name, hsn: cotton.hsn, qty: 5, unit: "pcs", rate: 60000, gstRate: 5 }] }), "purchase");
  expect(purchase.totals.cgst === 7500 && purchase.totals.sgst === 7500, JSON.stringify(purchase.totals));
  const s = ok(await call("GET", "/v1/inventory/stock?q=Cotton saree"), "stock").items.find((x) => x.itemId === cotton.id);
  return `total ${rs(purchase.total)}, ITC cgst+sgst ${rs(15000)}; cotton qty ${s.qty} avgCost ${rs(s.avgCost)} status ${s.status}`;
});

// ---------- credit book
let cust;
await step("customer with opening balance ₹500 + credit limit ₹10,000", async () => {
  cust = ok(await call("POST", "/v1/invoices/customers", { name: "Meena Sundaram", phone: MEENA_PHONE, stateCode: "33", openingBalance: 50000, creditLimit: 1000000 }), "cust");
  return `outstanding ${rs(cust.outstanding)}`;
});
let bill1, bill2;
await step("bill 1: 2 silk sarees (stock -2, credit limit warning)", async () => {
  bill1 = ok(await call("POST", "/v1/invoices", { customerId: cust.id, date: today, dueDate: today, issue: true, lines: [{ itemId: silk.id, description: silk.name, hsn: silk.hsn, qty: 2, unit: "pcs", rate: silk.rate, gstRate: 5 }] }), "bill1");
  const s = ok(await call("GET", `/v1/inventory/stock/${silk.id}`), "stock");
  expect(s.qty === silkBefore - 2, `silk qty ${s.qty}, expected ${silkBefore - 2}`);
  expect(bill1.warnings.includes("credit_limit_exceeded"), `warnings ${JSON.stringify(bill1.warnings)}`);
  return `${bill1.number} ${rs(bill1.total)}; silk qty now ${s.qty}; warnings ${bill1.warnings}`;
});
await step("bill 2: 1 cotton saree", async () => {
  bill2 = ok(await call("POST", "/v1/invoices", { customerId: cust.id, date: today, issue: true, lines: [{ itemId: cotton.id, description: cotton.name, hsn: cotton.hsn, qty: 1, rate: cotton.rate, gstRate: 5 }] }), "bill2");
  return `${bill2.number} ${rs(bill2.total)}`;
});
await step("ledger balance = opening + bills", async () => {
  const j = ok(await call("GET", `/v1/invoices/customers/${cust.id}/ledger?from=${daysAgo(30)}&to=${today}`), "ledger");
  const expected = 50000 + bill1.total + bill2.total;
  expect(j.closingBalance === expected, `closing ${j.closingBalance} expected ${expected}`);
  return `${j.entries.length} entries, closing ${rs(j.closingBalance)}`;
});
await step("receipt ₹10,000 on account → FIFO", async () => {
  const j = ok(await call("POST", `/v1/invoices/customers/${cust.id}/receipts`, { amount: 1000000, method: "cash", date: today }), "receipt");
  return `allocations ${j.allocations.map((a) => `${a.number}:${rs(a.amount)}`).join(", ")}; advance ${rs(j.advance)}`;
});
await step("credit book list", async () => {
  const j = ok(await call("GET", "/v1/invoices/credit-book?filter=all&q=Meena"), "creditbook");
  return `Meena balance ${rs(j.items[0]?.balance ?? 0)}; totals receivable ${rs(j.totals.receivable)}`;
});
await step("statement share + public statement", async () => {
  const s = ok(await call("POST", `/v1/invoices/customers/${cust.id}/statement/share`), "share");
  const p = ok(await call("GET", `/v1/invoices/public/statement/${s.token}`, undefined, { auth: false, tenant: null }), "public");
  return `${s.url} → balance ${rs(p.balance)}`;
});

// ---------- WhatsApp
await step("send bill 2 on WhatsApp (console driver)", async () => {
  const j = ok(await call("POST", `/v1/invoices/${bill2.id}/send`, { channel: "whatsapp" }), "send");
  const inv = ok(await call("GET", `/v1/invoices/${bill2.id}`), "get");
  expect(inv.messages.length >= 1, "no messages recorded");
  return `log ${j.logId}; messages ${inv.messages.map((m) => `${m.template}→${m.to}`).join(", ")}`;
});
await step("remind customer", async () => JSON.stringify(ok(await call("POST", `/v1/invoices/customers/${cust.id}/remind`, {}), "remind")).slice(0, 120));

// ---------- online payment (mock provider)
let bill3;
await step("bill 3 for online payment", async () => {
  bill3 = ok(await call("POST", "/v1/invoices", { customer: { name: "Online buyer", phone: BUYER_PHONE }, date: today, issue: true, lines: [{ description: "Blouse stitching", qty: 1, rate: 50000, gstRate: 5 }] }), "bill3");
  return `${bill3.number} ${rs(bill3.total)}`;
});
let share3, order;
await step("public invoice says online payment available", async () => {
  share3 = ok(await call("POST", `/v1/invoices/${bill3.id}/share`), "share");
  const p = ok(await call("GET", `/v1/invoices/public/${share3.token}`, undefined, { auth: false, tenant: null }), "public");
  expect(p.onlinePayment?.enabled === true, JSON.stringify(p.onlinePayment));
  expect(p.invoice.customer.name === "Online buyer", `walk-in name lost: ${p.invoice.customer.name}`);
  return `${JSON.stringify(p.onlinePayment)}; customer ${p.invoice.customer.name} ${p.invoice.customer.phone}`;
});
await step("checkout (mock)", async () => {
  order = ok(await call("POST", "/v1/payments/checkout", { kind: "invoice", ref: share3.token }, { auth: false, tenant: null }), "checkout");
  expect(order.provider === "mock" && order.amount === bill3.total, JSON.stringify(order));
  return `${order.orderId} ${rs(order.amount)} shop "${order.name}"`;
});
await step("mock payment completes → bill paid", async () => {
  ok(await call("POST", "/v1/payments/mock/complete", { orderId: order.orderId, method: "upi" }, { auth: false, tenant: null }), "complete");
  const inv = ok(await call("GET", `/v1/invoices/${bill3.id}`), "get");
  expect(inv.status === "paid", inv.status);
  return `status ${inv.status}, payment source ${inv.payments[0]?.source} ref ${inv.payments[0]?.reference}`;
});
await step("duplicate completion is ignored", async () => {
  const r = await call("POST", "/v1/payments/mock/complete", { orderId: order.orderId }, { auth: false, tenant: null });
  const inv = ok(await call("GET", `/v1/invoices/${bill3.id}`), "get");
  expect(inv.payments.length === 1, `payments ${inv.payments.length}`);
  return `second call ${r.status}, still 1 payment`;
});
await step("checkout refused for a paid bill", async () => {
  const r = await call("POST", "/v1/payments/checkout", { kind: "invoice", ref: share3.token }, { auth: false, tenant: null });
  expect(r.status === 400, `got ${r.status}`);
  return `${r.status} ${r.json.error.code}`;
});
await step("payment receipt WhatsApp queued", async () => {
  const inv = ok(await call("GET", `/v1/invoices/${bill3.id}`), "get");
  expect(inv.messages.some((m) => m.template === "payment.received"), `messages: ${JSON.stringify(inv.messages)}`);
  return inv.messages.map((m) => `${m.template}→${m.to}`).join(", ");
});

// ---------- cancel restores stock
await step("cancel bill 1 → silk stock restored", async () => {
  ok(await call("POST", `/v1/invoices/${bill1.id}/cancel`, { reason: "Customer changed mind" }), "cancel");
  const s = ok(await call("GET", `/v1/inventory/stock/${silk.id}`), "stock");
  expect(s.qty === silkBefore, `silk qty ${s.qty} expected ${silkBefore}`);
  return `silk qty ${s.qty}`;
});

// ---------- reports
const range = `from=${daysAgo(30)}&to=${today}`;
await step("sales trend (30 days)", async () => { const j = ok(await call("GET", "/v1/invoices/reports/sales-trend?days=30"), "trend"); return `${j.items.length} days, today ${rs(j.items.at(-1).invoiced)}`; });
await step("GST summary", async () => { const j = ok(await call("GET", `/v1/invoices/reports/gst-summary?${range}`), "gst"); return `b2b ${j.b2b.length}, b2cs ${j.b2cs.length}, hsn ${j.hsn.map((h) => h.hsn).join("/")}, 3B taxable ${rs(j.gstr3b.outwardTaxable)} igst ${rs(j.gstr3b.igst)} cgst ${rs(j.gstr3b.cgst)}`; });
await step("payments by method", async () => ok(await call("GET", `/v1/invoices/reports/payments?${range}`), "pay").byMethod.map((m) => `${m.method} ${rs(m.amount)}`).join(", "));
await step("dues ageing", async () => ok(await call("GET", `/v1/invoices/reports/ageing?asOf=${today}`), "ageing").buckets.map((b) => `${b.key}:${rs(b.amount)}`).join(" "));
await step("top items", async () => ok(await call("GET", `/v1/invoices/reports/top-items?${range}`), "top").items.map((i) => `${i.description}×${i.qty}`).join(", "));
await step("sales register CSV", async () => { const r = await call("GET", `/v1/invoices/reports/sales-register?${range}&format=csv`, undefined, { raw: true }); expect(r.status === 200 && r.headers.get("content-type").includes("text/csv"), `status ${r.status}`); return `${r.text.split("\r\n").length - 1} rows; ${r.headers.get("content-disposition")}`; });
await step("purchases report ITC", async () => { const j = ok(await call("GET", `/v1/inventory/reports/purchases?${range}`), "pr"); return `rows ${j.rows.length}, ITC ${rs(j.itc.total)}`; });
await step("dashboard summary trend + prevMonth", async () => { const j = ok(await call("GET", "/v1/invoices/summary"), "sum"); return `trend ${j.trend.length} days, month ${rs(j.month.invoiced)}, prev ${rs(j.prevMonth.invoiced)}`; });
await step("payments account (owner)", async () => JSON.stringify(ok(await call("GET", "/v1/payments/account"), "acct")));

for (const [s, n, o] of results) console.log(`${s}  ${n}${o ? "  →  " + o : ""}`);
const passed = results.filter((r) => r[0] === "PASS").length;
console.log(`\n${passed}/${results.length} passed`);
process.exitCode = passed === results.length ? 0 : 1;
