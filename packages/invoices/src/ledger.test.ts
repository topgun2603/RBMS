import { describe, expect, it } from "vitest";
import {
  addDaysISO,
  ageingKey,
  ageingReport,
  allocateFifo,
  applyPaidDelta,
  buildLedger,
  creditLimitExceeded,
  dateText,
  daysBetween,
  ledgerBalance,
  ledgerEvents,
  maskPhone,
  moneyText,
  reminderDayFor,
  reverseAllocations,
  toIndianE164,
  type OpenBill,
} from "./ledger";

const bill = (id: string, date: string, total: number, paid = 0, extra: Partial<OpenBill> = {}): OpenBill => ({
  id,
  number: `INV/26-27/${id}`,
  date,
  status: paid === 0 ? "issued" : paid >= total ? "paid" : "partially_paid",
  total,
  paid,
  ...extra,
});

describe("dates", () => {
  it("adds days across months, years and leap days", () => {
    expect(addDaysISO("2026-10-14", 3)).toBe("2026-10-17");
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysISO("2028-03-01", -1)).toBe("2028-02-29");
    expect(addDaysISO("2026-10-14", -13)).toBe("2026-10-01");
  });
  it("counts whole days", () => {
    expect(daysBetween("2026-10-01", "2026-10-14")).toBe(13);
    expect(daysBetween("2026-10-14", "2026-10-01")).toBe(-13);
    expect(daysBetween("2025-04-01", "2026-04-01")).toBe(365);
  });
  it("formats dates for messages", () => {
    expect(dateText("2026-10-04")).toBe("4 Oct 2026");
    expect(dateText(null)).toBe("");
  });
});

describe("ledgerBalance / creditLimitExceeded", () => {
  it("is opening + bills − bill payments − receipts", () => {
    expect(ledgerBalance({ opening: 500, billed: 10_000, paid: 2_000, received: 3_000 })).toBe(5_500);
    expect(ledgerBalance({ opening: -1_000, billed: 0, paid: 0, received: 0 })).toBe(-1_000);
  });
  it("flags only balances above a set limit", () => {
    expect(creditLimitExceeded(10_001, 10_000)).toBe(true);
    expect(creditLimitExceeded(10_000, 10_000)).toBe(false);
    expect(creditLimitExceeded(99_999_999, null)).toBe(false);
    expect(creditLimitExceeded(1, 0)).toBe(true);
  });
});

describe("allocateFifo", () => {
  it("pays one bill exactly", () => {
    expect(allocateFifo(1000, [bill("a", "2026-10-01", 1000)])).toEqual({
      allocations: [{ invoiceId: "a", number: "INV/26-27/a", amount: 1000 }],
      advance: 0,
    });
  });
  it("pays part of the oldest bill", () => {
    const r = allocateFifo(400, [bill("b", "2026-10-05", 1000), bill("a", "2026-10-01", 1000)]);
    expect(r.allocations).toEqual([{ invoiceId: "a", number: "INV/26-27/a", amount: 400 }]);
    expect(r.advance).toBe(0);
  });
  it("spreads over several bills oldest first and keeps the overpayment as advance", () => {
    const r = allocateFifo(3500, [bill("c", "2026-10-09", 1000), bill("a", "2026-10-01", 1000), bill("b", "2026-10-05", 1000)]);
    expect(r.allocations.map((a) => [a.invoiceId, a.amount])).toEqual([
      ["a", 1000],
      ["b", 1000],
      ["c", 1000],
    ]);
    expect(r.advance).toBe(500);
  });
  it("counts existing partial payments and skips closed bills", () => {
    const r = allocateFifo(1000, [
      bill("a", "2026-10-01", 1000, 700),
      bill("p", "2026-09-01", 1000, 1000),
      bill("x", "2026-08-01", 5000, 0, { status: "cancelled" }),
      bill("d", "2026-08-01", 5000, 0, { status: "draft" }),
      bill("b", "2026-10-02", 1000),
    ]);
    expect(r.allocations.map((a) => [a.invoiceId, a.amount])).toEqual([
      ["a", 300],
      ["b", 700],
    ]);
    expect(r.advance).toBe(0);
  });
  it("orders same-day bills by sequence", () => {
    const r = allocateFifo(1500, [bill("z", "2026-10-01", 1000, 0, { seq: 12 }), bill("y", "2026-10-01", 1000, 0, { seq: 11 })]);
    expect(r.allocations.map((a) => [a.invoiceId, a.amount])).toEqual([
      ["y", 1000],
      ["z", 500],
    ]);
  });
  it("puts everything into advance when nothing is open", () => {
    expect(allocateFifo(2500, [])).toEqual({ allocations: [], advance: 2500 });
  });
});

