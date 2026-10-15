import { describe, expect, it } from "vitest";
import { pickCurrentBranch, type MyBranchItem } from "../components/branch-switcher";
import { BRANCH_KEY_PREFIX, branchKey, isBranchError } from "./branch";
import { webMessages } from "./messages";

const b = (id: string, extra: Partial<MyBranchItem> = {}): MyBranchItem => ({
  id,
  name: `Branch ${id}`,
  code: id.toUpperCase(),
  city: null,
  isDefault: false,
  isHome: false,
  ...extra,
});

describe("branch storage", () => {
  it("keys the choice per shop under the sr_ prefix (so other tabs hear changes)", () => {
    expect(branchKey("raja")).toBe("sr_branch:raja");
    expect(BRANCH_KEY_PREFIX.startsWith("sr_")).toBe(true);
    expect(branchKey("raja")).not.toBe(branchKey("kumar"));
  });

  it("recognises the API's stale-branch errors only", () => {
    expect(isBranchError("branch_forbidden")).toBe(true);
    expect(isBranchError("branch_not_found")).toBe(true);
    expect(isBranchError("forbidden")).toBe(false);
    expect(isBranchError(undefined)).toBe(false);
  });
});

describe("pickCurrentBranch", () => {
  const data = { items: [b("main", { isDefault: true }), b("north", { isHome: true }), b("south")], defaultBranchId: "main", currentBranchId: "north" };

  it("prefers the stored branch while it is still usable", () => {
    expect(pickCurrentBranch(data, "south")?.id).toBe("south");
  });

  it("falls back to the server's choice, then home, then main", () => {
    expect(pickCurrentBranch(data, "gone")?.id).toBe("north");
    expect(pickCurrentBranch({ ...data, currentBranchId: null }, null)?.id).toBe("north");
    expect(pickCurrentBranch({ items: [b("main", { isDefault: true }), b("x")], defaultBranchId: "main", currentBranchId: null }, null)?.id).toBe("main");
  });

  it("is null without branches", () => {
    expect(pickCurrentBranch(undefined, "x")).toBeNull();
    expect(pickCurrentBranch({ items: [], defaultBranchId: "m", currentBranchId: null }, null)).toBeNull();
  });
});

describe("branch messages", () => {
  it("has every web.branch key in English and Tamil", () => {
    const en = Object.keys(webMessages.en).filter((k) => k.startsWith("web.branch."));
    const ta = Object.keys(webMessages.ta).filter((k) => k.startsWith("web.branch."));
    expect(en.length).toBeGreaterThan(0);
    expect(ta.sort()).toEqual(en.sort());
    for (const k of ta) expect(/[஀-௿]/.test(webMessages.ta[k]!), k).toBe(true);
  });
});
