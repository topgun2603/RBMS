/** Pure report builders over account balances (no database). Money in paise; "net" = debit minus credit. */
import { GROUP_BY_KEY, ACCOUNT_GROUPS } from "./chart";
import type { AccountType } from "./schema";

export interface AccountInfo {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  group: string;
  subGroup: string | null;
  key: string | null;
  isCash: boolean;
  isBank: boolean;
}

export interface Balance {
  debit: number;
  credit: number;
}

const netOf = (b: Balance | undefined) => (b ? b.debit - b.credit : 0);
const split = (net: number) => ({ dr: net > 0 ? net : 0, cr: net < 0 ? -net : 0 });

/** "1,234.50 Dr" style side of a net balance. */
export const sideOf = (net: number): "dr" | "cr" => (net >= 0 ? "dr" : "cr");

// ------------------------------------------------------------------ trial balance

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  group: string;
  openingDr: number;
  openingCr: number;
  debit: number;
  credit: number;
  closingDr: number;
  closingCr: number;
}

export interface TrialBalance {
  from: string;
  to: string;
  rows: TrialBalanceRow[];
  totals: { openingDr: number; openingCr: number; debit: number; credit: number; closingDr: number; closingCr: number };
  /** Debits equal credits in the opening, period and closing columns. */
  balanced: boolean;
}

/** `before` = everything dated before `from`; `during` = from..to inclusive. Accounts with nothing at all are left out. */
export function buildTrialBalance(
  accounts: readonly AccountInfo[],
  before: ReadonlyMap<string, Balance>,
  during: ReadonlyMap<string, Balance>,
  range: { from: string; to: string },
): TrialBalance {
  const rows: TrialBalanceRow[] = [];
  for (const a of [...accounts].sort((x, y) => x.code.localeCompare(y.code, undefined, { numeric: true }))) {
    const open = netOf(before.get(a.id));
    const d = during.get(a.id);
    const debit = d?.debit ?? 0;
    const credit = d?.credit ?? 0;
    if (open === 0 && debit === 0 && credit === 0) continue;
    const o = split(open);
    const c = split(open + debit - credit);
    rows.push({ accountId: a.id, code: a.code, name: a.name, type: a.type, group: a.group, openingDr: o.dr, openingCr: o.cr, debit, credit, closingDr: c.dr, closingCr: c.cr });
  }
  const totals = rows.reduce(
    (t, r) => ({
      openingDr: t.openingDr + r.openingDr,
      openingCr: t.openingCr + r.openingCr,
      debit: t.debit + r.debit,
      credit: t.credit + r.credit,
      closingDr: t.closingDr + r.closingDr,
      closingCr: t.closingCr + r.closingCr,
    }),
    { openingDr: 0, openingCr: 0, debit: 0, credit: 0, closingDr: 0, closingCr: 0 },
  );
  return {
    ...range,
    rows,
    totals,
    balanced: totals.openingDr === totals.openingCr && totals.debit === totals.credit && totals.closingDr === totals.closingCr,
  };
}

// ------------------------------------------------------------------ ledger (running balance)

export interface LedgerLineIn {
  lineId: string;
  entryId: string;
  date: string;
  number: string;
  voucherType: string;
  narration: string;
  memo: string | null;
  debit: number;
  credit: number;
  partyName?: string | null;
}

export interface LedgerRow extends LedgerLineIn {
  /** Running balance, debit-positive. */
  balance: number;
}

export interface Ledger {
  openingBalance: number;
  rows: LedgerRow[];
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
}

/** Lines must already be in date / entry-number order. */
export function buildLedger(openingNet: number, lines: readonly LedgerLineIn[]): Ledger {
  let running = openingNet;
  let totalDebit = 0;
  let totalCredit = 0;
  const rows = lines.map((l) => {
    running += l.debit - l.credit;
    totalDebit += l.debit;
    totalCredit += l.credit;
    return { ...l, balance: running };
  });
  return { openingBalance: openingNet, rows, totalDebit, totalCredit, closingBalance: running };
}

// ------------------------------------------------------------------ profit and loss

export interface PnlLine {
  accountId: string | null;
  code: string | null;
  name: string;
  amount: number;
  compare?: number;
}

export interface PnlSection {
  key: "sales" | "cogs" | "otherIncome" | "expenses";
  label: string;
  lines: PnlLine[];
  total: number;
  compareTotal?: number;
}

export interface StockPart {
  /** Stock value at the end of the day before `from`, plus movements of the Stock account inside the period. */
  opening: number;
  /** Stock value at `to`. */
  closing: number;
}

export interface ProfitLoss {
  from: string;
  to: string;
  compare: { from: string; to: string } | null;
  sections: PnlSection[];
  stock: { opening: number; closing: number; compareOpening?: number; compareClosing?: number };
  grossProfit: number;
  netProfit: number;
  compareGrossProfit?: number;
  compareNetProfit?: number;
}

