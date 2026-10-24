import { describe, expect, it } from "vitest";
import {
  ageBucket,
  allocateOldestFirst,
  allocationProblem,
  apportion,
  buildAgeing,
  buildStatement,
  daysBetween,
  maxRefund,
  poProgress,
  poRemaining,
  purchaseBalance,
  returnedDiscount,
  type LedgerEvent,
} from "./payables";

describe("balances", () => {
  it("is total less returns less payments", () => {
    expect(purchaseBalance({ total: 1000, returnedAmount: 200, amountPaid: 300 })).toBe(500);
    // Paid in full, then goods returned without a refund: the supplier owes us.
    expect(purchaseBalance({ total: 1000, returnedAmount: 200, amountPaid: 1000 })).toBe(-200);
  });
  it("caps refunds at the note total and what was paid", () => {
    expect(maxRefund(500, 1000)).toBe(500);
    expect(maxRefund(500, 200)).toBe(200);
    expect(maxRefund(500, 0)).toBe(0);
  });
});

describe("allocateOldestFirst", () => {
  const bills = [
    { id: "c", balance: 300, date: "2026-10-03" },
    { id: "a", balance: 500, date: "2026-10-01" },
    { id: "b", balance: 200, date: "2026-10-02" },
    { id: "z", balance: 0, date: "2026-09-01" },
    { id: "n", balance: -50, date: "2026-09-02" },
  ];
  it("pays the oldest bills first and keeps the remainder", () => {
    const r = allocateOldestFirst(600, bills);
    expect(r.allocations).toEqual([
      { id: "a", amount: 500 },
      { id: "b", amount: 100 },
    ]);
    expect(r.remainder).toBe(0);
    const big = allocateOldestFirst(2000, bills);
    expect(big.allocations.map((a) => a.amount)).toEqual([500, 200, 300]);
    expect(big.remainder).toBe(1000);
  });
  it("breaks date ties by entry time then id", () => {
    const r = allocateOldestFirst(10, [
      { id: "x", balance: 10, date: "2026-10-01", createdAt: 2 },
      { id: "y", balance: 10, date: "2026-10-01", createdAt: 1 },
    ]);
    expect(r.allocations).toEqual([{ id: "y", amount: 10 }]);
  });
  it("does nothing for zero", () => {
    expect(allocateOldestFirst(0, bills)).toEqual({ allocations: [], remainder: 0 });
  });
});

describe("allocationProblem", () => {
  const bal = new Map([
    ["a", 500],
    ["b", 200],
  ]);
  it("accepts parts within balances and the payment", () => {
    expect(allocationProblem(700, [{ id: "a", amount: 500 }, { id: "b", amount: 100 }], bal)).toBeNull();
    expect(allocationProblem(1000, [{ id: "a", amount: 500 }], bal)).toBeNull(); // rest on account
  });
  it("rejects duplicates, overpaying a bill, over-allocating and unknown bills", () => {
    expect(allocationProblem(700, [{ id: "a", amount: 1 }, { id: "a", amount: 1 }], bal)).toMatch(/twice/);
    expect(allocationProblem(700, [{ id: "b", amount: 201 }], bal)).toMatch(/more than what is due/);
    expect(allocationProblem(100, [{ id: "a", amount: 101 }], bal)).toMatch(/more than the payment/);
    expect(allocationProblem(100, [{ id: "q", amount: 1 }], bal)).toMatch(/not found/);
    expect(allocationProblem(100, [{ id: "a", amount: 0 }], bal)).toMatch(/more than 0/);
  });
});

