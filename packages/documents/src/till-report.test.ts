import { describe, expect, it } from "vitest";
import { renderTillReport } from "./renderers/till";
import { DEFAULT_BRANDING } from "./service";
import type { TillDocData } from "./types";

const en = { locale: "en" as const, branding: DEFAULT_BRANDING };
const ta = { locale: "ta" as const, branding: DEFAULT_BRANDING };
const bodyOf = (html: string) => html.slice(html.indexOf("<body>"));

const tax = (gstRate: number, taxable: number) => ({ gstRate, taxable, cgst: Math.round((taxable * gstRate) / 200), sgst: Math.round((taxable * gstRate) / 200), igst: 0 });

const session = (over: Partial<TillDocData> = {}): TillDocData => ({
  register: "Counter 1",
  status: "closed",
  date: "2026-10-27",
  openedAt: new Date("2026-10-27T03:30:00Z"),
  openedByName: "Meena",
  closedAt: new Date("2026-10-27T15:30:00Z"),
  closedByName: "Kumar",
  openingCash: 100_000,
  zNumber: 7,
  cashierName: "Kumar",
  cashEntries: [
    { amount: -5_000, category: "petty_expense", reason: "tea & <snacks>", byName: "Meena", at: "2026-10-27T06:00:00Z" },
    { amount: 20_000, category: "change_float", reason: "", byName: "Meena", at: "2026-10-27T07:00:00Z" },
  ],
  handovers: [{ at: "2026-10-27T09:00:00Z", fromName: "Meena", toName: "Kumar", expected: 150_000, counted: 149_000, difference: -1_000, note: "coins short", approvedByName: null }],
  closingCount: { 500: 4, 100: 3 },
  expectedCash: 234_000,
  countedCash: 230_000,
  difference: -4_000,
  differenceReason: "gave extra change",
  closeApprovedByName: "Owner Raja",
  note: null,
  report: {
    bills: { count: 12, total: 560_000, cancelled: 1 },
    payments: [
      { method: "cash", amount: 150_000, count: 8 },
      { method: "upi", amount: 400_000, count: 4 },
    ],
    refunds: [{ method: "cash", amount: 20_000, count: 1 }],
    creditNotes: { count: 1, total: 20_000 },
    onCredit: 0,
    collected: 550_000,
    refunded: 20_000,
    cash: { opening: 100_000, sales: 150_000, refunds: 20_000, cashIn: 20_000, cashOut: 5_000, handoverAdjust: -1_000, expected: 234_000 },
    voids: { count: 1, total: 9_900 },
    discounts: { total: 12_000, bills: 3 },
    taxByRate: [tax(5, 200_000), tax(18, 300_000)],
    returnsTaxByRate: [tax(5, 20_000)],
    billRange: { from: "INV/26-27/0101", to: "INV/26-27/0112" },
    cashByCategory: [
      { category: "change_float", cashIn: 20_000, cashOut: 0, count: 1 },
      { category: "petty_expense", cashIn: 0, cashOut: 5_000, count: 1 },
    ],
  },
  seller: { legalName: "Raja Stores", gstin: "33AAACR5055K1ZE", address: null, city: null, pincode: null, stateCode: "33", phone: null, email: null } as TillDocData["seller"],
  ...over,
});

describe("Z / X report PDF", () => {
  it("prints the Z number, bill range, sales, returns, discounts, voids and tax by rate", () => {
    const html = renderTillReport(session(), en, "80mm");
    const b = bodyOf(html);
    expect(b).toContain("Z report (day close) · Z7");
    expect(b).toContain("INV/26-27/0101 – INV/26-27/0112");
    expect(b).toContain("Discounts given");
    expect(b).toContain("Voided bills");
    expect(b).toContain("Net sales (after returns)");
    expect(b).toContain("GST 5%");
    expect(b).toContain("GST 18%");
    expect(b).toContain("Tax returned");
    expect(b).toContain("It cannot be re-opened");
  });

  it("shows cash expected, counted, the difference, its reason and the approving manager", () => {
    const b = bodyOf(renderTillReport(session(), en));
    expect(b).toContain("Cash expected");
    expect(b).toContain("Cash counted");
    expect(b).toContain("Short");
    expect(b).toContain("gave extra change");
    expect(b).toContain("Approved by: Owner Raja");
    expect(b).toContain("Handover differences");
  });

  it("lists pay-in / pay-out by category and escapes the notes", () => {
    const b = bodyOf(renderTillReport(session(), en));
    expect(b).toContain("Pay-in / pay-out");
    expect(b).toContain("Petty expense");
    expect(b).toContain("Change float");
    expect(b).toContain("tea &amp; &lt;snacks&gt;");
    expect(b).not.toContain("<snacks>");
  });

  it("records both cashiers of a handover", () => {
    const b = bodyOf(renderTillReport(session(), en));
    expect(b).toContain("Drawer handovers");
    expect(b).toContain("Meena → Kumar");
    expect(b).toContain("coins short");
  });

  it("an open session is an X report: running totals, no Z number, no signature lines", () => {
    const b = bodyOf(renderTillReport(session({ status: "open", closedAt: null, closedByName: null, zNumber: null, countedCash: null, difference: null, expectedCash: null, closingCount: null }), en));
    expect(b).toContain("X report");
    expect(b).not.toContain("Z7");
    expect(b).toContain("nothing is reset");
    expect(b).not.toContain("Manager's signature");
  });

  it("is available in Tamil", () => {
    const b = bodyOf(renderTillReport(session(), ta));
    expect(b).toContain("Z அறிக்கை (நாள் முடிவு)");
    expect(b).toContain("சிறு செலவு");
    expect(b).toContain("மீண்டும் திறக்க முடியாது");
  });

  it("sets the page for 58 mm, 80 mm and A4", () => {
    expect(renderTillReport(session(), en, "58mm")).toContain("width:54mm");
    expect(renderTillReport(session(), en, "80mm")).toContain("width:74mm");
    const a4 = renderTillReport(session(), en, "A4");
    expect(a4).toContain("size:A4");
    expect(a4).toContain("max-width:170mm");
  });

  it("reads an older frozen report that has none of the newer blocks", () => {
    const old = session({
      zNumber: null,
      handovers: undefined,
      differenceReason: null,
      closeApprovedByName: null,
      report: { ...session().report, voids: undefined, discounts: undefined, taxByRate: undefined, returnsTaxByRate: undefined, billRange: undefined, cashByCategory: undefined },
      cashEntries: [{ amount: -5_000, reason: "tea", at: "2026-10-27T06:00:00Z" }],
    });
    const b = bodyOf(renderTillReport(old, en));
    expect(b).toContain("Z report (day close)");
    expect(b).toContain("Other: tea");
    expect(b).not.toContain("Tax by GST rate");
  });
});
