import { describe, expect, it, vi } from "vitest";
import { APPAREL_FOOTWEAR_GST_RULE } from "@rbms/gst";
import { html, i18nFor, text } from "../testkit";
import { BalancePill, balanceInk, balanceSide, ledgerTypeMeta, LEDGER_TYPE, OverduePill, overdueInfo, statementMessage, statementUrl, waLink } from "./credit-book/credit-book-ui";
import { normalizeLedger } from "./credit-book/ledger-view";
import { chargeInputs, chargesTotal, type ChargeDraft } from "./inventory/landed-charges";
import { PurchaseStatusPill, StockStatusPill, cleanQty, round3, stockState } from "./inventory/stock-meta";
import { ExpiryPill, fmtDay, fmtStamp } from "./inventory/batch-bits";
import { supplierPartyState } from "./inventory/supplier-picker";
import { tabOfReturn } from "./gst/overview-tab";
import { rupeesToPaiseOrNull } from "./gst/shared";
import { fullProfile, SELLER_DEFAULTS } from "./payments/seller-defaults";
import { isOnlinePayment } from "./payments/send-invoice";
import { pct, rateText, sum } from "./reports/report-ui";
import { categoryLabel } from "./expenses/expense-dialog";
import { aiLowClass } from "./ai/scan-bits";
import { partyState, blankLine, isBlank, parseLine, linesFromInvoice, partyFromInvoice } from "./invoice-form";

const lang = vi.hoisted(() => ({ current: "en" as "en" | "ta" }));
vi.mock("@rbms/web", async (orig) => {
  const real = await orig<typeof import("@rbms/web")>();
  const { i18nFor: make } = await import("../testkit");
  return { ...real, useI18n: () => make(lang.current) };
});

const pill = (node: React.ReactElement, locale: "en" | "ta" = "en") => {
  lang.current = locale;
  return text(html(node));
};

describe("credit book: dues, advances and statements", () => {
  it("calls a positive balance a due, a negative one an advance, zero settled", () => {
    expect(balanceSide(5000)).toBe("due");
    expect(balanceSide(-1)).toBe("advance");
    expect(balanceSide(0)).toBe("settled");
    expect(balanceInk(5000)).toContain("warning");
    expect(balanceInk(-5000)).toContain("success");
    expect(balanceInk(0)).toContain("muted");
  });

  it("shows the right pill word, in both languages", () => {
    expect(pill(<BalancePill balance={5000} />)).toBe("Due");
    expect(pill(<BalancePill balance={-5000} />)).toBe("Advance");
    expect(pill(<BalancePill balance={0} />)).toBe("Settled");
    expect(pill(<BalancePill balance={5000} />, "ta")).toBe("நிலுவை");
  });

  it("reads overdue as an amount, a plain flag, or nothing", () => {
    expect(overdueInfo(25_000)).toEqual({ amount: 25_000 });
    expect(overdueInfo(0)).toBeNull();
    expect(overdueInfo(-5)).toBeNull();
    expect(overdueInfo(true)).toEqual({ amount: null });
    expect(overdueInfo(false)).toBeNull();
    expect(overdueInfo(undefined)).toBeNull();
    expect(overdueInfo("yes")).toBeNull();
    expect(pill(<OverduePill overdue={25_000} />)).toBe("₹250.00 overdue");
    expect(pill(<OverduePill overdue={true} />)).toBe("Overdue");
    expect(pill(<OverduePill overdue={0} />)).toBe("");
    expect(pill(<OverduePill overdue={25_000} />, "ta")).toBe("₹250.00 தவணை கடந்தது");
  });

  it("words the statement message for a due, an advance and a settled account, with a positive amount", () => {
    const t = i18nFor("en").t;
    const v = { name: "Ravi", shop: "Murugan Stores", url: "https://x/s/abc" };
    expect(statementMessage(t, { ...v, balance: 123_456 })).toBe("Hello Ravi, your balance with Murugan Stores is ₹1,234.56. See your statement: https://x/s/abc");
    expect(statementMessage(t, { ...v, balance: -50_000 })).toBe("Hello Ravi, you have an advance of ₹500.00 with Murugan Stores. See your statement: https://x/s/abc");
    expect(statementMessage(t, { ...v, balance: 0 })).toContain("fully settled");
    expect(statementMessage(i18nFor("ta").t, { ...v, balance: 123_456 })).toContain("₹1,234.56");
  });

  it("builds a WhatsApp link with the country code and an encoded message", () => {
    expect(waLink("98765 43210", "Hi & bye")).toBe("https://wa.me/919876543210?text=Hi%20%26%20bye");
    expect(waLink(null, "x")).toBe("https://wa.me/?text=x");
  });

  it("prefers the API's statement URL and falls back to the public page", () => {
    const publicUrl = (p: string) => `https://shop.example/${p}`;
    expect(statementUrl({ token: "abc", url: "https://api/s/abc" }, publicUrl)).toBe("https://api/s/abc");
    expect(statementUrl({ token: "abc" }, publicUrl)).toBe("https://shop.example/s/abc");
  });

  it("falls back to the opening-balance icon for an unknown ledger entry type", () => {
    expect(ledgerTypeMeta("invoice")).toBe(LEDGER_TYPE.invoice);
    expect(ledgerTypeMeta("something_new")).toBe(LEDGER_TYPE.opening);
  });

  it("normalises a ledger from the full response or a bare list, taking the last balance when none is given", () => {
    const e = (balance: number) => ({ balance }) as never;
    expect(normalizeLedger(null)).toEqual({ openingBalance: null, entries: [], closingBalance: null });
    expect(normalizeLedger([e(100), e(250)])).toEqual({ openingBalance: null, entries: [e(100), e(250)], closingBalance: 250 });
    expect(normalizeLedger({ openingBalance: 50, entries: [e(100)], closingBalance: 900 } as never)).toMatchObject({ openingBalance: 50, closingBalance: 900 });
    expect(normalizeLedger({ entries: [e(100), e(250)] } as never)).toMatchObject({ openingBalance: null, closingBalance: 250 });
    // A zero closing balance is a real answer, not a gap.
    expect(normalizeLedger({ entries: [e(100)], closingBalance: 0 } as never).closingBalance).toBe(0);
    expect(normalizeLedger({} as never)).toEqual({ openingBalance: null, entries: [], closingBalance: null });
  });
});

