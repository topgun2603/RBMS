/**
 * Branch books: every automatic posting carries the branch of its document (null = head office / unassigned), the
 * branch never changes the content hash (so history posted before branch books is not re-posted), cancellations stay
 * in the branch of what they cancel, and per-branch reports add up to the whole shop to the paisa.
 */
import { describe, expect, it } from "vitest";
import type {
  CreditNoteSrc,
  DebitNoteSrc,
  ExpenseSrc,
  InvoicePaymentSrc,
  InvoiceSrc,
  PurchaseSrc,
  SalesDebitNoteSrc,
  StockAdjustmentSrc,
  SupplierPaymentSrc,
  TillSrc,
} from "./ports";
import { buildProfitLoss, buildTrialBalance, type AccountInfo, type Balance } from "./reports-logic";
import {
  creditNotePostings,
  debitNotePostings,
  expensePostings,
  invoicePaymentPostings,
  invoicePostings,
  isBalanced,
  MIRROR_BASE,
  postingHash,
  purchasePostings,
  receiptPostings,
  salesDebitNotePostings,
  stockAdjustmentPostings,
  supplierPaymentPostings,
  tillPostings,
  totalOf,
  type Posting,
  type RuleOptions,
} from "./rules";
import { profitLossBranchTable } from "./tables";

const opts: RuleOptions = { importedBills: "exclude", shopState: "33" };
const B1 = "b1b1b1b1-0000-4000-8000-000000000001";
const B2 = "b2b2b2b2-0000-4000-8000-000000000002";

const tax = { cgst: 9_000, sgst: 9_000, igst: 0 };
const invoice = (over: Partial<InvoiceSrc> = {}): InvoiceSrc => ({
  id: "i1",
  number: "INV-1",
  date: "2026-10-01",
  status: "issued",
  imported: false,
  customerId: "c1",
  customerName: "Meena",
  subtotal: 100_000,
  discount: 0,
  taxable: 100_000,
  ...tax,
  roundOff: 0,
  total: 118_000,
  cancelledOn: null,
  ...over,
});
const payment = (over: Partial<InvoicePaymentSrc> = {}): InvoicePaymentSrc => ({
  id: "p1",
  invoiceId: "i1",
  invoiceNumber: "INV-1",
  customerId: "c1",
  customerName: "Meena",
  imported: false,
  date: "2026-10-01",
  amount: 118_000,
  method: "cash",
  receiptId: null,
  ...over,
});
const creditNote = (over: Partial<CreditNoteSrc> = {}): CreditNoteSrc => ({
  id: "cn1",
  number: "CN-1",
  invoiceNumber: "INV-1",
  date: "2026-10-03",
  status: "issued",
  invoiceCancelled: false,
  invoiceImported: false,
  customerId: "c1",
  customerName: "Meena",
  total: 11_800,
  taxable: 10_000,
  cgst: 900,
  sgst: 900,
  igst: 0,
  roundOff: 0,
  cancelledOn: null,
  ...over,
});
const salesDebitNote = (over: Partial<SalesDebitNoteSrc> = {}): SalesDebitNoteSrc => ({
  id: "sdn1",
  number: "SDN-1",
  invoiceNumber: "INV-1",
  date: "2026-10-04",
  status: "issued",
  customerId: "c1",
  customerName: "Meena",
  total: 5_900,
  taxable: 5_000,
  cgst: 450,
  sgst: 450,
  igst: 0,
  roundOff: 0,
  cancelledOn: null,
  ...over,
});
const purchase = (over: Partial<PurchaseSrc> = {}): PurchaseSrc => ({
  id: "pu1",
  billNumber: "SUP-1",
  date: "2026-10-01",
  status: "recorded",
  imported: false,
  supplierId: "s1",
  supplierName: "Ravi Traders",
  total: 59_000,
  cgst: 4_500,
  sgst: 4_500,
  igst: 0,
  roundOff: 0,
  cancelledOn: null,
  ...over,
});
const supplierPayment = (over: Partial<SupplierPaymentSrc> = {}): SupplierPaymentSrc => ({
  id: "sp1",
  supplierId: "s1",
  supplierName: "Ravi Traders",
  purchaseBill: "SUP-1",
  purchaseImported: false,
  kind: "payment",
  amount: 59_000,
  mode: "bank",
  date: "2026-10-02",
  reversedOn: null,
  ...over,
});
const debitNote = (over: Partial<DebitNoteSrc> = {}): DebitNoteSrc => ({
  id: "dn1",
  number: "DN-1",
  date: "2026-10-05",
  status: "issued",
  supplierId: "s1",
  supplierName: "Ravi Traders",
  purchaseImported: false,
  total: 5_900,
  cgst: 450,
  sgst: 450,
  igst: 0,
  roundOff: 0,
  cancelledOn: null,
  ...over,
});
const expense = (over: Partial<ExpenseSrc> = {}): ExpenseSrc => ({
  id: "e1",
  date: "2026-10-06",
  status: "recorded",
  categoryId: "cat1",
  categoryName: "Rent",
  amount: 20_000,
  gstAmount: 0,
  itc: 0,
  vendorName: null,
  vendorGstin: null,
  paymentMethod: "cash",
  cancelledOn: null,
  ...over,
});
const till = (over: Partial<TillSrc> = {}): TillSrc => ({
  id: "t1",
  register: "Counter 1",
  status: "closed",
  closedOn: "2026-10-01",
  difference: -500,
  cashEntries: [{ id: "c1", amount: 1_000, reason: "float", on: "2026-10-01" }],
  handovers: [{ id: "h1", difference: 200, on: "2026-10-01" }],
  ...over,
});
const stockAdjustment = (over: Partial<StockAdjustmentSrc> = {}): StockAdjustmentSrc => ({
  id: "m1",
  date: "2026-10-01",
  reason: "adjustment",
  value: -3_000,
  itemName: null,
  ...over,
});

