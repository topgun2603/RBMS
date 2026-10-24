import type { FestivalGroup } from "./calendar";
import { ELECTRONICS } from "./electronics";
import { cloudKitchen } from "./profile-cloud-kitchen";
import { restaurant } from "./profile-restaurant";
import { teaStall } from "./profile-tea-stall";
import { spa } from "./profile-spa";
import { TAILORING } from "./profile-tailoring";

/**
 * Trade profiles for the history simulator: pure data (no I/O), so they can be tested and tuned freely. Money is in
 * paise, GST-exclusive; times are minutes since midnight (IST); weekday arrays run Sunday to Saturday.
 */

export type ProfileId = "kirana" | "pharmacy" | "restaurant" | "jewellery" | "textiles" | "hardware" | "services" | "electronics" | "repair" | "cloud_kitchen" | "tea_stall" | "tailoring" | "spa";
export type HookId = "kirana" | "pharmacy" | "restaurant" | "jewellery" | "electronics" | "jobcards" | "bookings" | "none";
export type Schedule = "otc" | "G" | "H" | "H1" | "X" | "narcotic";

export interface CatalogueEntry {
  name: string;
  hsn: string;
  unit: string;
  /** GST-exclusive selling rate, paise per unit. */
  rate: number;
  gstRate: number;
  /** Purchase cost as a fraction of the rate (0.82 = 18% margin). */
  cost: number;
  /** Reorder level in units (a purchase is made when stock falls to it). Omit for untracked items. */
  reorder?: number;
  /** Supplier name from `Profile.suppliers`. */
  supplier?: string;
  /** Apparel / made-up (Ch. 61-63): taxed by price band, 5% up to Rs 2,500 per piece, 18% above (docs/verticals.md). */
  band?: boolean;
  /** Barcode; with `band` the item is created as a catalogue product (rule, barcode) rather than a bare billing item. */
  barcode?: string;
  /** Sold by weight in fractions (kg): quantities of 0.25 steps. */
  loose?: boolean;
  /** Typical quantity range on one bill line (default 1 to 2). */
  qty?: [number, number];
  /** Days of stock to order and hold for a perishable (milk, vegetables); overrides the profile's cover. */
  cover?: number;
  /** Purchase pack: restock quantities are rounded up to a multiple of this. */
  pack?: number;
  /** Electronics: a serial / IMEI tracked unit (warranty months from the bill date, dual IMEI, serial prefix for non-phones). */
  serial?: { months: number; dual: boolean; prefix: string };
  // Pharmacy
  schedule?: Schedule;
  composition?: string;
  packSize?: number;
  manufacturer?: string;
  rack?: string;
  // Restaurant
  veg?: boolean;
  station?: string;
}

export interface Supplier {
  name: string;
  /** Days of credit the supplier gives (purchases are paid later). */
  creditDays: number;
}

export interface Peak {
  /** Minute of day. */
  at: number;
  /** Standard deviation in minutes. */
  spread: number;
  weight: number;
}

export interface ExpenseRule {
  category: "Rent" | "Salaries" | "Electricity" | "Transport" | "Packaging" | "Marketing" | "Repairs" | "Other";
  note: string;
  amount: number;
  /** Day of the month it is paid (clamped to the month's length). */
  day: number;
  /** +/- fraction the amount varies by month. */
  jitter: number;
  method: "cash" | "upi" | "bank" | "card";
  vendor?: string;
}

export interface WeeklyExpense {
  category: ExpenseRule["category"];
  note: string;
  amount: [number, number];
  /** Weekday it is paid on (0 = Sunday), or "daily" (milk and fruit at a tea stall). */
  weekday: number | "daily";
  method: "cash" | "upi";
  vendor?: string;
}

export interface StaffRole {
  role: "Manager" | "Cashier" | "Helper" | "Cook" | "Waiter" | "Pharmacist" | "Salesman" | "Technician";
  count: number;
  /** Monthly salary, paise. */
  salary: number;
}

export interface Profile {
  id: ProfileId;
  label: string;
  /** Business types (billing starter packs) this profile fits, for picking one from the shop. */
  businessTypes: string[];
  hook: HookId;
  /** Mean bills on an ordinary day, Sunday to Saturday. */
  billsByWeekday: [number, number, number, number, number, number, number];
  closedWeekdays: number[];
  /** Salary-week lift on days 1 to 7 of a month (kirana), as a multiplier. */
  salaryWeekBoost: number;
  festivalAffinity: Record<FestivalGroup, number>;
  hours: { open: number; close: number; peaks: Peak[] };
  basket: {
    /** Mean number of lines on a bill (1 + Poisson(items - 1)). */
    items: number;
    maxLines: number;
  };
  /** Zipf exponent of item popularity (catalogue order = popularity order); ~1.2 gives 20% of items 75-80% of lines. */
  pareto: number;
  /** Shares of fully paid bills by method (credit is separate). */
  payments: { cash: number; upi: number; card: number };
  customers: {
    count: number;
    /** Share of bills made out to a named customer. */
    namedShare: number;
    /** Share of named customers who are businesses with a GSTIN (they show in the B2B part of the GST reports). */
    b2bShare: number;
    /** Share of named customers who buy on credit. */
    creditShare: number;
    /** Names for business customers ("<a> <b>", e.g. "Sri Murugan Tailors"); default: food-trade names. */
    businessNames?: { a: string[]; b: string[] };
    /** Credit limit range, paise. */
    creditLimit: [number, number];
    /** A credit customer's bill goes on the book with this probability. */
    onCredit: number;
    /** Daily chance a customer with dues pays something. */
    repayChance: number;
  };
  returnRate: number;
  registers: string[];
  tillFloat: [number, number];
  staff: StaffRole[];
  monthlyExpenses: ExpenseRule[];
  weeklyExpenses: WeeklyExpense[];
  stock: { openingCoverDays: number; reorderCoverDays: number; orderCoverDays: number };
  suppliers: Supplier[];
  catalogue: CatalogueEntry[];
}

const rs = (rupees: number) => Math.round(rupees * 100);

// A short constructor: [name, hsn, unit, rupees, gst, cost, reorder, supplier, extras].
type Extra = Partial<CatalogueEntry>;
const e = (name: string, hsn: string, unit: string, rupees: number, gstRate: number, cost: number, reorder: number | undefined, supplier: string | undefined, extra: Extra = {}): CatalogueEntry => ({
  name,
  hsn,
  unit,
  rate: rs(rupees),
  gstRate,
  cost,
  ...(reorder !== undefined ? { reorder } : {}),
  ...(supplier ? { supplier } : {}),
  ...extra,
});

// ------------------------------------------------------------------ kirana

const KIRANA_SUPPLIERS: Supplier[] = [
  { name: "Sri Murugan Wholesale Mart", creditDays: 7 },
  { name: "Madurai Grocers' Association Depot", creditDays: 14 },
  { name: "Hindustan Unilever Distributor (Sellur)", creditDays: 10 },
  { name: "Aavin Milk Agency, Anna Nagar", creditDays: 1 },
];
const W = "Sri Murugan Wholesale Mart";
const G = "Madurai Grocers' Association Depot";
const U = "Hindustan Unilever Distributor (Sellur)";
const M = "Aavin Milk Agency, Anna Nagar";

