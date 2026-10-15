import { sha256 } from "@srirealtime/core";
import { describe, expect, it, vi } from "vitest";
import { buildCancelIrn, buildEwbByIrn } from "../ewb";
import { buildEInvoice } from "../nic";
import { invoice, SELLER_GSTIN } from "../test-fixtures";
import { GspDriver, memoryTokenCache, parseGspEnvelope, readGspToken } from "./gsp";
import { decodeSignedQr, mainHsn, MockDriver, mockAckNo, mockIrn } from "./mock";
import { EInvoiceError } from "./types";

const NOW = new Date("2026-10-15T06:30:00Z"); // 12:00 IST

describe("MockDriver", () => {
  const payload = buildEInvoice(invoice());

  it("IRN = sha256(gstin + docType + docNo + FY), 64 hex", async () => {
    const d = new MockDriver(() => NOW);
    const r = await d.generateIrn(payload);
    expect(r.irn).toBe(sha256(`${SELLER_GSTIN}INVINV/26-27/00422026-27`));
    expect(r.irn).toMatch(/^[0-9a-f]{64}$/);
    expect(mockIrn(SELLER_GSTIN, "INV", "INV/26-27/0042", "2026-10-14")).toBe(r.irn);
    expect(r.ackNo).toMatch(/^1\d{14}$/);
    expect(r.ackNo).toBe(mockAckNo(r.irn));
    expect(r.ackDate).toBe("2026-10-15 12:00:00");
    expect(r.status).toBe("ACT");
    expect(r.mock).toBe(true);
  });

  it("signed QR is base64url JSON flagged as mock", async () => {
    const r = await new MockDriver(() => NOW).generateIrn(payload);
    const qr = JSON.parse(Buffer.from(r.signedQrCode!, "base64url").toString("utf8"));
    expect(qr).toEqual({
      SellerGstin: SELLER_GSTIN,
      BuyerGstin: payload.BuyerDtls.Gstin,
      DocNo: "INV/26-27/0042",
      DocTyp: "INV",
      DocDt: "14/10/2026",
      TotInvVal: 3277,
      ItemCnt: 2,
      MainHsnCode: "5208",
      Irn: r.irn,
      IrnDt: "2026-10-15 12:00:00",
      mock: true,
    });
    expect(decodeSignedQr(r.signedQrCode)).toEqual(qr);
    expect(mainHsn(payload)).toBe("5208");
  });

  it("decodes NIC JWT QR codes too", () => {
    const data = { Irn: "x".repeat(64), DocNo: "A1" };
    const jwt = `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify({ data: JSON.stringify(data), iss: "NIC" })).toString("base64url")}.sig`;
    expect(decodeSignedQr(jwt)).toEqual(data);
    expect(decodeSignedQr("garbage")).toBeNull();
    expect(decodeSignedQr(null)).toBeNull();
  });

  it("is deterministic across instances; second call is a 2150 duplicate with the existing IRN", async () => {
    const a = await new MockDriver(() => NOW).generateIrn(payload);
    const d = new MockDriver(() => NOW);
    const b = await d.generateIrn(payload);
    expect(b.irn).toBe(a.irn);
    const err = await d.generateIrn(payload).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EInvoiceError);
    expect(err).toMatchObject({ kind: "duplicate_irn", code: "2150", opts: { existing: { irn: a.irn } } });
    expect(await d.getByIrn(a.irn)).toMatchObject({ irn: a.irn });
    expect(await d.getByDocument("INV", "INV/26-27/0042", "14/10/2026")).toMatchObject({ irn: a.irn });
  });

  it("cancels within 24 h only, once", async () => {
    let now = NOW;
    const d = new MockDriver(() => now);
    const r = await d.generateIrn(payload);
    now = new Date(NOW.getTime() + 25 * 3_600_000);
    await expect(d.cancelIrn(buildCancelIrn(r.irn, 1))).rejects.toMatchObject({ kind: "cancel_window", code: "2270" });
    now = new Date(NOW.getTime() + 3_600_000);
    expect(await d.cancelIrn(buildCancelIrn(r.irn, 1))).toEqual({ irn: r.irn, cancelDate: "2026-10-15 13:00:00" });
    await expect(d.cancelIrn(buildCancelIrn(r.irn, 1))).rejects.toMatchObject({ kind: "not_active" });
    expect((await d.getByIrn(r.irn))!.status).toBe("CNL");
  });

  it("e-way bill from IRN with validity by distance", async () => {
    const d = new MockDriver(() => NOW);
    const r = await d.generateIrn(payload);
    const e = await d.generateEwb({ kind: "irn", payload: buildEwbByIrn(r.irn, { distance: 450, vehicleNo: "TN01AB1234" }) });
    expect(e.ewbNo).toMatch(/^1\d{11}$/);
    expect(e.ewbDate).toBe("2026-10-15 12:00:00");
    expect(e.ewbValidTill).toBe("2026-10-18 23:59:59"); // 3 days
    await expect(d.generateEwb({ kind: "irn", payload: buildEwbByIrn("nope", { distance: 1, vehicleNo: "TN01AB1234" }) })).rejects.toMatchObject({ kind: "not_active" });
    expect(await d.cancelEwb({ ewbNo: Number(e.ewbNo), cancelRsnCode: 2, cancelRmrk: "x" })).toMatchObject({ ewbNo: e.ewbNo });
  });

  it("Part-A only e-way bill has no validity yet", async () => {
    const d = new MockDriver(() => NOW);
    const r = await d.generateIrn(payload);
    const e = await d.generateEwb({ kind: "irn", payload: { Irn: r.irn, Distance: 100, TransId: "x" } });
    expect(e.ewbValidTill).toBeNull();
  });
});

