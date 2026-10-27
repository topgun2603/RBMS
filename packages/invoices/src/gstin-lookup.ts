/**
 * GSTIN lookup (docs/recurring-export-gstin.md): type a GSTIN on a customer or supplier and get, at once and offline,
 * whether it is well-formed (checksum), its State and its PAN; then, when a lookup provider is configured, the legal and
 * trade name, address, registration status (active / cancelled) and type from the public GST search through that
 * provider. Answers are cached 30 days for every shop (public registration data) and provider calls are rate-limited
 * per shop. Without a provider only the offline part runs, and the answer says so.
 */
import { AppError, badRequest } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { normalizeGstin, parseGstin, stateName, type GstinParts } from "@srirealtime/gst";
import { and, count, eq, gte, inArray } from "drizzle-orm";
import { noopLogger, type LoggerPort } from "./ports";
import { gstinLookupLog, gstinLookups, type GstinDetails, type GstinStatus } from "./schema-recurring";

/** A source of public GSTIN details (a GSP's taxpayer search, a public search API ...). */
export interface GstinLookupProvider {
  /** Short id stored with cached answers, e.g. "gstn-search". */
  readonly name: string;
  /** Details of a valid GSTIN; null when the provider says no such registration exists. Throws when it can't answer. */
  lookup(gstin: string): Promise<GstinDetails | null>;
}

export interface GstinLookupConfig {
  /** Days a cached answer is used before the provider is asked again. Default 30. */
  cacheDays?: number;
  /** Provider calls per shop per hour / per day (cache hits are free). Defaults 30 / 200. */
  perHour?: number;
  perDay?: number;
}

export interface GstinLookupDeps {
  db: Db;
  /** Null / absent = offline only. */
  provider?: GstinLookupProvider | null;
  config?: GstinLookupConfig;
  log?: LoggerPort;
  now?: () => Date;
}

export interface GstinOnline {
  /** A provider is configured. */
  available: boolean;
  /** Where `details` came from. */
  source: "cache" | "provider" | null;
  /** False = the provider said this GSTIN is not registered. Null = not asked. */
  found: boolean | null;
  details: GstinDetails | null;
  fetchedAt: Date | null;
  /** Why there are no details: "not_configured", "invalid", "rate_limited", "provider_error". */
  reason: "not_configured" | "invalid" | "rate_limited" | "provider_error" | null;
}

export interface GstinLookupResult extends Omit<GstinParts, "expectedCheck"> {
  stateName: string | null;
  /** The check character a mistyped GSTIN needs (only when the checksum fails). */
  expectedCheck: string | null;
  online: GstinOnline;
}

const DAY = 86_400_000;

const STATUS_WORDS: [RegExp, GstinStatus][] = [
  [/^act/i, "active"],
  [/cancel/i, "cancelled"],
  [/suspend/i, "suspended"],
  [/inact/i, "inactive"],
];
/** "Active" / "Cancelled" / "Suspended" / "Inactive" (any case) → our status. */
export function gstinStatusOf(v: unknown): GstinStatus {
  const s = typeof v === "string" ? v.trim() : "";
  for (const [re, st] of STATUS_WORDS) if (re.test(s)) return st;
  return "unknown";
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim() : null);
/** "15/07/2019" → "2019-07-15"; ISO dates pass. */
const isoDate = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const m = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

/**
 * Maps a GSTN taxpayer-search answer (the `searchtp` layout most GSPs pass through: lgnm, tradeNam, sts, dty, ctb, rgdt,
 * cxdt, pradr.addr {bno, bnm, flno, st, loc, dst, stcd, pncd}) to our details. Accepts it bare or under `data` / `result`.
 */
