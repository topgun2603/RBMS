/**
 * TDS / TCS rules for a small Indian business: the sections it commonly meets, their rates and thresholds, the higher
 * rate without a PAN, the quarter and the due dates. Pure functions; rates are basis points (100 = 1%), money paise.
 *
 * Source: Income-tax Act, 1961 as amended by the Finance (No. 2) Act, 2024 and the Finance Act, 2025 (thresholds from
 * 1 April 2025). From 1 April 2026 the Income-tax Act, 2025 replaces the 1961 Act and renumbers these provisions (TDS
 * moves to section 393 and its tables); the familiar 1961 section numbers are kept as labels because returns, challans
 * and accountants still use them. EVERY RATE AND THRESHOLD HERE IS AN ASSUMPTION TO BE CONFIRMED BY A CHARTERED
 * ACCOUNTANT; the owner can override any of them per shop. Salary (192), dividends, e-commerce (194-O), rent by
 * individuals (194-IB), 194-R / 194-S and non-resident sections are not covered.
 */

export type TdsBasis = "single_or_annual" | "annual" | "annual_excess" | "per_payment";

export interface TdsSectionDef {
  key: string;
  kind: "tds" | "tcs";
  /** The section as written on challans and returns. */
  section: string;
  label: string;
  /** Plain words for the owner. */
  plain: string;
  /** Rate for individuals and HUFs, basis points. */
  rate: number;
  /** Rate for companies, firms and others (defaults to `rate`). */
  rateOther?: number;
  /** Rate when the party has no valid PAN (section 206AA / 206CC). */
  noPanRate: number;
  /** One payment above this attracts tax (paise). */
  single?: number | null;
  /** Payments in the financial year above this attract tax (paise). */
  annual?: number | null;
  basis: TdsBasis;
  /** Only for buyers / sellers whose turnover was above Rs 10 crore last year (194Q, 206C(1H)). */
  needsTurnover10Cr?: boolean;
  /** Last date the provision applied (206C(1H) was omitted from 1 April 2025). */
  validUntil?: string;
  returnForm: "26Q" | "27EQ";
  /** Challan minor head / nature code shown in the quarterly file. */
  note?: string;
}

const L = 100_000 * 100; // Rs 1 lakh in paise
const R = 100; // Rs 1 in paise

