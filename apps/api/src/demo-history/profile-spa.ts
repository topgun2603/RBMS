import { itemName } from "@rbms/catalogue";
import { THERAPIES, minLabel } from "../demo-stores/spa-products";
import type { CatalogueEntry, Profile } from "./profiles";

/**
 * Spa and wellness centre (appointments): the history profile of store #21, Sukham Ayur Spa, R.S. Puram, Coimbatore.
 * Every bill is an appointment (hook `bookings`): booked on the day-calendar with a therapist, confirmed, arrived, in
 * service, then billed and completed, paid at the front desk by cash, UPI or card. Around them the hook books cancelled
 * and no-show appointments, appointments for the coming days, membership sales / renewals billed at the desk, and
 * members' check-ins. Prices are the store's own (demo-stores/spa-products.ts, 5% GST, GST-exclusive here). Corporate
 * wellness tie-ups on credit are added afterwards (seed-spa.ts), as a 90-day window cannot produce old dues.
 */

const rs = (rupees: number) => Math.round(rupees * 100);
const exclusive = (inclusiveRupees: number) => Math.round((inclusiveRupees * 100) / 1.05);

/** Most-booked first (the engine's Pareto popularity follows catalogue order): bestsellers, then the rest; long sessions rank below short ones. */
function entries(): CatalogueEntry[] {
  const out: { score: number; entry: CatalogueEntry }[] = [];
  for (const t of THERAPIES) {
    const best = t.extraTags?.includes("bestseller") ? 3 : 1;
    for (const [i, [min, price]] of t.rows.entries()) {
      out.push({
        score: best * (i === 0 ? 1 : 0.5) * (t.category === "Couple packages" ? 0.4 : 1) * (price > 3000 ? 0.5 : 1),
        entry: { name: t.rows.length > 1 ? itemName(t.name, minLabel(min)) : t.name, hsn: t.hsn, unit: "session", rate: exclusive(price), gstRate: 5, cost: 0.3, qty: [1, 1] },
      });
    }
  }
  return out.sort((a, b) => b.score - a.score).map((x) => x.entry);
}

export const spa: Profile = {
  id: "spa",
  label: "Spa and wellness centre (appointments, memberships)",
  businessTypes: ["spa"],
  hook: "bookings",
  billsByWeekday: [14, 9, 9, 10, 10, 12, 17],
  closedWeekdays: [],
  salaryWeekBoost: 1,
  festivalAffinity: { major: 1.15, worship: 0.5, gold: 0.1, minor: 0.6 },
  // Bill minute = the end of the session; the hook works back to the start.
  hours: { open: 11 * 60, close: 20 * 60 + 30, peaks: [{ at: 12 * 60 + 30, spread: 70, weight: 1.3 }, { at: 18 * 60 + 45, spread: 80, weight: 2.1 }] },
  basket: { items: 1.25, maxLines: 2 },
  pareto: 0.95,
  payments: { cash: 0.12, upi: 0.62, card: 0.26 },
  customers: { b2bShare: 0, count: 90, namedShare: 0.6, creditShare: 0, creditLimit: [0, 0], onCredit: 0, repayChance: 0 },
  returnRate: 0,
  registers: ["Front desk"],
  tillFloat: [rs(2000), rs(4000)],
  staff: [
    { role: "Manager", count: 1, salary: rs(32000) },
    { role: "Technician", count: 3, salary: rs(21000) },
    { role: "Cashier", count: 1, salary: rs(16000) },
  ],
  monthlyExpenses: [
    { category: "Rent", note: "Premises rent, D.B. Road", amount: rs(72000), day: 1, jitter: 0, method: "bank", vendor: "Mr. S. Parthasarathy (landlord)" },
    { category: "Electricity", note: "TNEB bill (sauna, steam and air conditioning)", amount: rs(26500), day: 9, jitter: 0.15, method: "upi", vendor: "TANGEDCO" },
    { category: "Other", note: "Herbal oils, powders and potli herbs", amount: rs(34000), day: 5, jitter: 0.2, method: "bank", vendor: "Pollachi Herbal Oils" },
    { category: "Marketing", note: "Instagram and Google ads", amount: rs(9000), day: 12, jitter: 0.3, method: "card" },
    { category: "Repairs", note: "Steam cabin, sauna heater and plumbing upkeep", amount: rs(4200), day: 20, jitter: 0.6, method: "upi" },
  ],
  weeklyExpenses: [
    { category: "Other", note: "Linen and towel laundry", amount: [rs(3200), rs(4600)], weekday: 1, method: "upi", vendor: "Fresh Fold Laundry" },
    { category: "Other", note: "Herbal tea, jaggery and fresh flowers", amount: [rs(900), rs(1600)], weekday: 6, method: "cash" },
    { category: "Other", note: "Disposables: sheets, disposable underwear, cotton", amount: [rs(1200), rs(2000)], weekday: 3, method: "upi", vendor: "Kovai Medical and Spa Supplies" },
  ],
  stock: { openingCoverDays: 0, reorderCoverDays: 0, orderCoverDays: 0 },
  suppliers: [],
  catalogue: entries(),
};