/** Every source type that carries a branch, as (name, postings of the document with the given branch). */
const SOURCES: [string, (branchId?: string | null) => Posting[]][] = [
  ["invoice", (b) => invoicePostings(invoice({ branchId: b }), opts)],
  ["cancelled invoice", (b) => invoicePostings(invoice({ branchId: b, status: "cancelled", cancelledOn: "2026-10-09" }), opts)],
  ["payment on a bill", (b) => invoicePaymentPostings(payment({ branchId: b }), opts)],
  ["refund on a bill", (b) => invoicePaymentPostings(payment({ branchId: b, amount: -1_000 }), opts)],
  ["credit note", (b) => creditNotePostings(creditNote({ branchId: b }), opts)],
  ["debit note to a customer", (b) => salesDebitNotePostings(salesDebitNote({ branchId: b, status: "cancelled", cancelledOn: "2026-10-08" }))],
  ["purchase", (b) => purchasePostings(purchase({ branchId: b }), opts)],
  ["cancelled purchase", (b) => purchasePostings(purchase({ branchId: b, status: "cancelled", cancelledOn: "2026-10-07" }), opts)],
  ["supplier payment", (b) => supplierPaymentPostings(supplierPayment({ branchId: b }), opts)],
  ["reversed supplier payment", (b) => supplierPaymentPostings(supplierPayment({ branchId: b, reversedOn: "2026-10-03" }), opts)],
  ["debit note", (b) => debitNotePostings(debitNote({ branchId: b, status: "cancelled", cancelledOn: "2026-10-06" }), opts)],
  ["expense", (b) => expensePostings(expense({ branchId: b }), opts)],
  ["cancelled expense", (b) => expensePostings(expense({ branchId: b, status: "cancelled", cancelledOn: "2026-10-07" }), opts)],
  ["expense on credit", (b) => expensePostings(expense({ branchId: b, onCredit: true, supplierId: "s1" }), opts)],
  ["till", (b) => tillPostings(till({ branchId: b }))],
  ["stock adjustment", (b) => stockAdjustmentPostings(stockAdjustment({ branchId: b }))],
  ["opening stock", (b) => stockAdjustmentPostings(stockAdjustment({ branchId: b, reason: "opening", value: 50_000 }))],
];

describe("branch on automatic postings", () => {
  for (const [name, post] of SOURCES) {
    it(`${name}: with a branch every posting carries it, without one it is unassigned`, () => {
      const withBranch = post(B1);
      const without = post(undefined);
      const nullBranch = post(null);
      expect(withBranch.length).toBeGreaterThan(0);
      for (const p of withBranch) {
        expect(p.branchId).toBe(B1);
        expect(isBalanced(p.lines)).toBe(true);
      }
      for (const p of [...without, ...nullBranch]) expect(p.branchId).toBeNull();
      // The same lines whatever the branch, so the books' totals are unchanged.
      expect(withBranch.map((p) => p.lines)).toEqual(without.map((p) => p.lines));
    });

    it(`${name}: the branch is not part of the content hash (no re-posting of history)`, () => {
      expect(post(B1).map(postingHash)).toEqual(post(undefined).map(postingHash));
      expect(post(B1).map(postingHash)).toEqual(post(B2).map(postingHash));
    });
  }

  it("a cancellation or reversal is in the same branch as what it mirrors and nets to zero there", () => {
    for (const [, post] of SOURCES) {
      const ps = post(B2);
      for (const m of ps.filter((p) => MIRROR_BASE[p.sourceType])) {
        const base = ps.find((p) => p.sourceType === MIRROR_BASE[m.sourceType] && p.sourceId === m.sourceId)!;
        expect(m.branchId).toBe(base.branchId);
        const net = (p: Posting) => p.lines.map((l) => l.debit - l.credit);
        expect(net(m).map((v, i) => v + net(base)[i]!)).toEqual(net(base).map(() => 0));
      }
    }
  });

  it("customer receipts are shop-wide (no branch)", () => {
    const [r] = receiptPostings({ id: "r1", customerId: "c1", customerName: "Meena", date: "2026-10-01", amount: 5_000, method: "upi", reference: null });
    expect(r!.branchId ?? null).toBeNull();
  });
});

