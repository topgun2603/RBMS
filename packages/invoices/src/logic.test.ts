import { describe, expect, it } from "vitest";
import { computeInvoice, type LineInput } from "./calc";
import {
  allocateProportional,
  applyBillDiscount,
  balanceOf,
  deriveStatus,
  isOverdue,
  monthRange,
  normalizeReminderDays,
  normalizeSeller,
  outstandingOf,
  paymentProblem,
} from "./logic";

describe("deriveStatus", () => {
  it("derives from paid vs total", () => {
    expect(deriveStatus("issued", 1000, 0)).toBe("issued");
    expect(deriveStatus("issued", 1000, 1)).toBe("partially_paid");
    expect(deriveStatus("partially_paid", 1000, 1000)).toBe("paid");
    expect(deriveStatus("paid", 1000, 400)).toBe("partially_paid");
    expect(deriveStatus("partially_paid", 1000, 0)).toBe("issued");
  });
  it("leaves drafts and cancelled invoices alone", () => {
    expect(deriveStatus("draft", 1000, 1000)).toBe("draft");
    expect(deriveStatus("cancelled", 1000, 0)).toBe("cancelled");
  });
});

describe("balanceOf / outstandingOf", () => {
  it("cancelled invoices owe nothing", () => {
    expect(balanceOf({ status: "cancelled", total: 1000, paid: 200 })).toBe(0);
    expect(balanceOf({ status: "partially_paid", total: 1000, paid: 200 })).toBe(800);
  });
  it("sums only issued and partially paid", () => {
    expect(
      outstandingOf([
        { status: "issued", total: 1000, paid: 0 },
        { status: "partially_paid", total: 5000, paid: 2000 },
        { status: "paid", total: 700, paid: 700 },
        { status: "draft", total: 900, paid: 0 },
        { status: "cancelled", total: 400, paid: 0 },
      ]),
    ).toBe(4000);
    expect(outstandingOf([])).toBe(0);
  });
});

describe("isOverdue", () => {
  const today = "2026-10-14";
  const inv = { status: "issued" as const, total: 1000, paid: 0, dueDate: "2026-10-13" };
  it("is overdue after the due date with a balance", () => {
    expect(isOverdue(inv, today)).toBe(true);
    expect(isOverdue({ ...inv, status: "partially_paid", paid: 10 }, today)).toBe(true);
  });
  it("is not overdue on the due date, when paid, without a due date, or when draft/cancelled", () => {
    expect(isOverdue({ ...inv, dueDate: today }, today)).toBe(false);
    expect(isOverdue({ ...inv, status: "paid", paid: 1000 }, today)).toBe(false);
    expect(isOverdue({ ...inv, dueDate: null }, today)).toBe(false);
    expect(isOverdue({ ...inv, status: "draft" }, today)).toBe(false);
    expect(isOverdue({ ...inv, status: "cancelled" }, today)).toBe(false);
  });
});

describe("paymentProblem", () => {
  it("allows payments up to the balance on open invoices", () => {
    expect(paymentProblem({ status: "issued", total: 1000, paid: 0 }, 1000)).toBeNull();
    expect(paymentProblem({ status: "partially_paid", total: 1000, paid: 400 }, 600)).toBeNull();
  });
  it("blocks overpayment and closed invoices", () => {
    expect(paymentProblem({ status: "partially_paid", total: 1000, paid: 400 }, 601)).toMatch(/exceeds/);
    expect(paymentProblem({ status: "draft", total: 1000, paid: 0 }, 1)).toMatch(/Issue/);
    expect(paymentProblem({ status: "cancelled", total: 1000, paid: 0 }, 1)).toMatch(/cancelled/);
    expect(paymentProblem({ status: "paid", total: 1000, paid: 1000 }, 1)).toMatch(/paid/);
  });
});

