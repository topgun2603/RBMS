import type { FeatureGatePort } from "@rbms/core";
import type { HttpRequest } from "./types";

export type { FeatureGatePort };

/** A delivery-platform order for the kitchen (the host wires it to @rbms/dining). */
export interface KitchenOrderInput {
  /** Idempotency key on the kitchen side: `agg:<aggregator order id>`. */
  ref: string;
  type: "delivery" | "takeaway";
  platform: string;
  customerName: string | null;
  customerPhone: string | null;
  /** "Zomato #5123 · TEST · no cutlery": printed on the KOT. */
  note: string | null;
  dueAt: Date | null;
  /** GST paid by the platform (9(5)): the kitchen order must not be billed as a tax invoice. */
  taxByOperator: boolean;
  lines: { itemId: string | null; name: string; qty: number; rate: number; note: string | null }[];
  /** Send KOTs now (accepted). */
  send: boolean;
}

export interface KitchenState {
  status: "open" | "billed" | "cancelled";
  number: number;
  kots: { status: string }[];
}

/** The restaurant's kitchen (dining orders, KOTs, kitchen display). */
export interface KitchenPort {
  open(tenantId: string, input: KitchenOrderInput): Promise<{ id: string; number: number }>;
  /** Sends the waiting lines as KOTs (on accept). */
  send(tenantId: string, orderId: string): Promise<void>;
  setDue(tenantId: string, orderId: string, dueAt: Date | null): Promise<void>;
  cancel(tenantId: string, orderId: string, reason: string): Promise<void>;
  /** Closes it without a tax invoice (9(5) orders, once the food has left). */
  settle(tenantId: string, orderId: string): Promise<void>;
  state(tenantId: string, orderId: string): Promise<KitchenState | null>;
  /** The dining order of a KOT, to notice "all tickets ready". */
  orderOfKot(tenantId: string, kotId: string): Promise<string | null>;
}

export interface MenuItemInfo {
  id: string;
  name: string;
  /** Paise per unit, GST-exclusive (what the platform shows; it adds the tax). */
  rate: number;
  gstRate: number;
  categoryId: string | null;
  image: string | null;
  /** Kitchen settings (dining): veg mark and sold-out. */
  veg: boolean | null;
  available: boolean;
}

/** The restaurant's menu = its catalogue (+ dining's veg / sold-out flags). */
export interface MenuPort {
  list(tenantId: string): Promise<MenuItemInfo[]>;
  categories(tenantId: string): Promise<{ id: string; name: string; sort: number }[]>;
  /** Which of these ids are live catalogue items. */
  existing(tenantId: string, ids: string[]): Promise<string[]>;
}

export interface HttpResponse {
  status: number;
  body: unknown;
}

/** Outgoing calls to providers (fetch in the app, a mock in tests). */
export interface HttpPort {
  send(req: HttpRequest): Promise<HttpResponse>;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };

/** fetch with a timeout; JSON bodies in and out. */
export function fetchHttp(timeoutMs = 10_000): HttpPort {
  return {
    async send(req) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(req.url, {
          method: req.method,
          headers: req.headers,
          body: req.body === undefined ? undefined : JSON.stringify(req.body),
          signal: ctrl.signal,
        });
        const text = await res.text();
        let body: unknown = text;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          /* not JSON */
        }
        return { status: res.status, body };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
