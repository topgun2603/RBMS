// Reproduces each suspected problem by hand, one clean request at a time, so the report only claims what was seen.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { API, OUT, ownerToken, startApi, stopApi, TENANT } from "./lib.mjs";

await startApi();
const token = await ownerToken();
const h = { authorization: `Bearer ${token}`, "x-tenant": TENANT };
const req = async (method, path, body, headers = h) => {
  const r = await fetch(API + path, { method, headers: { ...headers, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body });
  const t = await r.text();
  return `${r.status} ${t.slice(0, 170).replace(/\s+/g, " ")}`;
};
const show = async (label, ...a) => console.log(label.padEnd(44), await req(...a));

console.log("--- URL filters");
await show("gst itc ?from=abc", "GET", "/v1/gstfiling/itc?from=abc");
await show("gst itc ?from=2026-13-45", "GET", "/v1/gstfiling/itc?from=2026-13-45");
await show("gst itc ?to=' OR 1=1--", "GET", `/v1/gstfiling/itc?to=${encodeURIComponent("' OR 1=1--")}`);
await show("gst payments ?from=abc", "GET", "/v1/gstfiling/payments?from=abc");
await show("gst rcm ?from=abc", "GET", "/v1/gstfiling/rcm?from=abc");
await show("collections ?offset=huge", "GET", "/v1/catalog/collections?offset=99999999999999999999");
await show("public products ?offset=huge (no sign-in)", "GET", "/v1/catalog/public/products?offset=99999999999999999999", undefined, { "x-tenant": "e2e-store" });
await show("products ?q=null byte", "GET", "/v1/catalog/products?q=a%00b");
await show("public product slug null byte (no sign-in)", "GET", "/v1/catalog/public/products/a%00b", undefined, { "x-tenant": "e2e-store" });
console.log("--- bodies");
await show("reports/run body 123", "POST", "/v1/reports/run", "123");
await show("jobcards customerName null byte", "POST", "/v1/jobcards", JSON.stringify({ template: "repair", customerName: "a\u0000b" }));
await show("otp request target null byte", "POST", "/v1/auth/otp/request", JSON.stringify({ target: "a\u0000b@example.com" }), { "x-tenant": TENANT });
console.log("--- bills");
const cust = JSON.parse((await (await fetch(`${API}/v1/invoices/customers`, { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ name: `QA R ${Date.now()}`, stateCode: "33" }) })).text()));
const line = { description: "x", qty: 1, rate: 10000, gstRate: 18 };
const bill = async (o) => {
  const r = await fetch(`${API}/v1/invoices`, { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ customerId: cust.id, issue: true, date: new Date().toISOString().slice(0, 10), lines: [line], ...o }) });
  return r.status < 300 ? (await r.json()) : `${r.status} ${(await r.text()).slice(0, 150)}`;
};
const pick = (b) => (typeof b === "string" ? b : `saved number=${b.number} fy=${b.fy} date=${b.date} due=${b.dueDate ?? ""}`);
console.log("bill dated 1900                             ", pick(await bill({ date: "1900-01-01" })));
console.log("bill dated 2099                             ", pick(await bill({ date: "2099-01-01" })));
console.log("normal bill right after those               ", pick(await bill({})));
console.log("free item beside a paid item                ", pick(await bill({ lines: [line, { ...line, rate: 0, description: "free gift" }] })));
console.log("only a free item                            ", pick(await bill({ lines: [{ ...line, rate: 0 }] })));
console.log("100% discount on one of two lines           ", pick(await bill({ lines: [line, { ...line, discount: 10000 }] })));
console.log("2-digit HSN                                 ", pick(await bill({ lines: [{ ...line, hsn: "12" }] })));
console.log("bill with a null line                       ", pick(await bill({ lines: [null] })));
console.log("bill with a null beside a real line         ", pick(await bill({ lines: [line, null] })));
console.log("--- bad values the sweep saw accepted");
const anon = { "x-tenant": "e2e-store" };
// The billing test shop's plan refuses these features, and a refusal for that reason proves nothing.
const store = { ...h, "x-tenant": "e2e-store" };
await show("delivery quote pincode letters (no sign-in)", "POST", "/v1/delivery/public/quote", JSON.stringify({ pincode: "abcdef", weightGrams: 500, subtotal: 99900 }), anon);
await show("delivery quote pincode 100k (no sign-in)", "POST", "/v1/delivery/public/quote", JSON.stringify({ pincode: "x".repeat(100_000), weightGrams: 500, subtotal: 99900 }), anon);
await show("coupon starting 30 February", "POST", "/v1/coupons", JSON.stringify({ code: `QAFEB${Date.now()}`, type: "percent", value: 10, startsAt: "2026-02-30" }), store);
const categories = JSON.parse(await (await fetch(`${API}/v1/expenses/categories`, { headers: store })).text());
const categoryId = (categories.items ?? categories)[0]?.id;
const expense = (o) => JSON.stringify({ date: "2026-11-05", categoryId, amount: 118000, gstRate: 18, vendorName: "QA", paymentMethod: "upi", ...o });
await show("expense with GSTIN abcdef", "POST", "/v1/expenses", expense({ vendorGstin: "abcdef" }), store);
await show("expense dated 1900", "POST", "/v1/expenses", expense({ date: "1900-01-01" }), store);
await show("expense dated 9999", "POST", "/v1/expenses", expense({ date: "9999-12-31" }), store);
const stock = JSON.parse(await (await fetch(`${API}/v1/inventory/stock?limit=1`, { headers: store })).text());
const itemId = (stock.items ?? stock)[0]?.itemId;
await show("stock add with qty [2]", "POST", `/v1/inventory/stock/${itemId}/adjust`, JSON.stringify({ mode: "add", qty: [2], unitCost: 1000, note: "QA" }), store);
await show("stock add with qty []", "POST", `/v1/inventory/stock/${itemId}/adjust`, JSON.stringify({ mode: "add", qty: [], unitCost: 1000, note: "QA" }), store);
const till = await (await fetch(`${API}/v1/invoices/till/open`, { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ register: `QA ${Date.now()}`, openingCash: 0 }) })).json();
await show("till cash actorName 100k characters", "POST", `/v1/invoices/till/${till.id}/cash`, JSON.stringify({ amount: -100, reason: "QA", actorName: "x".repeat(100_000) }));

const sweep = JSON.parse(readFileSync(join(OUT, "findings-sweep.json"), "utf8"));
const open = Object.entries(sweep.coverage).filter(([r, c]) => c.anonymous >= 200 && c.anonymous < 300 && !r.startsWith("GET")).map(([r, c]) => `${r} ${c.anonymous}`);
const openGet = Object.entries(sweep.coverage).filter(([r, c]) => c.anonymous >= 200 && c.anonymous < 300 && r.startsWith("GET")).map(([r]) => r);
console.log(`--- answered 2xx with no sign-in: ${open.length} write routes, ${openGet.length} read routes`);
console.log(open.join("\n"));
console.log("--- read routes not obviously public");
console.log(openGet.filter((r) => !/public|health|ready|version|\/store\/|openapi|plans|pincode|branding|sitemap|robots|manifest/.test(r)).join("\n"));
stopApi();
process.exit(0);
