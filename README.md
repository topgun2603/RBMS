# RBMS — shared module library

Reusable modules for every RBMS app (Ecommerce SaaS, Matrimony, LMS, School ERP, SiteBook, Tailoring,
Billing and the rest), built once and switched on per tenant and per plan. Module ids match the
[Module Catalogue](https://claude.ai/artifact/CfVyjYrEmtnqNqsH5F3Nf1).

## Stack

| Layer | Choice |
|---|---|
| Workspace | pnpm workspaces + Turborepo, TypeScript (strict) |
| API | Fastify 5 (`apps/api`), Zod validation |
| Data | Postgres + Drizzle ORM, Redis + BullMQ for jobs |
| Web | React 19, Next.js (App Router), shadcn/ui, Tailwind CSS v4, Framer Motion (`motion`) |
| Storage | Local disk in dev, S3 or Cloudflare R2 in production |
| Messaging | MSG91 (SMS), Resend (email), WhatsApp Cloud API, FCM (push) |

## Layout

```
apps/
  api/            Fastify host (:4000): wires modules together, mounts routes under /v1/<module>
  admin/          Next.js super-admin + tenant-admin panel (:3000, catalogue module "admin")
  billing/        Billing app (:3001): billing-ui at "/" + workspace-ui
  shop/           Ecommerce store admin (:3002): store dashboard, orders-ui, commerce-ui, site-ui, billing-ui at
                  "/billing", workspace-ui
  store/          Customer storefront (:3003, SSR): each shop on its subdomain (anbu.localhost:3003) or custom domain;
                  theme from storefront-ui. Browser test: test/e2e.cjs
  pharmacy/       Pharmacy app (:3006, app profile "PH"): medicine billing, counter, workspace (thunai.localhost:3006)
  restaurant/     Restaurant app (:3007, app profile "RS"): orders, menu, counter, billing at "/billing"
                  (arusuvai.localhost:3007)
  services/       Services app (:3008, app profile "SV"): appointments, job cards, memberships for salons, gyms,
                  repair shops, tailors and opticals (glow.localhost:3008)
packages/
  core/           Shared contracts: errors, request context, env loading, module definition, permissions
  db/             Drizzle client and column helpers
  auth/           Phone/email OTP, Google sign-in, sessions, roles
  tenancy/        Tenants, subdomains, custom domains, memberships
  branding/       Per-tenant logo, colours, fonts -> shadcn CSS variables
  plans/          SaaS plans, module gating, usage limits
  features/       Feature keys: app profile ∩ plan ∩ shop switch (docs/features.md)
  settings/       Layered settings: defaults < app < tenant < user
  notify/         SMS, email, WhatsApp, push behind one API, with templates
  uploads/        Signed uploads, thumbnails, S3/R2/local adapters
  jobs/           Queues, cron, retries (BullMQ, in-memory driver for dev)
  i18n/           Tamil and English messages, per-app and per-tenant overrides
  consent/        Consent records, data export, account deletion (DPDP Act, Play Store)
  gst/            Browser-safe GST maths (tax-inclusive lines exact to the paisa), GSTIN, states, numbering, UPI
  invoices/ inventory/ payments/ expenses/          Billing back end: bills, credit book, stock, purchases, payments
  catalogue/ orders/ coupons/ delivery/ storefront/ Commerce back end: products, orders, coupons, shipping, shoppers
  cms/ reviews/ analytics/ onboarding/              Online store: home/pages/menus/blog + SEO, reviews, store analytics
  staff/ audit/ documents/ importexport/            Team & roles (permissions), activity log, PDFs, CSV import/export
  ui/             Shared shadcn design system, layouts and motion primitives
  web/            Shared client kit + UI module system (API client, OTP login, i18n, features, permission gating,
                  app shell)
  billing-ui/     UI module: bills, customers, credit book, stock, purchases, expenses, reports
  orders-ui/      UI module: orders, coupons, delivery
  commerce-ui/    UI module: products, variants, categories, collections
  site-ui/        UI module: online store website (home editor, pages, menus, blog), store settings, reviews,
                  analytics, custom domain
  workspace-ui/   UI module every app mounts: team & roles, audit log, import/export, onboarding
  storefront-ui/  The shopper-facing store theme (server + client components) used by apps/store
  medicines/      Pharmacy back end: medicine details, batches + expiry sold first-expiry-first-out, prescriptions,
                  Schedule H1 register (docs/verticals.md)
  dining/         Restaurant back end: tables, running orders, KOTs per station, kitchen display feed, QR table
                  ordering, bills from orders (docs/verticals.md)
  pharmacy-ui/    UI module: batches & expiry, medicines, prescriptions, H1 register
  restaurant-ui/  UI module: floor, order screen, kitchen display, Settings → Restaurant
docs/
  CONVENTIONS.md     How a module package is structured — read before adding one
  web-modules.md     The front-end contract: UI modules any Next.js app can mount (features, permissions)
  features.md        Feature keys, app profiles, plans and shop switches; e2e shops and test data cleanup
  commerce-batch1.md / commerce-batch2.md   Commerce back-end design (batches 1 and 2)
  roadmap.md         Batches and their status
```

## Getting started

```bash
pnpm install
pnpm infra:up                      # Postgres + Redis in Docker
cp .env.example apps/api/.env
pnpm db:generate && pnpm db:migrate
pnpm dev                           # API :4000, admin :3000, billing :3001, shop :3002, store :3003,
                                   # pharmacy :3006, restaurant :3007
pnpm seed                          # demo shops: raja, kumar (billing), anbu (store), thunai (pharmacy, a demo store: `pnpm seed:stores thunai`),
                                   # arusuvai (restaurant)
```

Without provider keys, SMS/email/WhatsApp/push messages are printed to the API console, so OTP sign-in
works locally out of the box. Shops are addressed by subdomain in dev: `raja.localhost:3001`, `anbu.localhost:3002`
(store admin), `anbu.localhost:3003` (storefront).

Tests: `pnpm -r typecheck`, `pnpm -r test`; end to end (needs the dev servers): `pnpm --filter @srirealtime/api
test:e2e:all` (seeds the e2e shops e2e-bill / e2e-store / e2e-lite, runs the API scripts and the storefront browser test).
See docs/features.md "End-to-end shops".

## Adding a module

Follow [docs/CONVENTIONS.md](docs/CONVENTIONS.md): create `packages/<id>`, export a `create<Name>(deps)`
factory returning `{ service, module }`, declare ports for anything it needs from other modules, and wire
it in `apps/api/src/kit.ts`. For its screens, add a UI module next to it (below).

## Mounting billing in your app

Billing is a UI module (`@srirealtime/billing-ui`), not an app: any Next.js app built on `@srirealtime/web` can mount it
at any path, next to its own modules. Contract and details: [docs/web-modules.md](docs/web-modules.md).

```ts
// apps/<yours>/src/web-app.ts
import { billingModule } from "@srirealtime/billing-ui";
import { createWebApp } from "@srirealtime/web";
import { storeModule } from "./store/module";

export const webApp = createWebApp({
  appId: "EC",                                    // informational; the shop's app profile on the server decides
  name: "Store",
  tenant: { from: "hostname" },                   // anbu.localhost:3002 → shop "anbu" (or { from: "storage" })
  modules: [storeModule(), billingModule({ basePath: "/billing" })],
  home: "dashboard",                              // "/" shows every module's dashboard cards
});
```

```tsx
// apps/<yours>/src/app/[[...slug]]/page.tsx: one catch-all route serves every screen, /login, /settings/* and public links
"use client";
import { WebAppRouter } from "@srirealtime/web";
import { webApp } from "@/web-app";

export default function Page() {
  return <WebAppRouter app={webApp} />;
}
```

Then list `@srirealtime/web`, `@srirealtime/billing-ui`, `@srirealtime/ui`, `@srirealtime/i18n` and `@srirealtime/gst` in
`transpilePackages` (see `apps/shop/next.config.ts`), and let Tailwind scan the packages from your `globals.css`:

```css
@import "@srirealtime/ui/styles.css";
@source "../";
@source "../../../../packages/web/src";
@source "../../../../packages/billing-ui/src";
```

Switching billing features on and off needs no app code:
- **Per app** (platform owner): the app profile, e.g. `EC` has no credit book, reminders or purchases (Admin → Features).
- **Per plan**: what the shop's plan grants (`starter` has no reminders or purchases).
- **Per shop** (owner): Settings → Features inside the app switches the `shopToggle` features.
- **Per host app** (code, optional): `billingModule({ basePath: "/billing", features: ["invoices", "invoices.reports"] })`.

Nav items, pages, dashboard cards and buttons of a feature that is off disappear. Its URLs show "Not available on your
plan" or "Turned off" (with a link to Settings → Features for owners), or "not found" when the app doesn't include it.
The API enforces the same rules (docs/features.md).