describe("stock and batch status", () => {
  it("shows untracked items as such whatever their status, and unknown statuses as in stock", () => {
    expect(stockState({ track: false, status: "out" })).toBe("untracked");
    expect(stockState({ track: true, status: "low" })).toBe("low");
    expect(stockState({ track: true, status: "out" })).toBe("out");
    expect(stockState({ track: true, status: "weird" as never })).toBe("ok");
  });

  it("labels each stock state", () => {
    expect(pill(<StockStatusPill row={{ track: true, status: "ok" }} />)).toBe("In stock");
    expect(pill(<StockStatusPill row={{ track: true, status: "low" }} />)).toBe("Low");
    expect(pill(<StockStatusPill row={{ track: true, status: "out" }} />)).toBe("Out of stock");
    expect(pill(<StockStatusPill row={{ track: false, status: "out" }} />)).toBe("Not tracked");
  });

  it("labels supplier bills Paid, Unpaid or Cancelled, a cancelled bill never Paid", () => {
    expect(pill(<PurchaseStatusPill paid={true} status="recorded" />)).toBe("Paid");
    expect(pill(<PurchaseStatusPill paid={false} status="recorded" />)).toBe("Unpaid");
    expect(pill(<PurchaseStatusPill paid={true} status="cancelled" />)).toBe("Cancelled");
  });

  it("states days left or overdue on a batch's expiry", () => {
    expect(pill(<ExpiryPill status="expired" daysLeft={-3} />)).toBe("Expired 3 days ago");
    expect(pill(<ExpiryPill status="expiring" daysLeft={12} />)).toBe("12 days left");
    expect(pill(<ExpiryPill status="ok" daysLeft={400} />)).toBe("Fresh");
    expect(pill(<ExpiryPill status="ok" daysLeft={90} />)).toBe("90 days left");
    expect(pill(<ExpiryPill status="none" daysLeft={null} />)).toBe("No expiry");
  });

  it("rounds quantities to three decimals and cleans typed ones", () => {
    expect(round3(1.23456)).toBe(1.235);
    expect(round3(0.1 + 0.2)).toBe(0.3);
    expect(cleanQty("1a2.3456.7")).toBe("12.345");
    expect(cleanQty("abc")).toBe("");
    expect(cleanQty(".5")).toBe(".5");
    expect(cleanQty("007")).toBe("007");
  });

  it("shows dates on India's calendar day and an em dash for none", () => {
    expect(fmtDay("2027-03-31")).toBe("31 Mar 2027");
    expect(fmtDay(null)).toBe("—");
    expect(fmtDay("not a date")).toBe("not a date");
    // 21:00 UTC on 30 Mar is 02:30 IST on 31 Mar.
    expect(fmtStamp("2027-03-30T21:00:00Z")).toBe("31 Mar 2027");
    expect(fmtStamp("2027-03-30T10:00:00Z")).toBe("30 Mar 2027");
    expect(fmtStamp(undefined)).toBe("—");
  });
});

