import { describe, expect, it } from "vitest";
import { SYS } from "./chart";
import type { CreditNoteSrc, DebitNoteSrc, ExpenseSrc, InvoicePaymentSrc, InvoiceSrc, PurchaseSrc, SupplierPaymentSrc, TillSrc } from "./ports";
import {
  accountOpeningPosting,
  creditNotePostings,
  debitNotePostings,
  effectiveDate,
  expensePostings,
  gstPaymentPostings,
  invoicePaymentPostings,
  invoicePostings,
  isBalanced,
  itcSplit,
  openingPartiesPosting,
  postingHash,
  purchasePostings,
  receiptPostings,
  stockAdjustmentPostings,
  supplierPaymentPostings,
  tillPostings,
  totalOf,
  type Posting,
  type RuleOptions,
} from "./rules";

const opts: RuleOptions = { importedBills: "exclude", shopState: "33" };

const invoice = (over: Partial<InvoiceSrc> = {}): InvoiceSrc => ({
  id: "i1",
  number: "INV-1",
  date: "2026-10-01",
  status: "issued",
  imported: false,
  customerId: "c1",
  customerName: "Meena",
  // 2 x 1000 + 18% = 2360; discount 100 -> taxable 1900, gst 342, total 2242 -> rounded 2242.00
  subtotal: 200_000,
  discount: 10_000,
  taxable: 190_000,
  cgst: 17_100,
  sgst: 17_100,
  igst: 0,
  roundOff: 0,
  total: 224_200,
  cancelledOn: null,
  ...over,
});

const amountOn = (p: Posting, key: string) =>
  p.lines.filter((l) => "key" in l.account && l.account.key === key).reduce((t, l) => t + l.debit - l.credit, 0);

