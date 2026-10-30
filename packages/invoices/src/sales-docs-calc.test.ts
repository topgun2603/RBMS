import { computeInvoice } from "@rbms/gst";
import { describe, expect, it } from "vitest";
import {
  advanceFor,
  advanceProblem,
  challanCancelProblem,
  challanDisplayStatus,
  challanInvoiceProblem,
  challanNet,
  challanReturnProblem,
  challanReturnStatus,
  ewayBillHint,
  keyLines,
  normalizeSalesDocSettings,
  normalizeVehicle,
  orderCancelProblem,
  orderEditProblem,
  orderProgress,
  orderStatusOf,
  partialLine,
  prefixFor,
  proformaConvertProblem,
  proformaDisplayStatus,
  proformaValidUntil,
  quantityProblem,
  reservationLines,
} from "./sales-docs-calc";
import type { SalesDocLine } from "./schema-sales";

const computed = computeInvoice(
  [
    { description: "Cement 50 kg", hsn: "2523", qty: 10, unit: "bag", rate: 40_000, gstRate: 28, itemId: "00000000-0000-4000-8000-000000000001" },
    { description: "TMT bar 12 mm", hsn: "7214", qty: 4, unit: "ton", rate: 5_800_000, gstRate: 18, discount: 400_000, itemId: "00000000-0000-4000-8000-000000000002" },
    { description: "Labour", hsn: "9954", qty: 1, unit: "job", rate: 500_000, gstRate: 18 },
  ],
  { sellerState: "33", placeOfSupply: "33" },
);
let n = 0;
const lines: SalesDocLine[] = keyLines(computed.lines, [], () => `k${++n}`);

describe("settings", () => {
  it("fills defaults and keeps valid values", () => {
    const d = normalizeSalesDocSettings({});
    expect(d).toMatchObject({ proformaPrefix: "PI", saleOrderPrefix: "SO", challanPrefix: "DC", proformaValidityDays: 15, advancePercent: null, reserveStock: false });
    const s = normalizeSalesDocSettings({ proformaPrefix: "pf", challanPrefix: "dlv-1", proformaValidityDays: 0, advancePercent: 30, reserveStock: true, challanTerms: "  Return in 7 days " });
    expect(s).toMatchObject({ proformaPrefix: "PF", challanPrefix: "DLV-1", proformaValidityDays: 0, advancePercent: 30, reserveStock: true, challanTerms: "Return in 7 days" });
    expect(prefixFor("challan", s)).toBe("DLV-1");
    expect(normalizeSalesDocSettings({ advancePercent: 0, proformaValidityDays: 999 })).toMatchObject({ advancePercent: null, proformaValidityDays: 15 });
  });

  it("validity 0 means a proforma never expires", () => {
    expect(proformaValidUntil("2026-10-14", 15)).toBe("2026-10-29");
    expect(proformaValidUntil("2026-10-14", 0)).toBeNull();
    expect(proformaDisplayStatus({ status: "issued", validUntil: null }, "2030-01-01")).toBe("issued");
    expect(proformaDisplayStatus({ status: "issued", validUntil: "2026-10-29" }, "2026-10-30")).toBe("expired");
    expect(proformaDisplayStatus({ status: "converted", validUntil: "2026-10-29" }, "2026-10-30")).toBe("converted");
  });
});

describe("advances", () => {
  it("asks for the percentage of the total, never more than the total", () => {
    expect(advanceFor(100_000, 25)).toBe(25_000);
    expect(advanceFor(99_999, 50)).toBe(50_000);
    expect(advanceFor(100_000, null)).toBe(0);
  });

  it("needs a saved customer, an open document and no more than the total", () => {
    expect(advanceProblem({ customerId: null, status: "issued" }, 100, 1000, 0)).toMatch(/Save the customer/);
    expect(advanceProblem({ customerId: "c", status: "cancelled" }, 100, 1000, 0)).toMatch(/open document/);
    expect(advanceProblem({ customerId: "c", status: "issued" }, 600, 1000, 500)).toMatch(/more than the document total/);
    expect(advanceProblem({ customerId: "c", status: "open" }, 500, 1000, 500)).toBeNull();
  });
});

