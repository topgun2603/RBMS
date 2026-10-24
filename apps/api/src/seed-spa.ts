import { gstinCheckChar } from "@srirealtime/gst";
import { pino } from "pino";
import { env } from "./env";
import { createKit } from "./kit";
import { SimClock } from "./demo-history/context";
import { addDays, istToday } from "./demo-history/calendar";
import { testPhone } from "./demo-history/names";

/**
 * `pnpm exec tsx --env-file-if-exists=.env src/seed-spa.ts`: the corporate wellness tie-ups of Sukham Ayur Spa (store
 * #21), run after `seed:stores sukham` and `seed:history sukham --profile spa`. A 90-day trading window cannot make
 * dues older than 90 days, so this adds dated corporate bills (on-site chair-massage days and employee wellness
 * packages) on credit through the invoices service, some part-paid, so the credit book's ageing has every bucket: not
 * yet due, 1-30, 31-60, 61-90 and over 90 days. Companies are fictional; phones are in the test block. Idempotent: a
 * company that exists is skipped. Nothing is sent to anyone.
 */
const SLUG = "sukham";
const CHAIR = "Corporate chair massage (on-site, 20 min per person)";
const DAY = "Corporate wellness day package (per person)";

interface Bill {
  /** Days ago the bill was made. */
  ago: number;
  item: string;
  qty: number;
  /** Share of the bill paid so far (0 = nothing). */
  paid: number;
  /** Days after the bill that the part payment came. */
  paidAfter?: number;
  termDays: number;
  note: string;
}
interface Company {
  name: string;
  area: string;
  address: string;
  gstin14: string;
  limit: number;
  bills: Bill[];
}

const COMPANIES: Company[] = [
  {
    name: "Kovai Infotech Private Limited",
    area: "Saravanampatti",
    address: "4th Floor, Tech Park Road, Saravanampatti, Coimbatore 641035",
    gstin14: "33AAKCK5120B1Z",
    limit: 40_000_000,
    bills: [
      { ago: 118, item: CHAIR, qty: 60, paid: 1, paidAfter: 40, termDays: 30, note: "Wellness day, July" },
      { ago: 84, item: CHAIR, qty: 72, paid: 1, paidAfter: 33, termDays: 30, note: "Wellness day, August" },
      { ago: 49, item: CHAIR, qty: 66, paid: 0.5, paidAfter: 38, termDays: 30, note: "Wellness day, September" },
      { ago: 12, item: CHAIR, qty: 70, paid: 0, termDays: 30, note: "Wellness day, October" },
    ],
  },
  {
    name: "Peelamedu Precision Components",
    area: "Peelamedu",
    address: "22, Hope College Road, Peelamedu, Coimbatore 641004",
    gstin14: "33AAPCP7731F1Z",
    limit: 25_000_000,
    bills: [
      { ago: 104, item: DAY, qty: 28, paid: 0.3, paidAfter: 55, termDays: 30, note: "Supervisors' wellness day" },
      { ago: 71, item: CHAIR, qty: 90, paid: 0.4, paidAfter: 45, termDays: 30, note: "Shop-floor chair massage fortnight" },
    ],
  },
  {
    name: "Ganapathy Textile Mills Limited",
    area: "Avinashi Road",
    address: "310, Avinashi Road, Coimbatore 641018",
    gstin14: "33AAGCG2204K1Z",
    limit: 30_000_000,
    bills: [
      { ago: 132, item: DAY, qty: 40, paid: 0.25, paidAfter: 60, termDays: 45, note: "Management retreat" },
      { ago: 62, item: CHAIR, qty: 54, paid: 0, termDays: 45, note: "Annual day chair massage" },
    ],
  },
  {
    name: "RS Puram Chartered Accountants LLP",
    area: "R.S. Puram",
    address: "12, Cross Cut Road, R.S. Puram, Coimbatore 641002",
    gstin14: "33AAURR8864M1Z",
    limit: 8_000_000,
    bills: [
      { ago: 96, item: DAY, qty: 12, paid: 1, paidAfter: 22, termDays: 15, note: "Tax-season recovery day" },
      { ago: 38, item: DAY, qty: 14, paid: 0, termDays: 15, note: "Audit-season recovery day" },
    ],
  },
  {
    name: "Avinashi Road Realty Group",
    area: "Avinashi Road",
    address: "88, Lakshmi Mills Junction, Avinashi Road, Coimbatore 641037",
    gstin14: "33AAFRA3396P1Z",
    limit: 15_000_000,
    bills: [
      { ago: 27, item: CHAIR, qty: 44, paid: 0.6, paidAfter: 12, termDays: 30, note: "Sales team day" },
      { ago: 5, item: DAY, qty: 18, paid: 0, termDays: 30, note: "Launch-week wellness day" },
    ],
  },
  {
    name: "Coimbatore Hospitality Group",
    area: "Race Course",
    address: "6, Racecourse Road, Coimbatore 641018",
    gstin14: "33AAHCC4418D1Z",
    limit: 20_000_000,
    bills: [{ ago: 150, item: DAY, qty: 20, paid: 0.25, paidAfter: 60, termDays: 30, note: "Hotel staff wellness day" }],
  },
  {
    name: "Kurichi Cooperative Employees Welfare Society",
    area: "Kurichi",
    address: "41, Kurichi Main Road, Coimbatore 641021",
    gstin14: "33AAAAK6275E1Z",
    limit: 10_000_000,
    bills: [{ ago: 80, item: CHAIR, qty: 38, paid: 0, termDays: 30, note: "Staff day chair massage" }],
  },
];

