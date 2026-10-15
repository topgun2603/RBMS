import { describe, expect, it, vi } from "vitest";
import { createSecretBox } from "./crypto";
import {
  ManualPayoutDriver,
  MockPayoutDriver,
  outcomeOfTransfer,
  RazorpayRouteClient,
  RazorpayRouteError,
  razorpayRouteTransferPort,
  RouteTransferDriver,
  transferResultOf,
  type PayoutSendInput,
} from "./payouts";
import type { TransferPort } from "./ports";

const input = (over: Partial<PayoutSendInput> = {}): PayoutSendInput => ({
  tenantId: "t1",
  payoutId: "11111111-2222-4333-8444-555555555555",
  attempt: 1,
  amount: 75_000,
  account: { type: "route", accountId: "acc_ABCDEFGHIJ1234" },
  vendor: { id: "v1", name: "Murugan Silks" },
  ...over,
});

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("simple drivers", () => {
  it("mock pays at once with a stable reference per attempt", async () => {
    const d = new MockPayoutDriver();
    expect(await d.send(input())).toEqual({ status: "paid", providerRef: "mock_111111112222_1" });
    expect((await d.send(input({ attempt: 2 }))).providerRef).toBe("mock_111111112222_2");
  });
  it("manual waits for staff", async () => {
    expect(await new ManualPayoutDriver().send()).toEqual({ status: "processing", providerRef: null });
  });
});

describe("RouteTransferDriver", () => {
  it("transfers to the linked account with an idempotency key per attempt", async () => {
    const transfers: TransferPort = { transfer: vi.fn(async () => ({ id: "trf_1", status: "processed" as const })) };
    const d = new RouteTransferDriver(transfers);
    expect(await d.send(input({ attempt: 3 }))).toEqual({ status: "paid", providerRef: "trf_1", error: null });
    expect(transfers.transfer).toHaveBeenCalledWith("t1", {
      accountId: "acc_ABCDEFGHIJ1234",
      amount: 75_000,
      currency: "INR",
      idempotencyKey: "11111111-2222-4333-8444-555555555555:3",
      notes: { payout_id: "11111111-2222-4333-8444-555555555555", vendor_id: "v1", attempt: "3" },
    });
  });
  it("pending transfers stay processing; failures carry the reason", async () => {
    const pending = new RouteTransferDriver({ transfer: async () => ({ id: "trf_2", status: "pending" }) });
    expect(await pending.send(input())).toMatchObject({ status: "processing", providerRef: "trf_2" });
    const failed = new RouteTransferDriver({ transfer: async () => ({ id: "trf_3", status: "failed", error: "Insufficient balance" }) });
    expect(await failed.send(input())).toEqual({ status: "failed", providerRef: "trf_3", error: "Insufficient balance" });
  });
  it("errors become failed outcomes, never throws", async () => {
    const d = new RouteTransferDriver({
      transfer: async () => {
        throw new Error("Razorpay unreachable");
      },
    });
    expect(await d.send(input())).toEqual({ status: "failed", providerRef: null, error: "Razorpay unreachable" });
  });
  it("needs a Route account", async () => {
    const transfers = { transfer: vi.fn() };
    const d = new RouteTransferDriver(transfers);
    const r = await d.send(input({ account: { type: "upi", vpa: "ab@ybl" } }));
    expect(r.status).toBe("failed");
    expect(transfers.transfer).not.toHaveBeenCalled();
  });
  it("check uses fetch when the port has it", async () => {
    const withFetch = new RouteTransferDriver({ transfer: vi.fn(), fetch: async () => ({ id: "trf_2", status: "processed" }) });
    expect(await withFetch.check("t1", "trf_2")).toMatchObject({ status: "paid" });
    const without = new RouteTransferDriver({ transfer: vi.fn() });
    expect(await without.check("t1", "trf_2")).toEqual({ status: "processing", providerRef: "trf_2" });
  });
  it("maps transfer statuses", () => {
    expect(outcomeOfTransfer("processed")).toBe("paid");
    expect(outcomeOfTransfer("created")).toBe("processing");
    expect(outcomeOfTransfer("pending")).toBe("processing");
    expect(outcomeOfTransfer("reversed")).toBe("failed");
    expect(outcomeOfTransfer("partially_reversed")).toBe("failed");
  });
});

