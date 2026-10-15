import { describe, expect, it, vi } from "vitest";
import { RazorpayClient, RazorpayError } from "./razorpay";

function mockFetch(status: number, body: unknown) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

const client = (fetch: ReturnType<typeof mockFetch>) =>
  new RazorpayClient({ keyId: "rzp_test_abc123", keySecret: "s3cret", fetch: fetch as unknown as typeof globalThis.fetch });
const basic = `Basic ${Buffer.from("rzp_test_abc123:s3cret").toString("base64")}`;

describe("RazorpayClient", () => {
  it("creates orders with Basic auth and a JSON body", async () => {
    const fetch = mockFetch(200, { id: "order_1", amount: 12345, currency: "INR", receipt: "inv-1", status: "created" });
    const order = await client(fetch).createOrder({
      amount: 12345,
      currency: "INR",
      receipt: "inv-1",
      notes: { tenantId: "t", kind: "invoice", purposeId: "inv-1" },
    });
    expect(order.id).toBe("order_1");
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://api.razorpay.com/v1/orders");
    expect(init!.method).toBe("POST");
    const headers = init!.headers as Record<string, string>;
    expect(headers.authorization).toBe(basic);
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(init!.body as string)).toEqual({
      amount: 12345,
      currency: "INR",
      receipt: "inv-1",
      notes: { tenantId: "t", kind: "invoice", purposeId: "inv-1" },
    });
  });

  it("fetches a payment by id", async () => {
    const fetch = mockFetch(200, { id: "pay_1", order_id: "order_1", amount: 100, status: "captured", method: "upi" });
    const p = await client(fetch).fetchPayment("pay_1");
    expect(p.method).toBe("upi");
    expect(fetch.mock.calls[0]![0]).toBe("https://api.razorpay.com/v1/payments/pay_1");
    expect(fetch.mock.calls[0]![1]!.method).toBe("GET");
    expect(fetch.mock.calls[0]![1]!.body).toBeUndefined();
  });

  it("surfaces Razorpay errors with status and code", async () => {
    const fetch = mockFetch(400, { error: { code: "BAD_REQUEST_ERROR", description: "The id provided does not exist" } });
    const err = await client(fetch).fetchPayment("pay_x").catch((e) => e);
    expect(err).toBeInstanceOf(RazorpayError);
    expect(err.status).toBe(400);
    expect(err.code).toBe("BAD_REQUEST_ERROR");
    expect(err.message).toContain("does not exist");
  });

  it("validates credentials with GET /payments?count=1", async () => {
    const ok = mockFetch(200, { entity: "collection", count: 0, items: [] });
    expect(await client(ok).validateCredentials()).toBe(true);
    expect(ok.mock.calls[0]![0]).toBe("https://api.razorpay.com/v1/payments?count=1");

    const rejected = mockFetch(401, { error: { code: "BAD_REQUEST_ERROR", description: "Authentication failed" } });
    expect(await client(rejected).validateCredentials()).toBe(false);

    const down = mockFetch(503, { error: { description: "down" } });
    await expect(client(down).validateCredentials()).rejects.toBeInstanceOf(RazorpayError);
  });

  it("wraps network failures", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const err = await new RazorpayClient({ keyId: "k", keySecret: "s", fetch: fetch as unknown as typeof globalThis.fetch })
      .createOrder({ amount: 100, currency: "INR", receipt: "r", notes: {} })
      .catch((e) => e);
    expect(err).toBeInstanceOf(RazorpayError);
    expect(err.status).toBe(0);
    expect(err.code).toBe("network_error");
  });
});