const log = pino({ level: "warn" });
const clock = new SimClock();
const quiet = { ...env, REDIS_URL: "memory", MSG91_AUTH_KEY: undefined, MSG91_SENDER_ID: undefined, MSG91_OTP_FLOW_ID: undefined, RESEND_API_KEY: undefined, WHATSAPP_TOKEN: undefined, WHATSAPP_PHONE_NUMBER_ID: undefined, FCM_SERVICE_ACCOUNT_JSON: undefined } as typeof env;
const kit = createKit(quiet, log, { now: clock.now, skipInvoiceQuota: true });
let code = 0;
try {
  const tenant = await kit.tenancy.service.getBySlug(SLUG);
  if (!tenant) throw new Error(`No shop "${SLUG}"`);
  const t = { id: tenant.id, slug: tenant.slug, planId: tenant.planId ?? null, appId: tenant.appId ?? null, name: tenant.name };
  const inv = kit.invoices.service;
  const today = istToday();
  // The two corporate billing items (a shop made before they were added to the store file does not have them yet).
  const BILLING = [
    { name: CHAIR, hsn: "999723", unit: "person", rate: Math.round(70_000 / 1.05), gstRate: 5 },
    { name: DAY, hsn: "999723", unit: "person", rate: Math.round(150_000 / 1.05), gstRate: 5 },
  ];
  let items = new Map((await kit.catalogue.service.listItems(tenant.id, { limit: 500 })).items.map((i) => [i.name, i]));
  for (const b of BILLING) if (!items.has(b.name)) await inv.createItem(tenant.id, b);
  items = new Map((await kit.catalogue.service.listItems(tenant.id, { limit: 500 })).items.map((i) => [i.name, i]));
  const have = new Map<string, string>();
  for (let offset = 0; ; offset += 200) {
    const page = await inv.listCustomers(tenant.id, { limit: 200, offset } as never);
    for (const c of page.items) have.set(c.name, c.id);
    if (offset + 200 >= page.total || page.items.length === 0) break;
  }
  for (const [n, c] of COMPANIES.entries()) {
    const gstin = `${c.gstin14}${gstinCheckChar(c.gstin14)}`;
    let customerId = have.get(c.name);
    if (customerId && (await inv.list(tenant.id, { customerId, limit: 1 } as never)).total > 0) {
      console.log(`skip ${c.name} (exists)`);
      continue;
    }
    if (!customerId) customerId = (await inv.createCustomer(tenant.id, { name: c.name, phone: testPhone(9100 + n), address: c.address, stateCode: "33", gstin, creditLimit: c.limit } as never)).id;
    const customer = { id: customerId };
    for (const b of c.bills) {
      const item = items.get(b.item);
      if (!item) throw new Error(`Billing item "${b.item}" is missing: run seed:stores ${SLUG} first`);
      const date = addDays(today, -b.ago);
      clock.set(date, 11 * 60 + 15 * (n + 1), 0);
      const bill = await inv.create(
        t,
        {
          date,
          issue: true,
          customerId: customer.id,
          dueDate: addDays(date, b.termDays),
          notes: b.note,
          lines: [{ description: b.item, itemId: item.id, qty: b.qty, unit: item.unit ?? "service", rate: item.rate, gstRate: item.gstRate, ...(item.hsn ? { hsn: item.hsn } : {}) }],
        } as never,
        { branchId: null },
      );
      if (b.paid > 0) {
        const payDate = addDays(date, b.paidAfter ?? 20);
        clock.set(payDate > today ? today : payDate, 15 * 60, 0);
        const amount = b.paid >= 1 ? bill.total : Math.round((bill.total * b.paid) / 100) * 100;
        await inv.addPayment(tenant.id, bill.id, { amount, method: "bank", date: payDate > today ? today : payDate, reference: `NEFT ${100000 + n * 1000 + b.ago}` } as never, null);
      }
      console.log(`${c.name}: ${b.note}, ${b.ago} days ago, ${(bill.total / 100).toFixed(0)} ${b.paid >= 1 ? "paid" : b.paid > 0 ? "part-paid" : "unpaid"}`);
    }
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  code = 1;
} finally {
  await kit.stop();
}
process.exit(code);