const kirana: Profile = {
  id: "kirana",
  label: "Kirana / general store",
  businessTypes: ["grocery", "kirana", "supermarket", "general"],
  hook: "kirana",
  billsByWeekday: [88, 62, 58, 58, 60, 66, 84],
  closedWeekdays: [],
  salaryWeekBoost: 1.14,
  festivalAffinity: { major: 1, worship: 0.8, gold: 0, minor: 0.8 },
  hours: {
    open: 7 * 60,
    close: 22 * 60,
    peaks: [
      { at: 8 * 60, spread: 55, weight: 2.2 },
      { at: 13 * 60, spread: 70, weight: 1 },
      { at: 18 * 60 + 30, spread: 80, weight: 2.8 },
    ],
  },
  basket: { items: 4.2, maxLines: 12 },
  pareto: 1.25,
  payments: { cash: 0.55, upi: 0.38, card: 0.07 },
  customers: { b2bShare: 0.06, count: 90, namedShare: 0.4, creditShare: 0.22, creditLimit: [rs(2000), rs(15000)], onCredit: 0.72, repayChance: 0.08 },
  returnRate: 0.01,
  registers: ["Morning counter", "Evening counter"],
  tillFloat: [rs(1500), rs(4000)],
  staff: [
    { role: "Manager", count: 1, salary: rs(22000) },
    { role: "Cashier", count: 2, salary: rs(14000) },
    { role: "Helper", count: 2, salary: rs(10000) },
  ],
  monthlyExpenses: [
    { category: "Rent", note: "Shop rent", amount: rs(28000), day: 3, jitter: 0, method: "bank", vendor: "Mr. R. Subramanian (landlord)" },
    { category: "Electricity", note: "TNEB bill", amount: rs(6200), day: 11, jitter: 0.22, method: "upi", vendor: "TANGEDCO" },
    { category: "Other", note: "Refrigerator and shop maintenance", amount: rs(1800), day: 18, jitter: 0.5, method: "cash" },
    { category: "Marketing", note: "Handbills and festival banner", amount: rs(1500), day: 20, jitter: 0.4, method: "cash" },
  ],
  weeklyExpenses: [
    { category: "Transport", note: "Goods autorickshaw", amount: [rs(450), rs(900)], weekday: 1, method: "cash", vendor: "Muthu Mini Goods Auto" },
    { category: "Other", note: "Tea, snacks and cleaning", amount: [rs(300), rs(650)], weekday: 6, method: "cash" },
  ],
  stock: { openingCoverDays: 10, reorderCoverDays: 3.5, orderCoverDays: 9 },
  suppliers: KIRANA_SUPPLIERS,
  catalogue: [
    e("Milk packet 500 ml", "0401", "pcs", 25, 0, 0.93, 80, M, { cover: 2, qty: [1, 4], pack: 40 }),
    e("Ponni rice (loose)", "1006", "kg", 56, 0, 0.88, 120, W, { loose: true, qty: [1, 3], pack: 50 }),
    e("Onion", "0703", "kg", 36, 0, 0.82, 60, W, { cover: 5, loose: true, qty: [0.5, 2.5], pack: 25 }),
    e("Tomato", "0702", "kg", 30, 0, 0.8, 40, W, { cover: 3, loose: true, qty: [0.5, 2], pack: 15 }),
    e("Sunflower oil 1 L", "1512", "pcs", 165, 5, 0.91, 30, G, { qty: [1, 3], pack: 12 }),
    e("Sugar 1 kg", "1701", "pcs", 42, 5, 0.92, 50, W, { qty: [1, 3], pack: 20 }),
    e("Potato", "0701", "kg", 32, 0, 0.82, 50, W, { cover: 6, loose: true, qty: [0.5, 2.5], pack: 25 }),
    e("Eggs", "0407", "pcs", 6.5, 0, 0.9, 120, W, { cover: 4, qty: [2, 12], pack: 120 }),
    e("Toor dal (loose)", "0713", "kg", 135, 0, 0.9, 40, W, { loose: true, qty: [0.5, 2], pack: 25 }),
    e("Tea powder 250 g", "0902", "pcs", 95, 5, 0.9, 20, G, { qty: [1, 2], pack: 12 }),
    e("Curd 500 g", "0403", "pcs", 28, 0, 0.93, 30, M, { cover: 2, qty: [1, 2], pack: 20 }),
    e("Bread", "1905", "pcs", 38, 0, 0.9, 20, M, { cover: 2, qty: [1, 2], pack: 12 }),
    e("Atta 5 kg packet", "1101", "pcs", 235, 5, 0.92, 15, G, { qty: [1, 2], pack: 10 }),
    e("Coconut", "0801", "pcs", 24, 0, 0.8, 40, W, { cover: 5, qty: [1, 4], pack: 50 }),
    e("Iodised salt 1 kg", "2501", "pcs", 24, 0, 0.9, 25, G, { qty: [1, 2], pack: 24 }),
    e("Bath soap", "3401", "pcs", 38, 18, 0.86, 40, U, { qty: [1, 4], pack: 24 }),
    e("Marie biscuits", "1905", "pcs", 25, 18, 0.88, 50, G, { qty: [1, 4], pack: 36 }),
    e("Urad dal (loose)", "0713", "kg", 118, 0, 0.9, 25, W, { loose: true, qty: [0.5, 1.5], pack: 25 }),
    e("Idli rice (loose)", "1006", "kg", 48, 0, 0.88, 50, W, { loose: true, qty: [1, 4], pack: 50 }),
    e("Gingelly oil 500 ml", "1515", "pcs", 285, 5, 0.9, 12, G, { qty: [1, 2], pack: 6 }),
    e("Red chilli (loose)", "0904", "kg", 310, 0, 0.88, 10, W, { loose: true, qty: [0.25, 0.75], pack: 10 }),
    e("Toothpaste 150 g", "3306", "pcs", 99, 18, 0.84, 30, U, { qty: [1, 2], pack: 24 }),
    e("Washing powder 1 kg", "3402", "pcs", 105, 18, 0.86, 20, U, { qty: [1, 2], pack: 12 }),
    e("Coffee powder 200 g", "0901", "pcs", 140, 5, 0.9, 12, G, { qty: [1, 2], pack: 12 }),
    e("Instant noodles", "1902", "pcs", 13, 12, 0.88, 60, G, { qty: [2, 6], pack: 72 }),
    e("Namkeen mixture 200 g", "2106", "pcs", 55, 12, 0.85, 25, G, { qty: [1, 2], pack: 24 }),
    e("Cool drink 750 ml", "2202", "pcs", 38, 28, 0.88, 36, G, { qty: [1, 3], pack: 24 }),
    e("Mineral water 1 L", "2201", "pcs", 16, 18, 0.8, 48, G, { qty: [1, 4], pack: 24 }),
    e("Moong dal (loose)", "0713", "kg", 120, 0, 0.9, 20, W, { loose: true, qty: [0.5, 1.5], pack: 25 }),
    e("Groundnut oil 1 L", "1508", "pcs", 190, 5, 0.91, 14, G, { qty: [1, 2], pack: 12 }),
    e("Turmeric powder 100 g", "0910", "pcs", 28, 5, 0.87, 25, G, { qty: [1, 2], pack: 24 }),
    e("Coriander powder 200 g", "0909", "pcs", 52, 5, 0.87, 20, G, { qty: [1, 2], pack: 24 }),
    e("Sambar powder 200 g", "0910", "pcs", 70, 5, 0.87, 20, G, { qty: [1, 2], pack: 24 }),
    e("Detergent bar", "3401", "pcs", 22, 18, 0.86, 40, U, { qty: [1, 4], pack: 36 }),
    e("Shampoo sachet", "3305", "pcs", 2.5, 18, 0.85, 200, U, { qty: [2, 8], pack: 200 }),
    e("Toothbrush", "9603", "pcs", 30, 18, 0.82, 30, U, { qty: [1, 2], pack: 24 }),
    e("Rice (Ponni) 25 kg", "1006", "bag", 1450, 5, 0.9, 6, W, { qty: [1, 1], pack: 5 }),
    e("Maida 1 kg", "1101", "pcs", 38, 5, 0.9, 12, G, { qty: [1, 2], pack: 20 }),
    e("Rava 500 g", "1103", "pcs", 28, 5, 0.9, 15, G, { qty: [1, 2], pack: 20 }),
    e("Poha 500 g", "1104", "pcs", 34, 5, 0.9, 10, G, { qty: [1, 2], pack: 20 }),
    e("Tamarind (loose)", "0813", "kg", 160, 0, 0.88, 8, W, { loose: true, qty: [0.25, 0.5], pack: 10 }),
    e("Jaggery (loose)", "1701", "kg", 70, 5, 0.9, 10, W, { loose: true, qty: [0.5, 1], pack: 10 }),
    e("Ghee 500 ml", "0405", "pcs", 330, 12, 0.92, 8, G, { qty: [1, 1], pack: 6 }),
    e("Pickle 200 g", "2001", "pcs", 85, 12, 0.86, 12, G, { qty: [1, 2], pack: 12 }),
    e("Dish wash gel", "3402", "pcs", 48, 18, 0.86, 15, U, { qty: [1, 2], pack: 12 }),
    e("Floor cleaner 500 ml", "3402", "pcs", 110, 18, 0.86, 8, U, { qty: [1, 1], pack: 12 }),
    e("Agarbathi pack", "3307", "pcs", 30, 12, 0.82, 20, G, { qty: [1, 3], pack: 24 }),
    e("Matchbox", "3605", "pcs", 2, 12, 0.85, 150, G, { qty: [2, 10], pack: 100 }),
    e("Camphor and wicks", "3307", "pcs", 20, 12, 0.82, 20, G, { qty: [1, 2], pack: 24 }),
    e("Chocolate bar", "1806", "pcs", 45, 18, 0.88, 30, G, { qty: [1, 3], pack: 24 }),
    e("Cashew nuts 100 g", "0801", "pcs", 90, 5, 0.9, 10, G, { qty: [1, 1], pack: 12 }),
    e("Battery AA pair", "8506", "pcs", 28, 18, 0.85, 12, G, { qty: [1, 2], pack: 24 }),
    e("Candles pack", "3406", "pcs", 15, 12, 0.85, 15, G, { qty: [1, 2], pack: 24 }),
  ],
};

// ------------------------------------------------------------------ pharmacy