export function mapTaxpayerSearch(raw: unknown): GstinDetails | null {
  let o = raw as Record<string, unknown> | null;
  for (const k of ["data", "result", "taxpayerInfo"]) {
    if (o && typeof o === "object" && o[k] && typeof o[k] === "object" && !("lgnm" in o)) o = o[k] as Record<string, unknown>;
  }
  if (!o || typeof o !== "object" || !("lgnm" in o || "tradeNam" in o)) return null;
  const pr = (o.pradr ?? {}) as Record<string, unknown>;
  const a = (pr.addr ?? {}) as Record<string, unknown>;
  const parts = [a.flno, a.bno, a.bnm, a.st, a.loc, a.dst].map(str).filter(Boolean) as string[];
  const address = parts.length ? parts.join(", ") : str(pr.adr);
  const pin = str(a.pncd) ?? (address ? (/(?<!\d)[1-9]\d{5}(?!\d)/.exec(address)?.[0] ?? null) : null);
  return {
    legalName: str(o.lgnm),
    tradeName: str(o.tradeNam),
    address,
    pincode: pin,
    stateCode: null,
    status: gstinStatusOf(o.sts),
    registrationType: str(o.dty),
    constitution: str(o.ctb),
    registeredOn: isoDate(o.rgdt),
    cancelledOn: isoDate(o.cxdt),
  };
}

export interface HttpProviderOptions {
  name?: string;
  /** URL with `{gstin}` where the number goes, e.g. "https://gsp.example.com/taxpayer/search?gstin={gstin}". */
  url: string;
  /** Sent as `headerName: key` (default header "Authorization", value "Bearer <key>" when the header is Authorization). */
  apiKey?: string | null;
  headerName?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/**
 * A provider over an HTTP endpoint that answers the GSTN taxpayer-search JSON (most GSPs and public search APIs do).
 * 404 = not registered. Nothing is called until a shop looks a GSTIN up, and only when configured by env.
 */
export function httpGstinProvider(o: HttpProviderOptions): GstinLookupProvider {
  const doFetch = o.fetch ?? fetch;
  const header = o.headerName?.trim() || "Authorization";
  return {
    name: o.name ?? "gstn-search",
    async lookup(gstin) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 8000);
      try {
        const headers: Record<string, string> = { accept: "application/json" };
        if (o.apiKey) headers[header] = header.toLowerCase() === "authorization" && !/\s/.test(o.apiKey) ? `Bearer ${o.apiKey}` : o.apiKey;
        const res = await doFetch(o.url.replace("{gstin}", encodeURIComponent(gstin)), { headers, signal: ctrl.signal });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`GSTIN provider answered ${res.status}`);
        const body = (await res.json()) as unknown;
        const err = body && typeof body === "object" ? (body as Record<string, unknown>).error : null;
        if (err && /not\s*found|invalid|no\s*record/i.test(JSON.stringify(err))) return null;
        const details = mapTaxpayerSearch(body);
        if (!details) throw new Error("GSTIN provider answer not understood");
        return details;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** A provider answering from a fixed map (tests, demos). Unknown numbers are "not registered". */
export function fakeGstinProvider(map: Record<string, GstinDetails>, name = "fake"): GstinLookupProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    name,
    calls,
    async lookup(gstin) {
      calls.push(gstin);
      return map[gstin] ?? null;
    },
  };
}

export class GstinLookupService {
  private readonly db: Db;
  private readonly provider: GstinLookupProvider | null;
  private readonly cacheMs: number;
  private readonly perHour: number;
  private readonly perDay: number;
  private readonly log: LoggerPort;
  private readonly now: () => Date;

  constructor(deps: GstinLookupDeps) {
    this.db = deps.db;
    this.provider = deps.provider ?? null;
    this.cacheMs = (deps.config?.cacheDays ?? 30) * DAY;
    this.perHour = deps.config?.perHour ?? 30;
    this.perDay = deps.config?.perDay ?? 200;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
  }

  /** Whether online lookups are possible (for the forms' hint). */
  info() {
    return { online: !!this.provider, provider: this.provider?.name ?? null, cacheDays: Math.round(this.cacheMs / DAY) };
  }

  private async withinLimit(tenantId: string): Promise<boolean> {
    const now = this.now().getTime();
    const [[hour], [day]] = await Promise.all([
      this.db.select({ n: count() }).from(gstinLookupLog).where(and(eq(gstinLookupLog.tenantId, tenantId), gte(gstinLookupLog.at, new Date(now - 3_600_000)))),
      this.db.select({ n: count() }).from(gstinLookupLog).where(and(eq(gstinLookupLog.tenantId, tenantId), gte(gstinLookupLog.at, new Date(now - DAY)))),
    ]);
    return Number(hour?.n ?? 0) < this.perHour && Number(day?.n ?? 0) < this.perDay;
  }

