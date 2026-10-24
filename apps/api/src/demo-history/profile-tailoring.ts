import { THAIYAL } from "../demo-stores/thaiyal";
import type { CatalogueEntry, Profile } from "./profiles";

/**
 * Tailoring shop on garment job cards (Thaiyal Tailors & Boutique, Madurai; hook `jobcards`, garment recipes in
 * hooks/jobcards-garments.ts): each "bill" is a job delivered that day. The catalogue is built from the demo store's own
 * services, one entry per variant, named the way the kit names variants as billing items ("<service> – <option>"), so
 * the history bills the shop's real prices. Stitching, alterations, embroidery and finishing are services at 5% (SAC
 * 998821); no stock is kept (cloth and thread on the shelf are not sold by the job-card flow).
 */
const rs = (rupees: number) => Math.round(rupees * 100);

function build(): CatalogueEntry[] {
  const out: CatalogueEntry[] = [];
  for (const p of THAIYAL.products) {
    if (p.unit !== "service") continue;
    for (const v of p.variants) {
      const name = p.options?.length ? `${p.name} – ${p.options.map((o) => v.values![o.name]).join(" / ")}` : p.name;
      out.push({ name, hsn: p.hsn, unit: p.unit, rate: Math.round(v.price / (1 + p.gstRate / 100) / 100) * 100, gstRate: p.gstRate, cost: p.costShare ?? 0.35, qty: [1, 1] });
    }
  }
  return out;
}

export const TAILORING: Profile = {
  id: "tailoring",
  label: "Tailoring shop (garment job cards)",
  businessTypes: ["tailoring"],
  hook: "jobcards",
  // Sunday is short (measurements), Friday and Saturday are the pick-up days; Deepavali (8 Nov 2026) fills the last weeks.
  billsByWeekday: [3, 5, 5, 5, 6, 8, 10],
  closedWeekdays: [],
  salaryWeekBoost: 1.08,
  festivalAffinity: { major: 1.9, worship: 0.9, gold: 0.4, minor: 0.7 },
  hours: { open: 9 * 60 + 30, close: 20 * 60 + 30, peaks: [{ at: 11 * 60 + 30, spread: 70, weight: 1.2 }, { at: 17 * 60 + 30, spread: 90, weight: 2.2 }] },
  basket: { items: 1.15, maxLines: 2 },
  pareto: 1,
  payments: { cash: 0.35, upi: 0.58, card: 0.07 },
  customers: {
    count: 95,
    namedShare: 0.7,
    b2bShare: 0.1,
    creditShare: 0.14,
    // Schools, hostels and boutiques that give uniforms and bulk stitching: credit customers with dues.
    businessNames: {
      a: ["Sri Vidya", "St. Joseph's", "Bharathi", "Vivekananda", "Kamarajar", "Fatima", "Annai Teresa", "Meenakshi", "Pasumpon", "Sri Ram"],
      b: ["Matric School", "Nursery School", "Boarding School", "Hr. Sec. School", "Public School", "Girls Hostel", "Balwadi", "Boutique"],
    },
    creditLimit: [rs(30_000), rs(150_000)],
    onCredit: 0.85,
    repayChance: 0.03,
  },
  returnRate: 0,
  registers: ["Front desk"],
  tillFloat: [rs(1500), rs(3000)],
  staff: [
    { role: "Manager", count: 1, salary: rs(32_000) },
    { role: "Technician", count: 3, salary: rs(20_000) },
    { role: "Cashier", count: 1, salary: rs(14_000) },
  ],
  monthlyExpenses: [
    { category: "Rent", note: "Shop and workroom rent, West Masi Street", amount: rs(26_000), day: 3, jitter: 0, method: "bank", vendor: "Mr. S. Chidambaram (landlord)" },
    { category: "Electricity", note: "TNEB bill (machines and lights)", amount: rs(4_200), day: 12, jitter: 0.2, method: "upi", vendor: "TANGEDCO" },
    { category: "Marketing", note: "Handbills, Instagram and a Deepavali banner", amount: rs(5_500), day: 5, jitter: 0.35, method: "upi" },
    { category: "Repairs", note: "Machine servicing, needles and oil", amount: rs(3_200), day: 9, jitter: 0.4, method: "cash" },
    { category: "Packaging", note: "Garment covers, tags and bags", amount: rs(1_800), day: 15, jitter: 0.3, method: "cash" },
  ],
  weeklyExpenses: [
    { category: "Other", note: "Thread, lining and interlining", amount: [rs(900), rs(2200)], weekday: 1, method: "upi" },
    { category: "Transport", note: "Pickup and delivery rider fuel", amount: [rs(350), rs(700)], weekday: 6, method: "cash" },
    { category: "Other", note: "Tea and cleaning", amount: [rs(200), rs(400)], weekday: 6, method: "cash" },
  ],
  stock: { openingCoverDays: 14, reorderCoverDays: 7, orderCoverDays: 21 },
  suppliers: [],
  catalogue: build(),
};
