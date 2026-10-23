import { describe, expect, it } from "vitest";
import { LookupLimiter } from "./routes";
import { publicWarrantyQuery } from "./service";
import {
  lastDigits,
  phoneLast4Matches,
  publicWarrantyStatus,
  canMoveTo,
  checkSerialRows,
  isValidImei,
  luhnValid,
  normaliseSerial,
  parseSerialLines,
  serialProblem,
  stockDelta,
  warrantyDaysLeft,
  warrantyEnd,
  warrantyStatus,
} from "./logic";

const IMEI = "490154203237518"; // a well-known valid IMEI
const IMEI2 = "352099001761481";

describe("normaliseSerial", () => {
  it("upper-cases and drops whitespace", () => {
    expect(normaliseSerial(" sn-12 ab\t34 ")).toBe("SN-12AB34");
    expect(normaliseSerial("49 015420 323751 8")).toBe(IMEI);
  });
});

describe("isValidImei", () => {
  it("needs 15 digits with a correct Luhn check digit", () => {
    expect(isValidImei(IMEI)).toBe(true);
    expect(isValidImei(IMEI2)).toBe(true);
    expect(isValidImei("490154203237519")).toBe(false);
    expect(isValidImei("49015420323751")).toBe(false);
    expect(isValidImei("49015420323751A")).toBe(false);
    expect(luhnValid("79927398713")).toBe(true);
  });
});

describe("serialProblem", () => {
  it("checks the check digit only for 15-digit values", () => {
    expect(serialProblem(IMEI)).toBeNull();
    expect(serialProblem("490154203237519")).toBe("imei_check");
    expect(serialProblem("4901542032375199")).toBeNull();
    expect(serialProblem("SN12345")).toBeNull();
    expect(serialProblem("A")).toBe("format");
    expect(serialProblem("AB#12")).toBe("format");
    expect(serialProblem("")).toBe("empty");
  });
});

describe("checkSerialRows", () => {
  it("lists problems per row, including repeats across both columns", () => {
    const r = checkSerialRows([
      { serial: IMEI.toLowerCase(), serial2: IMEI2 },
      { serial: IMEI2 },
      { serial: "490154203237519" },
      { serial: "sn 1", serial2: "SN1" },
    ]);
    expect(r.rows[0]).toEqual({ serial: IMEI, serial2: IMEI2 });
    expect(r.problems).toEqual([
      { index: 1, field: "serial", value: IMEI2, code: "duplicate_in_batch" },
      { index: 2, field: "serial", value: "490154203237519", code: "imei_check" },
      { index: 3, field: "serial2", value: "SN1", code: "same_as_imei1" },
    ]);
  });
});

describe("parseSerialLines", () => {
  it("one serial per line, or two IMEIs per line in dual mode", () => {
    expect(parseSerialLines(" sn 1 \n\nSN2,SN3\r\n", false)).toEqual([{ serial: "SN1" }, { serial: "SN2" }, { serial: "SN3" }]);
    expect(parseSerialLines(`${IMEI}\t${IMEI2}\n${IMEI2} ${IMEI}\nABC`, true)).toEqual([
      { serial: IMEI, serial2: IMEI2 },
      { serial: IMEI2, serial2: IMEI },
      { serial: "ABC", serial2: null },
    ]);
  });
});

describe("warranty", () => {
  it("ends the day before the same date months later", () => {
    expect(warrantyEnd("2026-10-20", 12)).toBe("2027-10-19");
    expect(warrantyEnd("2026-10-01", 6)).toBe("2027-03-31");
    expect(warrantyEnd("2026-01-31", 1)).toBe("2026-02-28");
    expect(warrantyEnd("2027-12-15", 24)).toBe("2029-12-14");
    expect(warrantyEnd("2026-10-20", 0)).toBeNull();
  });
  it("is active through its last day", () => {
    expect(warrantyStatus("2026-10-20", "2026-10-20")).toBe("active");
    expect(warrantyStatus("2026-10-19", "2026-10-20")).toBe("expired");
    expect(warrantyStatus(null, "2026-10-20")).toBe("none");
    expect(warrantyDaysLeft("2026-10-20", "2026-10-20")).toBe(1);
    expect(warrantyDaysLeft("2026-10-30", "2026-10-20")).toBe(11);
    expect(warrantyDaysLeft("2026-10-01", "2026-10-20")).toBe(0);
    expect(warrantyDaysLeft(null, "2026-10-20")).toBeNull();
  });
});

describe("status moves", () => {
  it("allows only hand moves that make sense and moves inventory with the shelf", () => {
    expect(canMoveTo("in_stock", "defective")).toBe(true);
    expect(canMoveTo("sold", "in_stock")).toBe(false);
    expect(canMoveTo("returned", "in_stock")).toBe(true);
    expect(stockDelta("in_stock", "defective")).toBe(-1);
    expect(stockDelta("defective", "written_off")).toBe(0);
    expect(stockDelta("written_off", "in_stock")).toBe(1);
    expect(stockDelta("returned", "in_stock")).toBe(0);
  });
});

describe("public warranty lookup", () => {
  it("matches the last 4 digits of the phone on the sale", () => {
    expect(lastDigits("+91 98765 43210")).toBe("3210");
    expect(lastDigits("12")).toBe("");
    expect(phoneLast4Matches("+91 98765 43210", "3210")).toBe(true);
    expect(phoneLast4Matches("+91 98765 43210", "3211")).toBe(false);
    expect(phoneLast4Matches(null, "3210")).toBe(false);
    expect(phoneLast4Matches("9876543210", "")).toBe(false);
  });

  it("reads claimed only while the warranty runs", () => {
    expect(publicWarrantyStatus("2027-10-19", "2026-10-22", false)).toBe("active");
    expect(publicWarrantyStatus("2027-10-19", "2026-10-22", true)).toBe("claimed");
    expect(publicWarrantyStatus("2026-10-21", "2026-10-22", true)).toBe("expired");
    expect(publicWarrantyStatus(null, "2026-10-22", false)).toBe("none");
  });

  it("validates the query", () => {
    expect(publicWarrantyQuery.parse({ code: " 3567 ", last4: "" })).toEqual({ code: "3567" });
    expect(publicWarrantyQuery.parse({ code: "SN123", last4: "0042" }).last4).toBe("0042");
    expect(() => publicWarrantyQuery.parse({ code: "SN123", last4: "42" })).toThrow();
    expect(() => publicWarrantyQuery.parse({ code: "" })).toThrow();
  });

  it("rate-limits per key in a sliding window", () => {
    let now = 0;
    const l = new LookupLimiter(2, 1000, () => now);
    expect(l.hit("a")).toBe(true);
    expect(l.hit("a")).toBe(true);
    expect(l.hit("a")).toBe(false);
    expect(l.hit("b")).toBe(true);
    now = 1001;
    expect(l.hit("a")).toBe(true);
  });
});
