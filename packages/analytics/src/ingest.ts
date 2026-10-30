/** Pure ingest helpers: validation, referrers, UTM, IP hashing and rate limiting (no database). */
import { sha256 } from "@rbms/core";
import { z } from "zod";
import { EVENT_TYPES, type NewAnalyticsEvent } from "./schema";
import { deviceOf } from "./ua";

export const MAX_EVENTS_PER_CALL = 50;
const MAX_PAISE = 2_000_000_000;

const id = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "Invalid id");
const short = z.string().trim().max(100);

export const utmSchema = z
  .object({ source: short.optional().nullable(), medium: short.optional().nullable(), campaign: short.optional().nullable() })
  .partial();

export const eventSchema = z.object({
  type: z.enum(EVENT_TYPES),
  path: z.string().max(512).optional().nullable(),
  productId: z.string().uuid().optional().nullable(),
  variantId: z.string().uuid().optional().nullable(),
  value: z.number().int().min(0).max(MAX_PAISE).optional().nullable(),
  query: z.string().max(200).optional().nullable(),
  referrer: z.string().max(2048).optional().nullable(),
  utm: utmSchema.optional().nullable(),
  at: z.string().datetime({ offset: true }).optional().nullable(),
});

export const ingestSchema = z.object({
  anonymousId: id,
  sessionId: id,
  events: z.array(eventSchema).min(1).max(MAX_EVENTS_PER_CALL),
});

export type IngestEvent = z.infer<typeof eventSchema>;
export type IngestInput = z.infer<typeof ingestSchema>;

// ------------------------------------------------------------------ hosts and referrers

/** Lower-case host without port, trailing dot or a leading "www.". */
export function bareHost(host: string | null | undefined): string | null {
  if (!host) return null;
  let h = host.trim().toLowerCase();
  if (h.startsWith("[")) return h; // IPv6 literal
  h = h.replace(/:\d+$/, "").replace(/\.$/, "");
  if (h.startsWith("www.")) h = h.slice(4);
  return h || null;
}

/** Host of a URL (Origin / Referer header), bare; null when it isn't a URL. */
export function hostOfUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return bareHost(new URL(url).host);
  } catch {
    return null;
  }
}

/**
 * The referring site, e.g. "google.com" or "com.google.android.gm" (android-app://). Null for no referrer, a bad URL,
 * a non-web scheme, or a self-referral (the referrer is one of `selfHosts`).
 */
export function referrerHost(referrer: string | null | undefined, selfHosts: readonly (string | null | undefined)[]): string | null {
  if (!referrer) return null;
  let u: URL;
  try {
    u = new URL(referrer);
  } catch {
    return null;
  }
  if (!["http:", "https:", "android-app:"].includes(u.protocol)) return null;
  const host = bareHost(u.host);
  if (!host) return null;
  const self = new Set(selfHosts.map((h) => bareHost(h)).filter(Boolean));
  return self.has(host) ? null : host;
}

// ------------------------------------------------------------------ UTM

export interface Utm {
  source: string | null;
  medium: string | null;
  campaign: string | null;
}

const cleanUtm = (v: string | null | undefined): string | null => {
  const s = (v ?? "").trim().toLowerCase().slice(0, 100);
  return s || null;
};

/** UTM tags from the event's `utm` object, else from the `path` query string (`?utm_source=...`). */
export function parseUtm(utm: IngestEvent["utm"], path?: string | null): Utm {
  if (utm && (utm.source || utm.medium || utm.campaign)) {
    return { source: cleanUtm(utm.source), medium: cleanUtm(utm.medium), campaign: cleanUtm(utm.campaign) };
  }
  const q = path?.indexOf("?") ?? -1;
  if (path && q >= 0) {
    const params = new URLSearchParams(path.slice(q + 1).split("#")[0]);
    return {
      source: cleanUtm(params.get("utm_source")),
      medium: cleanUtm(params.get("utm_medium")),
      campaign: cleanUtm(params.get("utm_campaign")),
    };
  }
  return { source: null, medium: null, campaign: null };
}

