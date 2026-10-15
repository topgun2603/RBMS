import type { PayoutAccount } from "./logic";
import type { TransferPort, TransferRequest, TransferResult, TransferStatus } from "./ports";
import type { PayoutProvider } from "./settings";

export interface PayoutSendInput {
  tenantId: string;
  payoutId: string;
  /** 1 for the first try, then +1 per retry. */
  attempt: number;
  /** Paise. */
  amount: number;
  account: PayoutAccount;
  vendor: { id: string; name: string };
}

export interface PayoutOutcome {
  /** paid = money moved; processing = waiting on the provider (or on staff, for manual payouts); failed = try again. */
  status: "paid" | "processing" | "failed";
  providerRef: string | null;
  error?: string | null;
}

/** One way of paying sellers. */
export interface PayoutDriver {
  readonly provider: PayoutProvider;
  send(input: PayoutSendInput): Promise<PayoutOutcome>;
  /** Re-checks a `processing` payout; absent = only staff can settle it. */
  check?(tenantId: string, providerRef: string): Promise<PayoutOutcome>;
}

/** Development: paid at once, no money moves. */
export class MockPayoutDriver implements PayoutDriver {
  readonly provider = "mock" as const;
  async send(input: PayoutSendInput): Promise<PayoutOutcome> {
    return { status: "paid", providerRef: `mock_${input.payoutId.replace(/-/g, "").slice(0, 12)}_${input.attempt}` };
  }
}

/** Staff pay by bank transfer / UPI themselves and mark the payout paid with the bank reference. */
export class ManualPayoutDriver implements PayoutDriver {
  readonly provider = "manual" as const;
  async send(): Promise<PayoutOutcome> {
    return { status: "processing", providerRef: null };
  }
}

export function outcomeOfTransfer(status: TransferStatus): PayoutOutcome["status"] {
  if (status === "processed") return "paid";
  if (status === "failed" || status === "reversed" || status === "partially_reversed") return "failed";
  return "processing";
}

/** Razorpay Route: a transfer from the shop's balance to the seller's linked account, via the kit's TransferPort. */
export class RouteTransferDriver implements PayoutDriver {
  readonly provider = "razorpayRoute" as const;
  constructor(private readonly transfers: TransferPort) {}

  async send(input: PayoutSendInput): Promise<PayoutOutcome> {
    if (input.account.type !== "route") {
      return { status: "failed", providerRef: null, error: "Razorpay Route needs the seller's linked account id (acc_…)" };
    }
    const req: TransferRequest = {
      accountId: input.account.accountId,
      amount: input.amount,
      currency: "INR",
      idempotencyKey: `${input.payoutId}:${input.attempt}`,
      notes: { payout_id: input.payoutId, vendor_id: input.vendor.id, attempt: String(input.attempt) },
    };
    try {
      const r = await this.transfers.transfer(input.tenantId, req);
      return toOutcome(r);
    } catch (err) {
      return { status: "failed", providerRef: null, error: (err as Error).message || "Transfer failed" };
    }
  }

  async check(tenantId: string, providerRef: string): Promise<PayoutOutcome> {
    if (!this.transfers.fetch) return { status: "processing", providerRef };
    return toOutcome(await this.transfers.fetch(tenantId, providerRef));
  }
}

const toOutcome = (r: TransferResult): PayoutOutcome => {
  const status = outcomeOfTransfer(r.status);
  return { status, providerRef: r.id, error: status === "failed" ? (r.error ?? `Transfer ${r.status}`) : null };
};

// ------------------------------------------------------------------ Razorpay Route REST client

export const RAZORPAY_API = "https://api.razorpay.com/v1";

export class RazorpayRouteError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "RazorpayRouteError";
  }
}

export interface RazorpayTransfer {
  id: string;
  entity?: string;
  status?: string;
  amount: number;
  currency: string;
  recipient?: string;
  /** Unix seconds; older API versions report only this. */
  processed_at?: number | null;
  error?: { code?: string | null; description?: string | null; reason?: string | null } | null;
  notes?: Record<string, string>;
}

export interface RazorpayRouteClientOptions {
  keyId: string;
  keySecret: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

/** Minimal Razorpay Route client (Basic auth with the shop's own key id + secret). No SDK. */
export class RazorpayRouteClient {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly auth: string;
  private readonly timeoutMs: number;

  constructor(opts: RazorpayRouteClientOptions) {
    this.fetchFn = opts.fetch ?? globalThis.fetch;
    this.baseUrl = opts.baseUrl ?? RAZORPAY_API;
    this.auth = `Basic ${Buffer.from(`${opts.keyId}:${opts.keySecret}`).toString("base64")}`;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  /** `POST /v1/transfers`: direct transfer from the account balance to a linked account. */
  createTransfer(input: { account: string; amount: number; currency: "INR"; notes?: Record<string, string> }): Promise<RazorpayTransfer> {
    return this.request<RazorpayTransfer>("POST", "/transfers", input);
  }

  /** `GET /v1/transfers/:id`. */
  fetchTransfer(id: string): Promise<RazorpayTransfer> {
    return this.request<RazorpayTransfer>("GET", `/transfers/${encodeURIComponent(id)}`);
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
      throw new RazorpayRouteError(0, "network_error", `Razorpay unreachable: ${(err as Error).message}`);
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
      throw new RazorpayRouteError(res.status, e?.code ?? null, e?.description ?? `Razorpay HTTP ${res.status}`);
    }
    return json as T;
  }
}

const TRANSFER_STATUSES: readonly string[] = ["created", "pending", "processed", "failed", "reversed", "partially_reversed"];

/** Maps a Razorpay transfer entity to the port's result (no status but a `processed_at` = processed). */
export function transferResultOf(t: RazorpayTransfer): TransferResult {
  const raw = t.status ?? (t.processed_at ? "processed" : "pending");
  const status = (TRANSFER_STATUSES.includes(raw) ? raw : "pending") as TransferStatus;
  const error = t.error?.description ?? t.error?.reason ?? null;
  return { id: t.id, status, error: status === "failed" ? error : null };
}

/**
 * A `TransferPort` over the Razorpay Route API for kit: `credentialsFor` returns the shop's decrypted key id + secret
 * (from the payments module), or null when the shop has no Razorpay account (the transfer then fails).
 */
export function razorpayRouteTransferPort(
  credentialsFor: (tenantId: string) => Promise<{ keyId: string; keySecret: string } | null>,
  opts: { fetch?: typeof fetch; baseUrl?: string; timeoutMs?: number } = {},
): Required<TransferPort> {
  const client = async (tenantId: string) => {
    const c = await credentialsFor(tenantId);
    if (!c) throw new RazorpayRouteError(400, "not_configured", "The shop has no Razorpay account connected");
    return new RazorpayRouteClient({ ...c, ...opts });
  };
  return {
    async transfer(tenantId, req) {
      const t = await (await client(tenantId)).createTransfer({
        account: req.accountId,
        amount: req.amount,
        currency: req.currency,
        notes: { ...req.notes, idempotency_key: req.idempotencyKey },
      });
      return transferResultOf(t);
    },
    async fetch(tenantId, transferId) {
      return transferResultOf(await (await client(tenantId)).fetchTransfer(transferId));
    },
  };
}
