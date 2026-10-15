import type { FulfillmentOrder } from "../ports";
import type { PackageDims, ShipmentEvent } from "../schema";
import { stateNameOf } from "../states";
import { mapShiprocketStatus, parseCarrierTime } from "./status";
import {
  CarrierError,
  type CarrierDriver,
  type CreateShipmentInput,
  type CreatedShipment,
  type ShipmentRef,
  type TrackResult,
} from "./types";

/** Minimal Shiprocket REST client (email/password → bearer token). No SDK. */

export const SHIPROCKET_API = "https://apiv2.shiprocket.in/v1/external";
/** Shiprocket tokens live 10 days; we re-login after 9. */
export const SHIPROCKET_TOKEN_TTL_MS = 9 * 86_400_000;
export const shiprocketTrackingUrl = (awb: string) => `https://shiprocket.co/tracking/${encodeURIComponent(awb)}`;

export class ShiprocketError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ShiprocketError";
  }
}

export interface CachedToken {
  token: string;
  /** Epoch ms. */
  expiresAt: number;
}

/** Where tokens are kept between requests (default: one in-memory map per process). */
export interface TokenCache {
  get(key: string): CachedToken | undefined;
  set(key: string, value: CachedToken): void;
  delete(key: string): void;
}

export const memoryTokenCache = (): TokenCache => {
  const m = new Map<string, CachedToken>();
  return { get: (k) => m.get(k), set: (k, v) => void m.set(k, v), delete: (k) => void m.delete(k) };
};

export interface ShiprocketClientOptions {
  email: string;
  password: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  tokenCache?: TokenCache;
  now?: () => Date;
}

export interface ShiprocketAdhocItem {
  name: string;
  sku: string;
  units: number;
  /** Rupees. */
  selling_price: number;
}

/** Body of `POST /orders/create/adhoc` (amounts in rupees, weight in kg, dimensions in cm). */
export interface ShiprocketAdhocOrder {
  order_id: string;
  order_date: string;
  pickup_location: string;
  billing_customer_name: string;
  billing_last_name: string;
  billing_address: string;
  billing_address_2: string;
  billing_city: string;
  billing_pincode: string;
  billing_state: string;
  billing_country: string;
  billing_email: string;
  billing_phone: string;
  shipping_is_billing: true;
  order_items: ShiprocketAdhocItem[];
  payment_method: "Prepaid" | "COD";
  shipping_charges: number;
  total_discount: number;
  sub_total: number;
  length: number;
  breadth: number;
  height: number;
  weight: number;
}

export interface ShiprocketCreatedOrder {
  order_id?: number | string;
  shipment_id?: number | string;
  status?: string;
  status_code?: number;
  awb_code?: string;
  courier_company_id?: number | string;
  courier_name?: string;
}

export interface ShiprocketAwbResult {
  awb_assign_status?: number;
  message?: string;
  response?: {
    data?: {
      awb_code?: string;
      courier_company_id?: number | string;
      courier_name?: string;
      shipment_id?: number | string;
      freight_charges?: number | string;
      awb_assign_error?: string;
    };
  };
}

export class ShiprocketClient {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly cache: TokenCache;
  private readonly now: () => Date;
  private readonly cacheKey: string;

  constructor(private readonly opts: ShiprocketClientOptions) {
    this.fetchFn = opts.fetch ?? globalThis.fetch;
    this.baseUrl = (opts.baseUrl ?? SHIPROCKET_API).replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.cache = opts.tokenCache ?? memoryTokenCache();
    this.now = opts.now ?? (() => new Date());
    this.cacheKey = `${this.baseUrl}|${opts.email.toLowerCase()}`;
  }

  /** `POST /auth/login` → token (cached ~9 days). Throws ShiprocketError 401 for wrong credentials. */
  async login(): Promise<string> {
    const json = await this.send<{ token?: string }>("POST", "/auth/login", { email: this.opts.email, password: this.opts.password }, null);
    if (!json?.token) throw new ShiprocketError(401, "Shiprocket login returned no token", json);
    this.cache.set(this.cacheKey, { token: json.token, expiresAt: this.now().getTime() + SHIPROCKET_TOKEN_TTL_MS });
    return json.token;
  }

