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
- Respond with plain JSON objects. Lists are `{ items: [...] }`.

## Errors and logging

- Throw `AppError` helpers from core. Unknown errors become a generic 500.
- Log through the injected logger port, never `console.log` (console drivers in dev mode are the exception).
