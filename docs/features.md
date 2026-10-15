# Features: switching module capabilities on and off

Every module declares **features**. Whether a feature is on for a shop is decided at three levels, all of which must allow it:

```
enabled(feature, shop) =
     registered(feature)                      // some mounted module declares it
  && appAllows(shop.appId, feature)           // App profile, set by the platform owner (super-admin)
  && planAllows(shop.plan, feature)           // the shop's pricing plan
  && shopAllows(shop, feature)                // the shop owner's own switch (only for shopToggle features)
  && every dependsOn feature is enabled
```

## Feature keys

Key = `<moduleId>` for a module's base feature, `<moduleId>.<name>` for optional parts. Plans and app profiles hold a
list of grants:
- a feature key grants exactly that feature (`inventory` = stock tracking only, **not** purchases);
- `<moduleId>.*` grants every feature of the module, including features the module adds later;
- dependencies are not implied when resolving — they must be granted too (the profile editor and `PUT /apps/:appId`
  add them automatically).

Example: Ecommerce = `invoices`, `invoices.whatsapp`, `invoices.reports`, `invoices.gst-reports`, `inventory`, `payments`
(stock without purchases, no credit book, no reminders). Pro plan = `invoices.*`, `inventory.*`, `payments.*`.

```ts
// @srirealtime/core
interface FeatureDef {
  key: string;                 // "invoices.credit-book"
  module: string;              // "invoices"
  label: string;               // English label, e.g. "Credit book"
  description: string;
  dependsOn?: string[];        // e.g. ["invoices"]
  shopToggle?: boolean;        // shop owners may switch it off/on (default false)
  defaultOn?: boolean;         // shop-toggle default when the owner never touched it (default true)
}
interface SrModule { /* existing */ features?: FeatureDef[] }
```

Billing features (declared by their packages):

| key | label | depends on | shop toggle |
|---|---|---|---|
| `invoices` | GST bills | — | no |
| `invoices.whatsapp` | Send bills on WhatsApp/SMS | invoices | yes |
| `invoices.reminders` | Automatic payment reminders | invoices.whatsapp | yes |
| `invoices.credit-book` | Credit book (customer ledger, receipts, statements, credit limits) | invoices | yes |
| `invoices.reports` | Sales, payments and dues reports | invoices | no |
| `invoices.gst-reports` | GST reports (GSTR-1/3B summaries) | invoices.reports | no |
| `inventory` | Stock tracking | invoices | yes |
| `inventory.purchases` | Purchases and suppliers (with ITC) | inventory | yes |
| `payments` | Online payments (Razorpay) | — | yes |

## Server enforcement

Routes declare the feature they belong to in Fastify route config; the API host checks it:
```ts
app.get("/credit-book", { config: { feature: "invoices.credit-book" } }, handler)
```
- `config.feature` may be a string or an array (all required). Core augments `FastifyContextConfig` with `feature?: string | string[]`.
- The host adds one `preHandler` hook: when a route has `config.feature` and the request has a tenant, it calls
  `features.assert(tenant, keys)`. Errors: plan → `402 plan_limit` `{ feature, reason: "plan" }`; app or shop or dependency →
  `403 feature_disabled` `{ feature, reason: "app" | "shop" | "dependency" }`.
- Public routes (shared invoice links etc.) declare the feature too; they resolve the tenant from the token, so they call
  `assert` themselves through a `FeatureGatePort { isEnabled(tenantId, key): Promise<boolean> }` when needed (e.g. checkout
  refuses when `payments` is off for that shop).
- Background jobs (reminders) skip shops where the feature is off (via the same port).
- Plan **usage limits** (`invoices_per_month`) stay as they are.

`TenantRef` gains `appId: string | null` (tenancy fills it).

## `@srirealtime/features` API (`/v1/features`)

Tables: `app_profiles` (app_id text pk, name, features text[], timestamps), `tenant_feature_toggles` (tenant_id, feature, enabled,
updated_by, timestamps; pk (tenant_id, feature)).

```ts
type Reason = "app" | "plan" | "shop" | "dependency";
interface FeatureState { key; module; label; description; dependsOn: string[]; shopToggle: boolean;
  enabled: boolean; reason: Reason | null;          // why it's off (first failing level, in the order app → plan → dependency → shop)
  available: boolean;                                // app + plan + dependencies allow it (shop switch aside)
  shopEnabled: boolean | null }                      // the owner's switch (null = never touched, uses defaultOn)
```

- `GET /` (any request with a tenant; public) → `{ appId, planId, features: FeatureState[], enabled: string[] }`
- `PUT /toggles/:key` `{ enabled: boolean }` (owner/admin) → `FeatureState[]`. 400 if the feature isn't `shopToggle`; 402/403 if
  it isn't `available` and the owner tries to enable it.
