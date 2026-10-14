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
docs/
  CONVENTIONS.md   How a module package is structured — read before adding one
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
it in `apps/api/src/kit.ts`.
