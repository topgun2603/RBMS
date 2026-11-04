// Backs the marketing claim "one stock for counter and store": one product, sold at the counter and online, on the QA stack.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { API, OUT, ownerToken, startApi, stopApi } from "./lib.mjs";

await startApi();
const token = await ownerToken();
const SHOP = "e2e-store";
const call = async (method, path, body) => {
  const r = await fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${token}`, "x-tenant": SHOP, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let json;
  try {
    json = JSON.parse(t);
  } catch {
    json = t;
  }
  return { status: r.status, json };
};
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const list = await call("GET", "/v1/inventory/stock?limit=50");
const rows = list.json.items ?? list.json;
const row = rows.find((r) => r.tracked !== false) ?? rows[0];
const id = row.itemId ?? row.variantId ?? row.id;
console.log("product:", row.name, "id", id);
const stock = async () => {
  const r = (await call("GET", "/v1/inventory/stock?limit=50")).json;
  const x = (r.items ?? r).find((i) => (i.itemId ?? i.variantId ?? i.id) === id);
  return { qty: x.qty, reserved: x.reserved };
};
const set = await call("POST", `/v1/inventory/stock/${id}/adjust`, { mode: "set", qty: 10, note: "qa one-stock" });
console.log("set to 10:", set.status, JSON.stringify(await stock()));

const bill = await call("POST", "/v1/invoices", { customer: { name: "QA walk-in" }, date: today, issue: true, lines: [{ itemId: id, description: row.name, qty: 1, rate: 10000, gstRate: 5 }] });
console.log("counter bill for 1:", bill.status, bill.json.number ?? JSON.stringify(bill.json).slice(0, 200), JSON.stringify(await stock()));

const sample = readFileSync(join(OUT, "recorded.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.method === "POST" && r.url.split("?")[0] === "/v1/orders" && r.body);
const body = JSON.parse(sample[0].body);
console.log("recorded order shape:", JSON.stringify(body).slice(0, 220));
if (Array.isArray(body.lines) && body.lines[0]) {
  const key = "variantId" in body.lines[0] ? "variantId" : "itemId" in body.lines[0] ? "itemId" : null;
  body.lines = [{ ...body.lines[0], ...(key ? { [key]: id } : {}), qty: 1 }];
  delete body.couponCode;
}
const order = await call("POST", "/v1/orders", body);
console.log("online-style order for 1:", order.status, order.json.number ?? JSON.stringify(order.json).slice(0, 240), JSON.stringify(await stock()));
stopApi();
process.exit(0);
