import { describe, expect, it } from "vitest";
import type { Viewer } from "./logic";
import { MemoryNonceStore, StreamTokens } from "./stream-token";

const tenant = { id: "t1", slug: "sri", planId: "pro", appId: "EC" };
const viewer: Viewer = { tenantId: "t1", userId: "u1", isStaff: true, canManage: true };

describe("StreamTokens", () => {
  it("issues a 60 s single-use token carrying the viewer", async () => {
    let now = 1_000_000;
    const tokens = new StreamTokens("secret", new MemoryNonceStore(() => now), () => now);
    const { token, expiresAt } = tokens.issue(viewer, tenant);
    expect(expiresAt).toBe(new Date(1_060_000).toISOString());
    const p = await tokens.redeem(token);
    expect(p).toMatchObject({ viewer, tenant, exp: 1_060_000 });
    expect(await tokens.redeem(token)).toBeNull(); // single use
  });

  it("expires after 60 s", async () => {
    let now = 0;
    const tokens = new StreamTokens("secret", new MemoryNonceStore(() => now), () => now);
    const { token } = tokens.issue(viewer, tenant);
    now = 59_999;
    expect(tokens.verify(token)).not.toBeNull();
    now = 60_000;
    expect(await tokens.redeem(token)).toBeNull();
  });

  it("rejects tampering and other secrets; instances sharing the secret accept each other's tokens", async () => {
    const a = new StreamTokens("secret");
    const b = new StreamTokens("secret");
    const other = new StreamTokens("different");
    const { token } = a.issue(viewer, tenant);
    expect(other.verify(token)).toBeNull();
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, "base64url").toString()), viewer: { ...viewer, userId: "evil" } })).toString("base64url");
    expect(a.verify(`${forged}.${sig}`)).toBeNull();
    expect(a.verify("garbage")).toBeNull();
    expect(a.verify(`${token}.x`)).toBeNull();
    expect(await b.redeem(token)).not.toBeNull();
  });

  it("without a secret, tokens only verify on the issuing instance", () => {
    const a = new StreamTokens(undefined);
    const b = new StreamTokens(undefined);
    const { token } = a.issue(viewer, tenant);
    expect(a.verify(token)).not.toBeNull();
    expect(b.verify(token)).toBeNull();
  });
});