/** The sections offered. Order = order on screen. */
export const TDS_SECTIONS: readonly TdsSectionDef[] = [
  {
    key: "194C",
    kind: "tds",
    section: "194C",
    label: "Contractors and job work",
    plain: "Payments to contractors: transport, printing, repairs and maintenance contracts, job work, catering, advertising.",
    rate: 100,
    rateOther: 200,
    noPanRate: 2000,
    single: 30_000 * R,
    annual: 1 * L,
    basis: "single_or_annual",
    returnForm: "26Q",
    note: "1% for individuals and HUFs, 2% for others. A transporter owning up to 10 goods carriages who gives a PAN and declaration is exempt (not checked here).",
  },
  {
    key: "194J-b",
    kind: "tds",
    section: "194J",
    label: "Professional fees",
    plain: "Fees to professionals: chartered accountant, lawyer, doctor, architect, consultant; royalty; director's fees.",
    rate: 1000,
    noPanRate: 2000,
    annual: 50_000 * R,
    basis: "annual",
    returnForm: "26Q",
    note: "Threshold Rs 50,000 a year from 1 April 2025 (Rs 30,000 before). Director's fees have no threshold (not handled).",
  },
  {
    key: "194J-a",
    kind: "tds",
    section: "194J",
    label: "Technical services",
    plain: "Fees for technical services (not professional), royalty for films, call-centre services.",
    rate: 200,
    noPanRate: 2000,
    annual: 50_000 * R,
    basis: "annual",
    returnForm: "26Q",
  },
  {
    key: "194H",
    kind: "tds",
    section: "194H",
    label: "Commission and brokerage",
    plain: "Commission or brokerage you pay to agents.",
    rate: 200,
    noPanRate: 2000,
    annual: 20_000 * R,
    basis: "annual",
    returnForm: "26Q",
    note: "2% from 1 October 2024 (5% before). Threshold Rs 20,000 a year from 1 April 2025 (Rs 15,000 before).",
  },
  {
    key: "194I-b",
    kind: "tds",
    section: "194I",
    label: "Rent of land, building or furniture",
    plain: "Rent for the shop, godown or office, or for furniture and fittings.",
    rate: 1000,
    noPanRate: 2000,
    single: 50_000 * R,
    basis: "per_payment",
    returnForm: "26Q",
    note: "From 1 April 2025 the threshold is Rs 50,000 for a month or part of a month (Rs 2,40,000 a year before). Here: a rent payment above Rs 50,000.",
  },
  {
    key: "194I-a",
    kind: "tds",
    section: "194I",
    label: "Rent of plant and machinery",
    plain: "Hire of machinery, equipment or vehicles (without operator).",
    rate: 200,
    noPanRate: 2000,
    single: 50_000 * R,
    basis: "per_payment",
    returnForm: "26Q",
  },
  {
    key: "194A",
    kind: "tds",
    section: "194A",
    label: "Interest (other than on securities)",
    plain: "Interest you pay on loans from people or firms (not banks).",
    rate: 1000,
    noPanRate: 2000,
    annual: 10_000 * R,
    basis: "annual",
    returnForm: "26Q",
    note: "Threshold Rs 10,000 a year from 1 April 2025 for payers other than banks (Rs 5,000 before).",
  },
  {
    key: "194Q",
    kind: "tds",
    section: "194Q",
    label: "Purchase of goods (above Rs 50 lakh)",
    plain: "Buying goods from one seller for more than Rs 50 lakh in a year, when your own turnover was above Rs 10 crore last year.",
    rate: 10,
    noPanRate: 500,
    annual: 50 * L,
    basis: "annual_excess",
    needsTurnover10Cr: true,
    returnForm: "26Q",
    note: "0.1% of the purchases above Rs 50 lakh from that seller in the year, on the value without GST (CBDT Circular 13/2021). 5% without a PAN.",
  },
  {
    key: "206C1H",
    kind: "tcs",
    section: "206C(1H)",
    label: "TCS on sale of goods (above Rs 50 lakh)",
    plain: "Collecting tax from a buyer who bought more than Rs 50 lakh in a year, when your turnover was above Rs 10 crore last year.",
    rate: 10,
    noPanRate: 100,
    annual: 50 * L,
    basis: "annual_excess",
    needsTurnover10Cr: true,
    validUntil: "2025-03-31",
    returnForm: "27EQ",
    note: "Omitted by the Finance Act, 2025 from 1 April 2025: switch it on only for older periods or if your CA says another TCS applies.",
  },
];

export const SECTION_BY_KEY: Readonly<Record<string, TdsSectionDef>> = Object.fromEntries(TDS_SECTIONS.map((s) => [s.key, s]));

/** Per-shop overrides of a section (rates in basis points, thresholds in paise). */
export interface SectionOverride {
  rate?: number | null;
  rateOther?: number | null;
  noPanRate?: number | null;
  single?: number | null;
  annual?: number | null;
  enabled?: boolean | null;
}

export function mergedSections(overrides: Record<string, SectionOverride | Record<string, unknown>> = {}): (TdsSectionDef & { enabled: boolean })[] {
  return TDS_SECTIONS.map((s) => {
    const o = (overrides[s.key] ?? {}) as SectionOverride;
    const pick = <K extends keyof SectionOverride>(k: K, d: number | null | undefined) => (typeof o[k] === "number" ? (o[k] as number) : d);
    return {
      ...s,
      rate: pick("rate", s.rate)!,
      rateOther: pick("rateOther", s.rateOther ?? s.rate)!,
      noPanRate: pick("noPanRate", s.noPanRate)!,
      single: pick("single", s.single ?? null),
      annual: pick("annual", s.annual ?? null),
      enabled: typeof o.enabled === "boolean" ? o.enabled : s.kind === "tds" && !s.needsTurnover10Cr,
    };
  });
}

// ------------------------------------------------------------------ PAN

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const isValidPan = (pan: string | null | undefined): pan is string => !!pan && PAN_RE.test(pan);
/** The PAN inside a GSTIN (characters 3 to 12). */
export const panFromGstin = (gstin: string | null | undefined): string | null => {
  const p = (gstin ?? "").toUpperCase().slice(2, 12);
  return isValidPan(p) ? p : null;
};
/** Deductee type from the 4th letter of the PAN: P person, H HUF, C company, F firm/LLP, others. */
export function deducteeTypeOfPan(pan: string | null | undefined): "individual" | "huf" | "company" | "firm" | "other" | null {
  if (!isValidPan(pan)) return null;
  switch (pan[3]) {
    case "P":
      return "individual";
    case "H":
      return "huf";
    case "C":
      return "company";
    case "F":
      return "firm";
    default:
      return "other";
  }
}