// ------------------------------------------------------------------ GSP

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function fakeFetch(handler: (c: Call) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const c: Call = {
      url: String(url),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(c);
    const r = await handler(c);
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status ?? 200 });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const creds = { gstin: SELLER_GSTIN, username: "api_user", password: "secret", clientId: "cid", clientSecret: "csec" };
const AUTH_OK = { Status: 1, Data: { AuthToken: "tok-1", TokenExpiry: "2026-10-15 18:00:00" } };
const IRN_DATA = { AckNo: 112610000012345, AckDt: "2026-10-15 12:00:00", Irn: "a".repeat(64), SignedInvoice: "eyJ.sig.inv", SignedQRCode: "eyJ.sig.qr", Status: "ACT", EwbNo: null };

describe("GspDriver", () => {
  const payload = buildEInvoice(invoice());

  it("authenticates once, caches the token and sends NIC headers", async () => {
    const f = fakeFetch((c) => (c.url.endsWith("/eivital/v1.04/auth") ? { body: AUTH_OK } : { body: { Status: 1, Data: JSON.stringify(IRN_DATA) } }));
    const cache = memoryTokenCache();
    const d = new GspDriver({ baseUrl: "https://gsp.test/", credentials: creds, fetch: f.fetch, tokenCache: cache, now: () => NOW, headers: { "x-sub": "k" } });
    const r1 = await d.generateIrn(payload);
    const r2 = await d.getByIrn(IRN_DATA.Irn);
    expect(r1).toEqual({
      irn: IRN_DATA.Irn,
      ackNo: "112610000012345",
      ackDate: "2026-10-15 12:00:00",
      signedInvoice: "eyJ.sig.inv",
      signedQrCode: "eyJ.sig.qr",
      status: "ACT",
      ewbNo: null,
      ewbDate: null,
      ewbValidTill: null,
    });
    expect(r2?.irn).toBe(IRN_DATA.Irn);
    expect(f.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST https://gsp.test/eivital/v1.04/auth",
      "POST https://gsp.test/eicore/v1.03/Invoice",
      `GET https://gsp.test/eicore/v1.03/Invoice/irn/${IRN_DATA.Irn}`,
    ]);
    expect(f.calls[0]!.body).toEqual({ username: "api_user", password: "secret", client_id: "cid", client_secret: "csec", gstin: SELLER_GSTIN });
    expect(f.calls[1]!.body).toEqual(payload);
    expect(f.calls[1]!.headers).toMatchObject({ gstin: SELLER_GSTIN, user_name: "api_user", authtoken: "tok-1", authorization: "Bearer tok-1", client_id: "cid", "x-sub": "k" });
    expect(cache.get(`https://gsp.test/|${SELLER_GSTIN}|api_user`)?.token).toBe("tok-1");
  });

  it("re-authenticates once on an invalid token (1005)", async () => {
    let n = 0;
    const f = fakeFetch((c) => {
      if (c.url.endsWith("/auth")) return { body: { Status: 1, Data: { AuthToken: `tok-${++n}` } } };
      if (c.headers.authtoken === "tok-1") return { body: { Status: 0, ErrorDetails: [{ ErrorCode: "1005", ErrorMessage: "Invalid Token" }] } };
      return { body: { Status: 1, Data: IRN_DATA } };
    });
    const d = new GspDriver({ baseUrl: "https://gsp.test", credentials: creds, fetch: f.fetch, now: () => NOW });
    expect((await d.generateIrn(payload)).irn).toBe(IRN_DATA.Irn);
    expect(f.calls.filter((c) => c.url.endsWith("/auth"))).toHaveLength(2);
  });

  it("maps 2150 duplicate with InfoDtls to the existing IRN", async () => {
    const f = fakeFetch((c) =>
      c.url.endsWith("/auth")
        ? { body: AUTH_OK }
        : {
            body: {
              Status: 0,
              ErrorDetails: [{ ErrorCode: "2150", ErrorMessage: "Duplicate IRN" }],
              InfoDtls: [{ InfCd: "DUPIRN", Desc: { AckNo: 112610000012345, AckDt: "2026-10-15 11:00:00", Irn: "b".repeat(64) } }],
            },
          },
    );
    const d = new GspDriver({ baseUrl: "https://gsp.test", credentials: creds, fetch: f.fetch, now: () => NOW });
    const err = await d.generateIrn(payload).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: "duplicate_irn", code: "2150", opts: { existing: { irn: "b".repeat(64), ackNo: "112610000012345", ackDate: "2026-10-15 11:00:00" } } });
  });

  it("maps common error codes and network failures", async () => {
    const respond = (code: string) =>
      fakeFetch((c) => (c.url.endsWith("/auth") ? { body: AUTH_OK } : { body: { Status: 0, ErrorDetails: JSON.stringify([{ ErrorCode: code, ErrorMessage: `E${code}` }]) } }));
    for (const [code, kind] of [["2270", "cancel_window"], ["9999", "not_active"], ["3028", "invalid_gstin"], ["2172", "validation"]] as const) {
      const d = new GspDriver({ baseUrl: "https://gsp.test", credentials: creds, fetch: respond(code).fetch, now: () => NOW });
      await expect(d.cancelIrn(buildCancelIrn("x", 1))).rejects.toMatchObject({ kind, code });
    }
    const custom = new GspDriver({ baseUrl: "https://gsp.test", credentials: creds, fetch: respond("7001").fetch, now: () => NOW, errorKinds: { "7001": "auth" } });
    await expect(custom.cancelIrn(buildCancelIrn("x", 1))).rejects.toMatchObject({ kind: "auth", code: "7001" });

    const down = new GspDriver({ baseUrl: "https://gsp.test", credentials: creds, fetch: (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch, now: () => NOW });
    await expect(down.authenticate()).rejects.toMatchObject({ kind: "network" });
    const html = new GspDriver({ baseUrl: "https://gsp.test", credentials: creds, fetch: fakeFetch(() => ({ status: 503, body: "<html>down</html>" })).fetch, now: () => NOW });
    await expect(html.authenticate()).rejects.toMatchObject({ kind: "network" });
  });

  it("rejected login is an auth error", async () => {
    const f = fakeFetch(() => ({ body: { Status: 0, ErrorDetails: [{ ErrorCode: "1004", ErrorMessage: "Invalid user name or password" }] } }));
    const d = new GspDriver({ baseUrl: "https://gsp.test", credentials: creds, fetch: f.fetch, now: () => NOW });
    await expect(d.authenticate()).rejects.toMatchObject({ kind: "auth", code: "1004", message: "Invalid user name or password" });
  });

  it("supports configurable endpoints with placeholders, e-way bills and Masters India-style envelopes", async () => {
    const f = fakeFetch((c) => {
      if (c.url.endsWith("/token")) return { body: { access_token: "mi-tok", expires_in: 3600 } };
      if (c.url.includes("/ewb/")) return { body: { results: { status: "Success", code: 200, message: { EwbNo: 341001234567, EwbDt: "2026-10-15 12:10:00", EwbValidTill: "2026-10-16 23:59:00" } } } };
      if (c.url.includes("/bydoc")) return { body: { results: { status: "Failed", errorMessage: "2283: IRN details are not found" } } };
      return { body: { results: { status: "Success", message: { Irn: "c".repeat(64), CancelDate: "2026-10-15 12:20:00" } } } };
    });
    const d = new GspDriver({
      baseUrl: "https://mi.test/api",
      credentials: creds,
      fetch: f.fetch,
      now: () => NOW,
      endpoints: { auth: "/token", generateEwb: "/ewb/generate", cancelIrn: "/irn/cancel", getByDocument: "/bydoc/{docType}/{docNo}?date={docDate}" },
    });
    expect(await d.generateEwb({ kind: "irn", payload: { Irn: "c".repeat(64), Distance: 10, TransMode: "1", VehNo: "TN01AB1234", VehType: "R" } })).toEqual({
      ewbNo: "341001234567",
      ewbDate: "2026-10-15 12:10:00",
      ewbValidTill: "2026-10-16 23:59:00",
    });
    expect(await d.cancelIrn(buildCancelIrn("c".repeat(64), 1))).toEqual({ irn: "c".repeat(64), cancelDate: "2026-10-15 12:20:00" });
    expect(await d.getByDocument("INV", "INV/26-27/0042", "14/10/2026")).toBeNull();
    expect(f.calls.at(-1)!.url).toBe("https://mi.test/api/bydoc/INV/INV%2F26-27%2F0042?date=14%2F10%2F2026");
  });
});