describe("partial lines", () => {
  it("bills part of a line at the same rate with the discount in proportion", () => {
    const tmt = computed.lines[1]!;
    const part = partialLine(tmt, 1);
    expect(part).toMatchObject({ qty: 1, rate: 5_800_000, discount: 100_000, gstRate: 18, itemId: tmt.itemId });
    const again = computeInvoice([part, partialLine(tmt, 3)], { sellerState: "33", placeOfSupply: "33" });
    // Two partial bills add up to the full line.
    expect(again.taxable).toBe(tmt.taxable);
  });

  it("keeps the whole line (with serials) when everything goes", () => {
    const full = partialLine({ ...computed.lines[0]!, serials: ["SN001"] }, 10);
    expect(full.qty).toBe(10);
    expect(full.serials).toEqual(["SN001"]);
    expect(partialLine({ ...computed.lines[0]!, serials: ["SN001"] }, 5).serials).toBeUndefined();
  });

  it("keeps line keys when lines are edited in place and gives new lines new keys", () => {
    const again = keyLines(computed.lines, lines, () => "new");
    expect(again.map((l) => l.key)).toEqual(lines.map((l) => l.key));
    const swapped = keyLines([computed.lines[2]!, computed.lines[0]!], lines, (() => {
      let i = 0;
      return () => `x${++i}`;
    })());
    expect(swapped.map((l) => l.key)).toEqual(["x1", "x2"]);
  });

  it("checks quantities against what is left", () => {
    const left = new Map([["a", 5], ["b", 0]]);
    expect(quantityProblem([], left)).toMatch(/at least one/);
    expect(quantityProblem([{ key: "z", qty: 1 }], left)).toMatch(/doesn't belong/);
    expect(quantityProblem([{ key: "a", qty: 3 }, { key: "a", qty: 3 }], left, () => "Cement")).toBe("Only 5 left of Cement");
    expect(quantityProblem([{ key: "a", qty: 5 }], left)).toBeNull();
    expect(quantityProblem([{ key: "b", qty: 1 }], left)).toMatch(/Only 0 left/);
  });
});

describe("delivery challans", () => {
  const challan = (returns: { key: string; qty: number }[][] = []) => ({ lines, returns: returns.map((r) => ({ lines: r })) });

  it("nets returns per line and derives issued / partly returned / returned", () => {
    expect(challanReturnStatus(challan())).toBe("issued");
    const part = challan([[{ key: lines[0]!.key, qty: 4 }]]);
    expect(challanNet(part)[0]).toMatchObject({ sent: 10, returned: 4, net: 6 });
    expect(challanReturnStatus(part)).toBe("partly_returned");
    const all = challan([lines.map((l) => ({ key: l.key, qty: l.qty }))]);
    expect(challanReturnStatus(all)).toBe("returned");
  });

  it("bills only approval and before-invoice challans that still have goods out", () => {
    const base = { ...challan(), status: "issued" as const };
    expect(challanInvoiceProblem({ ...base, reason: "before_invoice" })).toBeNull();
    expect(challanInvoiceProblem({ ...base, reason: "approval" })).toBeNull();
    expect(challanInvoiceProblem({ ...base, reason: "job_work" })).toMatch(/approval or delivered before the bill/);
    expect(challanInvoiceProblem({ ...challan([lines.map((l) => ({ key: l.key, qty: l.qty }))]), status: "returned", reason: "approval" })).toMatch(/came back/);
    expect(challanInvoiceProblem({ ...base, status: "invoiced", reason: "approval" })).toMatch(/already billed/);
  });

  it("a billed challan takes no returns and can't be cancelled; a cancelled bill frees it", () => {
    expect(challanReturnProblem({ status: "invoiced" })).toMatch(/credit note/);
    expect(challanCancelProblem({ status: "invoiced" })).toMatch(/cancel the bill first/);
    expect(challanDisplayStatus({ ...challan(), status: "invoiced" }, true)).toBe("issued");
    expect(challanDisplayStatus({ ...challan(), status: "invoiced" }, false)).toBe("invoiced");
  });

  it("normalises vehicle numbers and hints at an e-way bill above ₹50,000", () => {
    expect(normalizeVehicle("tn 01 ab-1234")).toBe("TN01AB1234");
    expect(ewayBillHint(5_000_000)).toBe(false);
    expect(ewayBillHint(5_000_001)).toBe(true);
  });
});

describe("sale order fulfilment", () => {
  const [cement, tmt, labour] = lines as [SalesDocLine, SalesDocLine, SalesDocLine];
  const onChallan = (key: string, qty: number, billed = false, returned = 0) => ({
    lines: [{ ...cement, key: `c-${key}-${qty}`, orderLineKey: key, qty }],
    returns: returned ? [{ lines: [{ key: `c-${key}-${qty}`, qty: returned }] }] : [],
    billed,
  });

  it("tracks ordered, delivered and invoiced per line", () => {
    const p = orderProgress(lines, {
      challans: [onChallan(cement.key, 4), onChallan(cement.key, 3, true, 1)],
      bills: [{ lines: [{ key: tmt.key, qty: 1 }] }],
    });
    expect(p[0]).toMatchObject({ ordered: 10, delivered: 6, invoiced: 2, toDeliver: 4, onChallans: 4 });
    expect(p[1]).toMatchObject({ ordered: 4, delivered: 1, invoiced: 1, toDeliver: 3, onChallans: 0 });
    expect(p[2]).toMatchObject({ ordered: 1, delivered: 0, invoiced: 0, toDeliver: 1 });
    expect(orderStatusOf(p)).toBe("partly_delivered");
  });

  it("open → partly delivered → delivered → invoiced", () => {
    expect(orderStatusOf(orderProgress(lines, { challans: [], bills: [] }))).toBe("open");
    const delivered = orderProgress(lines, {
      challans: [onChallan(cement.key, 10)],
      bills: [{ lines: [{ key: tmt.key, qty: 4 }, { key: labour.key, qty: 1 }] }],
    });
    expect(orderStatusOf(delivered)).toBe("delivered");
    const invoiced = orderProgress(lines, {
      challans: [onChallan(cement.key, 10, true)],
      bills: [{ lines: [{ key: tmt.key, qty: 4 }, { key: labour.key, qty: 1 }] }],
    });
    expect(orderStatusOf(invoiced)).toBe("invoiced");
    expect(orderStatusOf(invoiced, true)).toBe("cancelled");
  });

  it("holds stock only for undelivered catalogue items", () => {
    const p = orderProgress(lines, { challans: [onChallan(cement.key, 4)], bills: [] });
    expect(reservationLines(p)).toEqual([
      { itemId: cement.itemId, qty: 6 },
      { itemId: tmt.itemId, qty: 4 },
    ]);
  });

  it("locks the lines once something left, and cancelling once something left", () => {
    expect(orderEditProblem({ status: "open" }, true)).toBeNull();
    expect(orderEditProblem({ status: "partly_delivered" }, true)).toMatch(/can't be changed/);
    expect(orderEditProblem({ status: "partly_delivered" }, false)).toBeNull();
    expect(orderCancelProblem({ status: "partly_delivered" })).toMatch(/cancel those challans and bills first/);
    expect(orderCancelProblem({ status: "open" })).toBeNull();
  });

  it("a proforma whose bill is gone can be billed again", () => {
    expect(proformaConvertProblem({ status: "converted" })).toMatch(/already billed/);
    expect(proformaConvertProblem({ status: "converted" }, true)).toBeNull();
    expect(proformaConvertProblem({ status: "cancelled" })).toMatch(/cancelled/);
  });
});
