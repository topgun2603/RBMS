#!/usr/bin/env node
// Checks the hand-written Dart models in dart/srikit_api against the typed API document.
//
//   pnpm --filter @rbms/api openapi -- --typed openapi.typed.json   (writes apps/api/openapi.typed.json)
//   node scripts/mobile/check-api-models.mjs [path/to/openapi.typed.json]
//
// For every operation srikit_api calls (found in lib/src/srikit_api.dart) that the document types, each documented
// response property must be read by the Dart model mapped to that level of the response (a name-level check on the
// `json['key']` reads in the class). Exit 1 on a missing property, or on a typed operation the app calls with no
// mapping below. Operations the app calls that the document doesn't type yet, and Dart keys the document doesn't list,
// are printed as notes only. No dependencies; not a code generator.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const docPath = resolve(process.argv[2] ?? resolve(root, "apps/api/openapi.typed.json"));
const apiDart = resolve(root, "dart/srikit_api/lib/src/srikit_api.dart");
const srcDir = resolve(root, "dart/srikit_api/lib/src");

/**
 * Response level → Dart class, per operation. Two markers instead of a class:
 * - `"map"`: an opaque JSON map / list kept raw (`Json`); the property itself must be read, what is inside is not checked;
 * - `"ignore"`: a property the client deliberately doesn't read (say why next to it); nothing under it is checked.
 *
 * Levels: "" (the body), "user" (a property), "items[]" (array items),
 * "apps.*" (map values). A level without an entry is checked against the nearest mapped parent (nested objects a
 * class reads inline, like `phone` in AuthClientConfig).
 */
const tillSession = (at) => ({
  [at]: "TillSession",
  [`${at ? `${at}.` : ""}cashEntries[]`]: "TillCashEntry",
  [`${at ? `${at}.` : ""}summary`]: "TillReport",
  [`${at ? `${at}.` : ""}summary.payments[]`]: "TillMethodTotal",
  [`${at ? `${at}.` : ""}summary.refunds[]`]: "TillMethodTotal",
  [`${at ? `${at}.` : ""}openingCount`]: "map",
  [`${at ? `${at}.` : ""}closingCount`]: "map",
});
const tillReport = { "": "TillSessionReport", ...tillSession("session"), report: "TillReport", "report.payments[]": "TillMethodTotal", "report.refunds[]": "TillMethodTotal" };
const INVOICE = {
  "": "Invoice",
  customer: "InvoiceParty",
  seller: "SellerProfile",
  "lines[]": "InvoiceLine",
  totals: "InvoiceTotals",
  "totals.taxBreakup[]": "TaxBreakupRow",
  "payments[]": "InvoicePaymentRow",
  "messages[]": "map",
  "creditNotes[]": "map",
};
const PRODUCT = {
  "": "Product",
  "variants[]": "ProductVariant",
  "variants[].optionValues": "map",
  attributes: "map",
  "options[]": "map",
  "images[]": "map",
  seo: "map",
};
const ORDER = {
  "": "Order",
  customer: "OrderCustomer",
  shippingAddress: "OrderAddress",
  billingAddress: "OrderAddress",
  "lines[]": "OrderLine",
  totals: "OrderTotals",
  "totals.shippingLine": "map",
  "totals.codFeeLine": "map",
  "totals.taxBreakup[]": "map",
  "totals.offers[]": "map",
  fulfillment: "Fulfillment",
  "events[]": "OrderEvent",
  "events[].data": "map",
};
const VARIANT = (at) => ({ [at]: "Variant", [`${at ? `${at}.` : ""}optionValues`]: "map" });
const under = (at, k) => (at ? `${at}.${k}` : k);
const TERMINAL = (at) => ({ [at]: "PosTerminal", [under(at, "settings")]: "TerminalSettings", [under(at, "device")]: "PosDeviceDescription" });
const WEIGH_TICKET = (at) => ({ [at]: "WeighTicket", [under(at, "lines[]")]: "WeighTicketLine" });