describe("envelope / token parsing", () => {
  it("parses NIC, Masters India and generic shapes", () => {
    expect(parseGspEnvelope({ Status: "1", Data: '{"Irn":"x"}' })).toEqual({ ok: true, data: { Irn: "x" }, errors: [], info: [] });
    expect(parseGspEnvelope({ status: 0, error: "2150 : Duplicate IRN" }).errors).toEqual([{ code: "2150", message: "Duplicate IRN" }]);
    expect(parseGspEnvelope({ success: true, data: { a: 1 } }).ok).toBe(true);
    expect(parseGspEnvelope({ results: { status: "Failed", errorMessage: "[3029] GSTIN is not active" } }).errors).toEqual([{ code: "3029", message: "GSTIN is not active" }]);
    expect(parseGspEnvelope("nope").ok).toBe(false);
  });
  it("reads tokens with NIC expiry or expires_in", () => {
    expect(readGspToken({ Status: 1, Data: { AuthToken: "t", TokenExpiry: "2026-10-15 18:00:00" } }, NOW)).toEqual({
      token: "t",
      expiresAt: new Date("2026-10-15T12:25:00Z").getTime(),
    });
    expect(readGspToken({ access_token: "t2", expires_in: 3600 }, NOW)!.expiresAt).toBe(NOW.getTime() + 3_300_000);
    expect(readGspToken({ Status: 0 }, NOW)).toBeNull();
  });
});
