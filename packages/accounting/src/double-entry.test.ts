import { describe, expect, it } from "vitest";
import { SYS } from "./chart";
import type { CreditNoteSrc, DebitNoteSrc, ExpenseSrc, GstPaymentSrc, InvoicePaymentSrc, InvoiceSrc, PurchaseSrc, SalesDebitNoteSrc, SupplierPaymentSrc } from "./ports";
import { buildTrialBalance, type AccountInfo, type Balance } from "./reports-logic";
import {
  creditNotePostings,
  debitNotePostings,
  expensePostings,
  gstPaymentPostings,
  invoicePaymentPostings,
  invoicePostings,
  isBalanced,
  purchasePostings,
  salesDebitNotePostings,
  supplierPaymentPostings,
  totalOf,
  type AccountRef,
  type Posting,
  type RuleOptions,
} from "./rules";

// Double entry: every posting balances to the paisa, cancellations net every account to zero, and the money a
// customer owes follows bills, notes and payments. Figures are hand-checkable paise.

const opts: RuleOptions = { importedBills: "exclude", shopState: "33" };

const refName = (a: AccountRef) => ("key" in a ? a.key : "method" in a ? `money:${a.method}` : "id" in a ? `id:${a.id}` : `exp:${a.expenseCategory.id}`);
/** Net (debit − credit) per account over a set of postings. */
const nets = (ps: readonly Posting[]) => {
  const m = new Map<string, number>();
  for (const p of ps) for (const l of p.lines) m.set(refName(l.account), (m.get(refName(l.account)) ?? 0) + l.debit - l.credit);
  return m;
};
const net = (ps: readonly Posting[], k: string) => nets(ps).get(k) ?? 0;

const invoice = (over: Partial<InvoiceSrc> = {}): InvoiceSrc => ({
  id: "i1",
  number: "INV-1",
  date: "2026-10-01",
  status: "issued",
  imported: false,
  customerId: "c1",
  customerName: "Meena",
  // 3 × ₹33.33 @ 18% intra: taxable 9999, CGST = SGST = 899.91 → 900 each, exact 11,799 → total ₹118 (+1 round-off).
  subtotal: 9_999,
  discount: 0,
  taxable: 9_999,
  cgst: 900,
  sgst: 900,
  igst: 0,
  roundOff: 1,
  total: 11_800,
  cancelledOn: null,
  ...over,
});
const creditNote = (over: Partial<CreditNoteSrc> = {}): CreditNoteSrc => ({
  id: "cn1",
  number: "CN-1",
  invoiceNumber: "INV-1",
  date: "2026-10-05",
  status: "issued",
  invoiceCancelled: false,
  invoiceImported: false,
  customerId: "c1",
  customerName: "Meena",
  // One unit back: 3333 + 300 + 300 = 3933 → ₹39 (round-off −33).
  taxable: 3_333,
  cgst: 300,
  sgst: 300,
  igst: 0,
  roundOff: -33,
  total: 3_900,
  cancelledOn: null,
  ...over,
});
const salesDebit = (over: Partial<SalesDebitNoteSrc> = {}): SalesDebitNoteSrc => ({
  id: "dn1",
  number: "DN-1",
  invoiceNumber: "INV-1",
  date: "2026-10-06",
  status: "issued",
  customerId: "c1",
  customerName: "Meena",
  // Price raised by ₹10 + 18% inter-state: 1000 + 180 IGST = ₹11.80 → ₹12 (+20).
  taxable: 1_000,
  cgst: 0,
  sgst: 0,
  igst: 180,
  roundOff: 20,
  total: 1_200,
  cancelledOn: null,
  ...over,
});
const payment = (over: Partial<InvoicePaymentSrc> = {}): InvoicePaymentSrc => ({
  id: "pay1",
  invoiceId: "i1",
  invoiceNumber: "INV-1",
  customerId: "c1",
  customerName: "Meena",
  imported: false,
  date: "2026-10-07",
  amount: 5_000,
  method: "upi",
  receiptId: null,
  ...over,
});
const purchase = (over: Partial<PurchaseSrc> = {}): PurchaseSrc => ({
  id: "p1",
  billNumber: "B-1",
  date: "2026-10-02",
  status: "recorded",
  imported: false,
  supplierId: "s1",
  supplierName: "Ravi Traders",
  // ₹999.99 @ 5% IGST = 50.00 → total 104,999 → ₹1,050 (+1).
  cgst: 0,
  sgst: 0,
  igst: 5_000,
  roundOff: 1,
  total: 105_000,
  cancelledOn: null,
  ...over,
});
const debitNote = (over: Partial<DebitNoteSrc> = {}): DebitNoteSrc => ({
  id: "d1",
  number: "PR-1",
  date: "2026-10-09",
  status: "issued",
  supplierId: "s1",
  supplierName: "Ravi Traders",
  purchaseImported: false,
  cgst: 0,
  sgst: 0,
  igst: 500,
  roundOff: 0,
  total: 10_500,
  cancelledOn: null,
  ...over,
});
const expense = (over: Partial<ExpenseSrc> = {}): ExpenseSrc => ({
  id: "e1",
  date: "2026-10-10",
  status: "recorded",
  categoryId: "cat1",
  categoryName: "Repairs",
  // ₹118 with ₹18 GST claimable, odd paisa: 1801 → CGST 901, SGST 900.
  amount: 11_801,
  gstAmount: 1_801,
  itc: 1_801,
  vendorName: "Fixit",
  vendorGstin: null,
  paymentMethod: "cash",
  cancelledOn: null,
  ...over,
});
const supplierPay = (over: Partial<SupplierPaymentSrc> = {}): SupplierPaymentSrc => ({
  id: "sp1",
  supplierId: "s1",
  supplierName: "Ravi Traders",
  purchaseBill: "B-1",
  purchaseImported: false,
  kind: "payment",
  amount: 40_000,
  mode: "bank",
  date: "2026-10-12",
  reversedOn: null,
  ...over,
});
const gstPay: GstPaymentSrc = { id: "g1", date: "2026-10-18", amount: 12_345, mode: "bank", status: "paid", cancelledOn: null, period: "2026-Q2" };