// ------------------------------------------------------------------ reports add up across branches

const ACCOUNTS: AccountInfo[] = [
  { id: "cash", code: "1010", name: "Cash", type: "asset", group: "cash_bank", subGroup: null, key: "cash", isCash: true, isBank: false },
  { id: "bank", code: "1020", name: "Bank", type: "asset", group: "cash_bank", subGroup: null, key: "bank", isCash: false, isBank: true },
  { id: "debtors", code: "1100", name: "Debtors", type: "asset", group: "receivables", subGroup: null, key: "debtors", isCash: false, isBank: false },
  { id: "stock", code: "1200", name: "Stock", type: "asset", group: "stock", subGroup: null, key: "stock", isCash: false, isBank: false },
  { id: "gstin", code: "1300", name: "GST input", type: "asset", group: "tax_assets", subGroup: null, key: "gst_in_cgst", isCash: false, isBank: false },
  { id: "creditors", code: "2100", name: "Creditors", type: "liability", group: "payables", subGroup: null, key: "creditors", isCash: false, isBank: false },
  { id: "gstout", code: "2200", name: "GST output", type: "liability", group: "tax_liabilities", subGroup: null, key: "gst_out_cgst", isCash: false, isBank: false },
  { id: "equity", code: "3000", name: "Capital", type: "equity", group: "capital", subGroup: null, key: "capital", isCash: false, isBank: false },
  { id: "sales", code: "4000", name: "Sales", type: "income", group: "sales", subGroup: null, key: "sales", isCash: false, isBank: false },
  { id: "returns", code: "4010", name: "Sales returns", type: "income", group: "sales", subGroup: null, key: "sales_returns", isCash: false, isBank: false },
  { id: "purchases", code: "5000", name: "Purchases", type: "expense", group: "direct", subGroup: null, key: "purchases", isCash: false, isBank: false },
  { id: "rent", code: "5900", name: "Rent", type: "expense", group: "indirect", subGroup: null, key: "expcat:cat1", isCash: false, isBank: false },
  { id: "short", code: "5910", name: "Cash short", type: "expense", group: "indirect", subGroup: null, key: "cash_short_excess", isCash: false, isBank: false },
];
const accountOf = (l: Posting["lines"][number]): string => {
  const a = l.account;
  if ("method" in a) return a.method === "cash" ? "cash" : "bank";
  if ("expenseCategory" in a) return "rent";
  if ("id" in a) return a.id;
  const map: Record<string, string> = {
    debtors: "debtors",
    creditors: "creditors",
    sales: "sales",
    sales_returns: "returns",
    purchases: "purchases",
    stock: "stock",
    gst_in_cgst: "gstin",
    gst_in_sgst: "gstin",
    gst_in_igst: "gstin",
    gst_out_cgst: "gstout",
    gst_out_sgst: "gstout",
    gst_out_igst: "gstout",
    cash: "cash",
    cash_short_excess: "short",
  };
  return map[a.key] ?? "equity";
};

/** A small shop: documents in two branches and some without one (as if posted before branch books). */
function shopPostings(): Posting[] {
  const out: Posting[] = [];
  const docs: (string | null)[] = [B1, B2, null];
  docs.forEach((b, i) => {
    const s = `-${i}`;
    out.push(...invoicePostings(invoice({ id: `i${s}`, branchId: b, total: 118_000 + i * 1_180, taxable: 100_000 + i * 1_000, subtotal: 100_000 + i * 1_000, cgst: 9_000 + i * 90, sgst: 9_000 + i * 90 }), opts));
    out.push(...invoicePaymentPostings(payment({ id: `p${s}`, branchId: b }), opts));
    out.push(...creditNotePostings(creditNote({ id: `cn${s}`, branchId: b }), opts));
    out.push(...purchasePostings(purchase({ id: `pu${s}`, branchId: b, status: i === 1 ? "cancelled" : "recorded", cancelledOn: i === 1 ? "2026-10-09" : null }), opts));
    out.push(...supplierPaymentPostings(supplierPayment({ id: `sp${s}`, branchId: b }), opts));
    out.push(...expensePostings(expense({ id: `e${s}`, branchId: b, amount: 20_000 + i * 333 }), opts));
    out.push(...tillPostings(till({ id: `t${s}`, branchId: b })));
    out.push(...stockAdjustmentPostings(stockAdjustment({ id: `m${s}`, branchId: b, value: -(3_000 + i * 7) })));
  });
  out.push(...receiptPostings({ id: "r1", customerId: "c1", customerName: "Meena", date: "2026-10-02", amount: 7_777, method: "upi", reference: null }));
  return out;
}