function pnlSection(
  key: PnlSection["key"],
  label: string,
  accounts: readonly AccountInfo[],
  cur: ReadonlyMap<string, Balance>,
  cmp: ReadonlyMap<string, Balance> | null,
  sign: 1 | -1,
): PnlSection {
  // sign 1: credit-positive (income); -1: debit-positive (expense).
  const amountOf = (m: ReadonlyMap<string, Balance>, id: string) => (sign === 1 ? -netOf(m.get(id)) : netOf(m.get(id)));
  const lines: PnlLine[] = [];
  for (const a of [...accounts].sort((x, y) => x.code.localeCompare(y.code, undefined, { numeric: true }))) {
    const amount = amountOf(cur, a.id);
    const compare = cmp ? amountOf(cmp, a.id) : undefined;
    if (amount === 0 && !compare) continue;
    lines.push({ accountId: a.id, code: a.code, name: a.name, amount, ...(cmp ? { compare } : {}) });
  }
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const compareTotal = cmp ? lines.reduce((s, l) => s + (l.compare ?? 0), 0) : undefined;
  return { key, label, lines, total, ...(cmp ? { compareTotal } : {}) };
}

export function buildProfitLoss(
  accounts: readonly AccountInfo[],
  cur: ReadonlyMap<string, Balance>,
  stock: StockPart,
  range: { from: string; to: string },
  cmp?: { balances: ReadonlyMap<string, Balance>; stock: StockPart; from: string; to: string } | null,
): ProfitLoss {
  const inGroup = (g: string) => accounts.filter((a) => a.group === g);
  const c = cmp?.balances ?? null;
  const sales = pnlSection("sales", "Net sales", inGroup("sales"), cur, c, 1);
  const cogs = pnlSection("cogs", "Cost of goods sold", inGroup("direct"), cur, c, -1);
  const otherIncome = pnlSection("otherIncome", "Other income", inGroup("other_income"), cur, c, 1);
  const expenses = pnlSection("expenses", "Running expenses", inGroup("indirect"), cur, c, -1);

  // Periodic stock method: cost of goods = opening stock + purchases - closing stock.
  const stockEffect = (s: StockPart) => s.closing - s.opening;
  const cogsTotal = cogs.total - stockEffect(stock);
  const cmpCogsTotal = cmp ? (cogs.compareTotal ?? 0) - stockEffect(cmp.stock) : undefined;
  cogs.total = cogsTotal;
  if (cmp) cogs.compareTotal = cmpCogsTotal;

  const grossProfit = sales.total - cogsTotal;
  const netProfit = grossProfit + otherIncome.total - expenses.total;
  const compareGrossProfit = cmp ? (sales.compareTotal ?? 0) - (cmpCogsTotal ?? 0) : undefined;
  const compareNetProfit = cmp ? (compareGrossProfit ?? 0) + (otherIncome.compareTotal ?? 0) - (expenses.compareTotal ?? 0) : undefined;
  return {
    ...range,
    compare: cmp ? { from: cmp.from, to: cmp.to } : null,
    sections: [sales, cogs, otherIncome, expenses],
    stock: { opening: stock.opening, closing: stock.closing, ...(cmp ? { compareOpening: cmp.stock.opening, compareClosing: cmp.stock.closing } : {}) },
    grossProfit,
    netProfit,
    ...(cmp ? { compareGrossProfit, compareNetProfit } : {}),
  };
}

// ------------------------------------------------------------------ balance sheet

export interface BalanceSheetGroup {
  key: string;
  label: string;
  lines: { accountId: string | null; code: string | null; name: string; amount: number }[];
  total: number;
}

export interface BalanceSheet {
  asOf: string;
  assets: BalanceSheetGroup[];
  liabilities: BalanceSheetGroup[];
  equity: BalanceSheetGroup[];
  totalAssets: number;
  totalLiabilities: number;
  /** Capital and reserves including profit up to the date. */
  totalEquity: number;
  /** Profit (or loss) from the start of the books to the date, stock revaluation included. */
  profitToDate: number;
  stockValue: number;
  /** Assets minus liabilities minus equity: 0 when the books balance. */
  difference: number;
  balanced: boolean;
}

/**
 * `balances` = everything dated up to `asOf`. `stockValue` replaces the Stock in hand account balance (periodic method):
 * the difference between the live value and the ledger balance goes to profit, so the sheet always balances when the
 * ledger does.
 */
