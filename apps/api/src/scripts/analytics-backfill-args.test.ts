import { describe, expect, it } from "vitest";
import { parseBackfillArgs } from "./analytics-backfill-args";

const T = "11111111-1111-4111-8111-111111111111";

describe("parseBackfillArgs", () => {
  it("defaults to 90 days, all shops", () => {
    expect(parseBackfillArgs([])).toEqual({ days: 90 });
  });
  it("reads --days and --tenant, spaced or with =", () => {
    expect(parseBackfillArgs(["--days", "30", "--tenant", T])).toEqual({ days: 30, tenantId: T });
    expect(parseBackfillArgs([`--days=7`, `--tenant=${T}`])).toEqual({ days: 7, tenantId: T });
  });
  it("rejects bad values and unknown options", () => {
    for (const bad of [["--days", "0"], ["--days", "1.5"], ["--days", "400"], ["--days"], ["--tenant", "x"], ["--wat"]]) {
      expect(() => parseBackfillArgs(bad)).toThrow(/Usage/);
    }
  });
});
