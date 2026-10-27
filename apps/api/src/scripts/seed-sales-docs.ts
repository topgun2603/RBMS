/**
 * Demo proforma invoices, sale orders and delivery challans (docs/sales-documents.md), made through the running API as the
 * platform owner (no SQL):
 *
 *   pnpm --filter @srirealtime/api exec tsx src/scripts/seed-sales-docs.ts
 *
 * Needs the dev API on :4000 with the dev OTP (123456) for OWNER_EMAIL. Nothing is sent to customers (links are only
 * shared). Idempotent: a step whose demo customer already has that kind of document is skipped. Shops: kumar (general
 * stores, wholesale), techzone (electronics) and thaiyal (tailoring).
 */
import { todayIST } from "@srirealtime/gst";

const API = process.env.API_URL ?? "http://127.0.0.1:4000";
const OWNER_EMAIL = process.env.OWNER_EMAIL ?? "gowtham_kumar@srirealtime.com";
const OTP = process.env.OTP ?? "123456";

let token = "";
async function call<T = any>(method: string, path: string, body?: unknown, tenant?: string, anonymous = false): Promise<T> {
  const res = await fetch(`${API}/v1${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token && !anonymous ? { authorization: `Bearer ${token}` } : {}),
      ...(tenant ? { "x-tenant": tenant } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} (${tenant ?? "-"}) -> ${res.status} ${text.slice(0, 400)}`);
  return json as T;
}

const today = todayIST(new Date());
const daysAgo = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
const daysAhead = (n: number) => daysAgo(-n);

interface Item {
  id: string;
  name: string;
  rate: number;
  gstRate: number;
  unit: string;
  hsn: string | null;
}

async function item(shop: string, fragment: string): Promise<Item | null> {
  const r = await call<{ items: Item[] }>("GET", `/invoices/items?q=${encodeURIComponent(fragment.split(/[–,(]/)[0]!.trim())}&limit=100`, undefined, shop);
  return r.items.find((i) => i.name.toLowerCase().includes(fragment.toLowerCase())) ?? r.items[0] ?? null;
}

const line = (it: Item, qty: number) => ({
  description: it.name,
  itemId: it.id,
  qty,
  unit: it.unit,
  rate: it.rate,
  gstRate: it.gstRate,
  ...(it.hsn ? { hsn: it.hsn } : {}),
});

async function customer(shop: string, c: { name: string; phone: string; address?: string; stateCode?: string }) {
  const found = await call<{ items: { id: string; name: string }[] }>("GET", `/invoices/customers?q=${encodeURIComponent(c.name)}&limit=5`, undefined, shop);
  const hit = found.items.find((x) => x.name === c.name);
  if (hit) return hit.id;
  return (await call<{ id: string }>("POST", "/invoices/customers", c, shop)).id;
}

/** Runs `fn` unless `kind` already has a document for `name` in this shop. */
async function step(shop: string, kind: "proformas" | "sale-orders" | "challans", name: string, fn: () => Promise<void>) {
  const existing = await call<{ total: number }>("GET", `/sales-docs/${kind}?q=${encodeURIComponent(name)}&limit=1`, undefined, shop);
  if (existing.total > 0) {
    console.log(`${shop}: ${kind} for ${name} already there, skipped`);
    return;
  }
  try {
    await fn();
  } catch (err) {
    console.error(`${shop}: ${kind} for ${name} failed:`, (err as Error).message);
  }
}