export function buildBalanceSheet(
  accounts: readonly AccountInfo[],
  balances: ReadonlyMap<string, Balance>,
  stockValue: number,
  asOf: string,
): BalanceSheet {
  const byGroup = (type: AccountType, sign: 1 | -1): BalanceSheetGroup[] => {
    const out: BalanceSheetGroup[] = [];
    for (const g of ACCOUNT_GROUPS.filter((x) => x.type === type)) {
      const lines: BalanceSheetGroup["lines"] = [];
      for (const a of accounts.filter((x) => x.group === g.key).sort((x, y) => x.code.localeCompare(y.code, undefined, { numeric: true }))) {
        const amount = sign * netOf(balances.get(a.id));
        if (a.group === "stock") continue;
        if (amount !== 0) lines.push({ accountId: a.id, code: a.code, name: a.name, amount });
      }
      if (g.key === "stock") lines.push({ accountId: null, code: null, name: "Stock in hand (at cost)", amount: stockValue });
      const total = lines.reduce((s, l) => s + l.amount, 0);
      if (lines.length > 0 && (total !== 0 || lines.some((l) => l.amount !== 0))) out.push({ key: g.key, label: g.label, lines, total });
    }
    return out;
  };
  const assets = byGroup("asset", 1);
  const liabilities = byGroup("liability", -1);
  const equity = byGroup("equity", -1);

  let ledgerProfit = 0;
  let ledgerStock = 0;
  for (const a of accounts) {
    const n = netOf(balances.get(a.id));
    if (a.type === "income") ledgerProfit += -n;
    else if (a.type === "expense") ledgerProfit -= n;
    if (a.group === "stock") ledgerStock += n;
  }
  const profitToDate = ledgerProfit + (stockValue - ledgerStock);
  equity.push({ key: "profit", label: "Profit and loss", lines: [{ accountId: null, code: null, name: "Profit (loss) to date", amount: profitToDate }], total: profitToDate });

  const sum = (gs: BalanceSheetGroup[]) => gs.reduce((s, g) => s + g.total, 0);
  const totalAssets = sum(assets);
  const totalLiabilities = sum(liabilities);
  const totalEquity = sum(equity);
  const difference = totalAssets - totalLiabilities - totalEquity;
  return { asOf, assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity, profitToDate, stockValue, difference, balanced: difference === 0 };
}

// ------------------------------------------------------------------ GST ledger

export interface GstLedger {
  from: string;
  to: string;
  output: { cgst: number; sgst: number; igst: number; cess: number; total: number };
  input: { cgst: number; sgst: number; igst: number; cess: number; total: number };
  /** Output minus input: + = to pay, - = credit to carry forward. */
  net: number;
  paidOrSetOff: number;
}

const TAX_KEYS = { cgst: ["gst_out_cgst", "gst_in_cgst"], sgst: ["gst_out_sgst", "gst_in_sgst"], igst: ["gst_out_igst", "gst_in_igst"], cess: ["gst_out_cess", "gst_in_cess"] } as const;

export function buildGstLedger(accounts: readonly AccountInfo[], during: ReadonlyMap<string, Balance>, range: { from: string; to: string }, settled: number): GstLedger {
  const idOf = (k: string) => accounts.find((a) => a.key === k)?.id;
  const out = { cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 };
  const inn = { cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 };
  for (const t of ["cgst", "sgst", "igst", "cess"] as const) {
    const [o, i] = TAX_KEYS[t];
    const oid = idOf(o);
    const iid = idOf(i);
    out[t] = oid ? -netOf(during.get(oid)) : 0;
    inn[t] = iid ? netOf(during.get(iid)) : 0;
    out.total += out[t];
    inn.total += inn[t];
  }
  return { ...range, output: out, input: inn, net: out.total - inn.total, paidOrSetOff: settled };
}

// ------------------------------------------------------------------ generic tables (CSV and PDF)

export interface ReportColumn {
  key: string;
  label: string;
  align?: "left" | "right";
  /** "money" cells hold paise and print as rupees; "text" as is. */
  kind?: "text" | "money";
}

export interface ReportTable {
  title: string;
  subtitle: string;
  columns: ReportColumn[];
  rows: { cells: Record<string, string | number | null>; style?: "head" | "total" | "normal" }[];
  notes?: string[];
}

const rupees = (paise: number) => (paise / 100).toFixed(2);

const csvCell = (v: string | number | null | undefined): string => {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** UTF-8 BOM, CRLF; money columns in rupees with 2 decimals. */
export function tableToCsv(t: ReportTable): string {
  const head = t.columns.map((c) => csvCell(c.label)).join(",");
  const body = t.rows.map((r) =>
    t.columns
      .map((c) => {
        const v = r.cells[c.key] ?? null;
        // Money is written as a number (a minus sign is not a formula), so no quote guard.
        return c.kind === "money" && typeof v === "number" ? rupees(v) : csvCell(v);
      })
      .join(","),
  );
  return `﻿${[head, ...body].join("\r\n")}\r\n`;
}

export { GROUP_BY_KEY };