describe("normalizeSeller", () => {
  it("fills missing fields and defaults the prefix", () => {
    const s = normalizeSeller({ legalName: " Sri Silks ", stateCode: "7" });
    expect(s.legalName).toBe("Sri Silks");
    expect(s.stateCode).toBe("07");
    expect(s.invoicePrefix).toBe("INV");
    expect(s.upiId).toBeNull();
    // 14 text fields (+ lutNumber, lutDate for export bills) and the three messaging settings.
    expect(Object.keys(s)).toHaveLength(19);
  });
  it("defaults the messaging settings when missing", () => {
    const s = normalizeSeller({});
    expect(s).toMatchObject({ autoReminders: false, reminderDays: [1, 7, 15], sendPaymentReceipts: true });
    const t = normalizeSeller({ autoReminders: true, reminderDays: [15, 1, 1, -3, 400, 2.5, 30], sendPaymentReceipts: false });
    expect(t).toMatchObject({ autoReminders: true, reminderDays: [1, 15, 30], sendPaymentReceipts: false });
    expect(normalizeSeller({ reminderDays: [] }).reminderDays).toEqual([]);
    expect(normalizeSeller({ reminderDays: "x" as never }).reminderDays).toEqual([1, 7, 15]);
  });
  it("sanitizes the prefix and derives the state from the GSTIN", () => {
    const s = normalizeSeller({ invoicePrefix: "sri/tex 2026", gstin: "33aaacr5055k1ze", stateCode: "" });
    expect(s.invoicePrefix).toBe("SRITEX");
    expect(s.gstin).toBe("33AAACR5055K1ZE");
    expect(s.stateCode).toBe("33");
  });
  it("handles a missing profile", () => {
    expect(normalizeSeller(null).stateCode).toBeNull();
  });
});

describe("monthRange", () => {
  it("returns the month and next month starts", () => {
    expect(monthRange("2026-10-14")).toEqual({ from: "2026-10-01", to: "2026-11-01" });
    expect(monthRange("2026-12-31")).toEqual({ from: "2026-12-01", to: "2027-01-01" });
  });
});

describe("normalizeReminderDays", () => {
  it("keeps whole days 0–365, unique and sorted", () => {
    expect(normalizeReminderDays([7, "3", 0, 7, 366])).toEqual([0, 3, 7]);
    expect(normalizeReminderDays(null)).toEqual([1, 7, 15]);
  });
});

