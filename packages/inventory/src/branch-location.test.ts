import { describe, expect, it } from "vitest";
import { atBranch } from "./routes";

const req = (locationId: string | null | undefined) => ({ ctx: { branch: locationId === undefined ? undefined : { id: "b1", code: "B1", locationId } } }) as never;

describe("atBranch (stock routes default to the current branch's location)", () => {
  it("fills locationId from ctx.branch when the request names none", () => {
    expect(atBranch(req("loc-1"), { q: "silk" })).toEqual({ q: "silk", locationId: "loc-1" });
    expect(atBranch(req("loc-1"), { locationId: "" })).toEqual({ locationId: "loc-1" });
  });

  it("keeps an explicit locationId, and `all` means every location", () => {
    expect(atBranch(req("loc-1"), { locationId: "loc-2" })).toEqual({ locationId: "loc-2" });
    expect(atBranch(req("loc-1"), { locationId: "all", q: "x" })).toEqual({ q: "x" });
  });

  it("changes nothing without a branch (or a branch without a location)", () => {
    const input = { q: "silk" };
    expect(atBranch(req(undefined), input)).toBe(input);
    expect(atBranch(req(null), input)).toBe(input);
  });
});