  /** True when the email/password work; false when Shiprocket rejects them; other failures throw. */
  async validateCredentials(): Promise<boolean> {
    try {
      this.cache.delete(this.cacheKey);
      await this.login();
      return true;
    } catch (err) {
      if (err instanceof ShiprocketError && [400, 401, 403, 422].includes(err.status)) return false;
      throw err;
    }
  }

  createAdhocOrder(body: ShiprocketAdhocOrder): Promise<ShiprocketCreatedOrder> {
    return this.request("POST", "/orders/create/adhoc", body);
  }

  assignAwb(shipmentId: string, courierId?: number | null): Promise<ShiprocketAwbResult> {
    return this.request("POST", "/courier/assign/awb", {
      shipment_id: shipmentId,
      ...(courierId ? { courier_id: courierId } : {}),
    });
  }

  generateLabel(shipmentIds: string[]): Promise<{ label_created?: number; label_url?: string; response?: string; not_created?: unknown[] }> {
    return this.request("POST", "/courier/generate/label", { shipment_id: shipmentIds });
  }

  trackAwb(awb: string): Promise<unknown> {
    return this.request("GET", `/courier/track/awb/${encodeURIComponent(awb)}`);
  }

  /** `POST /orders/cancel` with Shiprocket order ids. */
  cancelOrders(orderIds: string[]): Promise<unknown> {
    return this.request("POST", "/orders/cancel", { ids: orderIds.map((id) => (/^\d+$/.test(id) ? Number(id) : id)) });
  }

  /** Authenticated request; a cached token that gets a 401 is dropped and the request retried once after a fresh login. */
  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const cached = this.cache.get(this.cacheKey);
    if (!cached || cached.expiresAt <= this.now().getTime()) return this.send<T>(method, path, body, await this.login());
    try {
      return await this.send<T>(method, path, body, cached.token);
    } catch (err) {
      if (!(err instanceof ShiprocketError) || err.status !== 401) throw err;
      this.cache.delete(this.cacheKey);
      return this.send<T>(method, path, body, await this.login());
    }
  }

  private async send<T>(method: "GET" | "POST", path: string, body: unknown, token: string | null): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
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
      throw new ShiprocketError(0, `Shiprocket unreachable: ${(err as Error).message}`);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) throw new ShiprocketError(res.status, errorMessage(json) ?? `Shiprocket HTTP ${res.status}`, json);
    return json as T;
  }
}

/** Shiprocket errors come as `{ message }`, `{ message, errors: { field: [..] } }` or `{ status_code, message }`. */
function errorMessage(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const j = json as { message?: unknown; errors?: unknown };
  const parts: string[] = [];
  if (typeof j.message === "string" && j.message) parts.push(j.message);
  if (j.errors && typeof j.errors === "object") {
    for (const v of Object.values(j.errors as Record<string, unknown>)) {
      if (Array.isArray(v)) parts.push(...v.filter((x): x is string => typeof x === "string"));
      else if (typeof v === "string") parts.push(v);
    }
  }
  return parts.length ? parts.join("; ").slice(0, 500) : null;
}

// ------------------------------------------------------------------ mapping

const rupees = (paise: number) => Math.round(paise) / 100;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

/** "+919876543210" / "09876543210" → "9876543210" (Shiprocket wants 10 digits). */
export function tenDigitPhone(phone: string | null | undefined): string {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}

/** "YYYY-MM-DD HH:mm" in IST. */
export function istDateTime(d: Date): string {
  const ist = new Date(d.getTime() + 330 * 60_000);
  return ist.toISOString().slice(0, 16).replace("T", " ");
}

/**
 * Order + package → adhoc order body. Amounts: items at the charged unit price; COD orders collect `balance`,
 * prepaid ones `total`; the gap to the item sum goes into `shipping_charges` (more) or `total_discount` (less).
 */