const PHARMA_SUPPLIERS: Supplier[] = [
  { name: "Salem Pharma Distributors", creditDays: 21 },
  { name: "Sri Balaji Medical Agencies", creditDays: 15 },
  { name: "Coimbatore Surgicals and Devices", creditDays: 30 },
];
const SP = "Salem Pharma Distributors";
const SB = "Sri Balaji Medical Agencies";
const CS = "Coimbatore Surgicals and Devices";
/** Fictional manufacturers (generic names, no brands). */
const KV = "Kaveri Pharma Pvt Ltd";
const NR = "Nilgiri Remedies";
const VL = "Vaigai Lifesciences";
const CH = "Cauvery Healthcare";
const PL = "Pothigai Labs";
const AF = "Annai Formulations";
/** A medicine priced from its MRP (GST-inclusive): the rate is the MRP without GST. */
const mrpMed = (name: string, unit: string, mrp: number, gst: number, reorder: number, supplier: string, schedule: Schedule, composition: string, packSize: number, manufacturer: string, rack: string, extra: Extra = {}) =>
  e(name, "3004", unit, Math.round((mrp * 10000) / (100 + gst)) / 100, gst, 0.78, reorder, supplier, { schedule, composition, packSize, manufacturer, rack, qty: [1, 2], pack: 10, ...extra });

