import { TECHZONE } from "../demo-stores/techzone";
import { TECHZONE_SERIALS } from "../demo-stores/techzone";
import type { CatalogueEntry, Profile, Supplier } from "./profiles";

/**
 * Electronics and mobiles (TechZone Mobiles, Coimbatore): a showroom with big-ticket, serial-numbered goods. The
 * catalogue is built from the demo store's own products, one entry per variant, named the way the kit names variants
 * as billing items ("<product> – <option values>"), so the history sells the shop's real catalogue with its real prices.
 * Phones, laptops, tablets, TVs, appliances and smartwatches are serial / IMEI tracked (the `electronics` hook puts
 * the unit on the bill line); accessories and installation are not.
 */
const rs = (rupees: number) => Math.round(rupees * 100);

const MOBILE = "Coimbatore Mobile Distributors";
const APPLIANCE = "South India Appliance Traders";
const IT = "Kovai Laptop & IT Wholesale";
const AUDIO = "Sri Lakshmi Audio Traders";
const SUPPLIERS: Supplier[] = [
  { name: MOBILE, creditDays: 7 },
  { name: APPLIANCE, creditDays: 30 },
  { name: IT, creditDays: 21 },
  { name: AUDIO, creditDays: 15 },
];

/** Category -> supplier, cost as a share of the selling rate, serial prefix. */
const BY_CATEGORY: Record<string, { supplier: string; cost: number; prefix: string; pack: number }> = {
  Smartphones: { supplier: MOBILE, cost: 0.9, prefix: "IMEI", pack: 3 },
  Laptops: { supplier: IT, cost: 0.88, prefix: "LP", pack: 2 },
  Tablets: { supplier: IT, cost: 0.88, prefix: "TB", pack: 2 },
  "Smart TVs & projectors": { supplier: APPLIANCE, cost: 0.86, prefix: "TV", pack: 2 },
  Refrigerators: { supplier: APPLIANCE, cost: 0.84, prefix: "RF", pack: 2 },
  "Washing machines": { supplier: APPLIANCE, cost: 0.84, prefix: "WM", pack: 2 },
  "Air conditioners": { supplier: APPLIANCE, cost: 0.84, prefix: "AC", pack: 2 },
  Audio: { supplier: AUDIO, cost: 0.72, prefix: "AU", pack: 4 },
  "Smartwatches & bands": { supplier: AUDIO, cost: 0.7, prefix: "SW", pack: 4 },
  "Kitchen & home appliances": { supplier: APPLIANCE, cost: 0.8, prefix: "HM", pack: 3 },
  "Installation & set-up": { supplier: "", cost: 0.3, prefix: "", pack: 1 },
};

const VALUE_ORDER = (p: { tags?: string[]; variants: { price: number }[] }) => [p.tags?.includes("bestseller") ? 0 : 1, Math.min(...p.variants.map((v) => v.price))] as const;

function build(): CatalogueEntry[] {
  const products = [...TECHZONE.products].sort((a, b) => {
    const [ba, pa] = VALUE_ORDER(a);
    const [bb, pb] = VALUE_ORDER(b);
    return ba - bb || pa - pb;
  });
  const out: CatalogueEntry[] = [];
  for (const p of products) {
    const cat = BY_CATEGORY[p.category]!;
    const serial = TECHZONE_SERIALS[p.name];
    const service = p.category === "Installation & set-up";
    for (const v of p.variants) {
      const name = p.options?.length ? `${p.name} – ${p.options.map((o) => v.values![o.name]).join(" / ")}` : p.name;
      out.push({
        name,
        hsn: p.hsn,
        unit: p.unit,
        // GST-exclusive rate (the shop's own item prices are kept when the item exists).
        rate: Math.round(v.price / (1 + p.gstRate / 100) / 100) * 100,
        gstRate: p.gstRate,
        cost: cat.cost,
        ...(service ? {} : { reorder: serial ? 1 : 2, supplier: cat.supplier, pack: cat.pack }),
        qty: service ? [1, 1] : serial ? [1, 1] : [1, 2],
        ...(serial ? { serial: { months: serial.months, dual: !!serial.dualImei, prefix: cat.prefix } } : {}),
      });
    }
  }
  // The shop's four original billing items sell too (two of them are phones with IMEIs).
  out.push(
    { name: "Galaxy M35 5G 8/128", hsn: "8517", unit: "pcs", rate: 1_699_900, gstRate: 18, cost: 0.9, reorder: 1, supplier: MOBILE, pack: 3, qty: [1, 1], serial: { months: 12, dual: true, prefix: "IMEI" } },
    { name: "Redmi Note 13 6/128", hsn: "8517", unit: "pcs", rate: 1_499_900, gstRate: 18, cost: 0.9, reorder: 1, supplier: MOBILE, pack: 3, qty: [1, 1], serial: { months: 12, dual: true, prefix: "IMEI" } },
    { name: "boAt Airdopes 141", hsn: "8518", unit: "pcs", rate: 129_900, gstRate: 18, cost: 0.7, reorder: 2, supplier: AUDIO, pack: 4, qty: [1, 2] },
    { name: "20W USB-C charger", hsn: "8504", unit: "pcs", rate: 89_900, gstRate: 18, cost: 0.65, reorder: 2, supplier: AUDIO, pack: 6, qty: [1, 2] },
  );
  return out;
}