describe("applyPaidDelta / reverseAllocations", () => {
  it("re-derives the status", () => {
    expect(applyPaidDelta({ status: "issued", total: 1000, paid: 0 }, 1000)).toEqual({ paid: 1000, status: "paid" });
    expect(applyPaidDelta({ status: "paid", total: 1000, paid: 1000 }, -300)).toEqual({ paid: 700, status: "partially_paid" });
    expect(applyPaidDelta({ status: "partially_paid", total: 1000, paid: 200 }, -500)).toEqual({ paid: 0, status: "issued" });
    expect(applyPaidDelta({ status: "cancelled", total: 1000, paid: 500 }, -500)).toEqual({ paid: 0, status: "cancelled" });
  });
  it("takes a receipt's allocations back off its bills", () => {
    const bills = [
      { id: "a", status: "paid" as const, total: 1000, paid: 1000 },
      { id: "b", status: "partially_paid" as const, total: 1000, paid: 900 },
    ];
    const r = reverseAllocations(bills, [
      { invoiceId: "a", amount: 1000 },
      { invoiceId: "b", amount: 400 },
      { invoiceId: "b", amount: 100 },
      { invoiceId: "gone", amount: 50 },
    ]);
    expect(r).toEqual([
      { id: "a", paid: 0, status: "issued" },
      { id: "b", paid: 400, status: "partially_paid" },
    ]);
    // Inputs are not mutated.
    expect(bills[0]!.paid).toBe(1000);
  });
  it("allocating then reversing restores the bills", () => {
    const bills = [bill("a", "2026-10-01", 1000, 250), bill("b", "2026-10-02", 2000)];
    const { allocations } = allocateFifo(2000, bills);
    const after = bills.map((b) => {
      const got = allocations.filter((a) => a.invoiceId === b.id).reduce((s, a) => s + a.amount, 0);
      return { ...b, ...applyPaidDelta(b, got) };
    });
    expect(after.map((b) => b.status)).toEqual(["paid", "partially_paid"]);
    const back = reverseAllocations(after, allocations);
    expect(back).toEqual([
      { id: "a", paid: 250, status: "partially_paid" },
      { id: "b", paid: 0, status: "issued" },
    ]);
  });
});

