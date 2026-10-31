/** Report results as flat tables, for CSV downloads and PDFs. */
import type { BalanceSheet, GstLedger, Ledger, ProfitLoss, ReportTable, TrialBalance } from "./reports-logic";
import { sideOf } from "./reports-logic";

const dmy = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
const period = (from: string, to: string) => `${dmy(from)} to ${dmy(to)}`;
/** Signed net as "1,234.00 Dr" is for screens; tables carry the magnitude and a side column. */
const side = (net: number) => (net === 0 ? "" : sideOf(net) === "dr" ? "Dr" : "Cr");

export function trialBalanceTable(tb: TrialBalance, shop: string): ReportTable {
  const row = (cells: Record<string, string | number | null>, style?: "head" | "total") => ({ cells, style });
  return {
    title: "Trial balance",
    subtitle: `${shop} - ${period(tb.from, tb.to)}`,
    columns: [
      { key: "code", label: "Code" },
      { key: "name", label: "Account" },
      { key: "openingDr", label: "Opening Dr", kind: "money" },
      { key: "openingCr", label: "Opening Cr", kind: "money" },
      { key: "debit", label: "Debit", kind: "money" },
      { key: "credit", label: "Credit", kind: "money" },
      { key: "closingDr", label: "Closing Dr", kind: "money" },
      { key: "closingCr", label: "Closing Cr", kind: "money" },
    ],
    rows: [
      ...tb.rows.map((r) => row({ code: r.code, name: r.name, openingDr: r.openingDr, openingCr: r.openingCr, debit: r.debit, credit: r.credit, closingDr: r.closingDr, closingCr: r.closingCr })),
      row({ code: "", name: "Total", ...tb.totals }, "total"),
    ],
    notes: [tb.balanced ? "Debits equal credits." : "Debits and credits differ: the books do not balance."],
  };
}

export function profitLossTable(pl: ProfitLoss, shop: string): ReportTable {
  const cmp = !!pl.compare;
  const columns: ReportTable["columns"] = [
    { key: "name", label: "Particulars" },
    { key: "amount", label: period(pl.from, pl.to), kind: "money" },
    ...(cmp ? [{ key: "compare", label: period(pl.compare!.from, pl.compare!.to), kind: "money" as const }] : []),
  ];
  const rows: ReportTable["rows"] = [];
  const add = (name: string, amount: number | null, compare?: number | null, style?: "head" | "total" | "normal") =>
    rows.push({ cells: { name, amount, ...(cmp ? { compare: compare ?? null } : {}) }, style });
  const sec = (key: string) => pl.sections.find((s) => s.key === key)!;
  const sales = sec("sales");
  add(sales.label, sales.total, sales.compareTotal, "head");
  for (const l of sales.lines) add(`  ${l.name}`, l.amount, l.compare);
  const cogs = sec("cogs");
  add("Cost of goods sold", cogs.total, cogs.compareTotal, "head");
  add("  Opening stock", pl.stock.opening, pl.stock.compareOpening);
  for (const l of cogs.lines) add(`  ${l.name}`, l.amount, l.compare);
  add("  Less: closing stock", -pl.stock.closing, pl.stock.compareClosing === undefined ? undefined : -pl.stock.compareClosing);
  add("Gross profit", pl.grossProfit, pl.compareGrossProfit, "total");
  const oi = sec("otherIncome");
  add(oi.label, oi.total, oi.compareTotal, "head");
  for (const l of oi.lines) add(`  ${l.name}`, l.amount, l.compare);
  const ex = sec("expenses");
  add(ex.label, ex.total, ex.compareTotal, "head");
  for (const l of ex.lines) add(`  ${l.name}`, l.amount, l.compare);
  add("Net profit", pl.netProfit, pl.compareNetProfit, "total");
  return {
    title: "Profit and loss",
    subtitle: `${shop} - ${period(pl.from, pl.to)}`,
    columns,
    rows,
    notes: ["Stock is valued at the moving-average cost from Stock. Bills and purchases are counted on the bill date (accrual basis), not when money moves."],
  };
}

