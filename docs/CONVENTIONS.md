# Module conventions

Every reusable module lives in `packages/<id>` and is published inside the workspace as `@srirealtime/<id>`
(ids match the Module Catalogue). The API host in `apps/api` wires modules together and serves them.

## Package layout

```
packages/<id>/
  package.json        name "@srirealtime/<id>", "type": "module", exports { ".": "./src/index.ts" }
  tsconfig.json       { "extends": "../../tsconfig.base.json", "include": ["src"] }
  src/
    schema.ts         Drizzle tables owned by this module (only if it has tables). drizzle-kit globs this file.
    service.ts        Business logic. Plain functions/classes, no Fastify imports.
    routes.ts         Fastify routes (only if it exposes HTTP endpoints).
    index.ts          Public API: create<Name>(deps) factory, types, and `export * from "./schema"`.
    *.test.ts         Vitest unit tests for pure logic (no database needed).
```

- Source is consumed directly as TypeScript; there is no build step for packages.
- Relative imports are **extensionless** (`from "./service"`), matching `moduleResolution: "Bundler"`.
- Package scripts: `"typecheck": "tsc -p tsconfig.json"`, `"test": "vitest run --passWithNoTests"`.
- Depend on `@srirealtime/core` and `@srirealtime/db` with `"workspace:*"`. Use `zod` `^3.25.0`,
  `drizzle-orm` `^0.44.0`, `fastify` `^5.3.0` (as peer + dev dependency, only if the package has routes).

## The factory

Each package exports one factory that takes its dependencies and returns its service plus an `SrModule`:

```ts
export interface NotifyDeps { db: Db; config: NotifyConfig; queue?: JobQueuePort; log?: LoggerPort }
export function createNotify(deps: NotifyDeps) {
  const service = new NotifyService(deps);
  const module = defineModule({ id: "notify", routes: notifyRoutes(service) });
  return { service, module };
}
```

- **Packages never import another feature package.** Core and db only. If a module needs another
  module's behaviour, it declares a small *port* interface in its own code
  (e.g. auth declares `interface OtpSender { sendOtp(...): Promise<void> }`) and `apps/api/src/kit.ts`
  passes the concrete service in. This keeps modules swappable and independently testable.
- Config is passed in as a typed object. Packages never read `process.env`.

## Tenancy and data

- Tenant-scoped tables use `tenantId()` from `@srirealtime/db`, plus `pk()` and `...timestamps()`.
- **Every query on a tenant-scoped table filters by `tenant_id`.** Service methods take `tenantId` explicitly.
- Table names are snake_case and prefixed with the module id when ambiguous (`notify_templates`).
- Use `uuid` keys, `timestamp(..., { withTimezone: true })`, and `jsonb` for flexible config.

## HTTP

- The host mounts `module.routes` under `/v1/<id>`. Routes receive the request context at `req.ctx`
  (`tenant`, `user`, `locale`, `ip`, `userAgent`), filled by the tenancy and auth hooks.
- Validate bodies and queries with zod (`schema.parse(req.body)`); a thrown `ZodError` becomes a 400.
- Use `requireUser`, `requireTenant`, `requireRole`, `requireSuperAdmin` from core for access checks
  and the error helpers (`notFound()`, `forbidden()` ...) for failures. Never `reply.code(...)` by hand for errors.
- Respond with plain JSON objects. Lists are `{ items: [...] }`; lists that can grow use the paged shape in
  "Lists and tables" below (`{ items, total, limit, offset, facets? }`).

## Lists and tables

Every list that can grow (bills, orders, customers, products, tickets …) is paged, sorted and filtered **on the server**
with the helpers in `@srirealtime/core` (`packages/core/src/list.ts`). The UI side is in docs/web-modules.md →
"Lists and tables".

**The contract**

```
GET /v1/<module>/<things>?limit=25&offset=50&sort=-date&q=meena&status=paid,unpaid&from=2026-10-01&to=2026-10-31
→ 200 { items: [...], total: 1234, limit: 25, offset: 50, facets?: { status: { paid: 10, unpaid: 4 } } }
```

| Param | Meaning |
|---|---|
| `limit` | page size, default 25, max 100 (a route may raise both for existing callers, e.g. bills 50/200, orders 50/500) |
| `offset` | rows to skip |
| `sort` | **one** field: `total` ascending, `-total` descending (`total:desc` is also accepted). Unknown field → 400 `bad_request` with `details: { field: "sort", value, allowed: [...] }`. Nulls sort last either way; a unique tie-breaker (id) keeps pages stable |
| `q` | free-text search, trimmed, ≤ 100 chars; `%` and `_` match literally |
| filters | declared per route. Lists are comma-separated (`status=paid,unpaid`; repeated `?status=a&status=b` works too); dates are `YYYY-MM-DD` pairs `from`/`to` (inclusive, IST calendar days for timestamps); numbers `minTotal`/`maxTotal`; ids |

