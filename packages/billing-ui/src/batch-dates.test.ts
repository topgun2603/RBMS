import { describe, expect, it } from "vitest";
import { fmtStamp } from "./components/inventory/batch-bits";

describe("fmtStamp", () => {
  it("shows India's calendar day, not the UTC one", () => {
    // 18:44 UTC on 24 Oct is already 00:14 on 25 Oct in India.
    expect(fmtStamp("2026-10-24T18:44:00.000Z")).toBe("25 Oct 2026");
    expect(fmtStamp("2026-10-24T12:00:00.000Z")).toBe("24 Oct 2026");
  });
  it("is an em dash for no value and echoes junk", () => {
    expect(fmtStamp(null)).toBe("—");
    expect(fmtStamp("not a date")).toBe("not a date");
  });
});