describe("allocateProportional", () => {
  it("splits exactly by weight with the largest remainder", () => {
    expect(allocateProportional(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateProportional(10, [3, 7])).toEqual([3, 7]);
    expect(allocateProportional(5, [0, 10, 0])).toEqual([0, 5, 0]);
    expect(allocateProportional(0, [5, 5])).toEqual([0, 0]);
    expect(allocateProportional(7, [0, 0])).toEqual([0, 0]);
  });
});

describe("applyBillDiscount", () => {
  const intra = { sellerState: "33", placeOfSupply: "33" };
  const inter = { sellerState: "33", placeOfSupply: "29" };
  const redo = (lines: LineInput[], d: number, opts = intra) => {
    const before = computeInvoice(lines, opts);
    const after = computeInvoice(applyBillDiscount(before.lines, d), opts);
    return { before, after };
  };
  const lineSum = (t: ReturnType<typeof computeInvoice>) => t.lines.reduce((s, l) => s + l.total, 0);

  const mixed: LineInput[] = [
    { description: "Saree", qty: 2, rate: 123_457, gstRate: 5, itemId: "i1", hsn: "5007", unit: "pcs" },
    { description: "Shirt", qty: 3, rate: 49_999, gstRate: 12, discount: 1_000 },
    { description: "Watch", qty: 1, rate: 299_900, gstRate: 18 },
    { description: "Rice", qty: 2.5, rate: 6_000, gstRate: 0 },
    { description: "MRP soap", qty: 4, rate: 4_286, gstRate: 18, inclusiveTotal: 20_230 },
  ];

  it("takes exactly a whole-rupee discount off a mixed-rate bill and recomputes GST", () => {
    for (const opts of [intra, inter]) {
      for (const d of [100, 10_000, 54_300, 300_000]) {
        const { before, after } = redo(mixed, d, opts);
        expect(lineSum(before) - lineSum(after)).toBe(d);
        expect(after.roundOff).toBe(before.roundOff);
        expect(after.total).toBe(before.total - d);
        // Amounts stay; the taxable value drops and GST follows it.
        after.lines.forEach((l, i) => {
          expect(l.amount).toBe(before.lines[i]!.amount);
          expect(l.taxable).toBeLessThanOrEqual(before.lines[i]!.taxable);
          expect(l.discount).toBeGreaterThanOrEqual(before.lines[i]!.discount ?? 0);
          expect(l.total).toBeGreaterThanOrEqual(0);
          expect(l.itemId).toBe(before.lines[i]!.itemId);
          expect(l.hsn).toBe(before.lines[i]!.hsn);
        });
        expect(after.taxable).toBeLessThan(before.taxable);
        expect(after.cgst + after.sgst + after.igst).toBeLessThanOrEqual(before.cgst + before.sgst + before.igst);
      }
    }
  });

  it("splits pro-rata by line value", () => {
    const lines: LineInput[] = [
      { description: "A", qty: 1, rate: 100_000, gstRate: 5 },
      { description: "B", qty: 1, rate: 300_000, gstRate: 5 },
    ];
    const { before, after } = redo(lines, 40_000);
    expect(before.lines.map((l, i) => l.total - after.lines[i]!.total)).toEqual([10_000, 30_000]);
    // ₹950 incl. 5% → taxable round(95000 / 1.05) = 90476.
    expect(after.lines[0]!.taxable).toBe(90_476);
    expect(after.lines[0]!.cgst + after.lines[0]!.sgst).toBe(95_000 - 90_476);
  });

  it("handles a single line", () => {
    const { before, after } = redo([{ description: "Saree", qty: 1, rate: 100_000, gstRate: 5 }], 10_000);
    expect(before.total).toBe(105_000);
    expect(after.total).toBe(95_000);
    expect(after.lines[0]!.amount).toBe(100_000);
    expect(after.lines[0]!.taxable).toBe(90_476);
    expect(after.lines[0]!.discount).toBe(9_524);
  });

  it("can give a line more than its share would suggest only up to its total (discount larger than a small line)", () => {
    const lines: LineInput[] = [
      { description: "Big", qty: 1, rate: 1_000_000, gstRate: 18 },
      { description: "Small", qty: 1, rate: 500, gstRate: 5 },
    ];
    const { before, after } = redo(lines, 50_000);
    expect(50_000).toBeGreaterThan(before.lines[1]!.total);
    expect(lineSum(before) - lineSum(after)).toBe(50_000);
    after.lines.forEach((l) => expect(l.total).toBeGreaterThanOrEqual(0));
    // The whole bill.
    const all = redo(lines, lineSum(before));
    expect(all.after.lines.every((l) => l.total === 0 && l.taxable === 0)).toBe(true);
  });

  it("leaves lines unchanged for a zero discount", () => {
    const before = computeInvoice(mixed, intra);
    const out = applyBillDiscount(before.lines, 0);
    expect(computeInvoice(out, intra)).toEqual(before);
    expect(out.some((l) => l.inclusiveTotal !== undefined && l.description !== "MRP soap")).toBe(false);
  });

  it("refuses more than the bill unless told to cap, and bad amounts", () => {
    const before = computeInvoice([{ description: "A", qty: 1, rate: 1_000, gstRate: 5 }], intra);
    expect(() => applyBillDiscount(before.lines, 1_051)).toThrow(RangeError);
    expect(() => applyBillDiscount(before.lines, -1)).toThrow(RangeError);
    expect(() => applyBillDiscount(before.lines, 1.5)).toThrow(RangeError);
    const capped = computeInvoice(applyBillDiscount(before.lines, 5_000, { strict: false }), intra);
    expect(capped.lines[0]!.total).toBe(0);
  });
});
