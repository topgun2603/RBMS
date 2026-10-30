import { itemName } from "@rbms/catalogue";
import { CAT, DISHES, GST_RATE, type Dish } from "../demo-stores/vaasam-menu";
import type { CatalogueEntry, Profile, Supplier } from "./profiles";

/**
 * Cloud kitchen (delivery-only): the history profile of store #18, Vaasam Biryani Kitchen. Every bill is a delivery or
 * pickup dining order (no tables); the menu is the demo store's own (demo-stores/vaasam-menu.ts), so the simulator sells
 * the dishes the online store shows. Lunch (12 to 3 pm) and dinner peaks, UPI-heavy, and corporate accounts (offices on
 * OMR on monthly credit) that order trays and lunch boxes in bulk (the restaurant hook's `shapeBill`), pay late and give
 * the credit book its ageing.
 */

const rs = (rupees: number) => Math.round(rupees * 100);
const SUPPLIERS: Supplier[] = [
  { name: "Kovilambakkam Meat Market", creditDays: 1 },
  { name: "Koyambedu Vegetable Mandi", creditDays: 1 },
  { name: "Sri Lakshmi Provisions", creditDays: 15 },
  { name: "Indane Gas Agency", creditDays: 0 },
];

/** Sales popularity order: singles and boxes first, then combos and family packs, then party trays and add-ons. */
const tier = (d: Dish, portion: string) => (d.category === CAT.party || d.category === CAT.addons ? 2 : portion === "Combo" || portion === "Family" ? 1 : 0);

function entries(): CatalogueEntry[] {
  const out: { tier: number; order: number; entry: CatalogueEntry }[] = [];
  DISHES.forEach((d, order) => {
    for (const [portion, price] of d.rows) {
      const name = d.rows.length > 1 ? itemName(d.name, portion) : d.name;
      const big = portion === "Family" || d.category === CAT.party;
      out.push({
        tier: tier(d, portion),
        order,
        entry: {
          name,
          hsn: "996331",
          unit: d.category === CAT.beverages ? "glass" : d.category === CAT.party ? "tray" : "plate",
          rate: Math.round((rs(price) * 100) / (100 + GST_RATE)),
          gstRate: GST_RATE,
          cost: 0.38,
          veg: d.veg && !d.egg,
          station: d.station,
          qty: big ? [1, 1] : d.category === CAT.addons ? [1, 3] : [1, 2],
        },
      });
    }
  });
  return out.sort((a, b) => a.tier - b.tier || a.order - b.order).map((x) => x.entry);
}

export const cloudKitchen: Profile = {
  id: "cloud_kitchen",
  label: "Cloud kitchen (delivery-only)",
  businessTypes: ["cloud_kitchen"],
  hook: "restaurant",
  billsByWeekday: [92, 66, 62, 64, 68, 84, 98],
  closedWeekdays: [],
  salaryWeekBoost: 1.02,
  festivalAffinity: { major: 0.8, worship: 0.3, gold: 0, minor: 1 },
  hours: {
    open: 11 * 60,
    close: 23 * 60 + 30,
    peaks: [
      { at: 13 * 60 + 5, spread: 50, weight: 3.6 },
      { at: 17 * 60, spread: 40, weight: 0.7 },
      { at: 20 * 60 + 30, spread: 60, weight: 3.9 },
    ],
  },
  basket: { items: 2.4, maxLines: 8 },
  pareto: 1.0,
  payments: { cash: 0.14, upi: 0.73, card: 0.13 },
  // Offices on OMR (with GSTIN) on monthly credit: they order lunch boxes and trays and settle late.
  customers: {
    count: 90,
    namedShare: 0.3,
    b2bShare: 0.16,
    creditShare: 0.03,
    businessNames: {
      a: ["Karapakkam", "Perungudi", "Sholinganallur", "Thoraipakkam", "Navalur", "Siruseri", "Medavakkam", "Semmencheri"],
      b: ["Infotech", "Software Services", "Tech Solutions", "Analytics", "Diagnostics", "Engineering", "Design Studio", "Logistics"],
    },
    creditLimit: [rs(15000), rs(120000)],
    onCredit: 0.8,
    repayChance: 0.03,
  },
  returnRate: 0.004,
  registers: ["Pickup counter"],
  tillFloat: [rs(1000), rs(3000)],
  staff: [
    { role: "Manager", count: 1, salary: rs(32000) },
    { role: "Cashier", count: 1, salary: rs(17000) },
    { role: "Cook", count: 4, salary: rs(23000) },
    { role: "Helper", count: 3, salary: rs(14000) },
  ],
  monthlyExpenses: [
    { category: "Rent", note: "Kitchen rent, Karapakkam", amount: rs(48000), day: 1, jitter: 0, method: "bank", vendor: "Mr. R. Sundaram (landlord)" },
    { category: "Electricity", note: "TNEB bill", amount: rs(26000), day: 10, jitter: 0.18, method: "upi", vendor: "TANGEDCO" },
    { category: "Packaging", note: "Biryani boxes, tubs and covers", amount: rs(21000), day: 6, jitter: 0.3, method: "upi", vendor: "Sakthi Packaging" },
    { category: "Marketing", note: "Instagram ads and flyers", amount: rs(9000), day: 15, jitter: 0.5, method: "upi" },
    { category: "Transport", note: "Delivery bikes fuel and servicing", amount: rs(14000), day: 20, jitter: 0.3, method: "cash" },
  ],
  weeklyExpenses: [
    { category: "Other", note: "Chicken and mutton, Kovilambakkam", amount: [rs(42000), rs(58000)], weekday: 1, method: "upi", vendor: "Kovilambakkam Meat Market" },
    { category: "Other", note: "Vegetables, Koyambedu mandi", amount: [rs(7000), rs(11000)], weekday: 3, method: "cash", vendor: "Koyambedu Vegetable Mandi" },
    { category: "Other", note: "Rice, oil and masala", amount: [rs(16000), rs(24000)], weekday: 4, method: "upi", vendor: "Sri Lakshmi Provisions" },
    { category: "Other", note: "Commercial LPG cylinders", amount: [rs(7800), rs(11700)], weekday: 6, method: "cash", vendor: "Indane Gas Agency" },
  ],
  stock: { openingCoverDays: 0, reorderCoverDays: 0, orderCoverDays: 0 },
  suppliers: SUPPLIERS,
  catalogue: entries(),
};