const everything = (): Posting[] => [
  ...invoicePostings(invoice(), opts),
  ...invoicePostings(invoice({ id: "i2", number: "INV-2", igst: 1_800, cgst: 0, sgst: 0, status: "cancelled", cancelledOn: "2026-10-20" }), opts),
  ...creditNotePostings(creditNote(), opts),
  ...salesDebitNotePostings(salesDebit()),
  ...salesDebitNotePostings(salesDebit({ id: "dn2", status: "cancelled", cancelledOn: "2026-10-21" })),
  ...invoicePaymentPostings(payment(), opts),
  ...invoicePaymentPostings(payment({ id: "pay2", amount: -1_000, method: "cash" }), opts),
  ...invoicePaymentPostings(payment({ id: "pay3", amount: 2_000, forexDiff: -37 }), opts),
  ...purchasePostings(purchase(), opts),
  ...debitNotePostings(debitNote(), opts),
  ...debitNotePostings(debitNote({ id: "d2", status: "cancelled", cancelledOn: "2026-10-22" }), opts),
  ...expensePostings(expense(), opts),
  ...expensePostings(expense({ id: "e2", vendorGstin: "29AAGCB7383J1Z4", onCredit: true, supplierId: "s2" }), opts),
  ...expensePostings(expense({ id: "e3", status: "cancelled", cancelledOn: "2026-10-23" }), opts),
  ...supplierPaymentPostings(supplierPay(), opts),
  ...supplierPaymentPostings(supplierPay({ id: "sp2", kind: "refund", amount: 700 }), opts),
  ...supplierPaymentPostings(supplierPay({ id: "sp3", reversedOn: "2026-10-25" }), opts),
  ...gstPaymentPostings(gstPay),
  ...gstPaymentPostings({ ...gstPay, id: "g2", status: "cancelled", cancelledOn: "2026-10-26" }),
];