const pharmacy: Profile = {
  id: "pharmacy",
  label: "Pharmacy",
  businessTypes: ["pharmacy", "medical", "chemist"],
  hook: "pharmacy",
  billsByWeekday: [52, 70, 66, 64, 64, 68, 74],
  closedWeekdays: [],
  salaryWeekBoost: 1.05,
  festivalAffinity: { major: 0.25, worship: 0.15, gold: 0, minor: 0.1 },
  hours: {
    open: 8 * 60,
    close: 22 * 60 + 30,
    peaks: [
      { at: 10 * 60, spread: 70, weight: 1.6 },
      { at: 14 * 60, spread: 50, weight: 0.6 },
      { at: 19 * 60, spread: 80, weight: 2.2 },
    ],
  },
  basket: { items: 2.8, maxLines: 9 },
  pareto: 1.15,
  payments: { cash: 0.5, upi: 0.42, card: 0.08 },
  customers: { b2bShare: 0.05, count: 70, namedShare: 0.35, creditShare: 0.1, creditLimit: [rs(1500), rs(8000)], onCredit: 0.6, repayChance: 0.1 },
  returnRate: 0.008,
  registers: ["Counter 1", "Counter 2"],
  tillFloat: [rs(1000), rs(2500)],
  staff: [
    { role: "Pharmacist", count: 1, salary: rs(32000) },
    { role: "Cashier", count: 2, salary: rs(14000) },
    { role: "Helper", count: 1, salary: rs(11000) },
  ],
  monthlyExpenses: [
    { category: "Rent", note: "Shop rent", amount: rs(35000), day: 5, jitter: 0, method: "bank", vendor: "Dr. K. Natarajan (landlord)" },
    { category: "Electricity", note: "TNEB bill (refrigeration)", amount: rs(8400), day: 12, jitter: 0.2, method: "upi", vendor: "TANGEDCO" },
    { category: "Repairs", note: "Refrigerator service", amount: rs(1500), day: 22, jitter: 0.5, method: "cash" },
  ],
  weeklyExpenses: [
    { category: "Transport", note: "Courier and delivery boy", amount: [rs(300), rs(700)], weekday: 2, method: "cash" },
    { category: "Other", note: "Cleaning and stationery", amount: [rs(200), rs(450)], weekday: 6, method: "cash" },
  ],
  stock: { openingCoverDays: 21, reorderCoverDays: 7, orderCoverDays: 21 },
  suppliers: PHARMA_SUPPLIERS,
  catalogue: [
    // Popularity order (first = best seller). Rates are GST-exclusive, derived from the MRP; medicines are 5% since 22 Sep 2025.
    mrpMed("Paracetamol 650 mg (strip of 15)", "strip", 33.6, 5, 40, SP, "otc", "Paracetamol 650 mg", 15, KV, "A1", { qty: [1, 3], pack: 20 }),
    mrpMed("Cetirizine 10 mg (strip of 10)", "strip", 19, 5, 30, SP, "otc", "Cetirizine 10 mg", 10, NR, "A2", { qty: [1, 2] }),
    mrpMed("Metformin 500 mg (strip of 20)", "strip", 25, 5, 40, SP, "H", "Metformin 500 mg", 20, VL, "B1", { qty: [2, 4] }),
    mrpMed("Amlodipine 5 mg (strip of 15)", "strip", 22, 5, 40, SB, "H", "Amlodipine 5 mg", 15, CH, "B2", { qty: [2, 4] }),
    mrpMed("Vitamin C 500 mg (strip of 15)", "strip", 40, 5, 25, SB, "otc", "Ascorbic acid 500 mg", 15, KV, "C1", { qty: [1, 3] }),
    mrpMed("Pantoprazole 40 mg (strip of 15)", "strip", 89, 5, 30, SB, "H", "Pantoprazole 40 mg", 15, PL, "B3"),
    mrpMed("Telmisartan 40 mg (strip of 15)", "strip", 76, 5, 30, SB, "H", "Telmisartan 40 mg", 15, VL, "B4", { qty: [2, 3] }),
    mrpMed("Atorvastatin 10 mg (strip of 15)", "strip", 82, 5, 25, SP, "H", "Atorvastatin 10 mg", 15, CH, "B5", { qty: [1, 3] }),
    mrpMed("ORS powder sachet", "pcs", 19, 5, 50, SB, "otc", "Oral rehydration salts", 1, AF, "A3", { qty: [2, 5], pack: 50 }),
    mrpMed("Cough syrup 100 ml", "btl", 121, 5, 20, SP, "otc", "Dextromethorphan + Chlorpheniramine", 1, NR, "A4"),
    mrpMed("Azithromycin 500 mg (strip of 3)", "strip", 125.5, 5, 20, SP, "H1", "Azithromycin 500 mg", 3, KV, "H1-1", { qty: [1, 1] }),
    mrpMed("Omeprazole 20 mg (strip of 10)", "strip", 34, 5, 30, SB, "H", "Omeprazole 20 mg", 10, PL, "B3"),
    mrpMed("Diclofenac gel 30 g", "tube", 65, 5, 20, SB, "otc", "Diclofenac diethylamine 1.16%", 1, AF, "D1"),
    mrpMed("Amoxicillin + Clavulanate 625 (strip of 10)", "strip", 176, 5, 20, SP, "H", "Amoxicillin 500 mg + Clavulanic acid 125 mg", 10, KV, "H-1", { qty: [1, 2] }),
    mrpMed("Calcium + D3 (strip of 15)", "strip", 88, 5, 25, SB, "otc", "Calcium 500 mg + Vitamin D3", 15, VL, "C2"),
    mrpMed("Multivitamin capsules (strip of 10)", "strip", 65, 5, 25, SB, "otc", "Multivitamin + minerals", 10, CH, "C3"),
    mrpMed("Antacid gel 170 ml", "btl", 103, 5, 20, SB, "otc", "Magnesium + Aluminium hydroxide", 1, NR, "A5"),
    mrpMed("Povidone iodine 100 ml", "btl", 71, 5, 15, SB, "otc", "Povidone iodine 5%", 1, AF, "D2"),
    mrpMed("Cefixime 200 mg (strip of 10)", "strip", 103, 5, 15, SP, "H1", "Cefixime 200 mg", 10, PL, "H1-1", { qty: [1, 1] }),
    mrpMed("Levothyroxine 50 mcg (strip of 100)", "strip", 103, 5, 20, SP, "H", "Levothyroxine 50 mcg", 100, VL, "B6"),
    mrpMed("Paracetamol 650 mg - Nilgiri (strip of 15)", "strip", 31, 5, 20, SP, "otc", "Paracetamol 650 mg", 15, NR, "A1", { qty: [1, 2], pack: 20 }),
    mrpMed("Metformin 500 mg - Cauvery (strip of 20)", "strip", 23, 5, 20, SB, "H", "Metformin 500 mg", 20, CH, "B1", { qty: [1, 3] }),
    mrpMed("Glimepiride 2 mg (strip of 15)", "strip", 96, 5, 25, SP, "H", "Glimepiride 2 mg", 15, VL, "B1", { qty: [1, 3] }),
    mrpMed("Losartan 50 mg (strip of 15)", "strip", 58, 5, 25, SB, "H", "Losartan potassium 50 mg", 15, KV, "B4", { qty: [1, 3] }),
    mrpMed("Atenolol 50 mg (strip of 14)", "strip", 28, 5, 20, SB, "H", "Atenolol 50 mg", 14, NR, "B2", { qty: [1, 3] }),
    mrpMed("Rosuvastatin 10 mg (strip of 15)", "strip", 135, 5, 20, SP, "H", "Rosuvastatin 10 mg", 15, CH, "B5", { qty: [1, 2] }),
    mrpMed("Clopidogrel 75 mg (strip of 15)", "strip", 92, 5, 20, SP, "H", "Clopidogrel 75 mg", 15, PL, "B5", { qty: [1, 2] }),
    mrpMed("Aspirin 75 mg (strip of 14)", "strip", 8, 5, 20, SB, "otc", "Aspirin 75 mg", 14, AF, "B5", { qty: [1, 3] }),
    mrpMed("Ibuprofen 400 mg (strip of 15)", "strip", 32, 5, 25, SB, "otc", "Ibuprofen 400 mg", 15, KV, "A1", { qty: [1, 2] }),
    mrpMed("Diclofenac 50 mg (strip of 10)", "strip", 24, 5, 20, SB, "H", "Diclofenac sodium 50 mg", 10, NR, "D1"),
    mrpMed("Aceclofenac + Paracetamol (strip of 10)", "strip", 74, 5, 25, SP, "H", "Aceclofenac 100 mg + Paracetamol 325 mg", 10, VL, "D1", { qty: [1, 2] }),
    mrpMed("Famotidine 20 mg (strip of 10)", "strip", 26, 5, 20, SB, "H", "Famotidine 20 mg", 10, CH, "B3"),
    mrpMed("Domperidone 10 mg (strip of 10)", "strip", 31, 5, 25, SB, "H", "Domperidone 10 mg", 10, PL, "B3"),
    mrpMed("Ondansetron 4 mg (strip of 10)", "strip", 38, 5, 20, SP, "H", "Ondansetron 4 mg", 10, KV, "B3"),
    mrpMed("Levocetirizine 5 mg (strip of 10)", "strip", 62, 5, 25, SB, "H", "Levocetirizine 5 mg", 10, NR, "A2", { qty: [1, 2] }),
    mrpMed("Montelukast + Levocetirizine (strip of 10)", "strip", 118, 5, 20, SP, "H", "Montelukast 10 mg + Levocetirizine 5 mg", 10, VL, "A2", { qty: [1, 2] }),
    mrpMed("Cetirizine 10 mg - Cauvery (strip of 10)", "strip", 17, 5, 15, SB, "otc", "Cetirizine 10 mg", 10, CH, "A2"),
    mrpMed("Azithromycin 250 mg (strip of 6)", "strip", 98, 5, 15, SP, "H1", "Azithromycin 250 mg", 6, PL, "H1-1", { qty: [1, 1] }),
    mrpMed("Levofloxacin 500 mg (strip of 5)", "strip", 78, 5, 12, SP, "H1", "Levofloxacin 500 mg", 5, KV, "H1-1", { qty: [1, 1] }),
    mrpMed("Cefpodoxime 200 mg (strip of 10)", "strip", 154, 5, 12, SP, "H1", "Cefpodoxime proxetil 200 mg", 10, NR, "H1-1", { qty: [1, 1] }),
    mrpMed("Amoxicillin 500 mg (strip of 10)", "strip", 68, 5, 20, SP, "H", "Amoxicillin 500 mg", 10, VL, "H-1", { qty: [1, 2] }),
    mrpMed("Doxycycline 100 mg (strip of 10)", "strip", 82, 5, 15, SP, "H", "Doxycycline 100 mg", 10, CH, "H-1"),
    mrpMed("Ciprofloxacin 500 mg (strip of 10)", "strip", 61, 5, 15, SP, "H", "Ciprofloxacin 500 mg", 10, PL, "H-1"),
    mrpMed("Metronidazole 400 mg (strip of 15)", "strip", 21, 5, 20, SB, "H", "Metronidazole 400 mg", 15, KV, "H-1"),
    mrpMed("Alprazolam 0.25 mg (strip of 15)", "strip", 30, 5, 10, SP, "H1", "Alprazolam 0.25 mg", 15, NR, "H1-2", { qty: [1, 1] }),
    mrpMed("Clonazepam 0.5 mg (strip of 10)", "strip", 36, 5, 10, SP, "H1", "Clonazepam 0.5 mg", 10, VL, "H1-2", { qty: [1, 1] }),
    mrpMed("Tramadol 50 mg (strip of 10)", "strip", 49, 5, 10, SP, "H1", "Tramadol 50 mg", 10, CH, "H1-2", { qty: [1, 1] }),
    mrpMed("Pregabalin 75 mg (strip of 10)", "strip", 118, 5, 10, SP, "H1", "Pregabalin 75 mg", 10, PL, "H1-2", { qty: [1, 1] }),
    mrpMed("Prednisolone 10 mg (strip of 10)", "strip", 28, 5, 12, SP, "H", "Prednisolone 10 mg", 10, KV, "H-2"),
    mrpMed("Folic acid 5 mg (strip of 20)", "strip", 14, 5, 20, SB, "H", "Folic acid 5 mg", 20, NR, "C1"),
    mrpMed("Iron + Folic acid (strip of 15)", "strip", 54, 5, 25, SB, "otc", "Ferrous ascorbate + Folic acid", 15, VL, "C1", { qty: [1, 2] }),
    mrpMed("Vitamin B-complex (strip of 15)", "strip", 36, 5, 25, SB, "otc", "Vitamin B complex + Vitamin C", 15, CH, "C3"),
    mrpMed("Vitamin D3 60000 IU (sachet of 4)", "pack", 118, 5, 20, SB, "otc", "Cholecalciferol 60000 IU", 4, PL, "C2"),
    mrpMed("Zinc 50 mg (strip of 15)", "strip", 62, 5, 15, SB, "otc", "Zinc sulphate 50 mg", 15, KV, "C3"),
    mrpMed("Insulin glargine pen", "pcs", 640, 5, 6, CS, "H", "Insulin glargine 100 IU/ml", 1, VL, "FRIDGE", { qty: [1, 1], pack: 5 }),
    mrpMed("Salbutamol inhaler", "pcs", 135, 5, 10, SP, "H", "Salbutamol 100 mcg", 1, NR, "E1", { qty: [1, 1], pack: 5 }),
    mrpMed("Budesonide + Formoterol inhaler", "pcs", 385, 5, 6, CS, "H", "Budesonide 200 mcg + Formoterol 6 mcg", 1, CH, "E1", { qty: [1, 1], pack: 4 }),
    mrpMed("Eye drops 10 ml", "btl", 76, 5, 15, SB, "H", "Moxifloxacin 0.5%", 1, AF, "E2"),
    mrpMed("Lubricant eye drops 10 ml", "btl", 118, 5, 12, SB, "otc", "Carboxymethylcellulose 0.5%", 1, PL, "E2"),
    mrpMed("Cough lozenges (strip of 8)", "strip", 40, 5, 25, SB, "otc", "Menthol + Eucalyptus lozenge", 8, AF, "A4", { qty: [1, 3] }),
    mrpMed("Cold and flu tablets (strip of 10)", "strip", 44, 5, 25, SB, "otc", "Paracetamol + Phenylephrine + Chlorpheniramine", 10, NR, "A4", { qty: [1, 2] }),
    mrpMed("Pain relief spray 55 g", "can", 175, 5, 10, SB, "otc", "Diclofenac + Menthol topical spray", 1, VL, "D1", { qty: [1, 1], pack: 6 }),
    mrpMed("Burn and antiseptic cream 20 g", "tube", 58, 5, 15, SB, "otc", "Silver sulphadiazine 1%", 1, CH, "D2"),
    mrpMed("Antifungal cream 15 g", "tube", 96, 5, 12, SB, "H", "Clotrimazole 1% + Beclomethasone", 1, KV, "D2"),
    mrpMed("Cotton roll 100 g", "pcs", 62, 5, 15, CS, "otc", "Absorbent cotton wool", 1, AF, "F1", { hsn: "3005" }),
    mrpMed("Crepe bandage 6 inch", "pcs", 50, 5, 12, CS, "otc", "Elastic crepe bandage", 1, AF, "F1", { hsn: "3005" }),
    mrpMed("Adhesive bandage (box of 100)", "box", 95, 5, 12, CS, "otc", "Adhesive wound strips", 100, AF, "F1", { hsn: "3005", qty: [1, 1] }),
    mrpMed("Digital thermometer", "pcs", 255, 5, 6, CS, "otc", "Digital thermometer", 1, AF, "G1", { hsn: "9025", qty: [1, 1], pack: 5 }),
    mrpMed("Glucometer strips (50)", "box", 680, 5, 8, CS, "otc", "Blood glucose test strips", 50, AF, "G1", { hsn: "3822", qty: [1, 1], pack: 5 }),
    mrpMed("BP monitor", "pcs", 1590, 5, 3, CS, "otc", "Digital BP monitor", 1, AF, "G1", { hsn: "9018", qty: [1, 1], pack: 3 }),
    mrpMed("Pulse oximeter", "pcs", 1250, 5, 3, CS, "otc", "Fingertip pulse oximeter", 1, AF, "G1", { hsn: "9018", qty: [1, 1], pack: 3 }),
    mrpMed("Face masks (box of 50)", "box", 165, 5, 10, CS, "otc", "3-ply surgical masks", 50, AF, "F2", { hsn: "6307", qty: [1, 1], pack: 5 }),
    mrpMed("Hand sanitizer 200 ml", "btl", 92, 18, 15, CS, "otc", "Isopropyl alcohol 70%", 1, AF, "F2", { hsn: "3808" }),
    mrpMed("Baby diapers (pack of 20)", "pack", 310, 5, 10, CS, "otc", "Baby diapers", 20, AF, "F3", { hsn: "9619", qty: [1, 1], pack: 6 }),
    mrpMed("Protein powder 200 g", "jar", 520, 18, 6, CS, "otc", "Whey protein supplement", 1, VL, "C4", { hsn: "2106", qty: [1, 1], pack: 4 }),
    mrpMed("Glucose powder 500 g", "pack", 140, 18, 8, CS, "otc", "Glucose powder", 1, CH, "C4", { hsn: "1702", qty: [1, 1], pack: 6 }),
    mrpMed("Toothpaste 100 g", "pcs", 68, 5, 12, CS, "otc", "Fluoride toothpaste", 1, PL, "F4", { hsn: "3306", qty: [1, 2], pack: 12 }),
    // Added with the Thunai Pharmacy demo store (demo-stores/thunai.ts): home-check devices, siddha / ayurveda, baby and personal care.
    mrpMed("Glucometer with 10 strips", "pcs", 899, 5, 4, CS, "otc", "Blood glucose monitor with test strips", 1, AF, "G1", { hsn: "9027", qty: [1, 1], pack: 3 }),
    mrpMed("Voice glucometer kit (25 strips)", "pcs", 1490, 5, 3, CS, "otc", "Talking blood glucose monitor with test strips", 1, AF, "G1", { hsn: "9027", qty: [1, 1], pack: 3 }),
    mrpMed("Wrist BP monitor", "pcs", 1290, 5, 3, CS, "otc", "Wrist digital blood pressure monitor", 1, AF, "G1", { hsn: "9018", qty: [1, 1], pack: 3 }),
    mrpMed("BP monitor with memory (arm)", "pcs", 1990, 5, 3, CS, "otc", "Upper-arm digital blood pressure monitor, 2 x 60 memory", 1, AF, "G1", { hsn: "9018", qty: [1, 1], pack: 3 }),
    mrpMed("Nebuliser, compressor type", "pcs", 1850, 5, 2, CS, "otc", "Compressor nebuliser with mask and mouthpiece", 1, AF, "E1", { hsn: "9018", qty: [1, 1], pack: 2 }),
    mrpMed("Nilavembu kudineer powder 100 g", "pack", 120, 5, 15, SB, "otc", "Andrographis paniculata and siddha herbs (kudineer)", 1, VL, "J1", { qty: [1, 2] }),
    mrpMed("Triphala churna 100 g", "pack", 140, 5, 12, SB, "otc", "Emblica officinalis, Terminalia chebula, Terminalia bellirica", 1, VL, "J1"),
    mrpMed("Ashwagandha capsules (bottle of 30)", "btl", 260, 5, 10, SB, "otc", "Withania somnifera root extract 300 mg", 30, CH, "J2"),
    mrpMed("Chyawanprash 500 g", "jar", 285, 5, 10, SB, "otc", "Ayurvedic herbal jam with amla", 1, CH, "J2"),
    mrpMed("Herbal pain relief oil 100 ml", "btl", 165, 5, 10, SB, "otc", "Herbal oil with camphor, wintergreen and nirgundi", 1, VL, "J3"),
    mrpMed("Sanitary napkins (pack of 15)", "pack", 99, 0, 12, CS, "otc", "Sanitary napkins, cotton-feel top sheet", 15, AF, "F3", { hsn: "9619", qty: [1, 2], pack: 12 }),
    mrpMed("Baby lotion 200 ml", "btl", 260, 18, 8, CS, "otc", "Mild baby moisturising lotion", 1, PL, "F3", { hsn: "3304", pack: 6 }),
    mrpMed("Feeding bottle 250 ml", "pcs", 210, 18, 6, CS, "otc", "BPA-free feeding bottle with slow-flow teat", 1, AF, "F3", { hsn: "3924", pack: 6 }),
    mrpMed("Anti-dandruff shampoo 180 ml", "btl", 185, 5, 8, CS, "otc", "Zinc pyrithione shampoo", 1, PL, "F4", { hsn: "3305", pack: 6 }),
  ],
};

