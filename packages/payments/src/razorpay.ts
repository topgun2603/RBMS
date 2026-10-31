/** Minimal Razorpay REST client (Basic auth with the shop's own key id + secret). No SDK. */

export const RAZORPAY_API = "https://api.razorpay.com/v1";

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string | null;
  status: string;
  notes?: Record<string, string>;
}

export interface RazorpayPayment {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  /** created | authorized | captured | refunded | failed */
  status: string;
  /** upi | card | netbanking | wallet | emi | paylater | ... */
  method: string | null;
  email?: string | null;
  contact?: string | null;
  /** Unix seconds. */
  created_at?: number;
}

export interface CreateOrderInput {
  amount: number;
  currency: "INR";
  receipt: string;
  notes: Record<string, string>;
}

export class RazorpayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "RazorpayError";
  }
}

export interface RazorpayClientOptions {
  keyId: string;
  keySecret: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

export class RazorpayClient {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly auth: string;
  private readonly timeoutMs: number;

  constructor(opts: RazorpayClientOptions) {
    this.fetchFn = opts.fetch ?? globalThis.fetch;
    this.baseUrl = opts.baseUrl ?? RAZORPAY_API;
    this.auth = `Basic ${Buffer.from(`${opts.keyId}:${opts.keySecret}`).toString("base64")}`;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  /** `POST /v1/orders`. */
  createOrder(input: CreateOrderInput): Promise<RazorpayOrder> {
    return this.request<RazorpayOrder>("POST", "/orders", input);
  }

  /** `GET /v1/payments/:id`. */
  fetchPayment(paymentId: string): Promise<RazorpayPayment> {
    return this.request<RazorpayPayment>("GET", `/payments/${encodeURIComponent(paymentId)}`);
  }

  /** `POST /v1/payments/:id/capture`: takes the authorized money (the full amount, in the payment's currency). */
  capturePayment(paymentId: string, amount: number, currency: string): Promise<RazorpayPayment> {
    return this.request<RazorpayPayment>("POST", `/payments/${encodeURIComponent(paymentId)}/capture`, { amount, currency });
  }

  /** `GET /v1/payments?count=1`: true when accepted, false on 401/403; other failures throw. */
  async validateCredentials(): Promise<boolean> {
    try {
      await this.request("GET", "/payments?count=1");
      return true;
    } catch (err) {
      if (err instanceof RazorpayError && (err.status === 401 || err.status === 403)) return false;
      throw err;
    }
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { authorization: this.auth, accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new RazorpayError(0, "network_error", `Razorpay unreachable: ${(err as Error).message}`);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const e = (json as { error?: { code?: string; description?: string } } | null)?.error;
      throw new RazorpayError(res.status, e?.code ?? null, e?.description ?? `Razorpay HTTP ${res.status}`);
    }
    return json as T;
  }
}