describe("sales rules", () => {
  it("posts an invoice: debtors, discount, sales and output GST balance", () => {
    const [p] = invoicePostings(invoice(), opts);
    expect(p!.sourceType).toBe("invoice");
    expect(isBalanced(p!.lines)).toBe(true);
    expect(amountOn(p!, SYS.debtors)).toBe(224_200);
    expect(amountOn(p!, SYS.discountAllowed)).toBe(10_000);
    expect(amountOn(p!, SYS.sales)).toBe(-200_000);
    expect(amountOn(p!, SYS.gstOutCgst)).toBe(-17_100);
    expect(amountOn(p!, SYS.gstOutSgst)).toBe(-17_100);
    expect(p!.lines.find((l) => "key" in l.account && l.account.key === SYS.debtors)!.party).toEqual({ type: "customer", id: "c1" });
  });

  it("handles round-off in both directions and stays balanced", () => {
    for (const roundOff of [-40, 40]) {
      const [p] = invoicePostings(invoice({ roundOff, total: 224_200 }), opts);
      expect(isBalanced(p!.lines)).toBe(true);
      expect(amountOn(p!, SYS.roundOff)).toBe(-roundOff);
    }
  });

  it("uses IGST for inter-state bills", () => {
    const [p] = invoicePostings(invoice({ cgst: 0, sgst: 0, igst: 34_200 }), opts);
    expect(amountOn(p!, SYS.gstOutIgst)).toBe(-34_200);
    expect(isBalanced(p!.lines)).toBe(true);
  });

  it("a cancelled invoice gets a second posting that exactly undoes the first, dated at the cancellation", () => {
    const [a, b] = invoicePostings(invoice({ status: "cancelled", cancelledOn: "2026-10-05" }), opts);
    expect(b!.sourceType).toBe("invoice_cancel");
    expect(b!.date).toBe("2026-10-05");
    expect(totalOf(a!.lines).debit).toBe(totalOf(b!.lines).credit);
    const net = new Map<string, number>();
    for (const l of [...a!.lines, ...b!.lines]) {
      const k = JSON.stringify(l.account);
      net.set(k, (net.get(k) ?? 0) + l.debit - l.credit);
    }
    expect([...net.values()].every((v) => v === 0)).toBe(true);
  });

  it("a cancellation dated before the bill falls back to the bill date", () => {
    const [, b] = invoicePostings(invoice({ status: "cancelled", cancelledOn: "2026-09-01" }), opts);
    expect(b!.date).toBe("2026-10-01");
  });

  it("leaves imported bills out unless the setting says to post them", () => {
    expect(invoicePostings(invoice({ imported: true }), opts)).toHaveLength(0);
    expect(invoicePostings(invoice({ imported: true }), { ...opts, importedBills: "post" })).toHaveLength(1);
  });

  it("posts payments by method and skips receipt allocations", () => {
    const pay = (over: Partial<InvoicePaymentSrc>): InvoicePaymentSrc => ({
      id: "p1",
      invoiceId: "i1",
      invoiceNumber: "INV-1",
      customerId: "c1",
      customerName: "Meena",
      imported: false,
      date: "2026-10-02",
      amount: 50_000,
      method: "cash",
      receiptId: null,
      ...over,
    });
    const [cash] = invoicePaymentPostings(pay({}), opts);
    expect(cash!.lines).toEqual([
      expect.objectContaining({ account: { method: "cash" }, debit: 50_000 }),
      expect.objectContaining({ account: { key: SYS.debtors }, credit: 50_000, party: { type: "customer", id: "c1" } }),
    ]);
    const [refund] = invoicePaymentPostings(pay({ amount: -30_000, method: "upi" }), opts);
    expect(refund!.lines[0]).toMatchObject({ account: { key: SYS.debtors }, debit: 30_000 });
    expect(refund!.lines[1]).toMatchObject({ account: { method: "upi" }, credit: 30_000 });
    expect(invoicePaymentPostings(pay({ receiptId: "r1" }), opts)).toHaveLength(0);
  });

  it("posts a customer receipt once, as the whole amount", () => {
    const [p] = receiptPostings({ id: "r1", customerId: "c1", customerName: "Meena", date: "2026-10-03", amount: 100_000, method: "bank", reference: "UTR1" });
    expect(isBalanced(p!.lines)).toBe(true);
    expect(p!.sourceType).toBe("customer_receipt");
  });

  it("posts a credit note as a bill in reverse against sales returns, and skips it when the bill was cancelled", () => {
    const cn: CreditNoteSrc = {
      id: "cn1",
      number: "CN-1",
      invoiceNumber: "INV-1",
      date: "2026-10-04",
      status: "issued",
      invoiceCancelled: false,
      invoiceImported: false,
      customerId: "c1",
      customerName: "Meena",
      total: 118_000,
      taxable: 100_000,
      cgst: 9_000,
      sgst: 9_000,
      igst: 0,
      roundOff: 0,
      cancelledOn: null,
    };
    const [p] = creditNotePostings(cn, opts);
    expect(isBalanced(p!.lines)).toBe(true);
    expect(amountOn(p!, SYS.salesReturns)).toBe(100_000);
    expect(amountOn(p!, SYS.gstOutCgst)).toBe(9_000);
    expect(amountOn(p!, SYS.debtors)).toBe(-118_000);
    expect(creditNotePostings({ ...cn, invoiceCancelled: true }, opts)).toHaveLength(0);
    expect(creditNotePostings({ ...cn, status: "cancelled" }, opts)).toHaveLength(0);
  });
});