// ------------------------------------------------------------------ computing the tax

export interface TdsComputeInput {
  section: TdsSectionDef;
  /** individual / huf get `rate`, others `rateOther`. */
  deducteeType: string | null;
  pan: string | null;
  /** This payment or bill, paise (GST excluded when shown separately). */
  base: number;
  /** Payments or bills to this party under this section earlier in the same financial year (paise). */
  earlier: number;
  /** Earlier amounts this year on which no tax was deducted yet (catch-up once the yearly limit is crossed). */
  earlierUntaxed?: number;
  /** Section 197 certificate rate (basis points) valid on the date. */
  lowerRate?: number | null;
  date: string;
  /** The shop's turnover last year was above Rs 10 crore (194Q / 206C(1H)). */
  turnoverAbove10Cr?: boolean;
}

export interface TdsComputeResult {
  applies: boolean;
  /** Amount the tax is charged on (paise). */
  taxable: number;
  rate: number;
  /** Tax, rounded to the rupee (paise). */
  amount: number;
  noPan: boolean;
  /** Why (plain words). */
  reasons: string[];
}

/** Tax rounded to the nearest rupee, in paise. */
export const taxOf = (taxable: number, rate: number) => Math.round((taxable * rate) / 10_000 / 100) * 100;

export function computeTds(i: TdsComputeInput): TdsComputeResult {
  const s = i.section;
  const reasons: string[] = [];
  const noPan = !isValidPan(i.pan);
  const individual = i.deducteeType === "individual" || i.deducteeType === "huf";
  let rate = individual ? s.rate : (s.rateOther ?? s.rate);
  if (i.lowerRate !== null && i.lowerRate !== undefined) {
    rate = i.lowerRate;
    reasons.push("Lower deduction certificate (section 197) rate");
  }
  if (noPan) {
    rate = Math.max(rate, s.noPanRate);
    reasons.push(`No valid PAN: higher rate ${(s.noPanRate / 100).toFixed(2)}% (section ${s.kind === "tcs" ? "206CC" : "206AA"})`);
  }
  if (s.validUntil && i.date > s.validUntil) reasons.push(`Section ${s.section} does not apply after ${s.validUntil}`);
  if (s.needsTurnover10Cr && !i.turnoverAbove10Cr) {
    reasons.push("Applies only when your turnover last year was above Rs 10 crore");
    return { applies: false, taxable: 0, rate, amount: 0, noPan, reasons };
  }
  const after = i.earlier + i.base;
  let taxable = 0;
  switch (s.basis) {
    case "per_payment":
      if (s.single && i.base <= s.single) reasons.push(`Not above Rs ${rupees(s.single)} for one payment`);
      else taxable = i.base;
      break;
    case "single_or_annual": {
      const overSingle = !!s.single && i.base > s.single;
      const overAnnual = !!s.annual && after > s.annual;
      if (overSingle || overAnnual) {
        taxable = i.base;
        if (overAnnual && !overSingle && s.annual && i.earlier <= s.annual) {
          taxable += i.earlierUntaxed ?? 0;
          if (i.earlierUntaxed) reasons.push("Yearly limit crossed now: earlier payments this year are taxed too");
        }
        reasons.push(overSingle ? `Above Rs ${rupees(s.single!)} for one payment` : `Above Rs ${rupees(s.annual!)} this year`);
      } else reasons.push(`Below the limits (Rs ${rupees(s.single ?? 0)} a payment, Rs ${rupees(s.annual ?? 0)} a year)`);
      break;
    }
    case "annual":
      if (s.annual && after <= s.annual) reasons.push(`Below Rs ${rupees(s.annual)} this year`);
      else {
        taxable = i.base + (s.annual && i.earlier <= s.annual ? (i.earlierUntaxed ?? 0) : 0);
        reasons.push(`Above Rs ${rupees(s.annual ?? 0)} this year`);
      }
      break;
    case "annual_excess": {
      const limit = s.annual ?? 0;
      taxable = Math.max(0, after - limit) - Math.max(0, i.earlier - limit);
      reasons.push(taxable > 0 ? `Charged on the part above Rs ${rupees(limit)} this year` : `Below Rs ${rupees(limit)} this year`);
      break;
    }
  }
  const amount = taxable > 0 ? taxOf(taxable, rate) : 0;
  return { applies: amount > 0, taxable, rate, amount, noPan, reasons };
}

const rupees = (paise: number) => Math.round(paise / 100).toLocaleString("en-IN");

// ------------------------------------------------------------------ periods and due dates

