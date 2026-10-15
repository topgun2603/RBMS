import { describe, expect, it, vi } from "vitest";
import { HttpKycDriver } from "./http";
import { KycProviderError } from "./types";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function driver(responder: (url: string, init: RequestInit) => Response | Promise<Response>, extra: Partial<ConstructorParameters<typeof HttpKycDriver>[0]> = {}) {
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => responder(String(url), init ?? {}));
  const d = new HttpKycDriver({ baseUrl: "https://kyc.test/", token: "tok_123", provider: "surepass", fetch: fetchFn as unknown as typeof fetch, ...extra });
  return { d, fetchFn };
}

describe("HttpKycDriver", () => {
  it("requires base URL and token", () => {
    expect(() => new HttpKycDriver({ baseUrl: "", token: "x" })).toThrow(/baseUrl/);
    expect(() => new HttpKycDriver({ baseUrl: "https://x", token: "" })).toThrow(/token/);
  });

  it("PAN: posts with bearer token and maps the Surepass envelope", async () => {
    const { d, fetchFn } = driver(() => json(200, { success: true, data: { client_id: "c1", pan_number: "AAAPL1234C", full_name: "GOWTHAM KUMAR S", category: "person", aadhaar_linked: true } }));
    const out = await d.verifyPan({ pan: "AAAPL1234C" });
    expect(out).toEqual({ status: "verified", name: "GOWTHAM KUMAR S", details: { category: "person", aadhaarLinked: true, panStatus: null }, providerRef: "c1" });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://kyc.test/api/v1/pan/pan-comprehensive");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer tok_123");
    expect(JSON.parse(String(init?.body))).toEqual({ id_number: "AAAPL1234C" });
    expect(d.provider).toBe("surepass");
  });

  it("422 from the provider is an answer (failed), not an error", async () => {
    const { d } = driver(() => json(422, { success: false, message_code: "Invalid PAN", data: {} }));
    expect(await d.verifyPan({ pan: "AAAPL1234C" })).toMatchObject({ status: "failed", error: "invalid_pan" });
  });

  it("GSTIN: inactive status fails", async () => {
    const { d } = driver(() => json(200, { success: true, data: { gstin: "33ABCDE1234F1Z7", legal_name: "RAJA", business_name: "RAJA STORES", gstin_status: "Cancelled" } }));
    expect(await d.verifyGstin({ gstin: "33ABCDE1234F1Z7" })).toMatchObject({ status: "failed", error: "gstin_inactive", details: { gstStatus: "Cancelled", stateCode: "33" } });
    const { d: d2 } = driver(() => json(200, { success: true, data: { gstin: "33ABCDE1234F1Z7", legal_name: "RAJA", business_name: "RAJA STORES", gstin_status: "Active" } }));
    expect(await d2.verifyGstin({ gstin: "33ABCDE1234F1Z7" })).toMatchObject({ status: "verified", name: "RAJA", details: { tradeName: "RAJA STORES" } });
  });

  it("bank: holder name + bank name; the account number never comes back", async () => {
    const { d } = driver(() =>
      json(200, { success: true, data: { account_exists: true, full_name: "GOWTHAM KUMAR", account_number: "123456789012", ifsc_details: { bank_name: "State Bank of India", branch: "Anna Nagar" } } }),
    );
    const out = await d.verifyBankAccount({ accountNumber: "123456789012", ifsc: "SBIN0001234" });
    expect(out).toMatchObject({ status: "verified", name: "GOWTHAM KUMAR", details: { bankName: "State Bank of India", accountLast4: "9012", ifsc: "SBIN0001234" } });
    expect(JSON.stringify(out)).not.toContain("123456789012");
    const { d: d2 } = driver(() => json(200, { success: true, data: { account_exists: false } }));
    expect(await d2.verifyBankAccount({ accountNumber: "123456789012", ifsc: "SBIN0001234" })).toMatchObject({ status: "failed", error: "account_not_found" });
  });

  it("UPI", async () => {
    const { d, fetchFn } = driver(() => json(200, { success: true, data: { account_exists: true, full_name: "PRIYA" } }));
    expect(await d.verifyUpi({ vpa: "priya@oksbi" })).toMatchObject({ status: "verified", name: "PRIYA" });
    expect(JSON.parse(String(fetchFn.mock.calls[0]![1]?.body))).toEqual({ upi_id: "priya@oksbi" });
  });

  it("DigiLocker: start, then fetch (pending until consent, Aadhaar masked to last 4)", async () => {
    const { d, fetchFn } = driver((url) => {
      if (url.endsWith("/initialize")) return json(200, { success: true, data: { client_id: "dl_1", url: "https://digilocker.example/consent" } });
      return json(200, { success: true, data: { aadhaar_xml_data: { full_name: "PRIYA", masked_aadhaar: "XXXXXXXX2346", dob: "1991-02-03", gender: "F", full_address: { state: "Tamil Nadu" } } } });
    });
    expect(await d.startDigilocker({ redirectUrl: "https://shop.test/back" })).toMatchObject({ status: "pending", providerRef: "dl_1", actionUrl: "https://digilocker.example/consent" });
    const out = await d.fetchDigilocker("dl_1");
    expect(out).toEqual({ status: "verified", name: "PRIYA", details: { aadhaarLast4: "2346", gender: "F", yearOfBirth: 1991, state: "Tamil Nadu" }, providerRef: "dl_1" });
    expect(fetchFn.mock.calls[1]![0]).toBe("https://kyc.test/api/v1/digilocker/download-aadhaar/dl_1");
    expect(fetchFn.mock.calls[1]![1]?.method).toBe("GET");

    const { d: waiting } = driver(() => json(422, { success: false, message_code: "verification_pending" }));
    expect(await waiting.fetchDigilocker("dl_1")).toMatchObject({ status: "pending" });
  });

  it("selfie: confidence 0–1 is scaled to 0–100", async () => {
    const { d } = driver(() => json(200, { success: true, data: { match_status: true, confidence: 0.91 } }));
    expect(await d.matchSelfie({ selfieUrl: "https://cdn/s.jpg" })).toMatchObject({ status: "verified", score: 91 });
    const { d: no } = driver(() => json(200, { success: true, data: { match_status: false, confidence: 30 } }));
    expect(await no.matchSelfie({ selfieUrl: "https://cdn/s.jpg" })).toMatchObject({ status: "failed", error: "face_mismatch", score: 30 });
  });

  it.each([
    [401, "unauthorized"],
    [403, "unauthorized"],
    [429, "rate_limited"],
    [502, "server_error"],
    [302, "bad_response"],
  ])("HTTP %i → KycProviderError %s", async (status, code) => {
    const { d } = driver(() => json(status, {}));
    await expect(d.verifyPan({ pan: "AAAPL1234C" })).rejects.toMatchObject({ name: "KycProviderError", status, code });
  });

  it("non-JSON → bad_response; network error → network", async () => {
    const { d } = driver(() => new Response("<html>", { status: 200 }));
    await expect(d.verifyUpi({ vpa: "a@b" })).rejects.toMatchObject({ code: "bad_response" });
    const { d: down } = driver(() => {
      throw new TypeError("fetch failed");
    });
    await expect(down.verifyUpi({ vpa: "a@b" })).rejects.toMatchObject({ code: "network", status: 0 });
  });

  it("times out", async () => {
    const { d } = driver(
      (_url, init) =>
        new Promise<Response>((_res, rej) => {
          init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
      { timeoutMs: 20 },
    );
    const err = await d.verifyPan({ pan: "AAAPL1234C" }).catch((e) => e);
    expect(err).toBeInstanceOf(KycProviderError);
    expect(err).toMatchObject({ code: "timeout", status: 0 });
    expect(String(err.message)).not.toContain("AAAPL1234C");
  });

  it("paths and mappers can be overridden (IDfy-like)", async () => {
    const { d, fetchFn } = driver(() => json(200, { result: { name_on_card: "X Y" } }), {
      paths: { pan: "v3/tasks/sync/verify_with_source/ind_pan" },
      mappers: { pan: (j) => ({ status: "verified", name: (j as { result: { name_on_card: string } }).result.name_on_card, details: {} }) },
      headers: { "account-id": "acc1" },
    });
    expect(await d.verifyPan({ pan: "AAAPL1234C" })).toMatchObject({ name: "X Y" });
    expect(fetchFn.mock.calls[0]![0]).toBe("https://kyc.test/v3/tasks/sync/verify_with_source/ind_pan");
    expect((fetchFn.mock.calls[0]![1]?.headers as Record<string, string>)["account-id"]).toBe("acc1");
  });
});
