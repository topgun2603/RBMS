import { describe, expect, it } from "vitest";
import { isMfaRequired, recoveryCodesText } from "./mfa";
import { enSecurity, taSecurity } from "./messages-security";

describe("two-factor client helpers", () => {
  it("tells the challenge from a session", () => {
    expect(isMfaRequired({ mfa_required: true, enrolRequired: false, challengeToken: "x", expiresAt: "2026-01-01T00:00:00Z" })).toBe(true);
    expect(isMfaRequired({ token: "t", expiresAt: "x", isNewUser: false, user: {} as never })).toBe(false);
  });
  it("renders the recovery codes as a file body", () => {
    const text = recoveryCodesText(["AAAA-BBBB", "CCCC-DDDD"], "Raja Silks");
    expect(text).toContain("Raja Silks");
    expect(text).toContain("AAAA-BBBB\nCCCC-DDDD");
  });
  it("English and Tamil have the same keys", () => {
    expect(Object.keys(taSecurity).sort()).toEqual(Object.keys(enSecurity).sort());
  });
});