export const ELECTRONICS: Profile = {
  id: "electronics",
  label: "Electronics and mobiles",
  businessTypes: ["electronics", "mobiles"],
  hook: "electronics",
  // Sunday and Saturday are the big days; Deepavali (8 Nov 2026) lifts the last weeks.
  billsByWeekday: [17, 9, 9, 10, 10, 13, 19],
  closedWeekdays: [],
  salaryWeekBoost: 1.1,
  festivalAffinity: { major: 1.5, worship: 0.7, gold: 0.3, minor: 0.4 },
  hours: { open: 10 * 60, close: 21 * 60 + 30, peaks: [{ at: 12 * 60 + 30, spread: 80, weight: 1.4 }, { at: 18 * 60 + 30, spread: 90, weight: 2.2 }] },
  basket: { items: 1.35, maxLines: 4 },
  pareto: 0.9,
  payments: { cash: 0.18, upi: 0.42, card: 0.4 },
  customers: { businessNames: { a: ["Sri Vinayaga", "Kovai", "Annai", "Sri Balaji", "Kaveri", "Pandian", "Thendral", "Arasan"], b: ["Computers", "Infotech", "Enterprises", "Traders", "Systems", "Associates"] }, b2bShare: 0.08, count: 80, namedShare: 0.75, creditShare: 0.4, creditLimit: [rs(30_000), rs(180_000)], onCredit: 0.55, repayChance: 0.04 },
  returnRate: 0.012,
  // The two POS terminals of the shop (their names are their till registers).
  registers: ["Counter 1", "Counter 2"],
  tillFloat: [rs(5000), rs(10000)],
  staff: [
    { role: "Manager", count: 1, salary: rs(38_000) },
    { role: "Salesman", count: 2, salary: rs(20_000) },
    { role: "Cashier", count: 1, salary: rs(17_000) },
    { role: "Helper", count: 1, salary: rs(13_000) },
  ],
  monthlyExpenses: [
    { category: "Rent", note: "Showroom rent, Cross Cut Road", amount: rs(95_000), day: 3, jitter: 0, method: "bank", vendor: "Mr. V. Ramasamy (landlord)" },
    { category: "Electricity", note: "TNEB bill (display ACs and TVs)", amount: rs(38_000), day: 12, jitter: 0.2, method: "upi", vendor: "TANGEDCO" },
    { category: "Transport", note: "Delivery vehicle fuel and driver", amount: rs(22_000), day: 18, jitter: 0.3, method: "cash" },
    { category: "Marketing", note: "Newspaper and Instagram ads", amount: rs(28_000), day: 6, jitter: 0.35, method: "upi" },
  ],
  weeklyExpenses: [{ category: "Other", note: "Tea and cleaning", amount: [rs(350), rs(800)], weekday: 6, method: "cash" }],
  stock: { openingCoverDays: 20, reorderCoverDays: 7, orderCoverDays: 21 },
  suppliers: SUPPLIERS,
  catalogue: build(),
};
