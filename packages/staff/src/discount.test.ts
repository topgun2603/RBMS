import { describe, expect, it } from "vitest";
import { discountLimitBody, evaluateDiscount, resolveLimit, toBp } from "./discount";

const row = (scope: "role" | "user", subject: string, maxPercentBp: number | null, maxAmount: number | null) => ({ scope, subject, maxPercentBp, maxAmount });

describe("evaluateDiscount", () => {
  const lines = [
    { qty: 2, rate: 10000, discount: 1000 }, // 5% of 20000
    { qty: 1, rate: 5000, discount: 1000 }, // 20% of 5000
    { qty: 1, rate: 700 },
  ];
  it("measures the total and the largest line percent", () => {
    const c = evaluateDiscount(lines, null);
    expect(c).toMatchObject({ ok: true, amount: 2000, percentBp: 2000 });
  });
  it("breaches on percent, on amount, or both", () => {
    expect(evaluateDiscount(lines, { maxPercentBp: 1000, maxAmount: null }).breached).toEqual(["percent"]);
    expect(evaluateDiscount(lines, { maxPercentBp: null, maxAmount: 1500 }).breached).toEqual(["amount"]);
    expect(evaluateDiscount(lines, { maxPercentBp: 1000, maxAmount: 1500 }).breached).toEqual(["percent", "amount"]);
    expect(evaluateDiscount(lines, { maxPercentBp: 2000, maxAmount: 2000 }).ok).toBe(true);
  });
  it("a bill without discounts always passes, even with a zero limit", () => {
    expect(evaluateDiscount([{ qty: 1, rate: 100 }], { maxPercentBp: 0, maxAmount: 0 }).ok).toBe(true);
  });
  it("a discount on a free line counts as 100%", () => {
    expect(evaluateDiscount([{ qty: 1, rate: 0, discount: 5 }], { maxPercentBp: 5000, maxAmount: null }).breached).toEqual(["percent"]);
  });
  it("handles fractional quantities", () => {
    expect(evaluateDiscount([{ qty: 0.5, rate: 20000, discount: 1000 }], { maxPercentBp: 1000, maxAmount: null }).ok).toBe(true);
  });
});

describe("resolveLimit", () => {
  const rows = [row("role", "cashier", 500, 20000), row("role", "trainee", 200, null), row("user", "u-ravi", 1500, null), row("role", "default", 1000, null)];
  it("owners and admins are never limited", () => {
    expect(resolveLimit(rows, "x", ["owner"])).toBeNull();
    expect(resolveLimit(rows, "x", ["admin", "role:cashier"])).toBeNull();
  });
  it("a member's own row wins over roles", () => {
    expect(resolveLimit(rows, "u-ravi", ["staff", "role:cashier"])).toEqual({ maxPercentBp: 1500, maxAmount: null });
  });
  it("uses the role row; two roles take the more generous cap per measure", () => {
    expect(resolveLimit(rows, "u1", ["staff", "role:cashier"])).toEqual({ maxPercentBp: 500, maxAmount: 20000 });
    expect(resolveLimit(rows, "u1", ["staff", "role:cashier", "role:trainee"])).toEqual({ maxPercentBp: 500, maxAmount: null });
  });
  it("staff without a custom role use the default role's row; no row = unlimited", () => {
    expect(resolveLimit(rows, "u1", ["staff"])).toEqual({ maxPercentBp: 1000, maxAmount: null });
    expect(resolveLimit([], "u1", ["staff", "role:cashier"])).toBeNull();
    expect(resolveLimit(rows, "u1", ["staff", "role:other"])).toBeNull();
  });
});

describe("discountLimitBody", () => {
  it("needs a cap, a valid subject and sane numbers", () => {
    expect(discountLimitBody.safeParse({ scope: "role", subject: "cashier", maxPercent: 10, maxAmount: null }).success).toBe(true);
    expect(discountLimitBody.safeParse({ scope: "role", subject: "cashier", maxPercent: null, maxAmount: null }).success).toBe(false);
    expect(discountLimitBody.safeParse({ scope: "user", subject: "cashier", maxPercent: 10, maxAmount: null }).success).toBe(false);
    expect(discountLimitBody.safeParse({ scope: "user", subject: "6b2f6f3e-8b0f-4a44-9d53-0f5a0c1d9b11", maxPercent: 10, maxAmount: 5000 }).success).toBe(true);
    expect(discountLimitBody.safeParse({ scope: "role", subject: "cashier", maxPercent: 101, maxAmount: null }).success).toBe(false);
    expect(toBp(12.5)).toBe(1250);
  });
});