// ------------------------------------------------------------------ jewellery

const jewellery: Profile = {
  id: "jewellery",
  label: "Jewellery",
  businessTypes: ["jewellery", "jeweller", "gold"],
  hook: "jewellery",
  billsByWeekday: [9, 4, 4, 4, 5, 6, 10],
  closedWeekdays: [],
  salaryWeekBoost: 1.1,
  festivalAffinity: { major: 1.2, worship: 0.6, gold: 1.4, minor: 0.5 },
  hours: {
    open: 10 * 60,
    close: 20 * 60 + 30,
    peaks: [
      { at: 12 * 60, spread: 70, weight: 1.2 },
      { at: 17 * 60 + 30, spread: 90, weight: 2 },
    ],
  },
  basket: { items: 1.3, maxLines: 3 },
  pareto: 1,
  payments: { cash: 0.22, upi: 0.28, card: 0.5 },
  customers: { b2bShare: 0.08, count: 45, namedShare: 0.8, creditShare: 0.12, creditLimit: [rs(50000), rs(300000)], onCredit: 0.45, repayChance: 0.04 },
  returnRate: 0,
  registers: ["Showroom counter"],
  tillFloat: [rs(5000), rs(10000)],
  staff: [
    { role: "Manager", count: 1, salary: rs(35000) },
    { role: "Salesman", count: 3, salary: rs(18000) },
    { role: "Cashier", count: 1, salary: rs(16000) },
  ],
  monthlyExpenses: [
    { category: "Rent", note: "Showroom rent", amount: rs(85000), day: 1, jitter: 0, method: "bank", vendor: "Mr. S. Ramanathan (landlord)" },
    { category: "Electricity", note: "TNEB bill", amount: rs(18500), day: 9, jitter: 0.15, method: "upi", vendor: "TANGEDCO" },
    { category: "Marketing", note: "Newspaper and hoarding ads", amount: rs(12000), day: 14, jitter: 0.5, method: "bank" },
    { category: "Other", note: "Security and insurance", amount: rs(9000), day: 20, jitter: 0.1, method: "bank" },
  ],
  weeklyExpenses: [{ category: "Other", note: "Tea, cleaning and polish", amount: [rs(500), rs(1200)], weekday: 6, method: "cash" }],
  stock: { openingCoverDays: 0, reorderCoverDays: 0, orderCoverDays: 0 },
  suppliers: [{ name: "Sowcarpet Bullion Traders", creditDays: 7 }],
  catalogue: [],
};

// ------------------------------------------------------------------ textiles, hardware, services (simple)

const TEXTILE_SUPPLIERS: Supplier[] = [
  { name: "Kanchipuram Silk Weavers Society", creditDays: 30 },
  { name: "Erode Textile Market", creditDays: 21 },
  { name: "Tiruppur Knitwear Garments Hub", creditDays: 15 },
  { name: "Salem Handloom Weavers Cooperative", creditDays: 30 },
  { name: "Surat Fabrics Wholesale", creditDays: 21 },
];
const KS = "Kanchipuram Silk Weavers Society";
const ET = "Erode Textile Market";
const TK = "Tiruppur Knitwear Garments Hub";
const SH = "Salem Handloom Weavers Cooperative";
const SF = "Surat Fabrics Wholesale";

/** EAN-13 for a demo item: Indian prefix 890, nine digits from the name, check digit. */
function ean13(name: string): string {
  let h = 2166136261;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const body = "890" + String(h % 1_000_000_000).padStart(9, "0");
  const sum = [...body].reduce((t, d, i) => t + Number(d) * (i % 2 ? 3 : 1), 0);
  return body + String((10 - (sum % 10)) % 10);
}
/**
 * A textile catalogue entry with a barcode. Chapters 61-63 (apparel, made-up articles) are taxed by price band: 5% up
 * to Rs 2,500 taxable per piece, 18% above (Notification 9/2025-CT(R)); fabric, yarn and sarees (Ch. 50-59) stay at 5%.
 */