/** Search text as stored and grouped: trimmed, lower-case, single spaces, ≤ 100 chars. */
export const normalizeQuery = (q: string | null | undefined): string | null => {
  const s = (q ?? "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 100);
  return s || null;
};

/** Path without query string or fragment (UTM tags are kept separately), ≤ 512 chars. */
export const cleanPath = (p: string | null | undefined): string | null => {
  const s = (p ?? "").split(/[?#]/)[0]!.trim().slice(0, 512);
  return s || null;
};

// ------------------------------------------------------------------ dates

/** IST calendar date of an instant, "2026-10-15". */
export const istDate = (d: Date): string => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** Start of an IST date as an instant. */
export const istDayStart = (date: string): Date => new Date(`${date}T00:00:00.000+05:30`);

/** `date` plus `n` days ("2026-10-15", -1 → "2026-10-14"). */
export const addDaysISO = (date: string, n: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * The IST dates a rollup recomputes, oldest first, ending today: `days` of them (whole number, at least 1, at most the
 * raw-event retention + 1 — older days have no raw events left to rebuild from).
 */
export function rollupDates(today: string, days: number, retentionDays = 90): string[] {
  const n = Math.min(Math.max(Math.trunc(Number.isFinite(days) ? days : 2), 1), retentionDays + 1);
  return Array.from({ length: n }, (_, i) => addDaysISO(today, i - n + 1));
}

/** Client timestamps are trusted only within the last 24 h and up to 5 min ahead; otherwise "now". */
export function eventTime(at: string | null | undefined, now: Date): Date {
  if (!at) return now;
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return now;
  if (t > now.getTime() + 5 * 60_000 || t < now.getTime() - 86_400_000) return now;
  return new Date(t);
}

// ------------------------------------------------------------------ IP hashing

/**
 * A salt that changes every IST day, derived from a secret and the date and kept in memory only, so IP hashes can't be
 * joined across days and raw IPs are never stored.
 */
export class DailySalt {
  private current: { date: string; salt: string } | null = null;

  constructor(private readonly secret: string) {
    if (!secret) throw new Error("analytics: an IP salt secret is required");
  }

  for(now: Date = new Date()): string {
    const date = istDate(now);
    if (this.current?.date !== date) this.current = { date, salt: sha256(`${this.secret}:analytics:${date}`) };
    return this.current.salt;
  }

  /** sha256(ip + daily salt), or null without an IP. */
  hashIp(ip: string | null | undefined, now: Date = new Date()): string | null {
    if (!ip) return null;
    return sha256(`${ip}${this.for(now)}`);
  }
}

// ------------------------------------------------------------------ rate limit

/** Fixed-window in-memory limiter (per process). */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; reset: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 50_000,
  ) {}

  /** Counts a hit; false when `key` is over the limit for the current window. */
  hit(key: string, now: number = Date.now()): boolean {
    let e = this.hits.get(key);
    if (!e || e.reset <= now) {
      if (this.hits.size >= this.maxKeys) this.sweep(now);
      e = { count: 0, reset: now + this.windowMs };
      this.hits.set(key, e);
    }
    e.count++;
    return e.count <= this.limit;
  }

  private sweep(now: number) {
    for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
    if (this.hits.size >= this.maxKeys) this.hits.clear();
  }
}

// ------------------------------------------------------------------ rows

export interface IngestMeta {
  userAgent: string | null;
  ipHash: string | null;
  /** Hosts of the shop itself (request host, Origin host) — referrals from these are ignored. */
  selfHosts: readonly (string | null | undefined)[];
  now: Date;
}

/** Validated input → rows for analytics_events. */
export function toEventRows(tenantId: string, input: IngestInput, meta: IngestMeta): NewAnalyticsEvent[] {
  const device = deviceOf(meta.userAgent);
  return input.events.map((e) => {
    const utm = parseUtm(e.utm, e.path);
    return {
      tenantId,
      at: eventTime(e.at, meta.now),
      type: e.type,
      sessionId: input.sessionId,
      anonymousId: input.anonymousId,
      path: cleanPath(e.path),
      productId: e.productId ?? null,
      variantId: e.variantId ?? null,
      value: e.value ?? null,
      query: e.type === "search" ? normalizeQuery(e.query) : null,
      referrerHost: referrerHost(e.referrer, meta.selfHosts),
      utmSource: utm.source,
      utmMedium: utm.medium,
      utmCampaign: utm.campaign,
      device,
      ipHash: meta.ipHash,
    };
  });
}
