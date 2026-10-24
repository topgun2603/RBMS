/**
 * Demo quotations for three demo shops, made through the running API as the platform owner (no SQL):
 *
 *   pnpm --filter @srirealtime/api exec tsx src/scripts/seed-quotations.ts
 *
 * Needs the dev API on :4000 with the dev OTP (123456) for OWNER_EMAIL. Idempotent: a shop that already has a quotation
 * for one of the demo customers is skipped. Shops: techzone (electronics, orders), kumar (general stores, wholesale) and
 * thaiyal (tailoring). Mixed statuses: sent, accepted, converted (order, issued bill with advance, draft bill), expired,
 * declined, revised and draft. Customers answer through the public link, like in real life.
 */
import { gstinCheckChar, todayIST } from "@srirealtime/gst";

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

async function item(shop: string, fragment: string): Promise<Item> {
  const r = await call<{ items: Item[] }>("GET", `/invoices/items?q=${encodeURIComponent(fragment.split(/[–,]/)[0]!.trim())}&limit=100`, undefined, shop);
  const hit = r.items.find((i) => i.name.toLowerCase().includes(fragment.toLowerCase()));
  if (!hit) throw new Error(`${shop}: no item matching "${fragment}"`);
  return hit;
}

const line = (it: Item, qty: number, o: { discountPct?: number; rate?: number } = {}) => {
  const rate = o.rate ?? it.rate;
  return {
    description: it.name,
    itemId: it.id,
    qty,
    unit: it.unit,
    rate,
    gstRate: it.gstRate,
    ...(it.hsn ? { hsn: it.hsn } : {}),
    ...(o.discountPct ? { discount: Math.round((qty * rate * o.discountPct) / 100) } : {}),
  };
};

async function customer(shop: string, c: { name: string; phone: string; email?: string; gstin?: string; address?: string; stateCode?: string }) {
  const found = await call<{ items: { id: string; name: string }[] }>("GET", `/invoices/customers?q=${encodeURIComponent(c.name)}&limit=5`, undefined, shop);
  const hit = found.items.find((x) => x.name === c.name);
  if (hit) return hit.id;
  return (await call<{ id: string }>("POST", "/invoices/customers", c, shop)).id;
}


async function make(shop: string, input: Record<string, unknown>, how: "draft" | "sent") {
  const q = await call<{ id: string; number: string }>("POST", "/quotations", input, shop);
  if (how === "sent") {
    const shared = await call<{ token: string }>("POST", `/quotations/${q.id}/share`, {}, shop);
    return { ...q, token: shared.token };
  }
  return { ...q, token: "" };
}

const respond = (token: string, decision: "accept" | "decline", name: string, note?: string) =>
  call("POST", `/quotations/public/${token}/respond`, { decision, name, ...(note ? { note } : {}) }, undefined, true);

/** Runs one demo quotation unless the shop already has one for that customer (so the script can be re-run). */
async function step(shop: string, customerName: string, run: () => Promise<void>) {
  const r = await call<{ total: number }>("GET", `/quotations?q=${encodeURIComponent(customerName)}&limit=1`, undefined, shop);
  if (r.total > 0) return console.log(`${shop}: ${customerName} already has a quotation`);
  await run();
}