async function kumar() {
  const shop = "kumar";
  const rice = await item(shop, "Rice (Ponni) 25 kg");
  const toor = await item(shop, "Toor dal (loose)");
  const oil = await item(shop, "Groundnut oil 1 L");
  const sugar = await item(shop, "Sugar 1 kg");
  if (!rice || !toor || !oil || !sugar) return console.log(`${shop}: demo items missing, skipped`);
  const caterer = await customer(shop, { name: "Murugan Catering Services", phone: "9894033344", address: "5, Sellur Main Road, Madurai", stateCode: "33" });
  const temple = await customer(shop, { name: "Arulmigu Meenakshi Amman Temple Annadhanam Trust", phone: "9443011122", address: "Temple Car Street, Madurai", stateCode: "33" });

  // A sale order for a wedding: half delivered on a challan (billed), the rest still to go, advance taken.
  await step(shop, "sale-orders", "Murugan Catering", async () => {
    const so = await call<{ id: string; number: string; lines: { key: string }[] }>(
      "POST",
      "/sales-docs/sale-orders",
      {
        customerId: caterer,
        date: daysAgo(6),
        promisedDate: daysAhead(4),
        customerRef: "MCS/WED/112",
        lines: [line(rice, 10), line(toor, 50), line(oil, 30)],
        advancePercent: 30,
        notes: "Wedding at Sellur on the promised date; deliver to the hall kitchen",
      },
      shop,
    );
    await call("POST", `/sales-docs/sale-orders/${so.id}/advance`, { amount: 500_000, method: "upi", reference: "UPI 412233" }, shop);
    const d = await call<{ challan: { id: string; number: string } }>(
      "POST",
      `/sales-docs/sale-orders/${so.id}/deliver`,
      { lines: [{ key: so.lines[0]!.key, qty: 5 }, { key: so.lines[1]!.key, qty: 25 }], transport: { mode: "road", vehicleNo: "TN59AB4321" } },
      shop,
    );
    const b = await call<{ invoice: { number: string | null } }>("POST", `/sales-docs/sale-orders/${so.id}/invoice-challans`, { issue: true }, shop);
    console.log(`${shop}: ${so.number} partly delivered (${d.challan.number}), billed ${b.invoice.number}`);
  });

  // A proforma for the temple trust to get its committee's approval, with an advance paid.
  await step(shop, "proformas", "Meenakshi Amman Temple", async () => {
    const p = await call<{ id: string; number: string }>(
      "POST",
      "/sales-docs/proformas",
      { customerId: temple, date: daysAgo(2), lines: [line(rice, 6), line(sugar, 40)], advancePercent: 25, deliveryText: "Before the festival", issue: true },
      shop,
    );
    await call("POST", `/sales-docs/proformas/${p.id}/advance`, { amount: 300_000, method: "bank", reference: "NEFT 77881" }, shop);
    await call("POST", `/sales-docs/proformas/${p.id}/share`, {}, shop);
    console.log(`${shop}: ${p.number} issued with an advance`);
  });
}

async function techzone() {
  const shop = "techzone";
  const phone = await item(shop, "phone");
  if (!phone) return console.log(`${shop}: demo items missing, skipped`);
  const corp = await customer(shop, { name: "Vaigai Software Park", phone: "9443077788", address: "Mattuthavani, Madurai", stateCode: "33" });
  // Phones on approval for the client's staff: two came back, the rest billed.
  await step(shop, "challans", "Vaigai Software Park", async () => {
    const c = await call<{ id: string; number: string; lines: { key: string }[] }>(
      "POST",
      "/sales-docs/challans",
      { customerId: corp, date: daysAgo(5), reason: "approval", returnBy: daysAhead(2), lines: [line(phone, 6)], transport: { mode: "hand" } },
      shop,
    );
    await call("POST", `/sales-docs/challans/${c.id}/return`, { lines: [{ key: c.lines[0]!.key, qty: 2 }], note: "Two staff chose another model" }, shop);
    const b = await call<{ invoice: { number: string | null } }>("POST", "/sales-docs/challans/invoice", { challanIds: [c.id], issue: true }, shop);
    console.log(`${shop}: ${c.number} on approval, 2 back, rest billed ${b.invoice.number}`);
  });
}

async function thaiyal() {
  const shop = "thaiyal";
  const fabric = await item(shop, "silk");
  if (!fabric) return console.log(`${shop}: demo items missing, skipped`);
  // Fabric sent out for embroidery (job work): due back in a week.
  await step(shop, "challans", "Sri Ganesh Embroidery", async () => {
    const c = await call<{ number: string }>(
      "POST",
      "/sales-docs/challans",
      {
        customer: { name: "Sri Ganesh Embroidery Works", phone: "9600011223", address: "Kamarajar Salai, Madurai", stateCode: "33" },
        date: daysAgo(1),
        reason: "job_work",
        returnBy: daysAhead(6),
        lines: [line(fabric, 3)],
        notes: "Zardosi work on blouse pieces; return with the finished pieces",
      },
      shop,
    );
    console.log(`${shop}: ${c.number} out for job work`);
  });
}

async function main() {
  await call("POST", "/auth/otp/request", { target: OWNER_EMAIL }, undefined, true);
  token = (await call<{ token: string }>("POST", "/auth/otp/verify", { target: OWNER_EMAIL, code: OTP }, undefined, true)).token;
  await kumar();
  await techzone();
  await thaiyal();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
