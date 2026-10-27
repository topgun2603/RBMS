import { describe, expect, it } from "vitest";
import { SYS, STANDARD_CHART } from "./chart";
import type { InvoicePaymentSrc } from "./ports";
import { invoicePaymentPostings, isBalanced, type RuleOptions } from "./rules";

const opts: RuleOptions = { importedBills: "exclude", shopState: "33" };
const pay = (over: Partial<InvoicePaymentSrc>): InvoicePaymentSrc => ({
  id: "p1",
  invoiceId: "i1",
  invoiceNumber: "INV/26-27/0101",
  customerId: "c1",
  customerName: "Madison Imports LLC",
  imported: false,
  date: "2026-11-20",
  amount: 83_250_00,
  method: "bank",
  receiptId: null,
  ...over,
});
const line = (lines: { account: unknown; debit: number; credit: number }[], k: string) => lines.find((l) => (l.account as { key?: string }).key === k);

describe("foreign-currency receipts (docs/accounting.md: Foreign currency)", () => {
  it("has a standard Foreign exchange gain or loss account", () => {
    expect(STANDARD_CHART.find((a) => a.key === SYS.forex)).toMatchObject({ type: "income", group: "other_income" });
  });

  it("posts an exchange gain: bank gets what it paid, debtors settled at the bill's rate", () => {
    // USD 1,000 billed at ₹83.25 (₹83,250), received at ₹84.10 (₹84,100): gain ₹850.
    const [p] = invoicePaymentPostings(pay({ forexDiff: 850_00 }), opts);
    expect(isBalanced(p!.lines)).toBe(true);
    expect(p!.lines[0]).toMatchObject({ account: { method: "bank" }, debit: 84_100_00, credit: 0 });
    expect(line(p!.lines, SYS.debtors)).toMatchObject({ debit: 0, credit: 83_250_00 });
    expect(line(p!.lines, SYS.forex)).toMatchObject({ debit: 0, credit: 850_00 });
  });

  it("posts an exchange loss as a debit", () => {
    const [p] = invoicePaymentPostings(pay({ forexDiff: -1_250_00 }), opts);
    expect(isBalanced(p!.lines)).toBe(true);
    expect(p!.lines[0]).toMatchObject({ debit: 82_000_00 });
    expect(line(p!.lines, SYS.forex)).toMatchObject({ debit: 1_250_00, credit: 0 });
  });

  it("leaves rupee payments exactly as before (same lines, so the same posting hash)", () => {
    const [p] = invoicePaymentPostings(pay({}), opts);
    expect(p!.lines).toHaveLength(2);
    expect(line(p!.lines, SYS.forex)).toBeUndefined();
  });
});