describe("landed charges", () => {
  const d = (over: Partial<ChargeDraft>): ChargeDraft => ({ key: "c", kind: "freight", label: "", amount: "", gstRate: "0", claimable: true, basis: "value", ...over });

  it("skips empty rows and turns typed rupees into paise", () => {
    expect(chargeInputs([d({}), d({ amount: "1,500", gstRate: "18", label: " Lorry " })])).toEqual([{ kind: "freight", label: "Lorry", amount: 150_000, gstRate: 18, claimable: true, basis: "value" }]);
  });

  it("refuses the whole list when one amount is wrong or not positive", () => {
    expect(chargeInputs([d({ amount: "abc" })])).toBeNull();
    expect(chargeInputs([d({ amount: "0" })])).toBeNull();
    expect(chargeInputs([d({ amount: "100" }), d({ amount: "-5" })])).toBeNull();
  });

  it("adds each charge's GST to the bill total: ₹1,000 at 18% and ₹200 at 5% is ₹1,390", () => {
    expect(chargesTotal([d({ amount: "1000", gstRate: "18" }), d({ amount: "200", gstRate: "5" })])).toBe(139_000);
    expect(chargesTotal([d({ amount: "oops" })])).toBe(0);
    expect(chargesTotal([])).toBe(0);
  });
});

