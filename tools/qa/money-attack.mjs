// Bad behaviour against the money flows, with expected answers written by hand. QA stack only.
// reject = must be refused with a 4xx. allow = must work. judge = either is defensible: the answer is listed for the owner.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { API, OUT, ownerToken, startApi, stopApi, TENANT } from "./lib.mjs";

await startApi();
const token = await ownerToken();
const OTHER = "e2e-store";
const rows = [];
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
let n = 0;

async function call(method, path, body, { tenant = TENANT, raw = false } = {}) {
  const res = await fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(tenant ? { "x-tenant": tenant } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }), "idempotency-key": `m-${Date.now()}-${n++}` }, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}
const must = (r, what) => {
  if (r.status >= 300) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json;
};
function record(area, name, expect, r, evidence) {
  const ok2xx = r.status >= 200 && r.status < 300;
  const crash = r.status >= 500;
  const verdict = crash ? "CRASH" : expect === "judge" ? "JUDGE" : expect === "reject" ? (ok2xx ? "FAIL" : "PASS") : ok2xx ? "PASS" : "FAIL";
  rows.push({ area, name, expect, status: r.status, verdict, evidence: evidence ?? (ok2xx ? "" : (r.json?.error?.code ?? "")) });
}

const cust = must(await call("POST", "/v1/invoices/customers", { name: `QA Selvi ${Date.now()}`, stateCode: "33" }), "customer");
const line = (o = {}) => ({ description: "QA item", qty: 1, rate: 10_000, gstRate: 18, ...o });
const bill = (lines, extra = {}) => call("POST", "/v1/invoices", { customerId: cust.id, date: today, issue: true, lines, ...extra });
const freshBill = async (o) => must(await bill([line(o)]), "fresh bill");

// ---------------------------------------------------------------- bill lines
const LINE_BAD = [
  ["quantity zero", { qty: 0 }, "reject"], ["quantity negative", { qty: -1 }, "reject"], ["quantity small negative", { qty: -0.5 }, "reject"], ["quantity letters", { qty: "abc" }, "reject"], ["quantity '12abc'", { qty: "12abc" }, "reject"], ["quantity empty", { qty: "" }, "reject"], ["quantity null", { qty: null }, "reject"],
  ["quantity 1e21", { qty: 1e21 }, "reject"], ["quantity 1e308", { qty: 1e308 }, "reject"], ["quantity 4 decimals", { qty: 0.0001 }, "reject"], ["quantity 1 crore", { qty: 10_000_000 }, "judge"], ["quantity 3 decimals", { qty: 1.125 }, "allow"],
  ["price negative", { rate: -100 }, "reject"], ["price letters", { rate: "abc" }, "reject"], ["price fraction of a paisa", { rate: 10.5 }, "reject"], ["price 1e21", { rate: 1e21 }, "reject"], ["price zero", { rate: 0 }, "accept"], ["price with rupee sign", { rate: "₹100" }, "reject"], ["price with comma", { rate: "1,000" }, "reject"],
  ["GST 7%", { gstRate: 7 }, "reject"], ["GST negative", { gstRate: -18 }, "reject"], ["GST text", { gstRate: "18" }, "reject"], ["GST 100%", { gstRate: 100 }, "reject"], ["GST 40%", { gstRate: 40 }, "allow"],
  ["discount negative (raises the price)", { discount: -5000 }, "reject"], ["discount above the amount", { discount: 20_000 }, "reject"], ["discount letters", { discount: "abc" }, "reject"], ["discount equals the amount", { discount: 10_000 }, "accept"],
  ["description empty", { description: "" }, "reject"], ["description spaces", { description: "   " }, "reject"], ["description 100k", { description: "x".repeat(100_000) }, "reject"], ["description null byte", { description: "a\u0000b" }, "reject"], ["description script", { description: "<script>alert(1)</script>" }, "judge"],
  ["HSN letters", { hsn: "ABCD" }, "reject"], ["HSN 2 digits", { hsn: "12" }, "reject"], ["inclusive total negative", { inclusiveTotal: -1 }, "reject"], ["inclusive total letters", { inclusiveTotal: "abc" }, "reject"],
];
for (const [name, o, expect] of LINE_BAD) {
  const r = await bill([line(o)]);
  record("Bill line", name, expect, r, r.status < 300 ? `saved, total ${r.json.total}` : undefined);
}
// Overflow by valid-looking parts: each field passes alone, the product doesn't.
{
  const r = await bill([line({ qty: 1_000_000, rate: 2_000_000_000 })]);
  record("Bill line", "10 lakh units at the top price (₹2 crore each)", "judge", r, r.status < 300 ? `saved, total ${r.json.total} paise` : undefined);
}
const BILL_BAD = [
  ["no lines", { lines: [] }, "reject"], ["10,000 lines", { lines: Array.from({ length: 10_000 }, () => line()) }, "reject"], ["date month 13", { date: "2026-13-45" }, "reject"], ["date 30 Feb", { date: "2026-02-30" }, "reject"], ["date year 1900", { date: "1900-01-01" }, "reject"], ["date year 2099", { date: "2099-01-01" }, "reject"], ["due date before bill date", { dueDate: "2000-01-01" }, "reject"], ["place of supply 99", { placeOfSupply: "99" }, "reject"], ["customer from another shop's id format", { customerId: "not-a-uuid" }, "reject"], ["unknown customer", { customerId: "7f3c1d52-9a0e-4b7a-8c11-2d4e6f8a9b10" }, "reject"],
];
for (const [name, o, expect] of BILL_BAD) {
  const r = await call("POST", "/v1/invoices", { customerId: cust.id, date: today, issue: true, lines: [line()], ...o });
  record("Bill", name, expect, r, r.status < 300 ? `saved, total ${r.json.total}, date ${r.json.date}` : undefined);
}