export function buildAdhocOrder(order: FulfillmentOrder, pkg: PackageDims, pickupLocation: string, now: Date): ShiprocketAdhocOrder {
  const a = order.shippingAddress;
  if (!a) throw new CarrierError("shiprocket", 400, "The order has no shipping address");
  const fullName = (a.name || order.customer.name || "Customer").trim();
  const [first, ...rest] = fullName.split(/\s+/);
  const cod = order.paymentMethod === "cod" && order.balance > 0;
  const collect = cod ? order.balance : order.total;
  const itemSum = order.lines.reduce((s, l) => s + Math.round(l.price * l.qty), 0);
  const phone = tenDigitPhone(a.phone || order.customer.phone);
  if (phone.length !== 10) throw new CarrierError("shiprocket", 400, "The shipping address needs a 10-digit phone number");
  return {
    order_id: order.number,
    order_date: istDateTime(now),
    pickup_location: pickupLocation,
    billing_customer_name: first || "Customer",
    billing_last_name: rest.join(" "),
    billing_address: a.line1,
    billing_address_2: [a.line2, a.landmark].map(str).filter(Boolean).join(", "),
    billing_city: a.city,
    billing_pincode: a.pincode,
    billing_state: stateNameOf(a.stateCode) ?? a.stateCode,
    billing_country: "India",
    billing_email: order.customer.email ?? "",
    billing_phone: phone,
    shipping_is_billing: true,
    order_items: order.lines.map((l, i) => ({
      name: l.name,
      sku: l.sku || `ITEM-${i + 1}`,
      units: Math.max(1, Math.round(l.qty)),
      selling_price: rupees(l.price),
    })),
    payment_method: cod ? "COD" : "Prepaid",
    shipping_charges: rupees(Math.max(0, collect - itemSum)),
    total_discount: rupees(Math.max(0, itemSum - collect)),
    sub_total: rupees(itemSum),
    length: Math.max(0.5, pkg.lengthCm),
    breadth: Math.max(0.5, pkg.breadthCm),
    height: Math.max(0.5, pkg.heightCm),
    weight: Math.max(0.01, Math.round(pkg.weightGrams) / 1000),
  };
}

interface ShiprocketActivity {
  date?: string;
  status?: string;
  activity?: string;
  location?: string;
  "sr-status"?: string | number;
  "sr-status-label"?: string;
}

const activityEvents = (scans: unknown, source: ShipmentEvent["source"], now: Date): ShipmentEvent[] =>
  (Array.isArray(scans) ? (scans as ShiprocketActivity[]) : []).map((a) => ({
    at: parseCarrierTime(a.date, now),
    status: mapShiprocketStatus(a["sr-status-label"], a["sr-status"]) ?? mapShiprocketStatus(a.activity),
    label: str(a.activity) || str(a["sr-status-label"]) || str(a.status) || "Update",
    location: str(a.location) || null,
    source,
  }));

/**
 * `GET /courier/track/awb/:awb` → ours. Accepts `{ tracking_data }` and the per-AWB wrapped form `{ "<awb>": { tracking_data } }`.
 */
export function parseTracking(json: unknown, awb: string, now: Date): TrackResult {
  let root = json as Record<string, unknown> | null;
  if (root && typeof root === "object" && !("tracking_data" in root) && awb in root) root = root[awb] as Record<string, unknown>;
  const td = (root && typeof root === "object" ? root.tracking_data : null) as Record<string, unknown> | null | undefined;
  if (!td || typeof td !== "object") return { status: null, events: [] };
  const track = Array.isArray(td.shipment_track) ? (td.shipment_track[0] as Record<string, unknown> | undefined) : undefined;
  const status = mapShiprocketStatus(track?.current_status, td.shipment_status);
  return {
    status,
    events: activityEvents(td.shipment_track_activities, "track", now),
    courier: str(track?.courier_name) || null,
    trackingUrl: str(td.track_url) || null,
  };
}

export interface ShiprocketWebhook {
  awb: string;
  status: ShipmentEvent["status"];
  label: string;
  at: string;
  courier: string | null;
  events: ShipmentEvent[];
}

/**
 * Shiprocket tracking webhook body: `{ awb, courier_name, current_status, current_status_id, shipment_status,
 * shipment_status_id, current_timestamp: "23 05 2023 11:43:52", scans: [{ date, activity, location, "sr-status", "sr-status-label" }] }`.
 * Null when there is no AWB (Shiprocket's test ping).
 */
export function parseShiprocketWebhook(body: unknown, now: Date): ShiprocketWebhook | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const awb = str(b.awb);
  if (!awb) return null;
  const label = str(b.current_status) || str(b.shipment_status) || "Update";
  const status =
    mapShiprocketStatus(b.current_status, b.current_status_id) ?? mapShiprocketStatus(b.shipment_status, b.shipment_status_id);
  const at = parseCarrierTime(b.current_timestamp, now);
  const events = activityEvents(b.scans, "webhook", now);
  if (!events.some((e) => e.at === at && e.label.toLowerCase() === label.toLowerCase())) events.push({ at, status, label, location: null, source: "webhook" });
  return { awb, status, label, at, courier: str(b.courier_name) || null, events };
}

