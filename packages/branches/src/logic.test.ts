import { describe, expect, it } from "vitest";
import {
  checkGstState,
  chooseBranch,
  deactivateProblem,
  findBranch,
  isValidGstin,
  monthToDate,
  prefixProblem,
  prefixFromName,
  sanitizePrefix,
  suggestPrefix,
  usableBranches,
  type BranchLite,
} from "./logic";

// Valid GSTINs (check characters computed with the GSTN mod-36 rule).
const TN = "33AAACR5055K1ZE"; // Tamil Nadu
const KA = "29AAACR5055K1Z3"; // Karnataka

const MAIN: BranchLite = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", code: "MAIN", locationId: "l-main", isDefault: true };
const MDU: BranchLite = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", code: "MDU", locationId: "l-mdu", isDefault: false };
const BLR: BranchLite = { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", code: "BLR", locationId: null, isDefault: false };
const ALL = [MDU, MAIN, BLR];

describe("GSTIN and state", () => {
  it("validates GSTIN check characters", () => {
    expect(isValidGstin(TN)).toBe(true);
    expect(isValidGstin(KA)).toBe(true);
    expect(isValidGstin("33AAACR5055K1Z5")).toBe(false);
    expect(isValidGstin(" 33aaacr5055k1ze ")).toBe(true);
  });

  it("takes the state from the GSTIN when missing", () => {
    expect(checkGstState(TN, null)).toEqual({ ok: true, gstin: TN, stateCode: "33" });
    expect(checkGstState(TN.toLowerCase(), "")).toEqual({ ok: true, gstin: TN, stateCode: "33" });
  });

  it("refuses a GSTIN from another state", () => {
    const r = checkGstState(KA, "33");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.field).toBe("gstin");
      expect(r.message).toContain("29");
    }
    expect(checkGstState(TN, " 33 ")).toEqual({ ok: true, gstin: TN, stateCode: "33" });
    expect(checkGstState(TN, "3")).toMatchObject({ ok: false, field: "gstin" });
  });

  it("refuses bad GSTINs and unknown states", () => {
    expect(checkGstState("33ABC", "33")).toMatchObject({ ok: false, field: "gstin" });
    expect(checkGstState(null, "25")).toMatchObject({ ok: false, field: "stateCode" });
    expect(checkGstState(null, "xx")).toMatchObject({ ok: false, field: "stateCode" });
    expect(checkGstState(null, "33")).toEqual({ ok: true, gstin: null, stateCode: "33" });
    expect(checkGstState(null, null)).toEqual({ ok: true, gstin: null, stateCode: null });
  });
});

describe("bill prefixes", () => {
  it("derives a new shop's prefix from its name", () => {
    expect(prefixFromName("ByteFix Computers")).toBe("BFC");
    expect(prefixFromName("ByteFix")).toBe("BF");
    expect(prefixFromName("Glow Salon & Spa")).toBe("GSS");
    expect(prefixFromName("Glow")).toBe("GLO");
    expect(prefixFromName("Sri Lakshmi Stores Pvt. Ltd.")).toBe("SLS");
    expect(prefixFromName("The Royal Tailors")).toBe("RT");
    expect(prefixFromName("A1 Mobiles")).toBe("AM");
    expect(prefixFromName("Café Mocha")).toBe("CM");
    expect(prefixFromName("Kanchi Silk Saree House Of Weaves")).toBe("KSSH");
    expect(prefixFromName("ஸ்ரீ ஸ்டோர்ஸ்")).toBe("INV");
    expect(prefixFromName("")).toBe("INV");
    expect(prefixFromName(null)).toBe("INV");
    for (const n of ["ByteFix Computers", "Glow", "x", "123 Stores"]) expect(prefixProblem(prefixFromName(n))).toBeNull();
  });

  it("sanitises like the invoices module", () => {
    expect(sanitizePrefix("mdu north")).toBe("MDUNOR");
    expect(sanitizePrefix("")).toBe("INV");
    expect(sanitizePrefix(null)).toBe("INV");
    expect(sanitizePrefix("AB-")).toBe("AB");
  });

  it("checks prefixes", () => {
    expect(prefixProblem("MDU")).toBeNull();
    expect(prefixProblem("M-1")).toBeNull();
    expect(prefixProblem("A")).toBeNull();
    expect(prefixProblem("TOOLONG")).not.toBeNull();
    expect(prefixProblem("AB-")).not.toBeNull();
    expect(prefixProblem("A/B")).not.toBeNull();
  });

  it("suggests a free prefix from the code", () => {
    expect(suggestPrefix("MDU", [])).toBe("MDU");
    expect(suggestPrefix("MDU", ["mdu"])).toBe("MDU2");
    expect(suggestPrefix("MDU", ["MDU", "MDU2"])).toBe("MDU3");
    expect(suggestPrefix("MDU_NORTH", [])).toBe("MDU-NO");
    expect(suggestPrefix("MADURAI", ["MADURA"])).toBe("MADUR2");
    expect(suggestPrefix("MDU-N", ["MDU-N"])).toBe("MDU-N2");
  });
});