describe("ledger", () => {
  const at = (d: string, h = 10) => Date.parse(`${d}T0${h % 10}:00:00Z`);
  const src = {
    invoices: [
      { id: "i1", number: "INV/1", date: "2026-09-01", total: 10_000, status: "partially_paid" as const, at: at("2026-09-01") },
      { id: "i2", number: "INV/2", date: "2026-10-01", total: 5_000, status: "issued" as const, at: at("2026-10-01") },
      {
        id: "i3",
        number: "INV/3",
        date: "2026-10-03",
        total: 2_000,
        status: "cancelled" as const,
        at: at("2026-10-03"),
        cancelledOn: "2026-10-05",
        cancelledAt: at("2026-10-05"),
      },
      { id: "d", number: null, date: "2026-10-04", total: 999, status: "draft" as const, at: at("2026-10-04") },
    ],
    payments: [
      { id: "p1", invoiceNumber: "INV/1", date: "2026-09-10", amount: 4_000, method: "upi" as const, reference: "UTR1", at: at("2026-09-10") },
      { id: "p2", invoiceNumber: "INV/2", date: "2026-10-01", amount: 1_000, method: "cash" as const, reference: null, online: true, at: at("2026-10-01", 11) },
    ],
    receipts: [{ id: "r1", date: "2026-10-02", amount: 3_000, method: "cash" as const, reference: null, note: "Diwali", at: at("2026-10-02") }],
  };

  it("builds dated events, skipping drafts and adding cancellations", () => {
    const ev = ledgerEvents(src);
    expect(ev.map((e) => [e.date, e.type, e.debit, e.credit])).toEqual([
      ["2026-09-01", "invoice", 10_000, 0],
      ["2026-09-10", "payment", 0, 4_000],
      ["2026-10-01", "invoice", 5_000, 0],
      ["2026-10-01", "payment", 0, 1_000],
      ["2026-10-02", "receipt", 0, 3_000],
      ["2026-10-03", "invoice", 2_000, 0],
      ["2026-10-05", "cancel", 0, 2_000],
    ]);
    expect(ev[1]!.description).toBe("Payment (UPI) for INV/1 ref UTR1");
    expect(ev[3]!.description).toBe("Online payment for INV/2");
    expect(ev[4]!.description).toBe("Received (Cash) · Diwali");
  });

  it("runs the balance from the opening balance", () => {
    const l = buildLedger(1_500, ledgerEvents(src), { openingDate: "2026-08-15" });
    expect(l.openingBalance).toBe(1_500);
    expect(l.entries[0]).toMatchObject({ type: "opening", date: "2026-08-15", debit: 1_500, credit: 0, balance: 1_500 });
    expect(l.entries.map((e) => e.balance)).toEqual([1_500, 11_500, 7_500, 12_500, 11_500, 8_500, 10_500, 8_500]);
    expect(l.closingBalance).toBe(8_500);
    // Same as the aggregate formula: opening + non-cancelled bills − bill payments − receipts.
    expect(l.closingBalance).toBe(ledgerBalance({ opening: 1_500, billed: 15_000, paid: 5_000, received: 3_000 }));
  });

  it("starts at the balance as of `from` and stops at `to`", () => {
    const l = buildLedger(1_500, ledgerEvents(src), { from: "2026-10-01", to: "2026-10-02", openingDate: "2026-08-15" });
    expect(l.openingBalance).toBe(7_500);
    expect(l.entries[0]).toMatchObject({ type: "opening", date: "2026-10-01", balance: 7_500 });
    expect(l.entries.slice(1).map((e) => e.type)).toEqual(["invoice", "payment", "receipt"]);
    expect(l.closingBalance).toBe(8_500);
  });

  it("shows a negative opening balance (advance) as a credit", () => {
    const l = buildLedger(-2_000, [], { openingDate: "2026-10-01" });
    expect(l.entries).toEqual([
      { date: "2026-10-01", type: "opening", refId: null, number: null, description: "Opening balance", debit: 0, credit: 2_000, balance: -2_000 },
    ]);
    expect(l.closingBalance).toBe(-2_000);
  });

  it("dates the opening line at the first bill when bills predate the customer record", () => {
    const l = buildLedger(0, ledgerEvents(src), { openingDate: "2026-10-10" });
    expect(l.entries[0]!.date).toBe("2026-09-01");
  });

  it("a deleted receipt simply disappears from the statement", () => {
    const without = buildLedger(0, ledgerEvents({ ...src, receipts: [] }), { openingDate: "2026-08-01" });
    const withR = buildLedger(0, ledgerEvents(src), { openingDate: "2026-08-01" });
    expect(without.closingBalance - withR.closingBalance).toBe(3_000);
  });
});

