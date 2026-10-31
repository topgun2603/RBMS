import { itemName } from "@rbms/catalogue";
import { BAKERY_HSN, DISHES, GST_RATE, SERVICE_HSN } from "../demo-stores/theneer-menu";
import type { CatalogueEntry, Profile, Supplier } from "./profiles";

/**
 * Tea stall and juice bar (counter-first): the history profile of store #19, Theneer Kadai, Mylapore. Hundreds of small
 * counter bills a day (a tea, a vada, two cups for the office), morning and evening peaks, cash and UPI, no tables and
 * no kitchen tickets (the standard counter bill, hook `none`), a handful of offices and shops on monthly tea cards that
 * settle late and give the credit book its ageing, and daily milk, fruit and snack-ingredient expenses. The menu is the
 * demo store's own (demo-stores/theneer-menu.ts), so the simulator sells the items the online store shows.
 */

const rs = (rupees: number) => Math.round(rupees * 100);
const SUPPLIERS: Supplier[] = [
  { name: "Mylapore Milk Agency", creditDays: 1 },
  { name: "Mylapore Fruit Market", creditDays: 1 },
  { name: "Sri Balaji Provisions", creditDays: 15 },
  { name: "Kapali Bakery Supplies", creditDays: 7 },
];

/** Most-sold first (the engine's Pareto popularity follows catalogue order); a Small sells about twice as often as a Large. */
function entries(): CatalogueEntry[] {
  const out: { score: number; entry: CatalogueEntry }[] = [];
  for (const d of DISHES) {
    for (const [size, price] of d.rows) {
      const many = d.rows.length > 1;
      const large = many && size !== d.rows[0]![0];
      out.push({
        score: d.pop * (large ? 0.45 : 1),
        entry: {
          name: many ? itemName(d.name, size) : d.name,
          hsn: d.hsn ?? SERVICE_HSN,
          unit: d.unit,
          rate: Math.round((rs(price) * 100) / (100 + GST_RATE)),
          gstRate: GST_RATE,
          cost: d.hsn === BAKERY_HSN ? 0.7 : 0.45,
          // Drinks and snacks are bought two or three at a time by a group; a flask is one.
          qty: d.unit === "flask" ? [1, 1] : large ? [1, 2] : d.hsn === BAKERY_HSN ? [1, 3] : [1, 3],
        },
      });
    }
  }
  return out.sort((a, b) => b.score - a.score).map((x) => x.entry);
}

export const teaStall: Profile = {
  id: "tea_stall",
  label: "Tea stall and juice bar (counter-first)",
  businessTypes: ["tea_stall"],
  hook: "none",
  billsByWeekday: [330, 290, 285, 285, 290, 310, 360],
  closedWeekdays: [],
  salaryWeekBoost: 1.02,
  festivalAffinity: { major: 0.8, worship: 0.9, gold: 0, minor: 1 },
  hours: {
    open: 5 * 60 + 30,
    close: 23 * 60,
    peaks: [
      { at: 7 * 60 + 40, spread: 55, weight: 3.4 },
      { at: 10 * 60 + 45, spread: 50, weight: 1.4 },
      { at: 13 * 60 + 30, spread: 60, weight: 1 },
      { at: 16 * 60 + 40, spread: 45, weight: 2.6 },
      { at: 19 * 60 + 10, spread: 55, weight: 2.6 },
    ],
  },
  basket: { items: 1.9, maxLines: 5 },
  pareto: 1.05,
  payments: { cash: 0.46, upi: 0.5, card: 0.04 },
  // Offices and shops of Mylapore on monthly tea cards (credit), settling late.
  customers: {
    count: 70,
    namedShare: 0.1,
    b2bShare: 0.3,
    creditShare: 0.3,
    businessNames: {
      a: ["Mylapore", "Luz", "Alwarpet", "Mandaveli", "Abhiramapuram", "Santhome", "Royapettah", "Kapali"],
      b: ["Chartered Accountants", "Law Chambers", "Printers", "Jewellers", "Travels", "Insurance Agency", "Diagnostics", "Textiles"],
    },
    creditLimit: [rs(3000), rs(15000)],
    onCredit: 0.9,
    repayChance: 0.03,
  },
  returnRate: 0.001,
  registers: ["Morning counter", "Evening counter"],
  tillFloat: [rs(1500), rs(3000)],
  staff: [
    { role: "Manager", count: 1, salary: rs(28000) },
    { role: "Cashier", count: 2, salary: rs(15000) },
    { role: "Helper", count: 1, salary: rs(16000) },
  ],
  monthlyExpenses: [
    { category: "Rent", note: "Shop rent, Sannidhi Street", amount: rs(32000), day: 1, jitter: 0, method: "bank", vendor: "Mr. K. Ramanathan (landlord)" },
    { category: "Electricity", note: "TNEB bill", amount: rs(7800), day: 10, jitter: 0.2, method: "upi", vendor: "TANGEDCO" },
    { category: "Packaging", note: "Paper cups, covers and straws", amount: rs(5200), day: 6, jitter: 0.3, method: "upi", vendor: "Sakthi Packaging" },
    { category: "Repairs", note: "Juicer, grinder and fridge servicing", amount: rs(1800), day: 19, jitter: 0.6, method: "cash" },
  ],
  weeklyExpenses: [
    { category: "Other", note: "Milk, morning delivery", amount: [rs(3800), rs(5200)], weekday: "daily", method: "cash", vendor: "Mylapore Milk Agency" },
    { category: "Other", note: "Fruit and sugarcane for the juice counter", amount: [rs(1800), rs(3000)], weekday: "daily", method: "cash", vendor: "Mylapore Fruit Market" },
    { category: "Other", note: "Besan, onion, potato and frying oil", amount: [rs(900), rs(1500)], weekday: "daily", method: "cash" },
    { category: "Other", note: "Tea dust, coffee powder and sugar", amount: [rs(6500), rs(9000)], weekday: 1, method: "upi", vendor: "Sri Balaji Provisions" },
    { category: "Other", note: "Bakery buns, puffs and rusk", amount: [rs(2500), rs(3800)], weekday: 3, method: "upi", vendor: "Kapali Bakery Supplies" },
    { category: "Other", note: "Commercial LPG cylinder", amount: [rs(1900), rs(2000)], weekday: 6, method: "cash" },
  ],
  stock: { openingCoverDays: 0, reorderCoverDays: 0, orderCoverDays: 0 },
  suppliers: SUPPLIERS,
  catalogue: entries(),
};
