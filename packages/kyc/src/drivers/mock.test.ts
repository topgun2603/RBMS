import { describe, expect, it } from "vitest";
import { MOCK_NAME, MOCK_OTHER_NAME, MockKycDriver } from "./mock";
import { KycProviderError } from "./types";

const d = new MockKycDriver();

describe("MockKycDriver", () => {
  it("PAN outcomes", async () => {
    expect(await d.verifyPan({ pan: "ABCDE1234F", name: "Someone" })).toMatchObject({ status: "verified", name: MOCK_NAME });
    expect(await d.verifyPan({ pan: "AAAPL1234C", name: "gowtham kumar" })).toMatchObject({
      status: "verified",
      name: "GOWTHAM KUMAR",
      details: { category: "Individual" },
    });
    expect(await d.verifyPan({ pan: "AAAPL1234C" })).toMatchObject({ name: MOCK_NAME });
    expect(await d.verifyPan({ pan: "AAAPL1234Z" })).toMatchObject({ status: "failed", error: "invalid_pan" });
    await expect(d.verifyPan({ pan: "AAAPL1234Y" })).rejects.toBeInstanceOf(KycProviderError);
  });

  it("is deterministic (same providerRef for the same input)", async () => {
    const a = await d.verifyPan({ pan: "AAAPL1234C" });
    const b = await d.verifyPan({ pan: "AAAPL1234C" });
    expect(a.providerRef).toBe(b.providerRef);
  });

  it("GSTIN outcomes follow the embedded PAN", async () => {
    expect(await d.verifyGstin({ gstin: "33ABCDE1234F1Z7" })).toMatchObject({ status: "verified", name: MOCK_NAME, details: { gstStatus: "Active", stateCode: "33" } });
    expect(await d.verifyGstin({ gstin: "33ABCDE1234Z1Z2" })).toMatchObject({ status: "failed", error: "gstin_not_found" });
    expect(await d.verifyGstin({ gstin: "33ABCDE1234Y1Z4" })).toMatchObject({ status: "failed", error: "gstin_inactive", details: { gstStatus: "Cancelled" } });
  });

  it("bank outcomes; never echoes the full account number", async () => {
    const okRes = await d.verifyBankAccount({ accountNumber: "123456781234", ifsc: "SBIN0001234", name: "Gowtham" });
    expect(okRes).toMatchObject({ status: "verified", name: "GOWTHAM", details: { bankName: "SBIN BANK", accountLast4: "1234" } });
    expect(JSON.stringify(okRes)).not.toContain("123456781234");
    expect(await d.verifyBankAccount({ accountNumber: "123456780000", ifsc: "SBIN0001234" })).toMatchObject({ status: "failed", error: "account_not_found" });
    expect(await d.verifyBankAccount({ accountNumber: "123456789999", ifsc: "SBIN0001234", name: "Gowtham" })).toMatchObject({ name: MOCK_OTHER_NAME });
  });

  it("UPI outcomes", async () => {
    expect(await d.verifyUpi({ vpa: "gowtham@okhdfc" })).toMatchObject({ status: "verified", name: MOCK_NAME, details: { handle: "okhdfc" } });
    expect(await d.verifyUpi({ vpa: "failme@ybl" })).toMatchObject({ status: "failed", error: "vpa_not_found" });
    expect(await d.verifyUpi({ vpa: "other@ybl", name: "x" })).toMatchObject({ name: MOCK_OTHER_NAME });
  });

  it("DigiLocker: start → pending with a consent URL; fetch completes", async () => {
    const start = await d.startDigilocker({ name: "Priya", redirectUrl: "https://shop.test/kyc/done" });
    expect(start).toMatchObject({ status: "pending", actionUrl: expect.stringContaining("https://digilocker.mock/consent") });
    expect(await d.fetchDigilocker(start.providerRef!)).toMatchObject({ status: "verified", name: "PRIYA", details: { aadhaarLast4: "1234" } });
    const anon = await d.startDigilocker({});
    expect(await d.fetchDigilocker(anon.providerRef!)).toMatchObject({ name: MOCK_NAME });
    const denied = await d.startDigilocker({ name: "Vetriz" });
    expect(await d.fetchDigilocker(denied.providerRef!)).toMatchObject({ status: "failed", error: "consent_denied" });
    expect(await d.fetchDigilocker("other")).toMatchObject({ status: "failed" });
  });

  it("selfie outcomes", async () => {
    expect(await d.matchSelfie({ selfieUrl: "https://cdn/s.jpg" })).toMatchObject({ status: "verified", score: 95 });
    expect(await d.matchSelfie({ selfieUrl: "https://cdn/review.jpg" })).toMatchObject({ status: "verified", score: 65 });
    expect(await d.matchSelfie({ selfieUrl: "https://cdn/fail.jpg" })).toMatchObject({ status: "failed", score: 20 });
  });
});