const MODELS = {
  "GET /v1/mobile/config": { "": "MobileConfig", "apps.*": "MobileAppVersions", client: "MobileClient" },
  "GET /v1/auth/config": { "": "AuthClientConfig" },
  "POST /v1/auth/otp/request": { "": "OtpRequestResult" },
  "POST /v1/auth/otp/verify": { "": "SignInResult", user: "AuthUser" },
  "POST /v1/auth/firebase": { "": "SignInResult", user: "AuthUser" },
  "GET /v1/auth/me": { "": "Me", user: "AuthUser" },
  "POST /v1/auth/logout": { "": "Ok" },
  "GET /v1/tenancy/mine": { "": "Page", "items[]": "Membership", "items[].tenant": "Tenant" },
  "GET /v1/features": { "": "TenantFeatures", "features[]": "FeatureState" },
  // The storefront theme inside tokens is web-only; BrandTokens.fromJson reads what the app uses.
  "GET /v1/branding": { "": "Branding", tokens: "map" },
  "GET /v1/invoices/summary": {
    "": "DashboardSummary",
    month: "PeriodTotals",
    prevMonth: "PeriodTotals",
    "recent[]": "InvoiceSummary",
  },
  "POST /v1/notify/push-tokens": { "": "Ok" },
  "DELETE /v1/notify/push-tokens": { "": "Ok" },
  // Counter billing
  "GET /v1/catalog/variants/search": { "": "Page", ...VARIANT("items[]") },
  "GET /v1/catalog/variants/lookup": VARIANT(""),
  "GET /v1/counter/resolve": { "": "CounterResolve", ...VARIANT("variant"), ...WEIGH_TICKET("weighTicket") },
  // categories: the web's category chips; the phone searches only.
  "GET /v1/invoices/items": { "": "Page", "items[]": "BillingItem", facets: "map", categories: "ignore" },
  "GET /v1/invoices/customers": { "": "Page", "items[]": "Customer", facets: "map" },
  "POST /v1/invoices/customers": { "": "Customer" },
  // The price fallback for shops without catalogue.variants (product detail quick edit).
  "PATCH /v1/invoices/items/{id}": { "": "BillingItem" },
  "POST /v1/invoices": INVOICE,
  "GET /v1/invoices/{id}": INVOICE,
  "POST /v1/invoices/{id}/issue": INVOICE,
  "POST /v1/invoices/{id}/payments": INVOICE,
  "POST /v1/invoices/{id}/cancel": INVOICE,
  "POST /v1/invoices/{id}/share": { "": "ShareLink" },
  "GET /v1/invoices/till/current": { "": "TillCurrent", ...tillSession("session") },
  "POST /v1/invoices/till/open": tillSession(""),
  "POST /v1/invoices/till/{id}/cash": tillSession(""),
  "GET /v1/invoices/till/{id}/x": tillReport,
  "POST /v1/invoices/till/{id}/close": tillReport,
  // Products & stock
  "GET /v1/catalog/categories": { "": "Page", "items[]": "Category", "items[].seo": "map" },
  "GET /v1/catalog/products": { "": "Page", "items[]": "ProductRow", "items[].stock": "StockBadge", facets: "map" },
  "GET /v1/catalog/products/{id}": PRODUCT,
  "POST /v1/catalog/products": PRODUCT,
  "PATCH /v1/catalog/products/{id}": PRODUCT,
  "PATCH /v1/catalog/variants/{id}": { "": "ProductVariant", optionValues: "map" },
  "GET /v1/inventory/stock": { "": "StockPage", "items[]": "StockItem", facets: "map" },
  "GET /v1/inventory/stock/{id}": { "": "StockItem" },
  "PATCH /v1/inventory/stock/{id}": { "": "StockItem" },
  "POST /v1/inventory/stock/{id}/adjust": { "": "StockItem" },
  "GET /v1/inventory/stock/{id}/movements": { "": "Page", "items[]": "StockMovement" },
  "GET /v1/inventory/locations": { "": "Page", "items[]": "StockLocation" },
  "GET /v1/inventory/summary": { "": "StockSummary", "lowItems[]": "StockItem" },
  // Orders
  "GET /v1/orders": { "": "OrderPage", "items[]": "OrderRow", counts: "map", facets: "map" },
  "GET /v1/orders/summary": { "": "OrderSummary", pending: "map" },
  "GET /v1/orders/{id}": ORDER,
  "POST /v1/orders/{id}/status": ORDER,
  "POST /v1/orders/{id}/fulfillment": ORDER,
  "POST /v1/orders/{id}/payments": ORDER,
  "POST /v1/orders/{id}/notes": ORDER,
  "POST /v1/orders/{id}/invoice": ORDER,
  // Customers and the credit book
  "GET /v1/invoices": { "": "Page", "items[]": "InvoiceSummary", facets: "map" },
  "GET /v1/invoices/customers/{id}": { "": "Customer" },
  "PATCH /v1/invoices/customers/{id}": { "": "Customer" },
  "GET /v1/invoices/credit-book": {
    "": "CreditBookPage",
    "items[]": "CreditBookRow",
    "items[].customer": "Customer",
    totals: "CreditBookTotals",
    facets: "map",
  },
  "GET /v1/invoices/customers/{id}/ledger": { "": "Ledger", customer: "Customer", "entries[]": "LedgerEntry" },
  "POST /v1/invoices/customers/{id}/receipts": { "": "ReceiptResult", receipt: "CustomerReceipt", "allocations[]": "ReceiptAllocation" },
  "POST /v1/invoices/customers/{id}/statement/share": { "": "ShareLink" },
  "POST /v1/invoices/customers/{id}/remind": { "": "RemindResult" },
  // Expenses
  "GET /v1/expenses": { "": "ExpensePage", "items[]": "Expense", totals: "ExpenseTotals", facets: "map" },
  "POST /v1/expenses": { "": "Expense" },
  "PATCH /v1/expenses/{id}": { "": "Expense" },
  "DELETE /v1/expenses/{id}": { "": "Expense" },
  "GET /v1/expenses/summary": {
    "": "ExpenseSummary",
    "byCategory[]": "ExpenseCategoryTotal",
    "byMonth[]": "ExpenseMonthTotal",
  },
  "GET /v1/expenses/categories": { "": "Page", "items[]": "ExpenseCategory" },
  "POST /v1/expenses/categories": { "": "ExpenseCategory" },
  "PATCH /v1/expenses/categories/{id}": { "": "ExpenseCategory" },
  "DELETE /v1/expenses/categories/{id}": { "": "Ok" },
  // POS terminals (docs/pos-terminals.md)
  "GET /v1/pos/terminals": { "": "PosTerminalList", ...TERMINAL("items[]") },
  "POST /v1/pos/terminals/{id}/pairing-code": { "": "PosPairing" },
  "POST /v1/pos/pair": { "": "PosPairResult", ...TERMINAL("terminal"), shop: "PosShop" },
  "GET /v1/pos/device": { "": "PosDeviceInfo", ...TERMINAL("terminal"), shop: "PosShop" },
  "POST /v1/pos/device/unpair": { "": "Ok" },
  "POST /v1/pos/session": { "": "PosPinSession" },
  "POST /v1/pos/session/lock": { "": "Ok" },
  "GET /v1/pos/staff": { "": "PosList", "items[]": "PosStaffEntry" },
  "GET /v1/pos/catalog": { "": "PosCatalogPage", "items[]": "PosItem", "items[].stock": "PosItemStock" },
  "GET /v1/pos/catalog/categories": { "": "PosList", "items[]": "PosCategory" },
  "POST /v1/pos/weigh-tickets": WEIGH_TICKET(""),
  "GET /v1/pos/weigh-tickets": { "": "WeighTicketPage", ...WEIGH_TICKET("items[]") },
  "GET /v1/pos/weigh-tickets/by-code/{id}": WEIGH_TICKET(""),
  "POST /v1/pos/weigh-tickets/{id}/use": WEIGH_TICKET(""),
  "POST /v1/pos/weigh-tickets/{id}/cancel": WEIGH_TICKET(""),
};

