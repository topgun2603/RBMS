import { describe, expect, it } from "vitest";
import { isValidImei, parseAndCheck } from "./serial";

const IMEI = "490154203237518";
const IMEI2 = "352099001761481";

describe("parseAndCheck", () => {
  it("checks IMEIs, repeats and pairs like the API", () => {
    expect(isValidImei(IMEI)).toBe(true);
    expect(isValidImei("490154203237519")).toBe(false);
    const rows = parseAndCheck(`${IMEI}\t${IMEI2}\n\n490154203237519\n${IMEI2}`, true);
    expect(rows.map((r) => [r.line, r.serial, r.serial2, r.problems.map((p) => p.code)])).toEqual([
      [1, IMEI, IMEI2, []],
      [3, "490154203237519", null, ["imei_check"]],
      [4, IMEI2, null, ["duplicate_in_batch"]],
    ]);
  });
  it("takes one serial per line in single mode", () => {
    expect(parseAndCheck(" sn 001 \nSN002, sn003", false).map((r) => r.serial)).toEqual(["SN001", "SN002", "SN003"]);
  });
});
