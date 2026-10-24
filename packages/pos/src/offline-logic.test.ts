import { describe, expect, it } from "vitest";
import { financialYearOf, inRange, isLate, isRetryableStatus, negativeStockFlags, provisionalNumber, reconcileLines, remainingPayments, unusedSeqs } from "./offline-logic";
import { offlineBillBody } from "./offline-schemas";

describe("offline billing rules", () => {
  it("financial year follows April to March", () => {
    expect(financialYearOf("2026-03-31")).toBe("25-26");
    expect(financialYearOf("2026-04-01")).toBe("26-27");
    expect(financialYearOf("2026-12-31")).toBe("26-27");
    expect(financialYearOf("2099-06-01")).toBe("99-00");
  });

  it("lists the numbers of a block nobody holds or voided", () => {
    const b = { fromSeq: 10, toSeq: 15, voided: [{ seq: 12 }] };
    expect(unusedSeqs(b, [10, 11, 14])).toEqual([13, 15]);
    expect(unusedSeqs(b, [10, 11, 13, 14, 15])).toEqual([]);
    expect(inRange(b, 15)).toBe(true);
    expect(inRange(b, 16)).toBe(false);
    expect(inRange(b, 9.5)).toBe(false);
  });

  it("makes a provisional number that can't be taken for an invoice number", () => {
    expect(provisionalNumber("dev-a1b2c3d4", 7)).toBe("OFF-C3D4-0007");
    expect(provisionalNumber("ab", 12345)).toBe("OFF-00AB-12345");
  });

  it("records only the payments not yet on the bill", () => {
    const planned = [{ method: "upi", amount: 10_000 }, { method: "cash", amount: 11_000 }];
    expect(remainingPayments(planned, 0)).toEqual(planned);
    expect(remainingPayments(planned, 10_000)).toEqual([{ method: "cash", amount: 11_000 }]);
    expect(remainingPayments(planned, 15_000)).toEqual([{ method: "cash", amount: 6_000 }]);
    expect(remainingPayments(planned, 21_000)).toEqual([]);
  });

  it("reconciles lines with the catalogue: deleted items go free-text, price and tax changes are flagged but not applied", () => {
    const lines = [
      { description: "A", qty: 1, rate: 100, gstRate: 5, itemId: "a" },
      { description: "B", qty: 1, rate: 100, gstRate: 5, itemId: "b" },
      { description: "C", qty: 1, rate: 100, gstRate: 5, itemId: "c" },
      { description: "Open", qty: 1, rate: 100, gstRate: 5 },
    ];
    const r = reconcileLines(
      lines,
      [{ itemId: "a", price: 100, gstRate: 5 }, { itemId: "b", price: 100, gstRate: 5 }],
      new Map([["a", { price: 120, gstRate: 12 }], ["b", { price: 100, gstRate: 5 }]]),
    );
    expect(r.flags.map((f) => `${f.code}@${f.line}`)).toEqual(["price_changed@0", "tax_changed@0", "item_missing@2"]);
    expect(r.lines[0]).toEqual(lines[0]);
    expect(r.lines[2]).not.toHaveProperty("itemId");
    expect(r.lines[2]!.description).toBe("C");
  });

  it("flags only the lines whose stock is below zero", () => {
    const flags = negativeStockFlags([{ itemId: "a" }, { itemId: "b" }, {}], new Map([["a", -2], ["b", 4]]));
    expect(flags).toEqual([{ code: "stock_negative", line: 0, detail: { itemId: "a", stock: -2 } }]);
  });

  it("calls a bill late after a day and splits retryable failures from fixable ones", () => {
    const now = new Date("2026-10-24T10:00:00Z");
    expect(isLate(new Date("2026-10-23T11:00:00Z"), now)).toBe(false);
    expect(isLate(new Date("2026-10-23T09:00:00Z"), now)).toBe(true);
    expect([400, 422, 404, 403].some(isRetryableStatus)).toBe(false);
    expect([500, 503, 402, 409, 429].every(isRetryableStatus)).toBe(true);
  });

  it("validates the bill payload", () => {
    const ok = { clientId: "2b1c1b3e-6c61-4f1f-8a43-0d5b3d1d8d11", deviceId: "dev-12345678", billedAt: "2026-10-24T09:00:00.000Z", date: "2026-10-24", lines: [{ description: "Tea", qty: 1, rate: 100, gstRate: 5 }] };
    expect(offlineBillBody.safeParse(ok).success).toBe(true);
    expect(offlineBillBody.parse(ok).payments).toEqual([]);
    expect(offlineBillBody.safeParse({ ...ok, clientId: "not-a-uuid" }).success).toBe(false);
    expect(offlineBillBody.safeParse({ ...ok, lines: [] }).success).toBe(false);
    expect(offlineBillBody.safeParse({ ...ok, payments: [{ method: "gateway", amount: 100 }] }).success).toBe(false);
    expect(offlineBillBody.safeParse({ ...ok, payments: [{ method: "cash", amount: 1.5 }] }).success).toBe(false);
  });
});