// ------------------------------------------------------------------ driver

const toCarrierError = (err: unknown, fallback: string): CarrierError => {
  if (err instanceof CarrierError) return err;
  if (err instanceof ShiprocketError) return new CarrierError("shiprocket", err.status, err.message || fallback, err.body);
  return new CarrierError("shiprocket", 0, (err as Error)?.message || fallback);
};

export class ShiprocketDriver implements CarrierDriver {
  readonly provider = "shiprocket" as const;

  constructor(
    private readonly client: ShiprocketClient,
    private readonly pickupLocation: string,
    private readonly log?: { warn(o: unknown, m?: string): void },
  ) {}

  /** Adhoc order → assign AWB (unless Shiprocket already did) → label (best effort). Cancels the order if no AWB. */
  async createShipment(input: CreateShipmentInput): Promise<CreatedShipment> {
    const body = buildAdhocOrder(input.order, input.package, this.pickupLocation, input.now);
    let created: ShiprocketCreatedOrder;
    try {
      created = await this.client.createAdhocOrder(body);
    } catch (err) {
      throw toCarrierError(err, "Shiprocket could not create the order");
    }
    const providerOrderId = str(created.order_id) || null;
    const providerShipmentId = str(created.shipment_id) || null;
    if (!providerShipmentId) throw new CarrierError("shiprocket", 502, "Shiprocket returned no shipment id", created);

    let awb = str(created.awb_code);
    let courier = str(created.courier_name);
    let cost: number | null = null;
    if (!awb) {
      const courierId = input.courier && /^\d+$/.test(input.courier.trim()) ? Number(input.courier.trim()) : null;
      let failure: string | null = null;
      try {
        const res = await this.client.assignAwb(providerShipmentId, courierId);
        const data = res.response?.data;
        awb = str(data?.awb_code);
        courier = str(data?.courier_name) || courier;
        const freight = Number(data?.freight_charges);
        if (Number.isFinite(freight) && freight > 0) cost = Math.round(freight * 100);
        if (!awb) failure = str(data?.awb_assign_error) || str(res.message) || "No courier could take this shipment";
      } catch (err) {
        failure = toCarrierError(err, "AWB assignment failed").message;
      }
      if (failure) {
        if (providerOrderId) {
          await this.client.cancelOrders([providerOrderId]).catch((err) => this.log?.warn({ err, providerOrderId }, "shiprocket: cancel after AWB failure failed"));
        }
        throw new CarrierError("shiprocket", 502, `Shiprocket could not assign an AWB: ${failure}`);
      }
    }

    let labelUrl: string | null = null;
    try {
      const res = await this.client.generateLabel([providerShipmentId]);
      labelUrl = str(res.label_url) || null;
    } catch (err) {
      this.log?.warn({ err, providerShipmentId }, "shiprocket: label generation failed (can be retried from the label link)");
    }

    return {
      providerOrderId,
      providerShipmentId,
      awb,
      courier: courier || null,
      trackingUrl: shiprocketTrackingUrl(awb),
      labelUrl,
      status: "created",
      cost,
      events: [{ at: input.now.toISOString(), status: "created", label: `AWB ${awb} assigned${courier ? ` (${courier})` : ""}`, source: "carrier" }],
    };
  }

  async cancel(ref: ShipmentRef): Promise<void> {
    if (!ref.providerOrderId) throw new CarrierError("shiprocket", 400, "This shipment has no Shiprocket order id");
    try {
      await this.client.cancelOrders([ref.providerOrderId]);
    } catch (err) {
      throw toCarrierError(err, "Shiprocket could not cancel the order");
    }
  }

  async track(ref: ShipmentRef, now: Date): Promise<TrackResult> {
    if (!ref.awb) return { status: null, events: [] };
    try {
      return parseTracking(await this.client.trackAwb(ref.awb), ref.awb, now);
    } catch (err) {
      throw toCarrierError(err, "Shiprocket tracking failed");
    }
  }

  async label(ref: ShipmentRef): Promise<string | null> {
    if (!ref.providerShipmentId) return null;
    try {
      const res = await this.client.generateLabel([ref.providerShipmentId]);
      return str(res.label_url) || null;
    } catch (err) {
      throw toCarrierError(err, "Shiprocket could not generate the label");
    }
  }
}