describe("ageing", () => {
  it("buckets by days", () => {
    expect([-5, 0, 30, 31, 60, 61, 90, 91, 400].map(ageBucket)).toEqual(["b0_30", "b0_30", "b0_30", "b31_60", "b31_60", "b61_90", "b61_90", "b90plus", "b90plus"]);
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(30);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
  });
  it("ages from the due date, else the bill date, and totals per supplier", () => {
    const rep = buildAgeing(
      "2026-10-31",
      [
        { supplierId: "s1", supplierName: "Sri Traders", date: "2026-10-20", dueDate: "2026-11-10", balance: 1000 }, // not due yet
        { supplierId: "s1", supplierName: "Sri Traders", date: "2026-08-01", dueDate: null, balance: 500 }, // 91 days
        { supplierId: "s1", supplierName: "Sri Traders", date: "2026-09-01", dueDate: "2026-09-15", balance: 200 }, // 46 days
        { supplierId: "s2", supplierName: "Kumar", date: "2026-10-30", dueDate: null, balance: 300 },
        { supplierId: "s2", supplierName: "Kumar", date: "2026-10-01", dueDate: null, balance: -100 }, // overpaid
        { supplierId: "s3", supplierName: "Zero", date: "2026-10-01", dueDate: null, balance: 0 },
      ],
      [{ supplierId: "s2", name: "Kumar", unsettled: 400 }],
    );
    const s1 = rep.rows.find((r) => r.supplierId === "s1")!;
    expect(s1).toMatchObject({ b0_30: 1000, b31_60: 200, b90plus: 500, total: 1700, overdue: 700 });
    const s2 = rep.rows.find((r) => r.supplierId === "s2")!;
    expect(s2).toMatchObject({ opening: 400, b0_30: 300, advance: 100, total: 600, overdue: 700 });
    expect(rep.rows.map((r) => r.supplierId)).toEqual(["s1", "s2"]);
    expect(rep.totals.total).toBe(2300);
  });
  it("shows an advance-only supplier", () => {
    const rep = buildAgeing("2026-10-31", [], [{ supplierId: "s", name: "A", unsettled: -500 }]);
    expect(rep.rows[0]).toMatchObject({ advance: 500, total: -500 });
  });
});

describe("statement", () => {
  const ev = (date: string, type: LedgerEvent["type"], credit: number, debit: number, at = 0): LedgerEvent => ({ date, at, type, ref: "", description: type, credit, debit });
  const events = [
    ev("2026-09-01", "opening", 1000, 0),
    ev("2026-09-10", "purchase", 5000, 0),
    ev("2026-09-20", "payment", 0, 2000),
    ev("2026-10-05", "purchase", 3000, 0),
    ev("2026-10-06", "debit_note", 0, 500),
    ev("2026-10-06", "payment", 0, 1500),
    ev("2026-10-07", "refund", 100, 0),
  ];
  it("keeps a running balance", () => {
    const st = buildStatement(events);
    expect(st.rows.map((r) => r.balance)).toEqual([1000, 6000, 4000, 7000, 6500, 5000, 5100]);
    expect(st.closingBalance).toBe(5100);
    expect(st.totalCredit).toBe(9100);
    expect(st.totalDebit).toBe(4000);
  });
  it("rolls earlier events into the period opening and cuts at `to`", () => {
    const st = buildStatement(events, { from: "2026-10-01", to: "2026-10-06" });
    expect(st.openingBalance).toBe(4000);
    expect(st.rows.map((r) => r.type)).toEqual(["purchase", "debit_note", "payment"]);
    expect(st.closingBalance).toBe(5000);
  });
  it("orders a bill before the payment of the same day", () => {
    const st = buildStatement([ev("2026-10-01", "payment", 0, 100, 1), ev("2026-10-01", "purchase", 100, 0, 5)]);
    expect(st.rows.map((r) => r.type)).toEqual(["purchase", "payment"]);
    expect(st.closingBalance).toBe(0);
  });
});

describe("apportion", () => {
  it("adds up exactly and follows the weights", () => {
    expect(apportion(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(apportion(1000, [100, 300])).toEqual([250, 750]);
    const parts = apportion(997, [333, 333, 334, 0]);
    expect(parts.reduce((s, n) => s + n, 0)).toBe(997);
    expect(parts[3]).toBe(0);
  });
  it("gives nothing without value or charge", () => {
    expect(apportion(0, [1, 2])).toEqual([0, 0]);
    expect(apportion(50, [0, 0])).toEqual([0, 0]);
  });
});

describe("purchase order progress", () => {
  it("moves from none to partial to complete", () => {
    expect(poProgress([{ qty: 10, received: 0 }])).toBe("sent_or_draft");
    expect(poProgress([{ qty: 10, received: 4 }, { qty: 2, received: 2 }])).toBe("partially_received");
    expect(poProgress([{ qty: 10, received: 10 }, { qty: 2.5, received: 2.5 }])).toBe("received");
  });
  it("computes the pending quantity", () => {
    expect(poRemaining({ qty: 10, received: 3.5 })).toBe(6.5);
    expect(poRemaining({ qty: 1, received: 2 })).toBe(0);
  });
  it("splits a line discount for a part quantity", () => {
    expect(returnedDiscount(100, 10, 4)).toBe(40);
    expect(returnedDiscount(100, 10, 10)).toBe(100);
    expect(returnedDiscount(0, 10, 4)).toBe(0);
  });
});
