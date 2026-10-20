import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { allowedMoves, canMove, formatJobNumber, isOverdue, jobTotals, lineTax, moveBlock, nextSteps, parseJobNumber } from "./logic";
import { defaultMeasurements, fieldsSummary, parseFields } from "./templates";

describe("formatJobNumber", () => {
  it("pads to four digits and keeps growing", () => {
    expect(formatJobNumber(12)).toBe("JC-0012");
    expect(formatJobNumber(1)).toBe("JC-0001");
    expect(formatJobNumber(12345)).toBe("JC-12345");
  });
  it("reads numbers back for search", () => {
    expect(parseJobNumber("JC-0012")).toBe(12);
    expect(parseJobNumber("jc12")).toBe(12);
    expect(parseJobNumber(" 7 ")).toBe(7);
    expect(parseJobNumber("meena")).toBeNull();
  });
});

describe("canMove", () => {
  it("goes forward any number of steps and can skip the trial", () => {
    expect(canMove("received", "diagnosed")).toBe(true);
    expect(canMove("received", "in_progress")).toBe(true);
    expect(canMove("in_progress", "ready")).toBe(true);
    expect(canMove("in_progress", "trial")).toBe(true);
  });
  it("delivers only when billed or when nothing is due", () => {
    expect(moveBlock("ready", "delivered", { billed: false, total: 50000 })).toBe("not_billed");
    expect(canMove("ready", "delivered", { billed: true, total: 50000 })).toBe(true);
    expect(canMove("ready", "delivered", { total: 0 })).toBe(true);
    expect(canMove("received", "delivered", { billed: true })).toBe(true);
  });
  it("allows one step back (ready to in progress when the trial was skipped), not more", () => {
    expect(canMove("diagnosed", "received")).toBe(true);
    expect(canMove("ready", "trial")).toBe(true);
    expect(canMove("ready", "in_progress")).toBe(true);
    expect(canMove("delivered", "ready")).toBe(true);
    expect(moveBlock("ready", "diagnosed")).toBe("backwards");
    expect(moveBlock("in_progress", "received")).toBe("backwards");
  });
  it("cancels anything not delivered; nothing leaves cancelled", () => {
    expect(canMove("in_progress", "cancelled")).toBe(true);
    expect(canMove("ready", "cancelled")).toBe(true);
    expect(moveBlock("delivered", "cancelled")).toBe("closed");
    expect(moveBlock("cancelled", "received")).toBe("closed");
    expect(moveBlock("received", "received")).toBe("same");
  });
  it("lists the moves and the stepper's next steps", () => {
    expect(allowedMoves("ready", { total: 100 })).toEqual(["in_progress", "trial", "cancelled"]);
    expect(nextSteps("in_progress")).toEqual(["trial", "ready"]);
    expect(nextSteps("ready", { total: 100 })).toEqual([]);
    expect(nextSteps("ready", { billed: true, total: 100 })).toEqual(["delivered"]);
    expect(nextSteps("cancelled")).toEqual([]);
  });
});

describe("isOverdue", () => {
  it("is past due and not ready or closed", () => {
    expect(isOverdue("2026-10-19", "in_progress", "2026-10-20")).toBe(true);
    expect(isOverdue("2026-10-20", "in_progress", "2026-10-20")).toBe(false);
    expect(isOverdue("2026-10-19", "ready", "2026-10-20")).toBe(false);
    expect(isOverdue("2026-10-19", "delivered", "2026-10-20")).toBe(false);
    expect(isOverdue(null, "received", "2026-10-20")).toBe(false);
  });
});

describe("jobTotals", () => {
  it("sums parts and labour before GST, GST per line, then advance and balance", () => {
    const t = jobTotals(
      [
        { kind: "part", qty: 1, rate: 120000, gstRate: 18 },
        { kind: "labour", qty: 1, rate: 30000, gstRate: 18 },
        { kind: "part", qty: 2.5, rate: 1001, gstRate: 5 },
      ],
      50000,
    );
    expect(t.parts).toBe(122503);
    expect(t.labour).toBe(30000);
    expect(t.amount).toBe(152503);
    expect(t.tax).toBe(21600 + 5400 + 125);
    expect(t.total).toBe(152503 + 27125);
    expect(t.balance).toBe(t.total - 50000);
  });
  it("rounds GST per line and handles no lines", () => {
    expect(lineTax({ qty: 1, rate: 333, gstRate: 18 })).toBe(60);
    expect(jobTotals([])).toEqual({ parts: 0, labour: 0, amount: 0, tax: 0, total: 0, advance: 0, balance: 0 });
  });
});

describe("template fields", () => {
  it("validates a device card and never keeps a passcode", () => {
    const f = parseFields("device", { brand: "Redmi", model: "Note 12", serial: "86123", issue: "Screen broken", accessories: ["charger"] });
    expect(f).toMatchObject({ brand: "Redmi", issue: "Screen broken", accessories: ["charger"], condition: null });
    expect(() => parseFields("device", { issue: "Dead", passcode: "1234" })).toThrow(ZodError);
    expect(() => parseFields("device", { brand: "Apple" })).toThrow(ZodError);
  });
  it("validates garment measurements and starts from the default list", () => {
    const f = parseFields("garment", { garmentType: "blouse", measurements: { bust: 36, waist: 30.5 }, trialDate: "2026-10-25" });
    expect(f).toMatchObject({ fabricReceived: false, unit: "in", measurements: { bust: 36, waist: 30.5 } });
    expect(() => parseFields("garment", { garmentType: "blouse", measurements: { bust: -1 } })).toThrow(ZodError);
    expect(() => parseFields("garment", { garmentType: "saree" })).toThrow(ZodError);
    expect(defaultMeasurements("blouse")).toContain("armhole");
    expect(defaultMeasurements("pant")).toContain("waist");
  });
  it("validates an eyewear prescription per eye", () => {
    const f = parseFields("eyewear", { right: { sph: -1.25, cyl: -0.5, axis: 90 }, left: { sph: -1, add: 1.5 }, pd: 62, lensType: "progressive" });
    expect(f).toMatchObject({ right: { sph: -1.25, cyl: -0.5, axis: 90, add: null }, left: { sph: -1, cyl: null, add: 1.5 }, pd: 62 });
    expect(() => parseFields("eyewear", { right: { sph: -1.3 } })).toThrow(ZodError);
    expect(() => parseFields("eyewear", { right: { cyl: -0.75 } })).toThrow(ZodError);
    expect(() => parseFields("eyewear", { right: { axis: 181 } })).toThrow(ZodError);
  });
  it("needs a description on a general card", () => {
    expect(parseFields("general", { description: "Mixer grinder service" })).toEqual({ description: "Mixer grinder service" });
    expect(() => parseFields("general", {})).toThrow(ZodError);
  });
  it("summarises a card in one line", () => {
    expect(fieldsSummary("device", { brand: "Redmi", model: "Note 12", issue: "Screen broken" })).toBe("Redmi Note 12 · Screen broken");
    expect(fieldsSummary("garment", { garmentType: "blouse" })).toBe("blouse");
  });
});