const balancesOf = (ps: readonly Posting[]) => {
  const m = new Map<string, Balance>();
  for (const p of ps)
    for (const l of p.lines) {
      const id = accountOf(l);
      const b = m.get(id) ?? { debit: 0, credit: 0 };
      m.set(id, { debit: b.debit + l.debit, credit: b.credit + l.credit });
    }
  return m;
};

describe("per-branch reports add up to the whole shop", () => {
  const all = shopPostings();
  const branches = [B1, B2, null];
  const ofBranch = (b: string | null) => all.filter((p) => (p.branchId ?? null) === b);
  const range = { from: "2026-10-01", to: "2026-10-31" };
  // Stock valued per branch (closing) and opening at zero; the parts add up to the shop's value.
  const stockOf = (b: string | null) => {
    const moved = (balancesOf(ofBranch(b)).get("stock")?.debit ?? 0) - (balancesOf(ofBranch(b)).get("stock")?.credit ?? 0);
    const closing = b === B1 ? 41_111 : b === B2 ? 22_222 : 3_333;
    return { opening: moved, closing };
  };

  it("every branch's postings balance on their own", () => {
    for (const b of branches) {
      const t = totalOf(ofBranch(b).flatMap((p) => p.lines));
      expect(t.debit).toBe(t.credit);
    }
  });

  it("trial balance totals of the branches equal the unfiltered totals", () => {
    const empty = new Map<string, Balance>();
    const whole = buildTrialBalance(ACCOUNTS, empty, balancesOf(all), range);
    const parts = branches.map((b) => buildTrialBalance(ACCOUNTS, empty, balancesOf(ofBranch(b)), range));
    expect(whole.balanced).toBe(true);
    for (const p of parts) expect(p.balanced).toBe(true);
    expect(parts.reduce((t, p) => t + p.totals.debit, 0)).toBe(whole.totals.debit);
    expect(parts.reduce((t, p) => t + p.totals.credit, 0)).toBe(whole.totals.credit);
    // Account by account, the movements add up to the paisa.
    for (const r of whole.rows) {
      const sum = parts.reduce((t, p) => t + ((p.rows.find((x) => x.accountId === r.accountId)?.debit ?? 0) - (p.rows.find((x) => x.accountId === r.accountId)?.credit ?? 0)), 0);
      expect(sum).toBe(r.debit - r.credit);
    }
  });

  it("profit and loss of the branches add up to the consolidated one, section by section", () => {
    const stockWhole = branches.reduce((t, b) => ({ opening: t.opening + stockOf(b).opening, closing: t.closing + stockOf(b).closing }), { opening: 0, closing: 0 });
    const whole = buildProfitLoss(ACCOUNTS, balancesOf(all), stockWhole, range);
    const parts = branches.map((b) => buildProfitLoss(ACCOUNTS, balancesOf(ofBranch(b)), stockOf(b), range));
    expect(parts.reduce((t, p) => t + p.netProfit, 0)).toBe(whole.netProfit);
    expect(parts.reduce((t, p) => t + p.grossProfit, 0)).toBe(whole.grossProfit);
    for (const s of whole.sections) expect(parts.reduce((t, p) => t + p.sections.find((x) => x.key === s.key)!.total, 0)).toBe(s.total);
    expect(whole.netProfit).not.toBe(0);

    const table = profitLossBranchTable(
      {
        ...range,
        consolidated: whole,
        columns: branches.map((b, i) => ({ branch: { id: b, name: b ? `Branch ${i + 1}` : "Head office / unassigned" }, pl: parts[i]! })),
        check: { ok: true, difference: 0 },
      },
      "Shop",
    );
    // Every row: the branch columns add up to the "Whole shop" column.
    for (const row of table.rows) {
      const cells = row.cells as Record<string, number | string | null>;
      const sum = branches.reduce((t, _, i) => t + Number(cells[`b${i}`] ?? 0), 0);
      expect(sum).toBe(Number(cells.total ?? 0));
    }
    expect(table.columns.map((c) => c.label)).toEqual(["Particulars", "Branch 1", "Branch 2", "Head office / unassigned", "Whole shop"]);
  });
});
