# srikit — @srirealtime shared module library

Reusable modules for every Srirealtime app (Ecommerce SaaS, Matrimony, LMS, School ERP, SiteBook, Tailoring,
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
  api/         Fastify host: wires modules together, mounts routes under /v1/<module>
  admin/       Next.js super-admin + tenant-admin panel (catalogue module "admin")
  billing/     Billing app (:3001): thin shell mounting @srirealtime/billing-ui at "/"
  shop/        Ecommerce store-admin demo (:3002): a store module + billing-ui at "/billing"
packages/
  core/        Shared contracts: errors, request context, env loading, module definition
  db/          Drizzle client and column helpers
  auth/        Phone/email OTP, Google sign-in, sessions, roles
  tenancy/     Tenants, subdomains, custom domains, memberships
  branding/    Per-tenant logo, colours, fonts -> shadcn CSS variables
  plans/       SaaS plans, module gating, usage limits
  settings/    Layered settings: defaults < app < tenant < user
  notify/      SMS, email, WhatsApp, push behind one API, with templates
  uploads/     Signed uploads, thumbnails, S3/R2/local adapters
  jobs/        Queues, cron, retries (BullMQ, in-memory driver for dev)
  i18n/        Tamil and English messages, per-app and per-tenant overrides
  consent/     Consent records, data export, account deletion (DPDP Act, Play Store)
  ui/          Shared shadcn design system, layouts and motion primitives
  web/         Shared client kit + UI module system (API client, OTP login, i18n, features, app shell)
  billing-ui/  The billing UI module: bills, customers, credit book, stock, purchases, reports
docs/
  CONVENTIONS.md   How a module package is structured — read before adding one
  web-modules.md   The front-end contract: UI modules any Next.js app can mount
  features.md      Feature keys, app profiles, plans and shop switches
```

## Getting started

```bash
pnpm install
pnpm infra:up                      # Postgres + Redis in Docker
cp .env.example apps/api/.env
pnpm db:generate && pnpm db:migrate
pnpm dev                           # API on :4000, admin on :3000
```

Without provider keys, SMS/email/WhatsApp/push messages are printed to the API console, so OTP sign-in
works locally out of the box.

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

