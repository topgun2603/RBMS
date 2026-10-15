import { describe, expect, it } from "vitest";
import {
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
    expect(Object.keys(s)).toHaveLength(17);
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