const tx = (name: string, hsn: string, unit: string, rupees: number, cost: number, reorder: number, supplier: string, extra: Extra = {}): CatalogueEntry => {
  const band = /^6[123]/.test(hsn);
  const gst = band ? (rs(rupees) <= 250_000 ? 5 : 18) : 5;
  return e(name, hsn, unit, rupees, gst, cost, reorder, supplier, { ...(band ? { band } : {}), barcode: ean13(name), ...extra });
};
const textiles: Profile = {
  id: "textiles",
  label: "Textiles / readymades",
  businessTypes: ["fashion", "textiles", "clothing", "garments"],
  hook: "none",
  billsByWeekday: [44, 16, 15, 16, 18, 24, 42],
  closedWeekdays: [],
  salaryWeekBoost: 1.12,
  festivalAffinity: { major: 1.3, worship: 0.7, gold: 0.3, minor: 0.5 },
  hours: { open: 10 * 60, close: 21 * 60 + 30, peaks: [{ at: 12 * 60, spread: 80, weight: 1 }, { at: 18 * 60 + 30, spread: 90, weight: 2.4 }] },
  basket: { items: 2.2, maxLines: 6 },
  pareto: 1.1,
  payments: { cash: 0.35, upi: 0.4, card: 0.25 },
  customers: { b2bShare: 0.12, count: 70, namedShare: 0.5, creditShare: 0.14, creditLimit: [rs(8000), rs(60000)], onCredit: 0.6, repayChance: 0.05, businessNames: { a: ["Sri Murugan", "Annai", "Kaveri", "Thendral", "Pandian", "Lakshmi", "Sri Balaji", "Meenakshi", "Arasan", "Bharathi"], b: ["Tailors", "Readymades", "Textiles", "Garments", "Fashions", "Silk House", "Boutique", "Cloth Stores"] } },
  returnRate: 0.03,
  registers: ["Counter A", "Counter B"],
  tillFloat: [rs(2000), rs(5000)],
  staff: [
    { role: "Manager", count: 1, salary: rs(30000) },
    { role: "Salesman", count: 3, salary: rs(15000) },
    { role: "Cashier", count: 1, salary: rs(14000) },
  ],
  monthlyExpenses: [
    { category: "Rent", note: "Shop rent", amount: rs(65000), day: 1, jitter: 0, method: "bank", vendor: "Mr. T. Gopalakrishnan (landlord)" },
    { category: "Electricity", note: "TNEB bill", amount: rs(14500), day: 10, jitter: 0.2, method: "upi", vendor: "TANGEDCO" },
    { category: "Packaging", note: "Carry bags and boxes", amount: rs(3800), day: 8, jitter: 0.3, method: "upi" },
    { category: "Marketing", note: "Social media and hoarding", amount: rs(8000), day: 15, jitter: 0.5, method: "bank" },
  ],
  weeklyExpenses: [{ category: "Transport", note: "Parcel and lorry charges", amount: [rs(600), rs(1800)], weekday: 3, method: "cash" }],
  stock: { openingCoverDays: 30, reorderCoverDays: 10, orderCoverDays: 30 },
  suppliers: TEXTILE_SUPPLIERS,
  catalogue: [
    // Sarees, fabrics and made-ups (Ch. 50-59: 5%); apparel and made-up articles (Ch. 61-63) by price band
    tx("Cotton saree", "5208", "pcs", 850, 0.72, 25, ET, { qty: [1, 2], pack: 20 }),
    tx("Readymade shirt", "6205", "pcs", 1499, 0.7, 20, TK, { qty: [1, 3], pack: 12 }),
    tx("Cotton shirting fabric", "5208", "m", 120.5, 0.75, 120, ET, { loose: true, qty: [2, 5], pack: 100 }),
    tx("Lungi", "6211", "pcs", 320, 0.74, 30, SH, { qty: [1, 3], pack: 24 }),
    tx("Dhoti with border", "5208", "pcs", 540, 0.74, 25, SH, { qty: [1, 2], pack: 20 }),
    tx("Sungudi cotton saree", "5208", "pcs", 950, 0.72, 20, SH, { qty: [1, 2], pack: 12 }),
    tx("Silk saree", "5007", "pcs", 6500, 0.78, 8, KS, { qty: [1, 1], pack: 6 }),
    tx("Towel", "6302", "pcs", 220, 0.7, 40, TK, { qty: [1, 3], pack: 24 }),
    tx("Kurti (cotton)", "6204", "pcs", 799, 0.7, 25, TK, { qty: [1, 2], pack: 15 }),
    tx("Kids frock", "6104", "pcs", 699, 0.7, 15, TK, { qty: [1, 2], pack: 12 }),
    tx("Churidar material set", "5208", "pcs", 990, 0.72, 20, ET, { qty: [1, 2], pack: 12 }),
    tx("Bedsheet double", "6302", "pcs", 780, 0.72, 15, ET, { qty: [1, 2], pack: 12 }),
    tx("Innerwear pack", "6107", "pack", 390, 0.68, 30, TK, { qty: [1, 2], pack: 24 }),
    tx("Polycot saree", "5513", "pcs", 780, 0.72, 20, SF, { qty: [1, 2], pack: 20 }),
    tx("Art silk saree", "5407", "pcs", 1200, 0.74, 15, SF, { qty: [1, 2], pack: 12 }),
    tx("Georgette saree", "5407", "pcs", 1650, 0.74, 12, SF, { qty: [1, 2], pack: 10 }),
    tx("Veshti (Madurai cotton)", "5208", "pcs", 460, 0.74, 30, SH, { qty: [1, 3], pack: 24 }),
    tx("Nighty (cotton)", "6208", "pcs", 450, 0.7, 25, TK, { qty: [1, 3], pack: 18 }),
    tx("T-shirt (men)", "6109", "pcs", 450, 0.68, 25, TK, { qty: [1, 3], pack: 24 }),
    tx("Bath towel large", "6302", "pcs", 450, 0.7, 20, TK, { qty: [1, 2], pack: 12 }),
    tx("Suiting fabric (poly-viscose)", "5515", "m", 380, 0.75, 80, SF, { loose: true, qty: [2, 4], pack: 60 }),
    tx("Kora cotton saree", "5208", "pcs", 1250, 0.74, 12, SH, { qty: [1, 2], pack: 10 }),
    tx("Soft silk saree", "5007", "pcs", 3400, 0.78, 8, KS, { qty: [1, 2], pack: 6 }),
    tx("Bedsheet single", "6302", "pcs", 520, 0.72, 15, ET, { qty: [1, 2], pack: 12 }),
    tx("Silk blouse piece", "5007", "pcs", 420, 0.74, 25, KS, { qty: [1, 3], pack: 24 }),
    tx("Pattu pavadai set", "6104", "pcs", 1850, 0.72, 8, KS, { qty: [1, 1], pack: 6 }),
    tx("Churidar readymade set", "6204", "pcs", 1350, 0.72, 12, TK, { qty: [1, 2], pack: 12 }),
    tx("Handkerchief (dozen)", "6213", "pack", 240, 0.7, 20, TK, { qty: [1, 2], pack: 24 }),
    tx("Dupatta (cotton)", "6214", "pcs", 350, 0.72, 20, SF, { qty: [1, 3], pack: 24 }),
    tx("Kanchipuram silk saree", "5007", "pcs", 14500, 0.8, 4, KS, { qty: [1, 1], pack: 3 }),
    tx("Pattu veshti with angavastram", "5007", "pcs", 4200, 0.78, 5, KS, { qty: [1, 1], pack: 4 }),
    tx("Formal shirt (branded)", "6205", "pcs", 2400, 0.7, 8, TK, { qty: [1, 2], pack: 12 }),
    tx("Party wear shirt", "6205", "pcs", 3200, 0.72, 5, TK, { qty: [1, 1], pack: 6 }),
    tx("Jeans (men)", "6203", "pcs", 1299, 0.68, 12, TK, { qty: [1, 2], pack: 12 }),
    tx("Track pant", "6103", "pcs", 599, 0.68, 15, TK, { qty: [1, 2], pack: 18 }),
    tx("Boys shorts and t-shirt set", "6209", "pcs", 540, 0.7, 12, TK, { qty: [1, 2], pack: 12 }),
    tx("Readymade blouse", "6206", "pcs", 650, 0.72, 12, TK, { qty: [1, 3], pack: 12 }),
    tx("Salwar suit (designer)", "6204", "pcs", 3200, 0.74, 5, SF, { qty: [1, 1], pack: 6 }),
    tx("Girls lehenga", "6204", "pcs", 3800, 0.74, 4, SF, { qty: [1, 1], pack: 4 }),
    tx("Bridal lehenga", "6204", "pcs", 7500, 0.78, 3, SF, { qty: [1, 1], pack: 2 }),
    tx("Wedding sherwani", "6203", "pcs", 6500, 0.78, 3, SF, { qty: [1, 1], pack: 2 }),
    tx("Mens suit set (3 pc)", "6203", "pcs", 4800, 0.76, 3, SF, { qty: [1, 1], pack: 3 }),
    tx("Bridal Banarasi saree", "5007", "pcs", 18500, 0.8, 3, KS, { qty: [1, 1], pack: 2 }),
    tx("Linen shirting fabric", "5309", "m", 520, 0.75, 60, SF, { loose: true, qty: [2, 4], pack: 50 }),
    tx("Cotton voile fabric", "5208", "m", 95, 0.75, 120, ET, { loose: true, qty: [2, 6], pack: 100 }),
    tx("Georgette fabric", "5407", "m", 160, 0.75, 100, SF, { loose: true, qty: [2, 5], pack: 80 }),
    tx("Khadi cloth", "5208", "m", 140, 0.75, 80, SH, { loose: true, qty: [2, 5], pack: 60 }),
    tx("Lining cloth", "5407", "m", 55, 0.72, 150, SF, { loose: true, qty: [2, 6], pack: 100 }),
    tx("Chudidar top material (poly crepe)", "5407", "pcs", 640, 0.74, 15, SF, { qty: [1, 2], pack: 12 }),
    tx("Curtain cloth set (2 pc)", "6303", "pcs", 1450, 0.72, 8, ET, { qty: [1, 2], pack: 8 }),
    tx("Woollen blanket", "6301", "pcs", 3200, 0.74, 5, SF, { qty: [1, 1], pack: 6 }),
    tx("Double bed quilt cover", "6304", "pcs", 2100, 0.72, 6, ET, { qty: [1, 1], pack: 6 }),
    tx("Pillow cover set (5 pc)", "6302", "pack", 320, 0.7, 15, ET, { qty: [1, 2], pack: 12 }),
    tx("Floor mat (cotton)", "5702", "pcs", 380, 0.72, 12, SH, { qty: [1, 2], pack: 12 }),
  ],
};