describe("ageing", () => {
  const asOf = "2026-10-14";
  it("buckets by days past due; no due date = due on the bill date", () => {
    expect(ageingKey({ date: "2026-10-14", dueDate: null }, asOf)).toBe("current");
    expect(ageingKey({ date: "2026-10-01", dueDate: "2026-10-20" }, asOf)).toBe("current");
    expect(ageingKey({ date: "2026-10-01", dueDate: "2026-10-14" }, asOf)).toBe("current");
    expect(ageingKey({ date: "2026-10-13", dueDate: null }, asOf)).toBe("1-30");
    expect(ageingKey({ date: "2026-09-01", dueDate: "2026-09-14" }, asOf)).toBe("1-30");
    expect(ageingKey({ date: "2026-09-01", dueDate: "2026-09-13" }, asOf)).toBe("31-60");
    expect(ageingKey({ date: "2026-08-01", dueDate: null }, asOf)).toBe("61-90");
    expect(ageingKey({ date: "2026-07-16", dueDate: null }, asOf)).toBe("61-90");
    expect(ageingKey({ date: "2026-07-15", dueDate: null }, asOf)).toBe("90+");
  });
  it("totals buckets and customers, grouping walk-ins by name", () => {
    const r = ageingReport(
      [
        { customerId: "c1", name: "Ravi", date: "2026-10-10", dueDate: "2026-10-20", balance: 1000 },
        { customerId: "c1", name: "Ravi", date: "2026-06-01", dueDate: null, balance: 500 },
        { customerId: null, name: "Walk-in Customer", date: "2026-10-01", dueDate: null, balance: 300 },
        { customerId: null, name: "walk-in customer ", date: "2026-09-01", dueDate: null, balance: 200 },
        { customerId: "c2", name: "Meena", date: "2026-10-01", dueDate: null, balance: 0 },
      ],
      asOf,
    );
    expect(r.buckets).toEqual([
      { key: "current", amount: 1000, count: 1 },
      { key: "1-30", amount: 300, count: 1 },
      { key: "31-60", amount: 200, count: 1 },
      { key: "61-90", amount: 0, count: 0 },
      { key: "90+", amount: 500, count: 1 },
    ]);
    expect(r.customers).toEqual([
      { customerId: "c1", name: "Ravi", current: 1000, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 500, total: 1500 },
      { customerId: null, name: "Walk-in Customer", current: 0, d1_30: 300, d31_60: 200, d61_90: 0, d90_plus: 0, total: 500 },
    ]);
  });
});

describe("reminderDayFor", () => {
  const days = [1, 7, 15];
  it("matches exactly N days after the due date", () => {
    expect(reminderDayFor("2026-10-13", "2026-10-14", days)).toBe(1);
    expect(reminderDayFor("2026-10-07", "2026-10-14", days)).toBe(7);
    expect(reminderDayFor("2026-09-29", "2026-10-14", days)).toBe(15);
  });
  it("ignores other days, future due dates and bills without a due date", () => {
    expect(reminderDayFor("2026-10-12", "2026-10-14", days)).toBeNull();
    expect(reminderDayFor("2026-10-15", "2026-10-14", days)).toBeNull();
    expect(reminderDayFor(null, "2026-10-14", days)).toBeNull();
    expect(reminderDayFor("2026-10-14", "2026-10-14", days)).toBeNull();
    expect(reminderDayFor("2026-10-14", "2026-10-14", [0, 3])).toBe(0);
    expect(reminderDayFor("2026-10-13", "2026-10-14", [])).toBeNull();
  });
});

describe("phones and message text", () => {
  it("normalises Indian mobiles to E.164", () => {
    for (const p of ["9876543210", "98765 43210", "098765-43210", "+91 98765 43210", "919876543210", "00919876543210", "+91-98765-43210"]) {
      expect(toIndianE164(p)).toBe("+919876543210");
    }
  });
  it("rejects landlines, foreign and malformed numbers", () => {
    for (const p of ["044 2345 6789", "+14155552671", "12345", "5876543210", "98765432101", "abc9876543210", null, ""]) {
      expect(toIndianE164(p)).toBeNull();
    }
  });
  it("masks numbers for history", () => {
    expect(maskPhone("+919876543210")).toBe("+91******3210");
    expect(maskPhone("9876543210")).toBe("******3210");
  });
  it("uses ₹ on WhatsApp and Rs. on SMS", () => {
    expect(moneyText(123456, "whatsapp")).toBe("₹1,234.56");
    expect(moneyText(10_000_000, "sms")).toBe("Rs.1,00,000.00");
  });
});