  /**
   * Offline facts at once, then the online details: from the cache when fresh (`refresh` skips it), else from the
   * provider (rate-limited per shop). Provider failures never fail the request: the offline part still answers.
   */
  async lookup(tenantId: string, input: string, opts: { userId?: string | null; refresh?: boolean } = {}): Promise<GstinLookupResult> {
    const raw = typeof input === "string" ? input : "";
    if (normalizeGstin(raw).length > 20) throw badRequest("A GSTIN has 15 characters");
    const parts = parseGstin(raw);
    const base = {
      ...parts,
      stateName: stateName(parts.stateCode),
      expectedCheck: parts.problem === "checksum" ? parts.expectedCheck : null,
    };
    const online: GstinOnline = { available: !!this.provider, source: null, found: null, details: null, fetchedAt: null, reason: null };
    if (!parts.valid) return { ...base, online: { ...online, reason: "invalid" } };

    const [cached] = await this.db.select().from(gstinLookups).where(eq(gstinLookups.gstin, parts.gstin)).limit(1);
    const fresh = cached && this.now().getTime() - cached.fetchedAt.getTime() < this.cacheMs;
    if (cached && (fresh || !this.provider) && !(opts.refresh && this.provider)) {
      return { ...base, online: { ...online, source: "cache", found: cached.found, details: this.withState(cached.details, parts), fetchedAt: cached.fetchedAt } };
    }
    if (!this.provider) return { ...base, online: { ...online, reason: "not_configured" } };
    if (!(await this.withinLimit(tenantId))) {
      // Over the limit: an old cached answer is better than none.
      if (cached) return { ...base, online: { ...online, source: "cache", found: cached.found, details: this.withState(cached.details, parts), fetchedAt: cached.fetchedAt, reason: "rate_limited" } };
      return { ...base, online: { ...online, reason: "rate_limited" } };
    }
    let details: GstinDetails | null;
    try {
      details = await this.provider.lookup(parts.gstin);
    } catch (err) {
      this.log.warn({ err, tenantId, provider: this.provider.name }, "gstin lookup: provider failed");
      await this.db.insert(gstinLookupLog).values({ tenantId, gstin: parts.gstin, userId: opts.userId ?? null, ok: false });
      if (cached) return { ...base, online: { ...online, source: "cache", found: cached.found, details: this.withState(cached.details, parts), fetchedAt: cached.fetchedAt, reason: "provider_error" } };
      return { ...base, online: { ...online, reason: "provider_error" } };
    }
    const at = this.now();
    await this.db.insert(gstinLookupLog).values({ tenantId, gstin: parts.gstin, userId: opts.userId ?? null, ok: true, at });
    const row = { gstin: parts.gstin, provider: this.provider.name, found: !!details, status: details?.status ?? ("unknown" as const), details, fetchedAt: at };
    await this.db.insert(gstinLookups).values(row).onConflictDoUpdate({ target: gstinLookups.gstin, set: row });
    return { ...base, online: { ...online, source: "provider", found: !!details, details: this.withState(details, parts), fetchedAt: at } };
  }

  private withState(d: GstinDetails | null, parts: GstinParts): GstinDetails | null {
    return d ? { ...d, stateCode: d.stateCode ?? parts.stateCode } : null;
  }

  /**
   * Registration status of GSTINs from the cache only (never calls the provider): what the bill and purchase screens
   * use to warn about a cancelled or suspended GSTIN. Unknown numbers are left out.
   */
  async statuses(gstins: string[]): Promise<Record<string, { status: GstinStatus; fetchedAt: Date; legalName: string | null }>> {
    const list = [...new Set(gstins.map((g) => normalizeGstin(String(g ?? ""))).filter((g) => g.length === 15))].slice(0, 100);
    if (!list.length) return {};
    const rows = await this.db.select().from(gstinLookups).where(inArray(gstinLookups.gstin, list));
    const out: Record<string, { status: GstinStatus; fetchedAt: Date; legalName: string | null }> = {};
    for (const r of rows) out[r.gstin] = { status: r.found ? r.status : "unknown", fetchedAt: r.fetchedAt, legalName: r.details?.legalName ?? null };
    return out;
  }
}

/** 429 for routes that want a hard refusal (the lookup route itself answers the offline part instead). */
export const gstinRateLimited = () => new AppError(429, "rate_limited", "Too many GSTIN lookups from this shop; try again in a while");