// ---------------------------------------------------------------- payments
const PAY_BAD = [["negative", -100, "reject"], ["zero", 0, "reject"], ["half a paisa", 0.5, "reject"], ["letters", "abc", "reject"], ["empty", "", "reject"], ["null", null, "reject"], ["1e21", 1e21, "reject"], ["more than the bill", 99_999_999, "reject"]];
for (const [name, amount, expect] of PAY_BAD) {
  const b = await freshBill();
  const r = await call("POST", `/v1/invoices/${b.id}/payments`, { amount, method: "cash", date: today });
  const after = must(await call("GET", `/v1/invoices/${b.id}`), "read bill");
  record("Payment", `amount ${name}`, expect, r, r.status < 300 ? `saved; bill ${b.total}, amountPaid ${after.amountPaid ?? after.paid}, status ${after.status}` : undefined);
}
{
  const b = await freshBill();
  record("Payment", "unknown method 'bitcoin'", "reject", await call("POST", `/v1/invoices/${b.id}/payments`, { amount: b.total, method: "bitcoin", date: today }));
  record("Payment", "date in year 2099", "reject", await call("POST", `/v1/invoices/${b.id}/payments`, { amount: 100, method: "cash", date: "2099-01-01" }));
}
{
  const b = await freshBill();
  must(await call("POST", `/v1/invoices/${b.id}/cancel`, { reason: "qa" }), "cancel");
  record("Payment", "pay a cancelled bill", "reject", await call("POST", `/v1/invoices/${b.id}/payments`, { amount: b.total, method: "cash", date: today }));
  record("Bill", "cancel the same bill twice", "reject", await call("POST", `/v1/invoices/${b.id}/cancel`, { reason: "again" }));
}
{
  const d = must(await call("POST", "/v1/invoices", { customerId: cust.id, date: today, lines: [line()] }), "draft");
  record("Payment", "pay a draft that was never issued", "reject", await call("POST", `/v1/invoices/${d.id}/payments`, { amount: d.total, method: "cash", date: today }));
}
{
  // Five full payments at the same instant: the bill must not end up paid five times.
  const b = await freshBill();
  const all = await Promise.all(Array.from({ length: 5 }, () => call("POST", `/v1/invoices/${b.id}/payments`, { amount: b.total, method: "cash", date: today })));
  const okCount = all.filter((r) => r.status < 300).length;
  const after = must(await call("GET", `/v1/invoices/${b.id}`), "read bill");
  const paid = after.amountPaid ?? after.paid ?? (after.payments ?? []).reduce((s, p) => s + p.amount, 0);
  rows.push({ area: "Payment", name: "5 full payments at the same instant", expect: "only one succeeds", status: okCount, verdict: okCount === 1 && paid === b.total ? "PASS" : "FAIL", evidence: `${okCount} succeeded; bill ${b.total}, recorded paid ${paid}` });
}