/** Financial year of a date: "2025-26" and its first and last day. */
export function financialYearOf(date: string): { fy: string; from: string; to: string; startYear: number } {
  const y = Number(date.slice(0, 4));
  const start = Number(date.slice(5, 7)) >= 4 ? y : y - 1;
  return { fy: `${start}-${String((start + 1) % 100).padStart(2, "0")}`, from: `${start}-04-01`, to: `${start + 1}-03-31`, startYear: start };
}

/** Parses "2025-26" (or 2025) into the year's dates. */
export function parseFy(fy: string | number): { fy: string; from: string; to: string; startYear: number } | null {
  const m = /^(\d{4})(?:-(\d{2}))?$/.exec(String(fy).trim());
  if (!m) return null;
  const start = Number(m[1]);
  if (m[2] && Number(m[2]) !== (start + 1) % 100) return null;
  return financialYearOf(`${start}-04-01`);
}

/** Quarter of the financial year: Q1 April-June ... Q4 January-March. */
export function quarterOf(date: string): { quarter: 1 | 2 | 3 | 4; fy: string; from: string; to: string; key: string } {
  const f = financialYearOf(date);
  const m = Number(date.slice(5, 7));
  const q = (m >= 4 && m <= 6 ? 1 : m >= 7 && m <= 9 ? 2 : m >= 10 ? 3 : 4) as 1 | 2 | 3 | 4;
  const startMonth = [4, 7, 10, 1][q - 1]!;
  const year = q === 4 ? f.startYear + 1 : f.startYear;
  const from = `${year}-${String(startMonth).padStart(2, "0")}-01`;
  const to = lastDay(year, startMonth + 2);
  return { quarter: q, fy: f.fy, from, to, key: `${f.fy}-Q${q}` };
}

/** "2025-26-Q3" -> the quarter. */
export function parseQuarter(key: string): { quarter: 1 | 2 | 3 | 4; fy: string; from: string; to: string; key: string } | null {
  const m = /^(\d{4})-(\d{2})-Q([1-4])$/.exec(key.trim());
  if (!m) return null;
  const f = parseFy(`${m[1]}-${m[2]}`);
  if (!f) return null;
  const q = Number(m[3]);
  const month = [4, 7, 10, 1][q - 1]!;
  const year = q === 4 ? f.startYear + 1 : f.startYear;
  return quarterOf(`${year}-${String(month).padStart(2, "0")}-15`);
}

export function lastDay(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** Due date to deposit tax deducted / collected in `month` (YYYY-MM): the 7th of the next month; March TDS 30 April. */
export function depositDueDate(month: string, kind: "tds" | "tcs"): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  if (m === 3 && kind === "tds") return `${y}-04-30`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-07`;
}

/** Quarterly statement (26Q / 27EQ) and certificate (16A / 27D) due dates (Rule 31A, 31AA, 31, 37D). */
export function quarterDueDates(q: { quarter: number; fy: string }, kind: "tds" | "tcs"): { returnDue: string; certificateDue: string } {
  const start = Number(q.fy.slice(0, 4));
  const next = start + 1;
  if (kind === "tds") {
    const r = [`${start}-07-31`, `${start}-10-31`, `${next}-01-31`, `${next}-05-31`][q.quarter - 1]!;
    const c = [`${start}-08-15`, `${start}-11-15`, `${next}-02-15`, `${next}-06-15`][q.quarter - 1]!;
    return { returnDue: r, certificateDue: c };
  }
  const r = [`${start}-07-15`, `${start}-10-15`, `${next}-01-15`, `${next}-05-15`][q.quarter - 1]!;
  const c = [`${start}-07-30`, `${start}-10-30`, `${next}-01-30`, `${next}-06-30`][q.quarter - 1]!;
  return { returnDue: r, certificateDue: c };
}

/**
 * Interest for depositing late (section 201(1A)(ii) / 206C(7)): 1.5% / 1% a month or part of a month from the date of
 * deduction / collection to the date of payment. A hint for the challan; the owner types the interest paid.
 */
export function lateInterest(amount: number, deductedOn: string, paidOn: string, due: string, kind: "tds" | "tcs"): number {
  if (paidOn <= due) return 0;
  const a = new Date(`${deductedOn}T00:00:00Z`);
  const b = new Date(`${paidOn}T00:00:00Z`);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + 1;
  if (months < 1) months = 1;
  const rate = kind === "tds" ? 150 : 100;
  return Math.round((amount * rate * months) / 10_000 / 100) * 100;
}