describe("small bill helpers", () => {
  it("sends each GST return to the tab where it is prepared", () => {
    expect(tabOfReturn("gstr1")).toBe("gstr1");
    expect(tabOfReturn("gstr3b")).toBe("gstr3b");
    expect(tabOfReturn("pmt06")).toBe("gstr3b");
    expect(tabOfReturn("gstr2b")).toBe("gstr2b");
    expect(tabOfReturn("cmp08")).toBe("composition");
    expect(tabOfReturn("gstr4")).toBe("composition");
  });

  it("reads GST adjustment rupees: empty is zero, negatives allowed, junk is null", () => {
    expect(rupeesToPaiseOrNull("")).toBe(0);
    expect(rupeesToPaiseOrNull("₹1,250.5")).toBe(125_050);
    expect(rupeesToPaiseOrNull("-10")).toBe(-1000);
    expect(rupeesToPaiseOrNull("1.234")).toBeNull();
    expect(rupeesToPaiseOrNull("ten")).toBeNull();
  });

  it("saves the full seller profile: defaults, then what the server has, then the changes", () => {
    const out = fullProfile({ legalName: "Murugan", city: "Madurai", reminderDays: [3] }, { city: "Salem", upiId: "m@bank", phone: undefined, email: null as never });
    expect(out).toMatchObject({ legalName: "Murugan", city: "Salem", upiId: "m@bank", reminderDays: [3], invoicePrefix: "INV", stateCode: "33", sendPaymentReceipts: true });
    // Empty values the user typed are kept (clearing a field), only undefined and null are ignored.
    expect(fullProfile({ terms: "Old" }, { terms: "" }).terms).toBe("");
    expect(fullProfile(undefined).legalName).toBe(SELLER_DEFAULTS.legalName);
    expect(SELLER_DEFAULTS.reminderDays).toEqual([1, 7, 15]);
  });

  it("treats a payment as online by its source, provider or Razorpay-looking reference", () => {
    const p = (o: object) => ({ amount: 1, method: "upi", date: "2026-11-01", reference: null, createdAt: "", ...o }) as never;
    expect(isOnlinePayment(p({ source: "online" }))).toBe(true);
    expect(isOnlinePayment(p({ provider: "razorpay" }))).toBe(true);
    expect(isOnlinePayment(p({ reference: "pay_Abc123" }))).toBe(true);
    expect(isOnlinePayment(p({ reference: "mock_1" }))).toBe(true);
    expect(isOnlinePayment(p({ reference: "UTR998877", source: "manual" }))).toBe(false);
    expect(isOnlinePayment(p({ reference: "my pay_ref" }))).toBe(false);
  });

  it("works out report percentages and sums tolerant of missing numbers", () => {
    expect(pct(1, 3)).toBe(33);
    expect(pct(2, 3)).toBe(67);
    expect(pct(5, 0)).toBe(0);
    expect(sum([{ a: 100 }, { a: null }, { a: undefined }, { a: 50 }], (r) => r.a)).toBe(150);
    expect(rateText(i18nFor("en").t, 18)).toBe("GST 18%");
    expect(rateText(i18nFor("en").t, 0.25)).toBe("GST 0.25%");
  });

  it("translates built-in expense categories and shows the owner's own names as typed", () => {
    const t = i18nFor("en").t;
    expect(categoryLabel(t, { name: "Rent", builtin: true })).toBe("Rent");
    expect(categoryLabel(i18nFor("ta").t, { name: "Rent", builtin: true })).not.toBe("Rent");
    // The owner's own "Rent" category is not rewritten.
    expect(categoryLabel(i18nFor("ta").t, { name: "Rent", builtin: false })).toBe("Rent");
    expect(categoryLabel(t, { name: "Pooja items", builtin: true })).toBe("Pooja items");
  });

  it("tints a low-confidence scanned field only", () => {
    expect(aiLowClass(true)).toContain("ring-warning");
    expect(aiLowClass(false)).toBe("");
  });

  it("finds a supplier's or buyer's state from whichever party kind is picked", () => {
    expect(supplierPartyState({ kind: "none" })).toBe("");
    expect(supplierPartyState({ kind: "oneoff", name: "x", gstin: "", stateCode: "29" })).toBe("29");
    expect(supplierPartyState({ kind: "saved", supplier: { stateCode: "27" } as never })).toBe("27");
    expect(supplierPartyState({ kind: "saved", supplier: { stateCode: null } as never })).toBe("");
    expect(partyState({ kind: "walkin", name: "", phone: "", gstin: "", stateCode: "33" })).toBe("33");
  });
});

