import { describe, expect, it } from "vitest";
import { emptyContext, requireBranch } from "./context";
import { AppError } from "./errors";

describe("requireBranch", () => {
  it("returns the current branch", () => {
    const branch = { id: "b1", code: "MAIN", locationId: null };
    expect(requireBranch({ ...emptyContext(), branch })).toBe(branch);
  });

  it("throws 400 branch_required when the branch is missing or null", () => {
    for (const ctx of [emptyContext(), { ...emptyContext(), branch: null }]) {
      try {
        requireBranch(ctx);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect(err).toMatchObject({ status: 400, code: "branch_required" });
      }
    }
  });

  it("leaves emptyContext unchanged (branch stays optional)", () => {
    expect("branch" in emptyContext()).toBe(false);
  });
});