describe("purchase rules", () => {
  const purchase = (over: Partial<PurchaseSrc> = {}): PurchaseSrc => ({
    id: "pu1",
    billNumber: "S-77",
    date: "2026-10-02",
    status: "recorded",
    imported: false,
    supplierId: "s1",
    supplierName: "Kumar Traders",
    cgst: 9_000,
    sgst: 9_000,
    igst: 0,
    roundOff: 0,
    total: 118_000,
    cancelledOn: null,
    ...over,
  });

  it("posts a purchase: purchases and input GST against creditors", () => {
    const [p] = purchasePostings(purchase(), opts);
    expect(isBalanced(p!.lines)).toBe(true);
    expect(amountOn(p!, SYS.purchases)).toBe(100_000);
    expect(amountOn(p!, SYS.gstInCgst)).toBe(9_000);
    expect(amountOn(p!, SYS.creditors)).toBe(-118_000);
  });

  it("keeps freight inside purchases and balances with round-off", () => {
    const [p] = purchasePostings(purchase({ total: 118_450, roundOff: 0 }), opts);
    expect(isBalanced(p!.lines)).toBe(true);
    expect(amountOn(p!, SYS.purchases)).toBe(100_450);
    for (const roundOff of [30, -30]) expect(isBalanced(purchasePostings(purchase({ roundOff }), opts)[0]!.lines)).toBe(true);
  });

  it("cancels a purchase with a mirror posting", () => {
    const out = purchasePostings(purchase({ status: "cancelled", cancelledOn: "2026-10-09" }), opts);
    expect(out.map((x) => x.sourceType)).toEqual(["purchase", "purchase_cancel"]);
    expect(out[1]!.date).toBe("2026-10-09");
  });

  it("pays and refunds suppliers; a reversed payment gets a reversal posting", () => {
    const base: SupplierPaymentSrc = { id: "sp1", supplierId: "s1", supplierName: "Kumar Traders", purchaseBill: "S-77", purchaseImported: false, kind: "payment", amount: 40_000, mode: "upi", date: "2026-10-03", reversedOn: null };
    const [pay] = supplierPaymentPostings(base, opts);
    expect(pay!.lines[0]).toMatchObject({ account: { key: SYS.creditors }, debit: 40_000 });
    expect(pay!.lines[1]).toMatchObject({ account: { method: "upi" }, credit: 40_000 });
    const [refund] = supplierPaymentPostings({ ...base, kind: "refund" }, opts);
    expect(refund!.lines[0]).toMatchObject({ account: { method: "upi" }, debit: 40_000 });
    const both = supplierPaymentPostings({ ...base, reversedOn: "2026-10-06" }, opts);
    expect(both.map((x) => x.sourceType)).toEqual(["supplier_payment", "supplier_payment_reversal"]);
    expect(both[1]!.lines[0]).toMatchObject({ account: { key: SYS.creditors }, credit: 40_000 });
  });

  it("posts a debit note against purchase returns", () => {
    const dn: DebitNoteSrc = { id: "d1", number: "DN-1", date: "2026-10-05", status: "issued", supplierId: "s1", supplierName: "Kumar Traders", purchaseImported: false, total: 59_000, cgst: 4_500, sgst: 4_500, igst: 0, roundOff: 0, cancelledOn: null };
    const [p] = debitNotePostings(dn, opts);
    expect(isBalanced(p!.lines)).toBe(true);
    expect(amountOn(p!, SYS.creditors)).toBe(59_000);
    expect(amountOn(p!, SYS.purchaseReturns)).toBe(-50_000);
    expect(amountOn(p!, SYS.gstInCgst)).toBe(-4_500);
  });
});

