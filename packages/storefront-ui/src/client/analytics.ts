"use client";

/**
 * Tiny analytics beacon: batches events for ~1.5 s and posts them to `/api/v1/analytics/public/events` with
 * navigator.sendBeacon (text/plain — no preflight), falling back to fetch keepalive. anonymousId lives in
 * localStorage (per browser), sessionId in sessionStorage (per tab, 30 min idle).
 */

export type EventType = "page_view" | "product_view" | "add_to_cart" | "remove_from_cart" | "begin_checkout" | "purchase" | "search";

export interface StoreEvent {
  type: EventType;
  path?: string;
  productId?: string;
  variantId?: string;
  value?: number;
  /** `purchase` only: the order lines (product id + line total in paise). */
  items?: { productId: string; value: number }[];
  query?: string;
  referrer?: string;
  utm?: { source?: string; medium?: string; campaign?: string };
  at?: string;
}

const ENDPOINT = "/api/v1/analytics/public/events";
const SESSION_IDLE_MS = 30 * 60_000;
let queue: StoreEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

const rid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

function anonymousId(): string {
  try {
    let id = localStorage.getItem("sr_aid");
    if (!id) {
      id = rid();
      localStorage.setItem("sr_aid", id);
    }
    return id;
  } catch {
    return "anonymous";
  }
}

function sessionId(): string {
  try {
    const now = Date.now();
    const raw = sessionStorage.getItem("sr_sid");
    const [id, last] = raw ? raw.split(":") : [];
    const live = id && last && now - Number(last) < SESSION_IDLE_MS ? id : rid();
    sessionStorage.setItem("sr_sid", `${live}:${now}`);
    return live;
  } catch {
    return "session";
  }
}

function utm(): StoreEvent["utm"] | undefined {
  try {
    const p = new URLSearchParams(location.search);
    // Launches from the installed app open the manifest's start_url "/?source=pwa" (lib/pwa): source "pwa", medium "app".
    const pwa = !p.get("utm_source") && p.get("source") === "pwa";
    const source = pwa ? "pwa" : (p.get("utm_source") ?? undefined);
    if (!source) return undefined;
    return { source, medium: (pwa ? "app" : p.get("utm_medium")) ?? undefined, campaign: p.get("utm_campaign") ?? undefined };
  } catch {
    return undefined;
  }
}

function flush() {
  timer = null;
  if (!queue.length) return;
  const events = queue.splice(0, 50);
  const body = JSON.stringify({ anonymousId: anonymousId(), sessionId: sessionId(), events });
  try {
    const ok = typeof navigator !== "undefined" && navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: "text/plain" }));
    if (!ok) void fetch(ENDPOINT, { method: "POST", body, headers: { "content-type": "text/plain" }, keepalive: true }).catch(() => undefined);
  } catch {
    /* analytics must never break the store */
  }
  if (queue.length) flush();
}

export function track(event: StoreEvent) {
  if (typeof window === "undefined") return;
  queue.push({
    path: location.pathname,
    at: new Date().toISOString(),
    ...(event.type === "page_view" ? { referrer: document.referrer || undefined, utm: utm() } : {}),
    ...event,
  });
  if (!timer) timer = setTimeout(flush, 1500);
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
}
