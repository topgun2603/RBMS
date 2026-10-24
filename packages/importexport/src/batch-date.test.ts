import { describe, expect, it } from "vitest";
import { parseBatchDate } from "./columns";
import { productColumns, toProductRow } from "./specs";

describe("parseBatchDate", () => {
  it("a month is the last day for an expiry and the first for a manufacturing date", () => {
    for (const v of ["03/2027", "3-27", "03.2027", "Mar-2027", "MAR 27", "march 2027", "2027-03", "2027/3"]) expect(parseBatchDate(v, "expiry"), v).toBe("2027-03-31");
    expect(parseBatchDate("09/2025", "mfg")).toBe("2025-09-01");
    expect(parseBatchDate("Feb-2028", "expiry")).toBe("2028-02-29");
  });
  it("full dates still work and nonsense is refused", () => {
    expect(parseBatchDate("15/03/2027")).toBe("2027-03-15");
    expect(parseBatchDate("2027-03-15")).toBe("2027-03-15");
    for (const v of ["13/2027", "foo", "00/2027", "Xyz-2027", "1999-01"]) expect(() => parseBatchDate(v), v).toThrow();
  });
});

describe("product rows with batches", () => {
  const col = (k: string) => productColumns.find((c) => c.key === k)!;
  it("reads batch number, expiry and manufacturing date", () => {
    expect(col("expiry").parse("03/2027")).toBe("2027-03-31");
    expect(col("mfg_date").parse("09/2025")).toBe("2025-09-01");
    const row = toProductRow({ name: "Syrup", gst: 12, price: 9500, tax_inclusive: false, batch_no: "A1", expiry: "2027-03-31", mfg_date: "2025-09-01" });
    expect(row).toMatchObject({ batchNo: "A1", expiry: "2027-03-31", mfgDate: "2025-09-01" });
  });
});