describe("expense and till rules", () => {
  const exp = (over: Partial<ExpenseSrc> = {}): ExpenseSrc => ({
    id: "e1",
    date: "2026-10-02",
    status: "recorded",
    categoryId: "cat1",
    categoryName: "Rent",
    amount: 118_000,
    gstAmount: 18_000,
    itc: 18_000,
    vendorName: "Kumar Estates",
    vendorGstin: "33AAGCB7383J1ZF",
    paymentMethod: "bank",
    cancelledOn: null,
    ...over,
  });

  it("expenses with ITC: expense net of GST, input GST split, money out", () => {
    const [p] = expensePostings(exp(), opts);
    expect(isBalanced(p!.lines)).toBe(true);
    expect(p!.lines[0]).toMatchObject({ account: { expenseCategory: { id: "cat1", name: "Rent" } }, debit: 100_000 });
    expect(amountOn(p!, SYS.gstInCgst)).toBe(9_000);
    expect(amountOn(p!, SYS.gstInSgst)).toBe(9_000);
    expect(p!.lines.at(-1)).toMatchObject({ account: { method: "bank" }, credit: 118_000 });
  });

  it("expenses without ITC put the whole amount in the expense", () => {
    const [p] = expensePostings(exp({ itc: 0 }), opts);
    expect(p!.lines).toHaveLength(2);
    expect(p!.lines[0]).toMatchObject({ debit: 118_000 });
  });

  it("splits ITC into IGST for a vendor from another state, and odd paise stay balanced", () => {
    expect(itcSplit(101, "29AAGCB7383J1Z4", "33")).toEqual({ cgst: 0, sgst: 0, igst: 101 });
    expect(itcSplit(101, "33AAGCB7383J1ZF", "33")).toEqual({ cgst: 51, sgst: 50, igst: 0 });
    expect(itcSplit(100, null, "33")).toEqual({ cgst: 50, sgst: 50, igst: 0 });
    const [p] = expensePostings(exp({ gstAmount: 101, itc: 101, amount: 1_101 }), opts);
    expect(isBalanced(p!.lines)).toBe(true);
  });

  it("cancels an expense with a mirror posting", () => {
    const out = expensePostings(exp({ status: "cancelled", cancelledOn: "2026-10-10" }), opts);
    expect(out.map((x) => x.sourceType)).toEqual(["expense", "expense_cancel"]);
  });

  it("till: cash difference and cash in/out", () => {
    const till: TillSrc = { id: "t1", register: "Counter 1", status: "closed", closedOn: "2026-10-02", difference: -500, cashEntries: [{ id: "a", amount: 20_000, reason: "float", on: "2026-10-02" }, { id: "b", amount: -5_000, reason: "tea", on: "2026-10-02" }] };
    const out = tillPostings(till);
    expect(out.map((x) => x.sourceType)).toEqual(["till_difference", "till_cash", "till_cash"]);
    expect(out[0]!.lines[0]).toMatchObject({ account: { key: SYS.cashShortExcess }, debit: 500 });
    expect(out[2]!.sourceId).toBe("t1:b");
    expect(tillPostings({ ...till, status: "open", difference: null, cashEntries: [] })).toHaveLength(0);
    expect(tillPostings({ ...till, difference: 300, cashEntries: [] })[0]!.lines[0]).toMatchObject({ account: { key: SYS.cash }, debit: 300 });
  });
});

describe("till handover and categories", () => {
  const base: TillSrc = { id: "t1", register: "Counter 1", status: "open", closedOn: null, difference: null, cashEntries: [] };
  it("posts a handover difference like a closing one, once per handover", () => {
    const out = tillPostings({ ...base, handovers: [{ id: "h1", difference: -300, on: "2026-10-02" }, { id: "h2", difference: 0, on: "2026-10-02" }] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ sourceType: "till_difference", sourceId: "t1:h:h1", date: "2026-10-02" });
    expect(out[0]!.lines[0]).toMatchObject({ account: { key: SYS.cashShortExcess }, debit: 300 });
    expect(isBalanced(out[0]!.lines)).toBe(true);
  });
  it("names the pay-in / pay-out category in the narration", () => {
    const [p] = tillPostings({ ...base, cashEntries: [{ id: "a", amount: -5_000, reason: "tea", on: "2026-10-02", category: "petty_expense" }] });
    expect(p!.narration).toBe("Cash taken out of Counter 1 (petty expense): tea");
  });
});

describe("stock adjustments", () => {
  it("opening stock goes against opening equity, found stock to gains, write-offs the other way", () => {
    const [open] = stockAdjustmentPostings({ id: "m1", date: "2026-04-01", reason: "opening", value: 50_000, itemName: "Cable" });
    expect(amountOn(open!, SYS.stock)).toBe(50_000);
    expect(amountOn(open!, SYS.openingEquity)).toBe(-50_000);
    const [found] = stockAdjustmentPostings({ id: "m2", date: "2026-04-02", reason: "adjustment", value: 1_000, itemName: null });
    expect(amountOn(found!, SYS.stockAdjustment)).toBe(-1_000);
    const [lost] = stockAdjustmentPostings({ id: "m3", date: "2026-04-03", reason: "adjustment", value: -2_500, itemName: null });
    expect(amountOn(lost!, SYS.stockAdjustment)).toBe(2_500);
    expect(amountOn(lost!, SYS.stock)).toBe(-2_500);
    expect(isBalanced(lost!.lines)).toBe(true);
    expect(stockAdjustmentPostings({ id: "m4", date: "2026-04-03", reason: "adjustment", value: 0, itemName: null })).toHaveLength(0);
  });
});