if (!existsSync(docPath)) {
  console.error(`check-api-models: ${docPath} not found. Run: pnpm --filter @rbms/api openapi -- --typed openapi.typed.json`);
  process.exit(1);
}
const doc = JSON.parse(readFileSync(docPath, "utf8"));
const apiSrc = readFileSync(apiDart, "utf8");
const modelsSrc = readdirSync(srcDir)
  .filter((f) => f.endsWith(".dart"))
  .map((f) => readFileSync(resolve(srcDir, f), "utf8"))
  .join("\n");

// ---- operations srikit_api calls
const used = new Set();
// Dart interpolations in paths (`/invoices/${_seg(id)}/issue`) become the document's `{id}`.
const norm = (path) => path.replace(/\$\{[^}]*\}|\$\w+/g, "{id}");
for (const m of apiSrc.matchAll(/client\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) used.add(`${m[1].toUpperCase()} /v1${norm(m[2])}`);
for (const m of apiSrc.matchAll(/_(?:ok|written)\(\s*'([A-Z]+)',\s*'([^']+)'/g)) used.add(`${m[1]} /v1${norm(m[2])}`);
// Raw requests (e.g. GET /pos/catalog with If-None-Match): client.request('GET', '/path', ...).
for (const m of apiSrc.matchAll(/client\.request\(\s*'([A-Z]+)',\s*'([^']+)'/g)) used.add(`${m[1]} /v1${norm(m[2])}`);

// ---- json keys each Dart class reads
const classKeys = {};
for (const m of modelsSrc.matchAll(/^class (\w+)[^{]*\{([\s\S]*?)^\}/gm)) {
  classKeys[m[1]] = new Set([...m[2].matchAll(/\w+\[\s*'([A-Za-z0-9_]+)'\s*\]/g)].map((k) => k[1]));
}

// ---- documented response properties, by level
const deref = (s) => {
  let out = s;
  while (out?.$ref) out = out.$ref.split("/").slice(1).reduce((o, k) => o?.[k], doc);
  return out;
};
function* levels(schema, level = "") {
  const s = deref(schema);
  if (!s || typeof s !== "object") return;
  for (const alt of [...(s.anyOf ?? []), ...(s.oneOf ?? []), ...(s.allOf ?? [])]) yield* levels(alt, level);
  if (s.items) yield* levels(s.items, `${level}[]`);
  if (s.additionalProperties && typeof s.additionalProperties === "object") yield* levels(s.additionalProperties, `${level ? `${level}.` : ""}*`);
  for (const [name, prop] of Object.entries(s.properties ?? {})) {
    yield { level, name, required: (s.required ?? []).includes(name) };
    yield* levels(prop, level ? `${level}.${name}` : name);
  }
}
const parentLevel = (l) => (l.endsWith("[]") ? l.slice(0, -2) : l.includes(".") ? l.slice(0, l.lastIndexOf(".")) : "");
/** Nearest mapped level at or above `level` ("items[].tenant" → "items[].tenant", "items[]", "items", ""). */
const modelFor = (map, level) => {
  for (let l = level; ; l = parentLevel(l)) {
    if (l in map) return [l, map[l]];
    if (l === "") return [null, null];
  }
};

const typed = new Map();
for (const [path, ops] of Object.entries(doc.paths ?? {})) {
  // Path parameters by any name ({itemId}) match the client's normalised {id}.
  for (const [method, op] of Object.entries(ops)) typed.set(`${method.toUpperCase()} ${path.replace(/\{[^}]+\}/g, "{id}")}`, op);
}

const problems = [];
const notes = [];
let checked = 0;
for (const id of [...used].sort()) {
  const op = typed.get(id);
  if (!op) {
    notes.push(`${id}: not in the typed document yet (model not checked)`);
    continue;
  }
  const map = MODELS[id];
  if (!map) {
    problems.push(`${id}: typed in the document but has no entry in MODELS (scripts/mobile/check-api-models.mjs)`);
    continue;
  }
  const ok = Object.entries(op.responses ?? {}).find(([code]) => /^2\d\d$/.test(code));
  const schema = ok?.[1]?.content?.["application/json"]?.schema;
  if (!schema) {
    notes.push(`${id}: no JSON success response documented`);
    continue;
  }
  const seen = {};
  for (const { level, name, required } of levels(schema)) {
    const [mappedLevel, cls] = modelFor(map, level);
    if (!cls) continue;
    // Inside an opaque map / an ignored property: nothing to check.
    if (cls === "map" || cls === "ignore") continue;
    // A property marked "ignore" isn't required at its parent either.
    if (map[level ? `${level}.${name}` : name] === "ignore") continue;
    const keys = classKeys[cls];
    if (!keys) {
      problems.push(`${id}: Dart class ${cls} not found in models.dart`);
      continue;
    }
    // Map-valued levels ("apps.*") are read with .map(), not by key, so their own property names aren't required.
    if (level.endsWith("*") && mappedLevel !== level) continue;
    checked++;
    (seen[cls] ??= new Set()).add(name);
    if (!keys.has(name)) problems.push(`${id}: ${cls} does not read "${level ? `${level}.` : ""}${name}"${required ? " (required)" : ""}`);
  }
  for (const [cls, names] of Object.entries(seen)) {
    const levelsOfCls = Object.entries(map).filter(([, c]) => c === cls).length;
    if (!classKeys[cls]) continue;
    if (levelsOfCls !== 1) continue;
    const extra = [...classKeys[cls]].filter((k) => !names.has(k));
    if (extra.length) notes.push(`${id}: ${cls} also reads ${extra.join(", ")} (not in the document)`);
  }
}
for (const id of typed.keys()) if (!used.has(id)) notes.push(`${id}: typed, not used by srikit_api`);

for (const n of notes) console.log(`note: ${n}`);
if (problems.length) {
  for (const p of problems) console.error(`MISSING: ${p}`);
  console.error(`check-api-models: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`check-api-models: ok (${used.size} operations used, ${checked} documented properties checked)`);