/** Profit and loss with a column per branch, head office / unassigned, and the whole shop. */
export function profitLossBranchTable(
  r: { from: string; to: string; consolidated: ProfitLoss; columns: { branch: { id: string | null; name: string }; pl: ProfitLoss }[]; check: { ok: boolean; difference: number } },
  shop: string,
): ReportTable {
  const cols = r.columns.map((c, i) => ({ key: `b${i}`, pl: c.pl, label: c.branch.name }));
  const all = [...cols, { key: "total", pl: r.consolidated, label: "Whole shop" }];
  const rows: ReportTable["rows"] = [];
  const add = (name: string, f: (pl: ProfitLoss) => number, style?: "head" | "total") =>
    rows.push({ cells: { name, ...Object.fromEntries(all.map((c) => [c.key, f(c.pl)])) }, style });
  const sec = (pl: ProfitLoss, key: string) => pl.sections.find((s) => s.key === key)!;
  // Every account that has an amount in any column, in code order.
  const linesOf = (key: string) => {
    const seen = new Map<string, { code: string | null; name: string }>();
    for (const c of all) for (const l of sec(c.pl, key).lines) seen.set(l.accountId ?? l.name, { code: l.code, name: l.name });
    return [...seen.entries()].sort((x, y) => (x[1].code ?? "").localeCompare(y[1].code ?? "", undefined, { numeric: true }));
  };
  const amountIn = (pl: ProfitLoss, key: string, id: string) => sec(pl, key).lines.find((l) => (l.accountId ?? l.name) === id)?.amount ?? 0;
  const section = (key: string, label: string) => {
    add(label, (pl) => sec(pl, key).total, "head");
    if (key === "cogs") add("  Opening stock", (pl) => pl.stock.opening);
    for (const [id, l] of linesOf(key)) add(`  ${l.name}`, (pl) => amountIn(pl, key, id));
    if (key === "cogs") add("  Less: closing stock", (pl) => -pl.stock.closing);
  };
  section("sales", sec(r.consolidated, "sales").label);
  section("cogs", "Cost of goods sold");
  add("Gross profit", (pl) => pl.grossProfit, "total");
  section("otherIncome", sec(r.consolidated, "otherIncome").label);
  section("expenses", sec(r.consolidated, "expenses").label);
  add("Net profit", (pl) => pl.netProfit, "total");
  return {
    title: "Profit and loss by branch",
    subtitle: `${shop} - ${period(r.from, r.to)}`,
    columns: [{ key: "name", label: "Particulars" }, ...all.map((c) => ({ key: c.key, label: c.label, kind: "money" as const }))],
    rows,
    notes: [
      "Head office / unassigned holds manual entries, shop-wide documents (customer receipts, payroll, opening balances) and everything posted before branch books.",
      r.check.ok ? "The branches add up to the whole shop." : `The branches differ from the whole shop by ${(r.check.difference / 100).toFixed(2)}.`,
    ],
  };
}

export function balanceSheetTable(bs: BalanceSheet, shop: string): ReportTable {
  const rows: ReportTable["rows"] = [];
  const block = (title: string, groups: BalanceSheet["assets"], total: number) => {
    rows.push({ cells: { name: title, amount: total }, style: "head" });
    for (const g of groups) {
      rows.push({ cells: { name: `  ${g.label}`, amount: g.total }, style: "normal" });
      for (const l of g.lines) rows.push({ cells: { name: `      ${l.name}`, amount: l.amount } });
    }
  };
  block("Assets", bs.assets, bs.totalAssets);
  block("Liabilities", bs.liabilities, bs.totalLiabilities);
  block("Owner's equity", bs.equity, bs.totalEquity);
  rows.push({ cells: { name: "Liabilities + equity", amount: bs.totalLiabilities + bs.totalEquity }, style: "total" });
  return {
    title: "Balance sheet",
    subtitle: `${shop} - as on ${dmy(bs.asOf)}`,
    columns: [
      { key: "name", label: "Particulars" },
      { key: "amount", label: "Amount", kind: "money" },
    ],
    rows,
    notes: [bs.balanced ? "Assets equal liabilities plus equity." : "Assets and liabilities differ by the amount shown on screen."],
  };
}