const HW_SUPPLIERS: Supplier[] = [
  { name: "Sri Ganapathy Hardware Traders", creditDays: 21 },
  { name: "Tuticorin Steel and Cement Depot", creditDays: 10 },
];
const GH = "Sri Ganapathy Hardware Traders";
const TS = "Tuticorin Steel and Cement Depot";
const hardware: Profile = {
  id: "hardware",
  label: "Hardware / paints / electricals",
  businessTypes: ["hardware", "paints", "electricals", "building"],
  hook: "none",
  billsByWeekday: [22, 40, 38, 38, 38, 40, 46],
  closedWeekdays: [],
  salaryWeekBoost: 1.05,
  festivalAffinity: { major: 0.8, worship: 1.2, gold: 0, minor: 0.3 },
  hours: { open: 8 * 60 + 30, close: 20 * 60 + 30, peaks: [{ at: 10 * 60 + 30, spread: 70, weight: 2 }, { at: 17 * 60, spread: 80, weight: 1.6 }] },
  basket: { items: 2.6, maxLines: 8 },
  pareto: 1.15,
  payments: { cash: 0.5, upi: 0.33, card: 0.17 },
  customers: { b2bShare: 0.25, count: 55, namedShare: 0.5, creditShare: 0.3, creditLimit: [rs(10000), rs(60000)], onCredit: 0.65, repayChance: 0.05 },
  returnRate: 0.015,
  registers: ["Billing counter"],
  tillFloat: [rs(2000), rs(5000)],
  staff: [
    { role: "Manager", count: 1, salary: rs(24000) },
    { role: "Salesman", count: 2, salary: rs(15000) },
    { role: "Helper", count: 1, salary: rs(11000) },
  ],
  monthlyExpenses: [
    { category: "Rent", note: "Shop and godown rent", amount: rs(32000), day: 2, jitter: 0, method: "bank", vendor: "Mr. M. Karuppasamy (landlord)" },
    { category: "Electricity", note: "TNEB bill", amount: rs(5200), day: 11, jitter: 0.2, method: "upi", vendor: "TANGEDCO" },
    { category: "Transport", note: "Lorry unloading and goods auto", amount: rs(6500), day: 17, jitter: 0.4, method: "cash" },
  ],
  weeklyExpenses: [{ category: "Other", note: "Tea and cleaning", amount: [rs(250), rs(550)], weekday: 6, method: "cash" }],
  stock: { openingCoverDays: 21, reorderCoverDays: 7, orderCoverDays: 21 },
  suppliers: HW_SUPPLIERS,
  catalogue: [
    e("Cement bag 50 kg", "2523", "bag", 330, 28, 0.9, 80, TS, { qty: [2, 20], pack: 100 }),
    e("TMT steel bar 12 mm", "7214", "kg", 62, 18, 0.92, 600, TS, { qty: [20, 150], pack: 1000 }),
    e("Emulsion paint 20 L", "3209", "pcs", 4200, 18, 0.8, 8, GH, { qty: [1, 2], pack: 6 }),
    e("Wall putty 20 kg", "3214", "bag", 780, 18, 0.82, 15, GH, { qty: [1, 4], pack: 10 }),
    e("PVC pipe 1 inch (3 m)", "3917", "pcs", 210, 18, 0.8, 40, GH, { qty: [2, 10], pack: 40 }),
    e("Switch and socket set", "8536", "pcs", 95, 18, 0.7, 60, GH, { qty: [2, 8], pack: 50 }),
    e("Copper wire 1.5 sqmm (90 m)", "8544", "coil", 1650, 18, 0.85, 12, GH, { qty: [1, 3], pack: 10 }),
    e("LED bulb 9 W", "8539", "pcs", 75, 12, 0.7, 80, GH, { qty: [2, 8], pack: 60 }),
    e("Door lock set", "8301", "pcs", 380, 18, 0.72, 20, GH, { qty: [1, 2], pack: 12 }),
    e("Paint brush 4 inch", "9603", "pcs", 85, 18, 0.7, 40, GH, { qty: [1, 4], pack: 24 }),
    e("Nails 2 inch", "7317", "kg", 85, 18, 0.82, 60, GH, { loose: true, qty: [1, 5], pack: 50 }),
    e("Water tank 1000 L", "3925", "pcs", 6200, 18, 0.86, 3, GH, { qty: [1, 1], pack: 3 }),
    e("Tap and fittings", "8481", "pcs", 160, 18, 0.72, 40, GH, { qty: [1, 4], pack: 24 }),
    e("Cutting disc and drill bits", "8207", "pcs", 140, 18, 0.74, 30, GH, { qty: [1, 4], pack: 24 }),
  ],
};

const services: Profile = {
  id: "services",
  label: "Services (salon, repair, gym)",
  businessTypes: ["salon", "gym", "services"],
  hook: "none",
  billsByWeekday: [26, 18, 16, 17, 18, 24, 34],
  closedWeekdays: [],
  salaryWeekBoost: 1.08,
  festivalAffinity: { major: 1.1, worship: 0.5, gold: 0.1, minor: 0.5 },
  hours: { open: 9 * 60 + 30, close: 20 * 60 + 30, peaks: [{ at: 11 * 60, spread: 70, weight: 1.4 }, { at: 17 * 60 + 30, spread: 80, weight: 2.2 }] },
  basket: { items: 1.5, maxLines: 4 },
  pareto: 1.05,
  payments: { cash: 0.3, upi: 0.55, card: 0.15 },
  customers: { b2bShare: 0.04, count: 50, namedShare: 0.6, creditShare: 0, creditLimit: [0, 0], onCredit: 0, repayChance: 0 },
  returnRate: 0.004,
  registers: ["Front desk"],
  tillFloat: [rs(1000), rs(3000)],
  staff: [
    { role: "Manager", count: 1, salary: rs(24000) },
    { role: "Salesman", count: 3, salary: rs(14000) },
  ],
  monthlyExpenses: [
    { category: "Rent", note: "Studio rent", amount: rs(30000), day: 3, jitter: 0, method: "bank", vendor: "Mr. A. Thangaraj (landlord)" },
    { category: "Electricity", note: "TNEB bill", amount: rs(7200), day: 12, jitter: 0.2, method: "upi", vendor: "TANGEDCO" },
    { category: "Other", note: "Consumables and products", amount: rs(9000), day: 7, jitter: 0.3, method: "upi" },
  ],
  weeklyExpenses: [{ category: "Other", note: "Tea and laundry", amount: [rs(300), rs(700)], weekday: 6, method: "cash" }],
  stock: { openingCoverDays: 0, reorderCoverDays: 0, orderCoverDays: 0 },
  suppliers: [],
  catalogue: [
    e("Haircut & styling", "999721", "service", 500, 18, 0.1, undefined, undefined, { qty: [1, 1] }),
    e("Hair spa (45 min)", "999721", "service", 1200, 18, 0.2, undefined, undefined, { qty: [1, 1] }),
    e("Facial (60 min)", "999722", "service", 1500, 18, 0.2, undefined, undefined, { qty: [1, 1] }),
    e("Threading and waxing", "999722", "service", 350, 18, 0.15, undefined, undefined, { qty: [1, 1] }),
    e("Bridal makeup", "999722", "service", 15000, 18, 0.25, undefined, undefined, { qty: [1, 1] }),
    e("Screen replacement (labour)", "998713", "service", 500, 18, 0.1, undefined, undefined, { qty: [1, 1] }),
    e("Battery replacement (labour)", "998713", "service", 300, 18, 0.1, undefined, undefined, { qty: [1, 1] }),
    e("Monthly membership", "999723", "month", 1500, 18, 0.1, undefined, undefined, { qty: [1, 1] }),
    e("Personal training session", "999723", "session", 800, 18, 0.1, undefined, undefined, { qty: [1, 4] }),
  ],
};


// ------------------------------------------------------------------ repair (job cards)

const RP_SUPPLIERS: Supplier[] = [
  { name: "Gandhipuram Mobile Parts Traders", creditDays: 10 },
  { name: "Sri Ganapathy Computer Spares", creditDays: 15 },
  { name: "Cool Point Appliance Spares", creditDays: 30 },
];
const GM = "Gandhipuram Mobile Parts Traders";
const SG = "Sri Ganapathy Computer Spares";
const CP = "Cool Point Appliance Spares";