describe("bill line form rules", () => {
  const line = (over: Partial<ReturnType<typeof blankLine>> = {}) => ({ ...blankLine("18"), description: "Bucket", qty: "2", rate: "500", ...over });

  it("treats a line with no name and no rate as blank", () => {
    expect(isBlank(blankLine())).toBe(true);
    expect(isBlank(line())).toBe(false);
    expect(isBlank({ ...blankLine(), qty: "5" })).toBe(true);
  });

  it("turns a filled line into paise and a GST rate for the API", () => {
    expect(parseLine(line({ discount: "100", hsn: " 7323 " }))).toEqual({
      input: { description: "Bucket", qty: 2, rate: 50_000, gstRate: 18, hsn: "7323", unit: "pcs", discount: 10_000 },
      errors: {},
    });
  });

  it("flags each bad field with its message key", () => {
    const bad = parseLine(line({ description: " ", qty: "0", rate: "x", discount: "y", hsn: "12" }));
    expect(bad.input).toBeNull();
    expect(bad.errors).toEqual({
      description: "billing.validation.required",
      qty: "billing.validation.qty",
      rate: "billing.validation.amount",
      discount: "billing.validation.amount",
      hsn: "billing.validation.hsn",
    });
  });

  it("accepts 4, 6 and 8 digit HSN codes only", () => {
    for (const ok of ["7323", "732310", "73231010", ""]) expect(parseLine(line({ hsn: ok })).errors.hsn, ok).toBeUndefined();
    for (const bad of ["732", "73231", "7323101", "732310101", "ABCD"]) expect(parseLine(line({ hsn: bad })).errors.hsn, bad).toBe("billing.validation.hsn");
  });

  it("refuses a discount bigger than the line: ₹1,000 line, ₹1,000.01 off", () => {
    expect(parseLine(line({ discount: "1000" })).input).not.toBeNull();
    const over = parseLine(line({ discount: "1000.01" }));
    expect(over.input).toBeNull();
    expect(over.errors.discount).toBe("billing.validation.discount");
  });

  it("allows a free line at a zero rate but not a missing rate", () => {
    expect(parseLine(line({ rate: "0" })).input).toMatchObject({ rate: 0 });
    expect(parseLine(line({ rate: "" })).errors.rate).toBe("billing.validation.amount");
  });

  it("sends the box factor when the unit is an alternate unit of the item", () => {
    const l = line({ unit: "Box", units: [{ unit: "box", factor: 12 } as never], baseUnit: "pcs" });
    expect(parseLine(l).input).toMatchObject({ unit: "Box", unitFactor: 12, baseUnit: "pcs" });
    // Saved bill with no unit list: keep its factor unless it is 1.
    expect(parseLine(line({ unitFactor: 6, baseUnit: "pcs" })).input).toMatchObject({ unitFactor: 6, baseUnit: "pcs" });
    expect(parseLine(line({ unitFactor: 1, baseUnit: "pcs" })).input).not.toHaveProperty("unitFactor");
  });

  it("keeps a batch only when both its id and number are known", () => {
    expect(parseLine(line({ batchId: "b1", batchNo: "B7", batchExpiry: "2027-01-31" })).input).toMatchObject({ batchId: "b1", batchNo: "B7", expiry: "2027-01-31" });
    expect(parseLine(line({ batchId: "b1" })).input).not.toHaveProperty("batchId");
  });

  it("re-bands a price-dependent GST rate on the value after the discount", () => {
    // Apparel up to ₹2,500 per piece is 5%, above it 18%: ₹2,600 less ₹200 is ₹2,400 -> 5%.
    const gstRule = APPAREL_FOOTWEAR_GST_RULE;
    const rate = (over: object) => parseLine(line({ qty: "1", gstRule, ...over })).input?.gstRate;
    expect(rate({ rate: "2600" })).toBe(18);
    expect(rate({ rate: "2600", discount: "200" })).toBe(5);
    // "Not exceeding ₹2,500" is 5%; one paisa more is 18%.
    expect(rate({ rate: "2500" })).toBe(5);
    expect(rate({ rate: "2500.01" })).toBe(18);
  });

  it("brings a saved bill back into the form with rupees, not paise, and keeps its prices fixed", () => {
    const back = linesFromInvoice({ lines: [{ description: "Bucket", qty: 2.5, rate: 123_450, discount: 0, gstRate: 18, hsn: null, unit: "pcs" }, { description: "Mug", qty: 1, rate: 5_000, discount: 250, gstRate: 5, hsn: "3924" }] as never });
    expect(back[0]).toMatchObject({ description: "Bucket", qty: "2.5", rate: "1234.5", discount: "", gstRate: "18", hsn: "", unit: "pcs", rateManual: true });
    expect(back[1]).toMatchObject({ rate: "50", discount: "2.5", gstRate: "5", hsn: "3924", unit: "" });
  });

  it("restores a saved customer or a walk-in buyer from a saved bill", () => {
    const customer = { name: "Ravi", phone: "9876543210", email: null, gstin: null, address: null, stateCode: "33" };
    expect(partyFromInvoice({ customerId: "c1", customer, createdAt: "2026-11-01" } as never)).toMatchObject({ kind: "saved", customer: { id: "c1", name: "Ravi", outstanding: 0 } });
    expect(partyFromInvoice({ customerId: null, customer: { ...customer, phone: null, stateCode: null }, createdAt: "x" } as never)).toEqual({ kind: "walkin", name: "Ravi", phone: "", gstin: "", stateCode: "" });
  });
});