- Super-admin:
  - `GET /registry` → `{ items: FeatureDef[] }` (every registered feature, grouped client-side by module)
  - `GET /apps` → `{ items: { appId, name, features: string[], tenantCount }[] }`
  - `PUT /apps/:appId` `{ name, features: string[] }` (validated against the registry; dependencies auto-added) → profile
  - `DELETE /apps/:appId`
  - `GET /tenants/:tenantId` → same shape as `GET /` for that tenant (to inspect a shop)

Resolution rules:
- No app profile for the shop's `appId` (or `appId` null) → the app level allows everything registered.
- Plan level uses the plans module: allowed if the plan's `modules` grants it (same rule as above), unless the plan's
  `features[key] === false`. No plan → the default plan (`free`).
- Cached per tenant for 60 s; invalidated on toggle, profile change, and plan change (`invalidate(tenantId?)`).

Seed (apps/api `pnpm seed`):
- App profiles: `BL` "Billing" = `invoices.*`, `inventory.*`, `payments.*`; `EC` "Ecommerce" = `invoices`, `invoices.whatsapp`, `invoices.reports`,
  `invoices.gst-reports`, `inventory`, `payments` (no credit book, reminders or purchases).
- Plans: free = `invoices`, `invoices.whatsapp`, `invoices.reports`; starter = free + `invoices.credit-book`, `invoices.gst-reports`,
  `inventory`, `payments`; pro/enterprise = `invoices.*`, `inventory.*`, `payments.*`.
- Demo shops: `raja` → pro, `kumar` → starter.

End-to-end shops (apps/api `pnpm --filter @srirealtime/api seed:e2e`, idempotent; development databases only):
- `e2e-bill` (BL, pro), `e2e-store` (EC, pro: the demo store catalogue, WELCOME10, delivery zones, published home, about
  page, menus, store settings) and `e2e-lite` (BL, starter, for plan checks). The e2e scripts in `apps/api/test/e2e` only
  write to these shops; `test:e2e:all` seeds them and runs `batch1.mjs`, `batch2.mjs` and `billing.mjs` in sequence, then
  the storefront browser test when the dev servers are up.
- Storefront browser test: `pnpm --filter @srirealtime/store test:e2e` (`apps/store/test/e2e.cjs`). Needs the api (:4000,
  test OTP on) and store (:3003) dev servers and Chrome (`CHROME_PATH`, default the Windows install path; puppeteer-core
  comes with `@srirealtime/documents`). It buys on `e2e-store.localhost:3003` as a fresh `+91 99990 xxxxx` shopper named
  "E2E Shopper …" (online + COD), checks the order lines add up to the charged prices, and screenshots each step into
  `SHOTS_DIR` (default `<tmp>/srikit-store-e2e`). Exits 2 (skipped) when a server is down; `test:e2e:all` reports that
  as SKIP. Its analytics anonymous id ends in `-e2e`.
- Owner `e2e-owner@example.com`. The e2e seed also makes this account a **super-admin** (needed for the custom-domain
  "force verify" step on `e2e-lite`), so never run seed:e2e against a shared or production database.
- Test identities sign in with a fixed dev OTP: API env `TEST_OTP_CODE` (e.g. 123456) and `TEST_OTP_TARGETS`
  (`+9199990*,e2e-*@example.com`). Matching targets get no message, skip the resend/hourly limits and accept the code;
  the API ignores both variables when `NODE_ENV=production` and logs a line at startup either way. Shoppers, cashiers and
  bill customers in the scripts use +91 9999 00xxxx.
- `pnpm --filter @srirealtime/api cleanup:e2e-data` (`-- --dry-run` to only count) removes what earlier e2e runs left in
  the demo shops (raja, kumar, anbu), found by the scripts' markers ("E2E " names, test phones, the billing smoke's fixed
  customers/supplier, "Test Shopper" storefront accounts of the old browser test with their orders, carts, addresses,
  reviews and review votes); issued bills and orders are cancelled, not deleted. See `apps/api/src/e2e-cleanup.ts`.

## Front end

`@srirealtime/web` gives every app `useFeatures()` / `useFeature(key)` / `<Feature when="invoices.credit-book">` backed by
`GET /v1/features`. UI modules declare a `feature` on every nav item, route and dashboard widget, and the host shell hides what
is off. A route whose feature is off shows an "Not available on your plan" (reason plan, with upgrade hint) or "Turned off"
(reason shop, with a link to Settings → Features for owners) page instead of the screen.