`total` is counted with the **same WHERE** (no ORDER BY / LIMIT, no joins the WHERE doesn't need), in parallel with the
page query. `facets` (optional) gives per-value counts of one filter under all the *other* filters, for the
"Status (12)" counts in the UI; compute it with a `group by` on the WHERE built without that filter.

**Helpers** (`@srirealtime/core`)

| Helper | Use |
|---|---|
| `listQuerySchema({ defaultLimit?, maxLimit?, maxSearch? })` | zod object with `q`, `limit`, `offset`, `sort` (raw); `.extend({...})` it with the route filters |
| `listFilter.oneOf(values)` / `.ids(max?)` / `.id()` / `.date()` / `.int(min?)` / `.bool()` | optional filter fields (`""` → undefined; lists split on commas) |
| `rangeOrder("from", "to")` | `.superRefine(...)`: `to` must not be before `from` |
| `defineSort(map, { default: "-date", tieBreaker: t.id \| [t.createdAt, t.id] })` | whitelist of sort keys → columns or `sql` expressions; `.orderBy(p.sort)` returns the ORDER BY list, `.parse()` resolves, `.keys` lists them |
| `searchAny(p.q, [t.number, sql\`${t.customer}->>'name'\`])` | ILIKE-contains ORed over columns/expressions (escaped); undefined for an empty `q` |
| `escapeLike(q)` / `likePattern(q)` | for hand-written LIKEs |
| `runList(p, { rows, count, map? })` | runs both queries in parallel → `{ items, total, limit, offset }` |
| `facetCounts(rows)` | `[{ key, n }]` → `{ key: n }` |
| `ListPage<T>` | the response type |

**Converting a list route (copy-paste)**

```ts
// service.ts
import { defineSort, facetCounts, listFilter, listQuerySchema, rangeOrder, runList, searchAny, type ListPage } from "@srirealtime/core";
import { and, count, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";

export const THING_STATUSES = ["open", "done", "void"] as const;

export const thingListQuerySchema = listQuerySchema()            // 25 / 100
  .extend({
    status: listFilter.oneOf(THING_STATUSES),                    // status=open,done
    customerId: listFilter.id(),
    from: listFilter.date(),
    to: listFilter.date(),
    minTotal: listFilter.int(),
  })
  .superRefine(rangeOrder("from", "to"));
export type ThingListQuery = z.input<typeof thingListQuerySchema>;

export const THING_SORT = defineSort(
  {
    number: things.number,
    date: things.date,
    customer: sql`lower(${things.customer}->>'name')`,
    total: things.total,
    status: things.status,
  },
  { default: "-date", tieBreaker: [things.createdAt, things.id] },
);

/** WHERE of the list; without `status` for the status facet counts. */
listConditions(tenantId: string, p: z.output<typeof thingListQuerySchema>, withStatus = true): SQL | undefined {
  return and(
    eq(things.tenantId, tenantId),                               // always
    withStatus && p.status?.length ? inArray(things.status, p.status) : undefined,
    p.customerId ? eq(things.customerId, p.customerId) : undefined,
    p.from ? gte(things.date, p.from) : undefined,
    p.to ? lte(things.date, p.to) : undefined,
    p.minTotal !== undefined ? gte(things.total, p.minTotal) : undefined,
    searchAny(p.q, [things.number, sql`${things.customer}->>'name'`, sql`${things.customer}->>'phone'`]),
  );
}

async list(tenantId: string, query: ThingListQuery = {}): Promise<ListPage<ThingSummary>> {
  const p = thingListQuerySchema.parse(query);                   // ZodError → 400
  const order = THING_SORT.orderBy(p.sort);                      // unknown sort → 400 with the allowed list
  const where = this.listConditions(tenantId, p);
  const [page, byStatus] = await Promise.all([
    runList(p, {
      rows: () => this.db.select({ /* summary columns only */ }).from(things).where(where).orderBy(...order).limit(p.limit).offset(p.offset),
      count: () => this.db.select({ total: count() }).from(things).where(where),
      map: (r) => toSummary(r),
    }),
    // optional facet counts
    this.db.select({ key: things.status, n: count() }).from(things).where(this.listConditions(tenantId, p, false)).groupBy(things.status),
  ]);
  return { ...page, facets: { status: facetCounts(byStatus) } };
}

// routes.ts — unchanged shape: pass the raw query through
staff.get("/", FEATURE, async (req) => service.list(requireTenant(req.ctx).id, req.query as ThingListQuery));
```

Rules:
- Sort keys are the client's names (`date`, `customer`, `balance`), never raw column names from the request. Derived
  values (balance = total − paid) sort by the same SQL expression the summary computes.
- Keep the `{ items }` contract: adding `total`/`limit`/`offset`/`facets` is fine; never rename `items`.
- Select summary columns only (no `lines` jsonb unless the row needs it).
- Unit-test the schema (limits, comma lists, bad values → ZodError), the WHERE (render with
  `db.select().from(t).where(...).toSQL()` on a never-connecting `createDb(...)`) and the sort map (unknown key throws
  `AppError` 400). See `packages/invoices/src/list.test.ts`.
- **Search indexes:** `%q%` ILIKE scans every row of the tenant. Fine for thousands of rows; past ~50k per tenant add
  `pg_trgm` GIN indexes on the searched expressions (`create index ... using gin (number gin_trgm_ops)`,
  `using gin ((customer->>'name') gin_trgm_ops)`) in a migration. Sorts on big tables want a
  `(tenant_id, <sort column>)` btree.

Converted so far: `GET /v1/invoices` (bills), `GET /v1/orders`.

## Errors and logging

- Throw `AppError` helpers from core. Unknown errors become a generic 500.
- Log through the injected logger port, never `console.log` (console drivers in dev mode are the exception).