// ---------------------------------------------------------------- returns
{
  const b = must(await bill([line({ qty: 2 })]), "bill for returns");
  const note = (lines, extra = {}) => call("POST", `/v1/invoices/${b.id}/credit-notes`, { reason: "return", refundMode: "none", lines, ...extra });
  record("Return", "return more than sold", "reject", await note([{ line: 0, qty: 3 }]));
  record("Return", "return negative quantity", "reject", await note([{ line: 0, qty: -1 }]));
  record("Return", "return zero", "reject", await note([{ line: 0, qty: 0 }]));
  record("Return", "return letters", "reject", await note([{ line: 0, qty: "abc" }]));
  record("Return", "unknown line", "reject", await note([{ line: 99, qty: 1 }]));
  record("Return", "negative line number", "reject", await note([{ line: -1, qty: 1 }]));
  record("Return", "same line twice to beat the limit", "reject", await note([{ line: 0, qty: 2 }, { line: 0, qty: 2 }]));
  record("Return", "correction with negative value", "reject", await call("POST", `/v1/invoices/${b.id}/credit-notes`, { reason: "price_correction", refundMode: "none", lines: [{ line: 0, taxable: -100 }] }));
  record("Return", "correction above the line value", "reject", await call("POST", `/v1/invoices/${b.id}/credit-notes`, { reason: "price_correction", refundMode: "none", lines: [{ line: 0, taxable: 99_999_999 }] }));
  const all = await Promise.all(Array.from({ length: 5 }, () => note([{ line: 0, qty: 2 }])));
  const okCount = all.filter((r) => r.status < 300).length;
  rows.push({ area: "Return", name: "5 full returns at the same instant", expect: "only one succeeds", status: okCount, verdict: okCount === 1 ? "PASS" : "FAIL", evidence: `${okCount} succeeded` });
}

// ---------------------------------------------------------------- saved items, customers
const items = await call("GET", "/v1/invoices/items?limit=1");
const ITEM_BAD = [["price negative", { rate: -1 }], ["price letters", { rate: "abc" }], ["GST 7%", { gstRate: 7 }], ["empty name", { name: "" }], ["HSN letters", { hsn: "ABCD" }]];
for (const [name, o] of ITEM_BAD) record("Saved item", name, "reject", await call("POST", "/v1/invoices/items", { name: `QA ${Date.now()}-${n++}`, unit: "pcs", rate: 1000, gstRate: 18, ...o }));
const CUST_BAD = [
  ["phone letters", { phone: "abcdefghij" }, "reject"], ["phone too short", { phone: "12" }, "reject"], ["phone 25 digits", { phone: "1234567890123456789012345" }, "reject"], ["bad GSTIN", { gstin: "NOTAGSTIN" }, "reject"], ["GSTIN with wrong check digit", { gstin: "33AABFR1234K1ZX" }, "reject"], ["state 99", { stateCode: "99" }, "reject"], ["credit limit negative", { creditLimit: -1 }, "reject"], ["opening balance letters", { openingBalance: "abc" }, "reject"], ["opening balance 1e21", { openingBalance: 1e21 }, "reject"], ["empty name", { name: "" }, "reject"], ["name only spaces", { name: "   " }, "reject"], ["email without @", { email: "not-an-email" }, "reject"], ["opening balance negative (advance)", { openingBalance: -5000 }, "judge"],
];
for (const [name, o, expect] of CUST_BAD) record("Customer", name, expect, await call("POST", "/v1/invoices/customers", { name: `QA ${Date.now()}-${n++}`, stateCode: "33", ...o }));
{
  const RECEIPT_BAD = [["negative", -100], ["zero", 0], ["letters", "abc"], ["1e21", 1e21]];
  for (const [name, amount] of RECEIPT_BAD) record("Credit book", `receipt ${name}`, "reject", await call("POST", `/v1/invoices/customers/${cust.id}/receipts`, { amount, method: "cash", date: today }));
}