async function techzone() {
  const shop = "techzone";
  const laptop = await item(shop, "Education laptop, 11.6-inch, 4 GB / 64 GB – Grey");
  const charger = await item(shop, "20W USB-C charger");
  const everydayLaptop = await item(shop, "Everyday laptop, 15.6-inch FHD, 16 GB RAM – 16 GB + 512 GB SSD");
  const tv55 = await item(shop, "4K smart TV, Android-style OS – 55-inch");
  const tv43 = await item(shop, "4K smart TV, Android-style OS – 43-inch");
  const ac = await item(shop, "3-star inverter split air conditioner – 1.5 ton");
  const phone = await item(shop, "Camera 5G smartphone, 108 MP with OIS – 8 GB + 256 GB / Black");
  const buds = await item(shop, "boAt Airdopes 141");

  const school = await customer(shop, { name: "Annai Matriculation School", phone: "9843012345", email: "office@annaischool.example", address: "12, Gandhi Nagar, Madurai", stateCode: "33" });
  const infotech = await customer(shop, { name: "Bengaluru Infotech Pvt Ltd", phone: "9886012345", gstin: `29AABCB1234F1Z${gstinCheckChar("29AABCB1234F1Z")}`, address: "88, Brigade Road, Bengaluru", stateCode: "29" });
  const hospital = await customer(shop, { name: "Sri Lakshmi Hospital", phone: "9865098765", address: "4, Race Course Road, Coimbatore", stateCode: "33" });
  const karthik = await customer(shop, { name: "R. Karthik", phone: "9790012345" });
  const hotel = await customer(shop, { name: "Hotel Vaigai Residency", phone: "9944012345", email: "gm@vaigairesidency.example", address: "Alagar Koil Road, Madurai", stateCode: "33" });

  // 1. Accepted by the school, then turned into an order with the 30% advance recorded.
  await step(shop, "Annai Matriculation School", async () => {
    const q1 = await make(shop, {
      customerId: school,
      date: daysAgo(6),
      validUntil: daysAhead(9),
      lines: [line(laptop, 4, { discountPct: 4 }), line(charger, 4)],
      deliveryText: "Within 7 days of the advance",
      advancePercent: 30,
      notes: "For the computer lab, Class 8 to 10",
    }, "sent");
    await respond(q1.token, "accept", "K. Lakshmanan (Correspondent)", "Please deliver before the lab inspection");
    const conv1 = await call<{ order?: { number: string } }>("POST", `/quotations/${q1.id}/convert`, { to: "order", recordAdvance: true, advanceMethod: "upi", advanceReference: "UPI-ANNAI-3021" }, shop);
    console.log(`${shop}: ${q1.number} -> order ${conv1.order?.number}`);
  });

  // 2. Inter-state quote to a Bengaluru company (IGST), waiting for an answer.
  await step(shop, "Bengaluru Infotech", async () => {
    const q2 = await make(shop, {
      customerId: infotech,
      date: daysAgo(2),
      validUntil: daysAhead(13),
      lines: [line(everydayLaptop, 5, { discountPct: 3 }), line(tv55, 2)],
      deliveryText: "Ex-stock Coimbatore, 5 working days by road",
      advancePercent: 50,
      terms: "50% advance with the purchase order. Balance before dispatch. Freight at actuals. Warranty as per manufacturer.",
    }, "sent");
    console.log(`${shop}: ${q2.number} sent (IGST)`);
  });

  // 3. Expired: sent three weeks ago, never answered.
  await step(shop, "Sri Lakshmi Hospital", async () => {
    const q3 = await make(shop, {
      customerId: hospital,
      date: daysAgo(24),
      validUntil: daysAgo(9),
      lines: [line(ac, 4, { discountPct: 5 })],
      deliveryText: "Installation included, 3 days",
      advancePercent: 25,
    }, "sent");
    console.log(`${shop}: ${q3.number} expired`);
  });

  // 4. Declined by the customer.
  await step(shop, "R. Karthik", async () => {
    const q4 = await make(shop, { customerId: karthik, date: daysAgo(4), validUntil: daysAhead(11), lines: [line(phone, 1), line(buds, 1), line(charger, 1)] }, "sent");
    await respond(q4.token, "decline", "R. Karthik", "Found it cheaper at another shop");
    console.log(`${shop}: ${q4.number} declined`);
  });

  // 5. Revised: the hotel asked for more TVs, so revision 2 replaced the first.
  await step(shop, "Hotel Vaigai", async () => {
    const q5 = await make(shop, { customerId: hotel, date: daysAgo(5), validUntil: daysAhead(10), lines: [line(tv43, 12)], deliveryText: "10 days", advancePercent: 40 }, "sent");
    const rev = await call<{ id: string; number: string; rev: number }>("POST", `/quotations/${q5.id}/revise`, { lines: [line(tv43, 20, { discountPct: 6 })], notes: "Revised for 20 rooms: bulk price" }, shop);
    await call("POST", `/quotations/${rev.id}/share`, {}, shop);
    console.log(`${shop}: ${rev.number} revision ${rev.rev} sent`);
  });
}