describe("deactivation", () => {
  it("never closes the default or the last open branch", () => {
    expect(deactivateProblem({ isDefault: true, active: true }, 3)).toMatch(/main branch/);
    expect(deactivateProblem({ isDefault: false, active: true }, 1)).toMatch(/at least one/);
    expect(deactivateProblem({ isDefault: false, active: true }, 2)).toBeNull();
    expect(deactivateProblem({ isDefault: true, active: false }, 1)).toBeNull();
  });
});

describe("choosing the request's branch", () => {
  it("finds branches by id or code, case-insensitively", () => {
    expect(findBranch(ALL, "mdu")).toBe(MDU);
    expect(findBranch(ALL, MDU.id.toUpperCase())).toBe(MDU);
    expect(findBranch(ALL, "nope")).toBeUndefined();
  });

  it("is null when the shop has no branches", () => {
    expect(chooseBranch([], { kind: "all" }, "MDU")).toEqual({ ok: true, branch: null });
  });

  it("owners/admins use any branch and default to the shop default", () => {
    expect(chooseBranch(ALL, { kind: "all" })).toEqual({ ok: true, branch: MAIN });
    expect(chooseBranch(ALL, { kind: "all" }, "blr")).toEqual({ ok: true, branch: BLR });
    // an owner with a home branch starts there
    expect(chooseBranch(ALL, { kind: "all", assignments: [{ branchId: MDU.id, isDefault: true }] })).toEqual({ ok: true, branch: MDU });
  });

  it("staff only use assigned branches", () => {
    const access = { kind: "assigned" as const, assignments: [{ branchId: MDU.id, isDefault: false }] };
    expect(chooseBranch(ALL, access)).toEqual({ ok: true, branch: MDU });
    expect(chooseBranch(ALL, access, "MDU")).toEqual({ ok: true, branch: MDU });
    expect(chooseBranch(ALL, access, "MAIN")).toEqual({ ok: false, error: "forbidden", header: "MAIN" });
    expect(chooseBranch(ALL, access, "XYZ")).toEqual({ ok: false, error: "not_found", header: "XYZ" });
  });

  it("staff with several branches start at their home, else the shop default, else the first by code", () => {
    const home = { kind: "assigned" as const, assignments: [{ branchId: MDU.id, isDefault: false }, { branchId: BLR.id, isDefault: true }] };
    expect(chooseBranch(ALL, home)).toEqual({ ok: true, branch: BLR });
    const noHome = { kind: "assigned" as const, assignments: [{ branchId: MDU.id, isDefault: false }, { branchId: MAIN.id, isDefault: false }] };
    expect(chooseBranch(ALL, noHome)).toEqual({ ok: true, branch: MAIN });
    const neither = { kind: "assigned" as const, assignments: [{ branchId: MDU.id, isDefault: false }, { branchId: BLR.id, isDefault: false }] };
    expect(chooseBranch(ALL, neither)).toEqual({ ok: true, branch: BLR });
  });

  it("unassigned staff (or staff whose branches closed) work at the default branch", () => {
    expect(chooseBranch(ALL, { kind: "assigned", assignments: [] })).toEqual({ ok: true, branch: MAIN });
    expect(chooseBranch(ALL, { kind: "assigned", assignments: [{ branchId: "gone", isDefault: true }] })).toEqual({ ok: true, branch: MAIN });
    expect(chooseBranch(ALL, { kind: "assigned", assignments: [] }, "MDU")).toMatchObject({ ok: false, error: "forbidden" });
  });

  it("public requests get the default branch and ignore the header", () => {
    expect(chooseBranch(ALL, { kind: "public" }, "MDU")).toEqual({ ok: true, branch: MAIN });
    expect(chooseBranch(ALL, { kind: "public" }, "nope")).toEqual({ ok: true, branch: MAIN });
  });

  it("falls back to the first branch by code when no default is open", () => {
    const noDefault = [MDU, BLR];
    expect(chooseBranch(noDefault, { kind: "all" })).toEqual({ ok: true, branch: BLR });
    expect(chooseBranch(noDefault, { kind: "public" })).toEqual({ ok: true, branch: BLR });
  });

  it("lists usable branches default first", () => {
    expect(usableBranches(ALL, { kind: "all" }).map((b) => b.code)).toEqual(["MAIN", "BLR", "MDU"]);
  });
});

describe("dates", () => {
  it("month to date in IST", () => {
    // 2026-10-31 20:00 UTC is already 1 November in India.
    expect(monthToDate(new Date("2026-10-31T20:00:00Z"))).toEqual({ from: "2026-11-01", to: "2026-11-01" });
    expect(monthToDate(new Date("2026-10-15T06:00:00Z"))).toEqual({ from: "2026-10-01", to: "2026-10-15" });
  });
});