// ---------------------------------------------------------------- stock
{
  const list = await call("GET", "/v1/inventory/stock?limit=5");
  const rowsList = list.json?.items ?? list.json?.rows ?? [];
  const id = rowsList[0]?.itemId ?? rowsList[0]?.id;
  if (id) {
    const adj = (o) => call("POST", `/v1/inventory/stock/${id}/adjust`, { mode: "add", qty: 1, note: "qa", ...o });
    for (const [name, o, expect] of [["add negative", { qty: -5 }, "reject"], ["add zero", { qty: 0 }, "reject"], ["add letters", { qty: "abc" }, "reject"], ["add 1e21", { qty: 1e21 }, "reject"], ["unknown mode", { mode: "steal" }, "reject"], ["unit cost negative", { unitCost: -1 }, "reject"], ["unit cost letters", { unitCost: "abc" }, "reject"], ["set to negative", { mode: "set", qty: -5 }, "reject"], ["remove far more than held", { mode: "remove", qty: 1_000_000 }, "reject"]]) {
      const r = await adj(o);
      record("Stock", name, expect, r, r.status < 300 ? `saved: ${JSON.stringify(r.json).slice(0, 120)}` : undefined);
    }
  } else rows.push({ area: "Stock", name: "could not find a stocked item", expect: "-", status: list.status, verdict: "SKIP", evidence: "" });
}

// ---------------------------------------------------------------- another shop's data
{
  const mine = await freshBill();
  const theirs = (m, p, b) => call(m, p, b, { tenant: OTHER });
  for (const [name, r] of [
    ["read my bill while signed into another shop", await theirs("GET", `/v1/invoices/${mine.id}`)],
    ["pay my bill from another shop", await theirs("POST", `/v1/invoices/${mine.id}/payments`, { amount: mine.total, method: "cash", date: today })],
    ["cancel my bill from another shop", await theirs("POST", `/v1/invoices/${mine.id}/cancel`, { reason: "qa" })],
    ["read my customer from another shop", await theirs("GET", `/v1/invoices/customers/${cust.id}`)],
  ]) record("Other shop", name, "reject", r);
  const other = must(await call("POST", "/v1/invoices/customers", { name: `QA other ${Date.now()}`, stateCode: "33" }, { tenant: OTHER }), "other shop customer");
  record("Other shop", "bill another shop's customer", "reject", await bill([line()], { customerId: other.id }));
  const res = await fetch(`${API}/v1/invoices/${mine.id}`, { headers: { "x-tenant": TENANT } });
  record("Other shop", "read a bill with no sign-in", "reject", { status: res.status, json: {} });
}

writeFileSync(join(OUT, "money.json"), JSON.stringify(rows, null, 1));
const count = (v) => rows.filter((r) => r.verdict === v).length;
console.log(`money attack: ${rows.length} checks. PASS ${count("PASS")}  FAIL ${count("FAIL")}  CRASH ${count("CRASH")}  JUDGE ${count("JUDGE")}  SKIP ${count("SKIP")}`);
for (const r of rows.filter((x) => x.verdict !== "PASS")) console.log(`${r.verdict.padEnd(5)} ${r.area}: ${r.name} -> ${r.status} ${String(r.evidence).slice(0, 110)}`);
stopApi();
process.exit(0);