describe("every posting balances", () => {
  it("debits equal credits to the paisa, and no line is negative or both-sided", () => {
    const ps = everything();
    expect(ps.length).toBeGreaterThan(20);
    for (const p of ps) {
      expect(isBalanced(p.lines), `${p.sourceType} ${p.sourceId}`).toBe(true);
      for (const l of p.lines) {
        expect(l.debit >= 0 && l.credit >= 0, `${p.sourceType}: negative amount`).toBe(true);
        expect(l.debit === 0 || l.credit === 0, `${p.sourceType}: line on both sides`).toBe(true);
        expect(Number.isInteger(l.debit) && Number.isInteger(l.credit), `${p.sourceType}: fractional paise`).toBe(true);
      }
    }
  });

  it("the trial balance of all of them balances", () => {
    const m = nets(everything());
    const accounts: AccountInfo[] = [...m.keys()].map((k, i) => ({ id: k, code: String(1000 + i), name: k, type: "asset", group: "g", subGroup: null, key: k, isCash: false, isBank: false }));
    const during = new Map<string, Balance>();
    for (const p of everything()) {
      for (const l of p.lines) {
        const b = during.get(refName(l.account)) ?? { debit: 0, credit: 0 };
        b.debit += l.debit;
        b.credit += l.credit;
        during.set(refName(l.account), b);
      }
    }
    const tb = buildTrialBalance(accounts, new Map(), during, { from: "2026-10-01", to: "2026-10-31" });
    expect(tb.balanced).toBe(true);
    expect(tb.totals.closingDr).toBe(tb.totals.closingCr);
  });
});

describe("what each document does to the books", () => {
  it("an invoice: Dr Debtors ₹118 / Cr Sales 99.99 + CGST 9 + SGST 9 + round-off 0.01", () => {
    const [p] = invoicePostings(invoice(), opts);
    expect(net([p!], SYS.debtors)).toBe(11_800);
    expect(net([p!], SYS.sales)).toBe(-9_999);
    expect(net([p!], SYS.gstOutCgst)).toBe(-900);
    expect(net([p!], SYS.gstOutSgst)).toBe(-900);
    expect(net([p!], SYS.roundOff)).toBe(-1);
  });

  it("a credit note reverses into Sales returns and output GST, round-off the other way", () => {
    const [p] = creditNotePostings(creditNote(), opts);
    expect(net([p!], SYS.debtors)).toBe(-3_900);
    expect(net([p!], SYS.salesReturns)).toBe(3_333);
    expect(net([p!], SYS.gstOutCgst)).toBe(300);
    expect(net([p!], SYS.roundOff)).toBe(-33);
  });

  it("a debit note to a customer adds to Debtors, Sales and output IGST", () => {
    const [p] = salesDebitNotePostings(salesDebit());
    expect(net([p!], SYS.debtors)).toBe(1_200);
    expect(net([p!], SYS.sales)).toBe(-1_000);
    expect(net([p!], SYS.gstOutIgst)).toBe(-180);
    expect(net([p!], SYS.roundOff)).toBe(-20);
  });

  it("the customer's balance is bill − credit note + debit note − payments + refunds", () => {
    const ps = [
      ...invoicePostings(invoice(), opts),
      ...creditNotePostings(creditNote(), opts),
      ...salesDebitNotePostings(salesDebit()),
      ...invoicePaymentPostings(payment(), opts),
      ...invoicePaymentPostings(payment({ id: "pay2", amount: -1_000 }), opts),
    ];
    // 11,800 − 3,900 + 1,200 − 5,000 + 1,000 = 5,100.
    expect(net(ps, SYS.debtors)).toBe(5_100);
  });

  it("a foreign receipt short by 37 paise books an exchange loss, the bill is settled in full", () => {
    const [p] = invoicePaymentPostings(payment({ amount: 2_000, forexDiff: -37 }), opts);
    expect(net([p!], "money:upi")).toBe(1_963);
    expect(net([p!], SYS.debtors)).toBe(-2_000);
    expect(net([p!], SYS.forex)).toBe(37);
  });

  it("a purchase and its debit note: input IGST taken then given back", () => {
    const ps = [...purchasePostings(purchase(), opts), ...debitNotePostings(debitNote(), opts)];
    expect(net(ps, SYS.gstInIgst)).toBe(5_000 - 500);
    // Creditors: owe 1,05,000, less 10,500 returned.
    expect(net(ps, SYS.creditors)).toBe(-105_000 + 10_500);
    expect(net(ps, SYS.purchases)).toBe(105_000 - 5_000 - 1);
    expect(net(ps, SYS.purchaseReturns)).toBe(-(10_500 - 500));
  });

  it("an expense: odd ITC paisa to CGST; another State's vendor is IGST; on credit it is owed to the supplier", () => {
    const [local] = expensePostings(expense(), opts);
    expect(net([local!], SYS.gstInCgst)).toBe(901);
    expect(net([local!], SYS.gstInSgst)).toBe(900);
    expect(net([local!], "exp:cat1")).toBe(10_000);
    expect(net([local!], "money:cash")).toBe(-11_801);
    const [other] = expensePostings(expense({ vendorGstin: "29AAGCB7383J1Z4", onCredit: true, supplierId: "s2" }), opts);
    expect(net([other!], SYS.gstInIgst)).toBe(1_801);
    expect(net([other!], SYS.creditors)).toBe(-11_801);
    expect(net([other!], "money:cash")).toBe(0);
  });

  it("claimed ITC can never exceed what was paid", () => {
    const [p] = expensePostings(expense({ amount: 1_000, itc: 5_000 }), opts);
    expect(net([p!], "exp:cat1")).toBe(0);
    expect(net([p!], SYS.gstInCgst) + net([p!], SYS.gstInSgst)).toBe(1_000);
    expect(isBalanced(p!.lines)).toBe(true);
  });
});