async function kumar() {
  const shop = "kumar";
  const rice = await item(shop, "Rice (Ponni) 25 kg");
  const toor = await item(shop, "Toor dal (loose)");
  const oil = await item(shop, "Groundnut oil 1 L");
  const sugar = await item(shop, "Sugar 1 kg");
  const salt = await item(shop, "Iodised salt 1 kg");
  const tea = await item(shop, "Tea powder 250 g");
  const sambar = await item(shop, "Sambar powder 200 g");
  const onion = await item(shop, "Onion");

  const temple = await customer(shop, { name: "Arulmigu Meenakshi Amman Temple Annadhanam Trust", phone: "9443011122", address: "Temple Car Street, Madurai", stateCode: "33" });
  const caterer = await customer(shop, { name: "Murugan Catering Services", phone: "9894033344", address: "5, Sellur Main Road, Madurai", stateCode: "33" });
  const mess = await customer(shop, { name: "Vasantha Mess", phone: "9488055566" });

  // 6. Accepted, waiting to be billed.
  await step(shop, "Meenakshi Amman Temple", async () => {
    const q6 = await make(shop, {
      customerId: temple,
      date: daysAgo(3),
      validUntil: daysAhead(12),
      lines: [line(rice, 8, { discountPct: 2 }), line(toor, 100), line(oil, 40), line(sugar, 60), line(salt, 30)],
      deliveryText: "Delivered the day before the festival",
      advancePercent: 25,
    }, "sent");
    await respond(q6.token, "accept", "S. Rajendran (Trustee)", "Deliver to the temple godown");
    console.log(`${shop}: ${q6.number} accepted`);
  });

  // 7. Converted: a bill was issued and the 40% advance recorded on it.
  await step(shop, "Murugan Catering", async () => {
    const q7 = await make(shop, {
      customerId: caterer,
      date: daysAgo(8),
      validUntil: daysAhead(7),
      lines: [line(rice, 6), line(toor, 60), line(oil, 25, { discountPct: 3 }), line(onion, 150), line(tea, 20), line(sambar, 30)],
      advancePercent: 40,
      notes: "Wedding reception, 600 guests",
    }, "sent");
    await respond(q7.token, "accept", "Murugan", "Go ahead");
    const conv7 = await call<{ invoice?: { number: string; paid: number } }>("POST", `/quotations/${q7.id}/convert`, { to: "invoice", issue: true, recordAdvance: true, advanceMethod: "cash" }, shop);
    console.log(`${shop}: ${q7.number} -> bill ${conv7.invoice?.number} (advance ${conv7.invoice?.paid})`);
  });

  // 8. A draft, not sent yet.
  await step(shop, "Vasantha Mess", async () => {
    const q8 = await make(shop, { customerId: mess, date: today, lines: [line(rice, 2), line(toor, 25), line(oil, 10)], deliveryText: "Weekly delivery" }, "draft");
    console.log(`${shop}: ${q8.number} draft`);
  });
}

async function thaiyal() {
  const shop = "thaiyal";
  const shirtShorts = await item(shop, "Boys shirt and shorts set – 6 to 9 years");
  const bridal = await item(shop, "Bridal blouse with aari work – Heavy aari, front and back");
  const silkBlouse = await item(shop, "Blouse for a silk saree, with fall and pico – Light border");
  const alteration = await item(shop, "Blouse alteration – Take in or let out, up to 1.5 inches");

  const school = await customer(shop, { name: "St. Joseph's Higher Secondary School", phone: "9486077788", address: "Trichy Road, Dindigul", stateCode: "33" });
  const priya = await customer(shop, { name: "Priya Ramesh", phone: "9600099900", email: "priya.ramesh@example.com" });

  // 9. Uniforms for a school: sent, waiting for the management's answer.
  await step(shop, "St. Joseph", async () => {
    const q9 = await make(shop, {
      customerId: school,
      date: daysAgo(1),
      validUntil: daysAhead(14),
      lines: [line(shirtShorts, 40, { discountPct: 8 })],
      deliveryText: "3 weeks from the advance; measurements taken on 2 days at the school",
      advancePercent: 50,
      notes: "Bulk rate for 40 uniforms. Cloth by the school.",
    }, "sent");
    console.log(`${shop}: ${q9.number} sent`);
  });

  // 10. A bride's order: accepted, then a draft bill was made to adjust before issuing.
  await step(shop, "Priya Ramesh", async () => {
    const q10 = await make(shop, {
      customerId: priya,
      date: daysAgo(5),
      validUntil: daysAhead(10),
      lines: [line(bridal, 1), line(silkBlouse, 3), line(alteration, 2)],
      deliveryText: "Ready in 12 days; first trial on day 6",
      advancePercent: 50,
    }, "sent");
    await respond(q10.token, "accept", "Priya Ramesh", "Please keep the neckline deep");
    const conv10 = await call<{ invoice?: { id: string; status: string } }>("POST", `/quotations/${q10.id}/convert`, { to: "invoice" }, shop);
    console.log(`${shop}: ${q10.number} -> ${conv10.invoice?.status} bill`);
  });
}

async function main() {
  await call("POST", "/auth/otp/request", { target: OWNER_EMAIL }, undefined, true);
  token = (await call<{ token: string }>("POST", "/auth/otp/verify", { target: OWNER_EMAIL, code: OTP }, undefined, true)).token;
  await techzone();
  await kumar();
  await thaiyal();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
