import { asc, desc, ilike, or, sql, type AnyColumn, type SQL, type SQLWrapper } from "drizzle-orm";
import { z } from "zod";
import { badRequest } from "./errors";

/*
 * Shared list-query helpers: paging, sorting, search and filters, so every module's list route behaves the same
 * (docs/CONVENTIONS.md → "Lists and tables").
 *
 *   GET /v1/<module>/<things>?limit=25&offset=50&sort=-date&q=meena&status=paid,unpaid&from=2026-10-01&to=2026-10-31
 *   → { items: [...], total: 1234, limit: 25, offset: 50, facets?: { status: { paid: 10, unpaid: 4 } } }
 *
 * `sort` is one field, ascending by name (`sort=total`) or descending with a leading minus (`sort=-total`).
 */

// ---------------------------------------------------------------------------------------------- query schema

export interface ListQueryOptions {
  /** Page size when the client sends none. Default 25. */
  defaultLimit?: number;
  /** Largest page a client may ask for. Default 100. */
  maxLimit?: number;
  /** Longest search text. Default 100. */
  maxSearch?: number;
}

/**
 * The common list query: `limit`, `offset`, `sort` (raw; resolved by a SortSpec) and `q` (trimmed, empty → undefined).
 * `.extend({...})` it with the route's own filters.
 */
export function listQuerySchema(opts: ListQueryOptions = {}) {
  const { defaultLimit = 25, maxLimit = 100, maxSearch = 100 } = opts;
  return z.object({
    q: z
      .string()
      .trim()
      .max(maxSearch)
      .optional()
      .transform((v) => (v ? v : undefined)),
    limit: z.coerce.number().int().min(1).max(maxLimit).default(Math.min(defaultLimit, maxLimit)),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
    sort: z.string().trim().max(64).optional(),
  });
}

/** Splits `"a,b"` and repeated params (`?s=a&s=b` arrives as an array) into a clean list; empty → undefined. */
export function splitList(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  const parts = (Array.isArray(v) ? v : [v])
    .flatMap((x) => String(x).split(","))
    .map((x) => x.trim())
    .filter(Boolean);
  return parts.length ? [...new Set(parts)] : undefined;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Route filter builders. Each is optional (absent or empty → undefined). */
export const listFilter = {
  /** Multi-select enum: `status=paid,unpaid` → ["paid", "unpaid"]. */
  oneOf<const T extends readonly [string, ...string[]]>(values: T) {
    return z.preprocess(splitList, z.array(z.enum(values)).max(values.length).optional());
  },
  /** Several ids: `customerId=<uuid>,<uuid>`. */
  ids(max = 50) {
    return z.preprocess(splitList, z.array(z.string().uuid()).max(max).optional());
  },
  /** One id. */
  id() {
    return z.preprocess((v) => (v === "" ? undefined : v), z.string().uuid().optional());
  },
  /** Calendar date `YYYY-MM-DD` (pair `from`/`to`, then `.superRefine(dateRangeOrder())`). */
  date() {
    return z.preprocess(
      (v) => (v === "" ? undefined : v),
      z
        .string()
        .regex(DATE_RE, "Use YYYY-MM-DD")
        .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "Invalid date")
        .optional(),
    );
  },
  /** Whole number bound, e.g. `minTotal=10000` (paise). */
  int(min = 0) {
    return z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(min).optional());
  },
  /** `true`/`false`/`1`/`0`. */
  bool() {
    return z.preprocess(
      (v) => (v === "" || v === undefined ? undefined : v === true || v === "true" || v === "1"),
      z.boolean().optional(),
    );
  },
};

/** `.superRefine(rangeOrder("from", "to"))`: rejects `to` before `from` (works for dates and numbers). */
export function rangeOrder<K extends string>(fromKey: K, toKey: K) {
  return (v: Partial<Record<K, unknown>>, ctx: z.RefinementCtx) => {
    const a = v[fromKey];
    const b = v[toKey];
    if (a !== undefined && b !== undefined && a !== null && b !== null && (b as number | string) < (a as number | string)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [toKey], message: `'${toKey}' must be on or after '${fromKey}'` });
    }
  };
}

// ---------------------------------------------------------------------------------------------- sorting

export type SortExpr = AnyColumn | SQL | SQLWrapper;
export type SortValue<K extends string> = K | `-${K}`;

export interface ResolvedSort<K extends string> {
  key: K;
  desc: boolean;
  /** As sent back to clients: "date" / "-date". */
  value: SortValue<K>;
}

export interface SortSpec<K extends string> {
  keys: readonly K[];
  default: SortValue<K>;
  /** Resolves `sort` (undefined → default). Unknown fields throw a 400 that lists the allowed ones. */
  parse(raw: string | undefined | null): ResolvedSort<K>;
  /** ORDER BY for `sort`: the chosen expression (nulls last either way), then the tie-breaker(s) in the same direction. */
  orderBy(raw: string | undefined | null | ResolvedSort<K>): SQL[];
}

/**
 * A whitelist of sortable fields. Keys are what clients send; values are columns or SQL expressions.
 *
 *   const SORT = defineSort({ number: invoices.number, date: invoices.date, total: invoices.total },
 *                           { default: "-date", tieBreaker: invoices.id });
 *   db.select()...orderBy(...SORT.orderBy(p.sort))
 */