describe("opening balances", () => {
  it("balances customers and suppliers against opening balance equity", () => {
    const [p] = openingPartiesPosting([{ id: "c1", name: "A", opening: 50_000 }, { id: "c2", name: "B", opening: -10_000 }], [{ id: "s1", name: "S", opening: 30_000 }], "2026-04-01");
    expect(isBalanced(p!.lines)).toBe(true);
    expect(amountOn(p!, SYS.debtors)).toBe(40_000);
    expect(amountOn(p!, SYS.creditors)).toBe(-30_000);
    expect(amountOn(p!, SYS.openingEquity)).toBe(-10_000);
  });

  it("returns nothing when there is nothing to open", () => {
    expect(openingPartiesPosting([], [], "2026-04-01")).toHaveLength(0);
    expect(accountOpeningPosting([{ id: "a", openingBalance: 0 }], "2026-04-01")).toHaveLength(0);
  });

  it("account openings keep the sign (debit-positive) and plug the difference", () => {
    const [p] = accountOpeningPosting([{ id: "cash", openingBalance: 10_000 }, { id: "loan", openingBalance: -4_000 }], "2026-04-01");
    expect(isBalanced(p!.lines)).toBe(true);
    expect(amountOn(p!, SYS.openingEquity)).toBe(-6_000);
  });
});

describe("identity and locks", () => {
  it("hashes the same posting to the same value and changes when anything changes", () => {
    const [a] = invoicePostings(invoice(), opts);
    const [b] = invoicePostings(invoice(), opts);
    expect(postingHash(a!)).toBe(postingHash(b!));
    expect(postingHash(a!)).not.toBe(postingHash({ ...a!, date: "2026-10-02" }));
    const [c] = invoicePostings(invoice({ total: 224_300 }), opts);
    expect(postingHash(c!)).not.toBe(postingHash(a!));
  });

  it("moves a posting past a locked period", () => {
    expect(effectiveDate("2026-09-30", "2026-09-30")).toEqual({ date: "2026-10-01", late: true });
    expect(effectiveDate("2026-10-01", "2026-09-30")).toEqual({ date: "2026-10-01", late: false });
    expect(effectiveDate("2026-10-01", null)).toEqual({ date: "2026-10-01", late: false });
    expect(effectiveDate("2026-12-31", "2026-12-31").date).toBe("2027-01-01");
  });
});

describe("composition tax paid", () => {
  const pay = { id: "g1", date: "2026-10-18", amount: 1_410, mode: "bank" as const, status: "paid" as const, cancelledOn: null, period: "2026-Q2" };
  it("is an expense paid from the money account, with no GST account touched", () => {
    const [p] = gstPaymentPostings(pay);
    expect(isBalanced(p!.lines)).toBe(true);
    expect(p!.lines.map((l) => l.account)).toEqual([{ key: SYS.compositionTax }, { method: "bank" }]);
    expect(p!.lines[0]!.debit).toBe(1_410);
    expect(p!.lines.some((l) => "key" in l.account && l.account.key.startsWith("gst_"))).toBe(false);
  });
  it("is mirrored when cancelled and ignores zero amounts", () => {
    const ps = gstPaymentPostings({ ...pay, status: "cancelled", cancelledOn: "2026-10-20" });
    expect(ps.map((p) => p.sourceType)).toEqual(["gst_payment", "gst_payment_cancel"]);
    expect(ps[1]!.date).toBe("2026-10-20");
    expect(gstPaymentPostings({ ...pay, amount: 0 })).toEqual([]);
  });
});
