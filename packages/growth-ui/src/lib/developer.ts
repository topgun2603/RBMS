/**
 * Pure helpers for the developer settings page (API keys, webhooks, delivery log, docs). No React, no fetch,
 * so they are unit-tested in developer.test.ts.
 */
import type { DeliveryStatus, ScopeDef, WebhookEventDef } from "./types";

/** Subscribing to `*` means every event, including ones added later (packages/developer/src/events.ts). */
export const ALL_EVENTS = "*";

/** Retry delays after a failed delivery (packages/developer/src/retry.ts). */
export const RETRY_SCHEDULE = ["1 m", "5 m", "30 m", "2 h", "12 h"] as const;
export const AUTO_DISABLE_AFTER = 20;
export const SIGNATURE_TOLERANCE_SEC = 300;
export const RESPONSE_BODY_LIMIT = 2048;
export const DELIVERY_PAGE_SIZE = 50;

// ------------------------------------------------------------------ grouping and search

export interface Group<T> {
  module: string;
  items: T[];
}

/** Groups items by `module`, keeping module order by first appearance (the server already sorts by module). */
export function groupByModule<T extends { module: string }>(items: readonly T[]): Group<T>[] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const list = map.get(it.module);
    if (list) list.push(it);
    else map.set(it.module, [it]);
  }
  return [...map].map(([module, list]) => ({ module, items: list }));
}

const norm = (s: string) => s.toLocaleLowerCase().normalize("NFKD");

/** Case-insensitive match on every word of `query` against the given fields. Empty query matches everything. */
export function matchesQuery(query: string, ...fields: (string | null | undefined)[]): boolean {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = norm(fields.filter(Boolean).join(" "));
  return words.every((w) => hay.includes(w));
}

/** Scopes matching a search (key, label, description, module), grouped by module. */
export function groupScopes(scopes: readonly ScopeDef[], query = ""): Group<ScopeDef>[] {
  return groupByModule(scopes.filter((s) => matchesQuery(query, s.key, s.label, s.description, s.module)));
}

/** Events matching a search (type, label, description, module), grouped by module. */
export function groupEvents(events: readonly WebhookEventDef[], query = ""): Group<WebhookEventDef>[] {
  return groupByModule(events.filter((e) => matchesQuery(query, e.type, e.label, e.description, e.module)));
}

/** Tri-state of a group checkbox: every / some / none of `keys` are in `selected`. */
export function groupState(keys: readonly string[], selected: ReadonlySet<string>): boolean | "indeterminate" {
  if (keys.length === 0) return false;
  const n = keys.filter((k) => selected.has(k)).length;
  return n === 0 ? false : n === keys.length ? true : "indeterminate";
}

/** Adds all `keys` (when not all are selected yet) or removes them all. Returns a new set. */
export function toggleGroup(selected: ReadonlySet<string>, keys: readonly string[]): Set<string> {
  const next = new Set(selected);
  const all = keys.length > 0 && keys.every((k) => next.has(k));
  for (const k of keys) {
    if (all) next.delete(k);
    else next.add(k);
  }
  return next;
}

/** Adds or removes one key. Returns a new set. */
export function toggleKey(selected: ReadonlySet<string>, key: string, on?: boolean): Set<string> {
  const next = new Set(selected);
  const want = on ?? !next.has(key);
  if (want) next.add(key);
  else next.delete(key);
  return next;
}

// ------------------------------------------------------------------ key expiry

export type ExpiryPreset = "never" | "30d" | "90d" | "1y" | "custom";
export const EXPIRY_PRESETS: readonly ExpiryPreset[] = ["never", "30d", "90d", "1y", "custom"];

const DAY = 86_400_000;

/**
 * `expiresAt` for the create-key body: null for "never", now + N days for a preset, end of the chosen day in IST
 * (23:59:59 +05:30) for "custom". Returns undefined when "custom" has no valid date yet.
 */
export function expiryToIso(preset: ExpiryPreset, customDate = "", now: Date = new Date()): string | null | undefined {
  switch (preset) {
    case "never":
      return null;
    case "30d":
      return new Date(now.getTime() + 30 * DAY).toISOString();
    case "90d":
      return new Date(now.getTime() + 90 * DAY).toISOString();
    case "1y": {
      const d = new Date(now.getTime());
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      return d.toISOString();
    }
    case "custom": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(customDate)) return undefined;
      const d = new Date(`${customDate}T23:59:59+05:30`);
      return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
    }
  }
}

/** True when an ISO expiry is in the future (null = never expires = fine). */
export const expiryInFuture = (iso: string | null | undefined, now: Date = new Date()) =>
  iso === null || (typeof iso === "string" && new Date(iso).getTime() > now.getTime());

/** Tomorrow in IST as YYYY-MM-DD (the earliest custom expiry date). */
export function tomorrowIST(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(now.getTime() + DAY),
  );
}

// ------------------------------------------------------------------ display

/** "sk_live_Ab3x" → "sk_live_Ab3x…" (the rest of the key is never stored). */
export const maskedKey = (prefix: string) => `${prefix}…`;