describe("cancellations and reversals net to nothing", () => {
  const cases: [string, Posting[]][] = [
    ["invoice", invoicePostings(invoice({ status: "cancelled", cancelledOn: "2026-10-03" }), opts)],
    ["sales debit note", salesDebitNotePostings(salesDebit({ status: "cancelled", cancelledOn: "2026-10-08" }))],
    ["purchase", purchasePostings(purchase({ status: "cancelled", cancelledOn: "2026-10-04" }), opts)],
    ["debit note", debitNotePostings(debitNote({ status: "cancelled", cancelledOn: "2026-10-10" }), opts)],
    ["expense", expensePostings(expense({ status: "cancelled", cancelledOn: "2026-10-11" }), opts)],
    ["supplier payment", supplierPaymentPostings(supplierPay({ reversedOn: "2026-10-13" }), opts)],
    ["composition tax", gstPaymentPostings({ ...gstPay, status: "cancelled", cancelledOn: "2026-10-19" })],
  ];
  for (const [name, ps] of cases) {
    it(`${name}: two postings, every account back to zero, dated at the cancellation`, () => {
      expect(ps).toHaveLength(2);
      for (const [, v] of nets(ps)) expect(v).toBe(0);
      expect(totalOf(ps[1]!.lines)).toEqual(totalOf(ps[0]!.lines));
      expect(ps[1]!.date > ps[0]!.date).toBe(true);
    });
  }

  it("a credit note on a cancelled bill posts nothing (the bill's cancellation already undid it)", () => {
    expect(creditNotePostings(creditNote({ invoiceCancelled: true }), opts)).toEqual([]);
    expect(creditNotePostings(creditNote({ status: "cancelled" }), opts)).toEqual([]);
  });

  it("zero amounts post nothing", () => {
    expect(invoicePaymentPostings(payment({ amount: 0 }), opts)).toEqual([]);
    expect(supplierPaymentPostings(supplierPay({ amount: 0 }), opts)).toEqual([]);
    expect(expensePostings(expense({ amount: 0 }), opts)).toEqual([]);
    expect(salesDebitNotePostings(salesDebit({ total: 0 }))).toEqual([]);
    expect(gstPaymentPostings({ ...gstPay, amount: 0 })).toEqual([]);
  });
});
