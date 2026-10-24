import { itemName } from "@srirealtime/catalogue";
import { CAT, DISHES, GST_RATE, type Dish } from "../demo-stores/arusuvai-menu";
import type { CatalogueEntry, Profile, Supplier } from "./profiles";

/**
 * Restaurant / mess (full service, dine-in first): the history profile of Arusuvai Unavagam, KK Nagar, Madurai (the
 * rebuilt restaurant demo shop). Bills come out of dining orders (restaurant hook): dine-in on tables with KOTs in rounds,
 * takeaway and delivery. The menu is the demo store's own (demo-stores/arusuvai-menu.ts), so the simulator sells the dishes
 * the online store shows: tiffin in the morning, meals at lunch, biryani, parotta and tandoor at dinner. Corporate and
 * catering accounts (offices, hospitals, colleges, function caterers, with GSTIN) buy meals and trays on monthly credit,
 * part-pay late and give the credit book its ageing; the restaurant hook turns their bills into bulk takeaway orders.
 */

const rs = (rupees: number) => Math.round(rupees * 100);
const SUPPLIERS: Supplier[] = [
  { name: "Paravai Vegetable Market", creditDays: 1 },
  { name: "Goripalayam Meat & Poultry", creditDays: 1 },
  { name: "Sri Meenakshi Provisions", creditDays: 15 },
  { name: "Bharat Gas Agency, KK Nagar", creditDays: 0 },
];

/** Most-ordered dishes first (the engine weights lines by position); the rest follow the menu's order, family packs last. */
const HOT = ["Idli – 2 pcs", "Masala Dosa", "Filter Coffee", "Unlimited Veg Meals", "Parotta – 2 pcs", "Chicken Biryani – Regular", "Tea – Plain", "Medu Vada – 2 pcs", "Chettinad Chicken Curry – Half", "Kothu Parotta – Egg", "Butter Milk", "Chicken Meals", "Dosa – Plain", "Naan – Butter", "Chicken 65 – Half", "Veg Biryani – Regular", "Mini Meals", "Ven Pongal"];

const unitOf = (d: Dish) => (d.category === CAT.beverages ? "glass" : d.name.includes("Tray") ? "tray" : "plate");
const lines = (d: Dish): [number, number] => (d.category === CAT.family ? [1, 1] : /Idli|Parotta|Tea|Coffee|Butter Milk|Roti|Naan|Vada/.test(d.name) ? [1, 3] : [1, 2]);

function entries(): CatalogueEntry[] {
  const all = DISHES.flatMap((d, order) =>
    d.rows.map(([value, price]) => {
      const name = d.rows.length > 1 ? itemName(d.name, value) : d.name;
      const entry: CatalogueEntry = {
        name,
        hsn: "996331",
        unit: unitOf(d),
        rate: Math.round((rs(price) * 100) / (100 + GST_RATE)),
        gstRate: GST_RATE,
        cost: 0.38,
        veg: d.diet === "veg",
        station: d.station,
        qty: lines(d),
      };
      return { name, order, family: d.category === CAT.family, entry };
    }),
  );
  const hot = (n: string) => HOT.indexOf(n);
  return all
    .sort((a, b) => (hot(a.name) < 0 ? 1000 : hot(a.name)) - (hot(b.name) < 0 ? 1000 : hot(b.name)) || Number(a.family) - Number(b.family) || a.order - b.order)
    .map((x) => x.entry);
}

export const restaurant: Profile = {
  id: "restaurant",
  label: "Restaurant / mess",
  businessTypes: ["restaurant", "hotel", "mess", "tiffin", "cafe", "bakery"],
  hook: "restaurant",
  billsByWeekday: [112, 60, 58, 60, 64, 84, 120],
  closedWeekdays: [],
  salaryWeekBoost: 1.03,
  festivalAffinity: { major: 0.7, worship: 0.5, gold: 0, minor: 0.9 },
  hours: {
    open: 7 * 60,
    close: 22 * 60 + 30,
    peaks: [
      { at: 8 * 60 + 15, spread: 40, weight: 1.3 },
      { at: 13 * 60, spread: 50, weight: 3.4 },
      { at: 16 * 60 + 30, spread: 35, weight: 0.8 },
      { at: 20 * 60 + 15, spread: 55, weight: 3.0 },
    ],
  },
  basket: { items: 3.4, maxLines: 10 },
  pareto: 1.1,
  payments: { cash: 0.36, upi: 0.52, card: 0.12 },
  // Corporate canteens, hospitals, colleges and function caterers (with GSTIN) on monthly credit, paying late, give the credit book its ageing.
  customers: {
    b2bShare: 0.12,
    count: 70,
    namedShare: 0.22,
    creditShare: 0.08,
    businessNames: {
      a: ["Vaigai", "Meenakshi", "Pandian", "Anna Nagar", "KK Nagar", "Thiruppalai", "Alagar", "Goripalayam", "Tamukkam", "Sellur"],
      b: ["Software Park", "Textiles", "Hospital", "Engineering College", "Function Caterers", "Finance", "Diagnostics", "Travels", "Matriculation School", "Marriage Hall"],
    },
    creditLimit: [rs(8000), rs(60000)],
    onCredit: 0.7,
    repayChance: 0.025,
  },
  returnRate: 0.004,
  registers: ["Counter 1", "Counter 2"],
  tillFloat: [rs(2000), rs(5000)],
  staff: [
    { role: "Manager", count: 1, salary: rs(32000) },
    { role: "Cashier", count: 2, salary: rs(16000) },
    { role: "Cook", count: 4, salary: rs(23000) },
    { role: "Waiter", count: 6, salary: rs(13000) },
    { role: "Helper", count: 3, salary: rs(11000) },
  ],
  monthlyExpenses: [
    { category: "Rent", note: "Restaurant and family hall rent, KK Nagar", amount: rs(68000), day: 1, jitter: 0, method: "bank", vendor: "Mr. S. Chidambaram (landlord)" },
    { category: "Electricity", note: "TNEB bill", amount: rs(31000), day: 10, jitter: 0.18, method: "upi", vendor: "TANGEDCO" },
    { category: "Packaging", note: "Takeaway boxes, banana leaves and covers", amount: rs(5200), day: 6, jitter: 0.3, method: "upi", vendor: "Sakthi Packaging" },
    { category: "Repairs", note: "Grinder, tandoor and kitchen repairs", amount: rs(3200), day: 19, jitter: 0.6, method: "cash" },
    { category: "Marketing", note: "Zomato / Google listing and flex banners", amount: rs(6000), day: 14, jitter: 0.4, method: "upi" },
  ],
  weeklyExpenses: [
    { category: "Other", note: "Vegetables, Paravai market", amount: [rs(10000), rs(15500)], weekday: 1, method: "cash", vendor: "Paravai Vegetable Market" },
    { category: "Other", note: "Chicken, mutton and fish, Goripalayam", amount: [rs(24000), rs(36000)], weekday: 3, method: "upi", vendor: "Goripalayam Meat & Poultry" },
    { category: "Other", note: "Groceries, rice and oil", amount: [rs(8000), rs(12500)], weekday: 4, method: "upi", vendor: "Sri Meenakshi Provisions" },
    { category: "Other", note: "Commercial LPG cylinders", amount: [rs(5600), rs(8400)], weekday: 6, method: "cash", vendor: "Bharat Gas Agency, KK Nagar" },
  ],
  stock: { openingCoverDays: 0, reorderCoverDays: 0, orderCoverDays: 0 },
  suppliers: SUPPLIERS,
  catalogue: entries(),
};