/** Relative time ("3 minutes ago", "in 2 hours") in the UI locale. */
export function relativeTime(iso: string | Date, locale: string, now: Date = new Date()): string {
  const t = typeof iso === "string" ? new Date(iso).getTime() : iso.getTime();
  const diffSec = Math.round((t - now.getTime()) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(locale === "ta" ? "ta-IN" : "en-IN", { numeric: "auto" });
  if (abs < 45) return rtf.format(0, "second");
  if (abs < 45 * 60) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 22 * 3600) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 26 * 86400) return rtf.format(Math.round(diffSec / 86400), "day");
  if (abs < 320 * 86400) return rtf.format(Math.round(diffSec / (30 * 86400)), "month");
  return rtf.format(Math.round(diffSec / (365 * 86400)), "year");
}

/** Host + path of a webhook URL for compact display; the input when it doesn't parse. */
export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url;
  }
}

/** Client-side URL check before the server's (which also blocks private addresses). */
export function urlProblem(url: string): "empty" | "invalid" | "scheme" | "http" | null {
  const s = url.trim();
  if (!s) return "empty";
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return "invalid";
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return "scheme";
  if (u.protocol === "http:") return "http";
  return null;
}

/** Cuts text to at most `limit` UTF-8 bytes without splitting a character. */
export function truncateBytes(text: string, limit = RESPONSE_BODY_LIMIT): { text: string; truncated: boolean } {
  const enc = new TextEncoder();
  const bytes = enc.encode(text);
  if (bytes.length <= limit) return { text, truncated: false };
  let out = new TextDecoder().decode(bytes.subarray(0, limit));
  while (out.endsWith("�") || enc.encode(out).length > limit) out = out.slice(0, -1);
  return { text: out, truncated: true };
}

/** Pretty JSON when `text` parses, else the text unchanged. */
export function prettyMaybeJson(text: string): string {
  const s = text.trim();
  if (!s || (s[0] !== "{" && s[0] !== "[")) return text;
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return text;
  }
}

/** Status tone of a delivery or an HTTP status. */
export const deliveryTone = (s: DeliveryStatus) => (s === "succeeded" ? "success" : s === "failed" ? "danger" : "warning");
export const httpTone = (status: number | null) => (status === null ? "neutral" : status >= 200 && status < 300 ? "success" : status >= 500 ? "danger" : "warning");

/** Does an endpoint's events list mean "every event"? */
export const isAllEvents = (events: readonly string[]) => events.includes(ALL_EVENTS);

/** Normalises the events picked in the editor for the API body: "*" wins; duplicates removed. */
export function eventsForApi(selected: ReadonlySet<string> | readonly string[], all: boolean): string[] {
  if (all) return [ALL_EVENTS];
  return [...new Set(selected)].filter((e) => e !== ALL_EVENTS);
}

// ------------------------------------------------------------------ samples and docs

/** The JSON body an endpoint receives for an event, with the catalogue's `sample` as `data`. */
export function samplePayload(event: Pick<WebhookEventDef, "type" | "sample">, tenantSlug: string, createdAt = "2026-10-15T10:30:00.000Z") {
  return {
    id: "evt_5b1c9e2d-0000-4a7f-9c3e-1d2e3f4a5b6c",
    type: event.type,
    createdAt,
    tenant: { slug: tenantSlug },
    data: event.sample,
  };
}

/** Example `x-srikit-signature` header value. */
export const SIGNATURE_EXAMPLE = "t=1760524200,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd";

/** Node.js (Express) receiver that verifies the signature. */
export const NODE_VERIFY_SAMPLE = `import express from "express";
import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = process.env.SRIKIT_WEBHOOK_SECRET; // whsec_…
const TOLERANCE_SEC = ${SIGNATURE_TOLERANCE_SEC};

function verify(header, rawBody) {
  if (!header) return false;
  let t = null;
  const sigs = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=");
    if (k === "t") t = Number(v);
    if (k === "v1") sigs.push(v); // more than one during a secret rotation
  }
  if (!t || sigs.length === 0) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - t) > TOLERANCE_SEC) return false; // replay

  const expected = Buffer.from(
    createHmac("sha256", SECRET).update(\`\${t}.\${rawBody}\`, "utf8").digest("hex"),
  );
  return sigs.some((s) => {
    const given = Buffer.from(s);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

const app = express();

// Keep the RAW body: re-serialised JSON won't match the signature.
app.post("/webhooks/rbms", express.raw({ type: "application/json" }), (req, res) => {
  const raw = req.body.toString("utf8");
  if (!verify(req.get("x-srikit-signature"), raw)) return res.status(400).send("bad signature");

  const event = JSON.parse(raw);
  // req.get("x-srikit-event")    → event.type, e.g. "invoice.paid"
  // req.get("x-srikit-delivery") → delivery id (a redelivery gets a new one)
  // event.id is the same across retries and redeliveries: use it to skip duplicates.
  console.log(event.type, event.data);
  res.sendStatus(200); // any 2xx within 10 s counts as delivered
});

app.listen(3000);
`;

/** curl call with an API key. */
export function curlSample(apiBase: string, tenantSlug: string): string {
  return `curl ${apiBase.replace(/\/+$/, "")}/invoices?limit=5 \\
  -H "Authorization: Bearer sk_live_…" \\
  -H "x-tenant: ${tenantSlug || "<shop slug>"}"`;
}
