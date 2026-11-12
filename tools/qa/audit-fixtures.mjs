// Test data for audit.mjs: documents the demo history never makes, created through the real API on the QA stack (a refusal
// is itself a finding), and the record ids that open each detail page.
import { execSync } from "node:child_process";
import { API, QA_DB } from "./lib.mjs";

const psql = (sql) => execSync(`docker exec srikit-postgres-1 psql -U srikit -d ${QA_DB} -tAc "${sql}"`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const LINE = { description: "QA audit item", qty: 2, rate: 10_000, gstRate: 18, hsn: "6109", unit: "pcs" };

/** Creates one of each document on the shop and returns the links customers open. Refusals come back as findings. */
export async function createFixtures(token, shop) {
  const headers = { authorization: `Bearer ${token}`, "x-tenant": shop, "content-type": "application/json" };
  const refused = [];
  const post = async (path, body) => {
    const r = await fetch(`${API}${path}`, { method: "POST", headers: { ...headers, "idempotency-key": `audit-${shop}-${Date.now()}-${Math.random().toString(36).slice(2)}` }, body: JSON.stringify(body) });
    const text = await r.text();
    if (r.ok) return text ? JSON.parse(text) : {};
    refused.push({ path, detail: `${r.status} ${text.slice(0, 220)}` });
    return null;
  };
  const customer = (await post("/v1/invoices/customers", { name: `QA Audit ${Date.now()}`, stateCode: "33", phone: "+919999000777" }))?.id;
  const tokens = {};
  if (!customer) return { tokens, refused };
  const doc = { customerId: customer, lines: [LINE] };
  const draft = await post("/v1/invoices", { ...doc, date: today(), issue: false });
  const bill = await post("/v1/invoices", { ...doc, date: today(), issue: true });
  if (bill) {
    await post(`/v1/invoices/${bill.id}/credit-notes`, { reason: "return", refundMode: "cash", lines: [{ line: 0, qty: 1 }], note: "QA audit" });
    tokens.i = (await post(`/v1/invoices/${bill.id}/share`, {}))?.token;
  }
  tokens.s = (await post(`/v1/invoices/customers/${customer}/statement/share`, {}))?.token;
  const quote = await post("/v1/quotations", doc);
  if (quote) tokens.q = (await post(`/v1/quotations/${quote.id}/share`, {}))?.token;
  const proforma = await post("/v1/sales-docs/proformas", doc);
  if (proforma) tokens.d = (await post(`/v1/sales-docs/proformas/${proforma.id}/share`, {}))?.token;
  await post("/v1/sales-docs/sale-orders", doc);
  await post("/v1/sales-docs/challans", { ...doc, reason: "job_work" });
  await post("/v1/recurring", { ...doc, name: "QA audit monthly", frequency: "monthly", interval: 1, dayOfMonth: 1, startDate: today() });
  return { tokens, refused, draft: draft?.id };
}

/** A detail page's address, its last piece of the route, and the table holding its records. */
const DETAILS = [
  [/\/invoices\/:id\/edit$/, "invoices", "status = 'draft'"],
  [/\/invoices\/:id$/, "invoices", "status <> 'draft'"],
  [/\/quotations\/:id(\/edit)?$/, "quotations"],
  [/\/credit-notes\/:id$/, "credit_notes"],
  [/\/sales-debit-notes\/:id$/, "sales_debit_notes"],
  [/\/customers\/:id$/, "billing_customers"],
  [/\/stock-audit\/:id$/, "stock_audits"],
  [/\/transfers\/:id$/, "stock_transfers"],
  [/\/purchases\/:id$/, "purchases"],
  [/\/purchase-orders\/:id$/, "purchase_orders"],
  [/\/suppliers\/:id$/, "suppliers"],
  [/\/proformas\/:id(\/edit)?$/, "proforma_invoices"],
  [/\/sale-orders\/:id(\/edit)?$/, "sale_orders"],
  [/\/challans\/:id$/, "delivery_challans"],
  [/\/recurring\/:id(\/edit)?$/, "recurring_profiles"],
  [/\/chat\/:id$/, "chat_conversations"],
  [/\/campaigns\/:id$/, "wa_campaigns"],
  [/\/whatsapp\/:id$/, "wa_conversations"],
  [/\/support\/:id$/, "support_tickets"],
  [/\/faq\/:id$/, "faq_articles"],
  [/\/loyalty\/members\/:id$/, "loyalty_members"],
  [/\/grow\/reports\/:id$/, "saved_reports"],
  [/\/staff\/payroll\/:id$/, "payroll_runs"],
  [/\/orders\/:id$/, "orders"],
  [/\/offers\/:id$/, "offers"],
  [/\/blog\/:id$/, "cms_posts"],
  [/\/enquiries\/:id$/, "enquiries"],
  [/\/exchange\/:id$/, "jewellery_exchanges"],
  [/\/marketplace\/vendors\/:id$/, "vendors"],
  [/\/dine\/orders\/:id$/, "dining_orders"],
  [/\/jobs\/jobs\/:id$/, "jobcards"],
  [/\/members\/m\/:id$/, "membership_members"],
  [/\/products\/:id$/, "catalog_products"],
];
const PUBLIC_LINKS = { "/i/:token": "i", "/s/:token": "s", "/q/:token": "q", "/d/:token": "d" };

/** The address of a real record for a route such as /invoices/:id, or null when the shop has none. */
export function detailValue(shop, full, tokens) {
  for (const [end, key] of Object.entries(PUBLIC_LINKS)) {
    if (full.endsWith(end)) return tokens[key] ? full.replace(":token", tokens[key]) : null;
  }
  const hit = DETAILS.find(([re]) => re.test(full));
  if (!hit) return null;
  const [, table, where] = hit;
  try {
    const id = psql(`select x.id from ${table} x join tenants t on t.id = x.tenant_id where t.slug = '${shop}'${where ? ` and x.${where}` : ""} order by x.created_at desc limit 1`);
    return id ? full.replace(":id", id) : null;
  } catch {
    return null;
  }
}