/**
 * Repair shop on job cards (hook `jobcards`, hooks/jobcards.ts): each "bill" is a job delivered that day, opened up to
 * a few days earlier and moved through the statuses with its own dated timeline. The catalogue lists the items the
 * job recipes use (names are those of the QuickFix demo store: services at their inclusive-price rates as GST-exclusive
 * items, spare parts stock-tracked, serial parts left to the serials module).
 */
const repair: Profile = {
  id: "repair",
  label: "Repair shop (job cards)",
  businessTypes: ["repair"],
  hook: "jobcards",
  billsByWeekday: [3, 6, 6, 6, 6, 7, 8],
  closedWeekdays: [],
  salaryWeekBoost: 1.05,
  festivalAffinity: { major: 0.9, worship: 0.5, gold: 0, minor: 0.4 },
  hours: { open: 9 * 60 + 30, close: 20 * 60 + 30, peaks: [{ at: 11 * 60 + 30, spread: 70, weight: 1.3 }, { at: 18 * 60, spread: 80, weight: 2 }] },
  basket: { items: 1.8, maxLines: 3 },
  pareto: 1,
  payments: { cash: 0.25, upi: 0.6, card: 0.15 },
  customers: {
    count: 70,
    namedShare: 0.55,
    b2bShare: 0.12,
    creditShare: 0.25,
    businessNames: { a: ["Sri Balaji", "Annai", "Kovai", "Lakshmi", "Pandian", "Vetri", "Sakthi", "Aruna"], b: ["Computers", "Medicals", "Textiles", "Traders", "Hospital", "Printers", "Jewellers", "Enterprises"] },
    creditLimit: [rs(15000), rs(60000)],
    onCredit: 0.8,
    repayChance: 0.045,
  },
  returnRate: 0,
  registers: ["Front desk"],
  tillFloat: [rs(1500), rs(3000)],
  staff: [
    { role: "Manager", count: 1, salary: rs(32000) },
    { role: "Technician", count: 2, salary: rs(22000) },
    { role: "Cashier", count: 1, salary: rs(16000) },
  ],
  monthlyExpenses: [
    { category: "Rent", note: "Shop and bench rent", amount: rs(38000), day: 3, jitter: 0, method: "bank", vendor: "Mr. R. Palanisamy (landlord)" },
    { category: "Electricity", note: "TNEB bill", amount: rs(6800), day: 12, jitter: 0.2, method: "upi", vendor: "TANGEDCO" },
    { category: "Marketing", note: "Google and Instagram ads", amount: rs(9000), day: 5, jitter: 0.25, method: "upi" },
    { category: "Repairs", note: "Tools, flux, solder and consumables", amount: rs(7500), day: 9, jitter: 0.35, method: "upi" },
    { category: "Other", note: "Software licences and cloud backup", amount: rs(2400), day: 15, jitter: 0, method: "bank" },
  ],
  weeklyExpenses: [
    { category: "Transport", note: "Pickup rider fuel", amount: [rs(600), rs(1100)], weekday: 6, method: "cash" },
    { category: "Other", note: "Tea and cleaning", amount: [rs(250), rs(550)], weekday: 6, method: "cash" },
  ],
  stock: { openingCoverDays: 14, reorderCoverDays: 7, orderCoverDays: 21 },
  suppliers: RP_SUPPLIERS,
  catalogue: [
    // Spare parts (stock-tracked, restocked from suppliers)
    e("Phone display module, 6.1-inch OLED (compatible)", "85249200", "pcs", 1270, 18, 0.7, 6, GM, { qty: [1, 1], pack: 6 }),
    e("Phone battery, 4000 mAh (compatible)", "85076000", "pcs", 510, 18, 0.6, 12, GM, { qty: [1, 1], pack: 20 }),
    e("Phone battery, 5000 mAh (compatible)", "85076000", "pcs", 635, 18, 0.62, 10, GM, { qty: [1, 1], pack: 20 }),
    e("Phone charging port flex, USB-C", "85177990", "pcs", 296, 18, 0.55, 12, GM, { qty: [1, 1], pack: 20 }),
    e("Laptop charger, 65 W", "85044030", "pcs", 762, 18, 0.7, 5, SG, { qty: [1, 1], pack: 6 }),
    e("TV backlight LED strip set, 43-inch", "85299090", "set", 1101, 18, 0.7, 4, CP, { qty: [1, 1], pack: 5 }),
    e("AC fan capacitor, 35 µF", "8532", "pcs", 211, 18, 0.5, 15, CP, { qty: [1, 1], pack: 25 }),
    e("Washing machine drum bearing kit", "84509000", "set", 1016, 18, 0.68, 4, CP, { qty: [1, 1], pack: 5 }),
    // Serial parts (units come from the serials module: no reorder here)
    e("Laptop SSD 512 GB SATA", "85235100", "pcs", 2796, 18, 0.75, undefined, undefined, { qty: [1, 1] }),
    e("Laptop SSD 1 TB NVMe", "85235100", "pcs", 4660, 18, 0.75, undefined, undefined, { qty: [1, 1] }),
    e("Laptop RAM 8 GB DDR4 SODIMM", "84733099", "pcs", 1270, 18, 0.72, undefined, undefined, { qty: [1, 1] }),
    e("Laptop battery, compatible", "85076000", "pcs", 1609, 18, 0.74, undefined, undefined, { qty: [1, 1] }),
    // Labour and services (the recipes in hooks/jobcards.ts)
    e("Screen replacement (labour)", "998713", "service", 500, 18, 0.1, undefined, undefined, { qty: [1, 1] }),
    e("Battery replacement (labour)", "998713", "service", 300, 18, 0.1, undefined, undefined, { qty: [1, 1] }),
    e("Phone screen replacement, compatible panel – 6.2 to 6.5-inch", "998716", "service", 1948, 18, 0.55, undefined, undefined, { qty: [1, 1] }),
    e("Phone screen replacement, compatible panel – Up to 6.1-inch", "998716", "service", 1525, 18, 0.55, undefined, undefined, { qty: [1, 1] }),
    e("Phone screen replacement, compatible panel – 6.6-inch and above", "998716", "service", 2372, 18, 0.55, undefined, undefined, { qty: [1, 1] }),
    e("Phone screen replacement, original panel – 6.2 to 6.5-inch", "998716", "service", 3813, 18, 0.7, undefined, undefined, { qty: [1, 1] }),
    e("Charging port replacement – USB-C", "998716", "service", 635, 18, 0.2, undefined, undefined, { qty: [1, 1] }),
    e("Charging port replacement – Micro USB", "998716", "service", 508, 18, 0.2, undefined, undefined, { qty: [1, 1] }),
    e("Windows reinstall with drivers and Office – Laptop", "998713", "service", 508, 18, 0.1, undefined, undefined, { qty: [1, 1] }),
    e("Data backup and transfer – Laptop or desktop", "998713", "service", 423, 18, 0.1, undefined, undefined, { qty: [1, 1] }),
    e("Laptop overheating: fan clean and thermal paste", "998713", "service", 677, 18, 0.15, undefined, undefined, { qty: [1, 1] }),
    e("Express diagnosis in 2 hours", "998716", "service", 169, 18, 0.1, undefined, undefined, { qty: [1, 1] }),
    e("AC general service (split) – 1.5 ton", "998715", "service", 550, 18, 0.2, undefined, undefined, { qty: [1, 1] }),
    e("AC general service (split) – 1 ton", "998715", "service", 508, 18, 0.2, undefined, undefined, { qty: [1, 1] }),
    e("AC general service (split) – 2 ton", "998715", "service", 677, 18, 0.2, undefined, undefined, { qty: [1, 1] }),
    e("AC not cooling: home visit diagnosis", "998715", "service", 296, 18, 0.1, undefined, undefined, { qty: [1, 1] }),
  ],
};

export const PROFILES: Record<ProfileId, Profile> = { kirana, pharmacy, restaurant, jewellery, textiles, hardware, services, electronics: ELECTRONICS, repair, cloud_kitchen: cloudKitchen, tea_stall: teaStall, tailoring: TAILORING, spa };
export const PROFILE_IDS = Object.keys(PROFILES) as ProfileId[];

export function getProfile(id: string): Profile {
  const p = (PROFILES as Record<string, Profile | undefined>)[id];
  if (!p) throw new Error(`Unknown profile "${id}" (have: ${PROFILE_IDS.join(", ")})`);
  return p;
}

/** The profile that fits a shop's business type (starter pack), or null. */
export function profileForBusinessType(businessType: string | null | undefined): Profile | null {
  if (!businessType) return null;
  return PROFILE_IDS.map((id) => PROFILES[id]).find((p) => p.businessTypes.includes(businessType)) ?? null;
}

/** Share of line volume taken by the most popular 20% of items (Pareto check; items are in popularity order). */
export function popularityWeights(count: number, pareto: number): number[] {
  return Array.from({ length: count }, (_, i) => 1 / Math.pow(i + 1, pareto));
}