describe("Razorpay Route client", () => {
  it("POSTs /transfers with Basic auth", async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { id: "trf_9", status: "processed", amount: 75_000, currency: "INR" }));
    const c = new RazorpayRouteClient({ keyId: "rzp_test_x", keySecret: "sec", fetch: fetch as unknown as typeof globalThis.fetch });
    const t = await c.createTransfer({ account: "acc_ABCDEFGHIJ1234", amount: 75_000, currency: "INR", notes: { a: "b" } });
    expect(t.id).toBe("trf_9");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.razorpay.com/v1/transfers");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from("rzp_test_x:sec").toString("base64")}`);
    expect(JSON.parse(String(init.body))).toEqual({ account: "acc_ABCDEFGHIJ1234", amount: 75_000, currency: "INR", notes: { a: "b" } });
  });
  it("turns API and network errors into RazorpayRouteError", async () => {
    const bad = new RazorpayRouteClient({
      keyId: "k",
      keySecret: "s",
      fetch: (async () => jsonResponse(400, { error: { code: "BAD_REQUEST_ERROR", description: "Account not activated" } })) as unknown as typeof fetch,
    });
    await expect(bad.fetchTransfer("trf_1")).rejects.toMatchObject({ status: 400, code: "BAD_REQUEST_ERROR", message: "Account not activated" });
    const down = new RazorpayRouteClient({
      keyId: "k",
      keySecret: "s",
      fetch: (async () => {
        throw new Error("ECONNRESET");
      }) as unknown as typeof fetch,
    });
    await expect(down.fetchTransfer("trf_1")).rejects.toBeInstanceOf(RazorpayRouteError);
  });
  it("transferResultOf reads status or processed_at", () => {
    expect(transferResultOf({ id: "a", amount: 1, currency: "INR", status: "processed" })).toEqual({ id: "a", status: "processed", error: null });
    expect(transferResultOf({ id: "b", amount: 1, currency: "INR", processed_at: 1_700_000_000 })).toMatchObject({ status: "processed" });
    expect(transferResultOf({ id: "c", amount: 1, currency: "INR" })).toMatchObject({ status: "pending" });
    expect(transferResultOf({ id: "d", amount: 1, currency: "INR", status: "weird" })).toMatchObject({ status: "pending" });
    expect(transferResultOf({ id: "e", amount: 1, currency: "INR", status: "failed", error: { description: "Linked account suspended" } })).toEqual({
      id: "e",
      status: "failed",
      error: "Linked account suspended",
    });
  });
  it("razorpayRouteTransferPort uses the shop's credentials", async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { id: "trf_5", status: "pending", amount: 100, currency: "INR" }));
    const creds = vi.fn(async (t: string) => (t === "t1" ? { keyId: "k", keySecret: "s" } : null));
    const port = razorpayRouteTransferPort(creds, { fetch: fetch as unknown as typeof globalThis.fetch });
    const r = await port.transfer("t1", { accountId: "acc_ABCDEFGHIJ1234", amount: 100, currency: "INR", idempotencyKey: "p:1", notes: { payout_id: "p" } });
    expect(r).toEqual({ id: "trf_5", status: "pending", error: null });
    const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.notes).toEqual({ payout_id: "p", idempotency_key: "p:1" });
    await expect(port.fetch("t2", "trf_5")).rejects.toMatchObject({ code: "not_configured" });
  });
});

describe("secret box", () => {
  it("round-trips and refuses other keys or tampering", () => {
    const box = createSecretBox("k1");
    const enc = box.encrypt('{"type":"bank","accountNumber":"001234567890"}');
    expect(enc).not.toContain("001234567890");
    expect(box.decrypt(enc)).toContain("001234567890");
    expect(() => createSecretBox("k2").decrypt(enc)).toThrow();
    const parts = enc.split(":");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => box.decrypt(parts.join(":"))).toThrow();
    expect(() => box.decrypt("v0:a:b:c")).toThrow();
  });
});
