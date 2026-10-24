import { describe, expect, it } from "vitest";
import { isTestTarget } from "../client/central-sign-in";
import { isProxyAllowed } from "../server/proxy";

describe("central sign-in plumbing", () => {
  it("lets the store redeem a handoff and read the auth config, but never create one", () => {
    expect(isProxyAllowed("/v1/auth/handoff/redeem", "POST")).toBe(true);
    expect(isProxyAllowed("/v1/auth/config", "GET")).toBe(true);
    expect(isProxyAllowed("/v1/auth/handoff", "POST")).toBe(false);
    expect(isProxyAllowed("/v1/auth/store/handoff", "POST")).toBe(false);
    expect(isProxyAllowed("/v1/auth/firebase", "POST")).toBe(false);
  });

  it("keeps test identities on the fixed-code form", () => {
    const patterns = ["+9199990*", "e2e-*@example.com", "*"];
    expect(isTestTarget("+919999000001", patterns)).toBe(true);
    expect(isTestTarget("e2e-a@example.com", patterns)).toBe(true);
    expect(isTestTarget("+919876543210", patterns)).toBe(false);
    expect(isTestTarget("+919876543210", ["*"])).toBe(false);
    expect(isTestTarget("+919876543210")).toBe(false);
  });
});