export function ledgerTable(l: Ledger & { account: { code: string; name: string }; from: string; to: string }, shop: string): ReportTable {
  const bal = (n: number) => n;
  return {
    title: `Ledger - ${l.account.name}`,
    subtitle: `${shop} - ${period(l.from, l.to)}`,
    columns: [
      { key: "date", label: "Date" },
      { key: "number", label: "Entry" },
      { key: "narration", label: "Narration" },
      { key: "debit", label: "Debit", kind: "money" },
      { key: "credit", label: "Credit", kind: "money" },
      { key: "balance", label: "Balance", kind: "money" },
      { key: "side", label: "" },
    ],
    rows: [
      { cells: { date: dmy(l.from), number: "", narration: "Opening balance", debit: null, credit: null, balance: Math.abs(bal(l.openingBalance)), side: side(l.openingBalance) }, style: "head" },
      ...l.rows.map((r) => ({
        cells: { date: dmy(r.date), number: r.number, narration: r.memo ? `${r.narration} - ${r.memo}` : r.narration, debit: r.debit || null, credit: r.credit || null, balance: Math.abs(r.balance), side: side(r.balance) },
      })),
      { cells: { date: dmy(l.to), number: "", narration: "Closing balance", debit: l.totalDebit, credit: l.totalCredit, balance: Math.abs(l.closingBalance), side: side(l.closingBalance) }, style: "total" },
    ],
  };
}

export function dayBookTable(
  items: { date: string; number: string; kindLabel: string; narration: string; lines: { accountName: string; debit: number; credit: number }[] }[],
  range: { from: string; to: string },
  shop: string,
): ReportTable {
  const rows: ReportTable["rows"] = [];
  for (const e of items) {
    rows.push({ cells: { date: dmy(e.date), number: e.number, particulars: `${e.kindLabel}: ${e.narration}`, debit: null, credit: null }, style: "head" });
    for (const l of e.lines) rows.push({ cells: { date: "", number: "", particulars: `   ${l.accountName}`, debit: l.debit || null, credit: l.credit || null } });
  }
  return {
    title: "Day book",
    subtitle: `${shop} - ${period(range.from, range.to)}`,
    columns: [
      { key: "date", label: "Date" },
      { key: "number", label: "Entry" },
      { key: "particulars", label: "Particulars" },
      { key: "debit", label: "Debit", kind: "money" },
      { key: "credit", label: "Credit", kind: "money" },
    ],
    rows,
  };
}

export function gstTable(g: GstLedger, shop: string): ReportTable {
  const row = (name: string, o: number, i: number): ReportTable["rows"][number] => ({ cells: { name, output: o, input: i, net: o - i } });
  return {
    title: "GST ledger summary",
    subtitle: `${shop} - ${period(g.from, g.to)}`,
    columns: [
      { key: "name", label: "Tax" },
      { key: "output", label: "Output (collected)", kind: "money" },
      { key: "input", label: "Input credit (paid)", kind: "money" },
      { key: "net", label: "Net payable", kind: "money" },
    ],
    rows: [
      row("CGST", g.output.cgst, g.input.cgst),
      row("SGST", g.output.sgst, g.input.sgst),
      row("IGST", g.output.igst, g.input.igst),
      row("Cess", g.output.cess, g.input.cess),
      { cells: { name: "Total", output: g.output.total, input: g.input.total, net: g.net }, style: "total" },
    ],
    notes: ["Output GST is net of credit notes; input credit is net of debit notes. The CGST/SGST/IGST set-off order is not applied here."],
  };
}