export function defineSort<const K extends string>(
  map: Record<K, SortExpr>,
  opts: {
    default: SortValue<NoInfer<K>>;
    /** Unique column(s) appended so equal values keep a stable order across pages, e.g. `id` or `[createdAt, id]`. */
    tieBreaker: SortExpr | readonly SortExpr[];
  },
): SortSpec<K> {
  const keys = Object.keys(map) as K[];
  const ties = (Array.isArray(opts.tieBreaker) ? opts.tieBreaker : [opts.tieBreaker]) as SortExpr[];
  const parse = (raw: string | undefined | null): ResolvedSort<K> => {
    const value = (raw ?? "").trim() || opts.default;
    const r = parseSortValue(value, keys);
    if (!r) {
      throw badRequest(`Unknown sort field "${value}". Sort by one of: ${keys.join(", ")} (prefix "-" for descending).`, {
        field: "sort",
        value,
        allowed: keys,
      });
    }
    return r;
  };
  return {
    keys,
    default: opts.default,
    parse,
    orderBy(raw) {
      const r = typeof raw === "object" && raw !== null ? raw : parse(raw);
      const expr = map[r.key];
      return [
        r.desc ? sql`${expr} desc nulls last` : sql`${expr} asc nulls last`,
        ...ties.map((t) => (r.desc ? desc(t as AnyColumn) : asc(t as AnyColumn))),
      ];
    },
  };
}

/** `"-date"` → `{ key: "date", desc: true }`; also accepts `"date:desc"` / `"date:asc"`. Unknown → null. */
export function parseSortValue<K extends string>(value: string, keys: readonly K[]): ResolvedSort<K> | null {
  let key = value;
  let isDesc = false;
  const colon = /^([A-Za-z0-9_.]+):(asc|desc)$/i.exec(value);
  if (colon) {
    key = colon[1]!;
    isDesc = colon[2]!.toLowerCase() === "desc";
  } else if (value.startsWith("-")) {
    key = value.slice(1);
    isDesc = true;
  } else if (value.startsWith("+")) {
    key = value.slice(1);
  }
  if (!(keys as readonly string[]).includes(key)) return null;
  return { key: key as K, desc: isDesc, value: (isDesc ? `-${key}` : key) as SortValue<K> };
}

// ---------------------------------------------------------------------------------------------- search

/** Escapes `\`, `%` and `_` so user text matches literally inside LIKE/ILIKE. */
export const escapeLike = (q: string) => q.replace(/[\\%_]/g, "\\$&");

/** `%text%` with LIKE wildcards escaped. */
export const likePattern = (q: string) => `%${escapeLike(q)}%`;

/**
 * Case-insensitive "contains" over several columns/expressions (ORed); undefined when `q` is empty.
 * Each `%q%` ILIKE is a sequential scan per tenant; past ~50k rows a trigram index helps
 * (`create extension pg_trgm; create index ... using gin (number gin_trgm_ops)`; for jsonb fields index the expression,
 * e.g. `((customer->>'name')) gin_trgm_ops`).
 */
export function searchAny(q: string | undefined | null, exprs: SortExpr[]): SQL | undefined {
  const text = q?.trim();
  if (!text || exprs.length === 0) return undefined;
  const pat = likePattern(text);
  return or(...exprs.map((e) => ilike(e as AnyColumn, pat)));
}

// ---------------------------------------------------------------------------------------------- response

/** The standard list response. `facets` holds per-filter value counts when a route computes them. */
export interface ListPage<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  facets?: Record<string, Record<string, number>>;
}

type CountResult = number | string | bigint | Array<{ total: number | string | bigint } | undefined>;

/**
 * Runs the page query and the count (same WHERE, no ORDER BY / LIMIT, no joins the WHERE doesn't need) in parallel
 * and shapes the response.
 *
 *   return runList(p, {
 *     rows: () => db.select(...).from(t).where(where).orderBy(...SORT.orderBy(p.sort)).limit(p.limit).offset(p.offset),
 *     count: () => db.select({ total: count() }).from(t).where(where),
 *   });
 */
export async function runList<R, T = R>(
  page: { limit: number; offset: number },
  q: { rows: () => Promise<R[]>; count: () => Promise<CountResult>; map?: (row: R) => T },
): Promise<ListPage<T>> {
  const [rows, counted] = await Promise.all([q.rows(), q.count()]);
  const items = q.map ? rows.map(q.map) : (rows as unknown as T[]);
  return { items, total: toCount(counted), limit: page.limit, offset: page.offset };
}

export function toCount(r: CountResult): number {
  if (Array.isArray(r)) return Number(r[0]?.total ?? 0);
  return Number(r ?? 0);
}

/** Facet counts from `select key, count(*) group by key` rows: `{ paid: 10, unpaid: 4 }`. */
export function facetCounts(rows: Array<{ key: string | null; n: number | string | bigint }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) if (r.key !== null && r.key !== undefined) out[r.key] = (out[r.key] ?? 0) + Number(r.n);
  return out;
}
