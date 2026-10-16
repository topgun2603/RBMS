# Batch 5 contract: sign-up, plan subscriptions, landing + pricing

Goal: a shop owner finds Srirealtime on the public site, picks Billing or Online Store and a plan, signs up with an OTP,
creates the shop, gets a 14-day trial of the chosen paid plan without a card, then pays monthly or yearly through
Razorpay Subscriptions (UPI Autopay or card mandate). Srirealtime (the platform) is the seller: platform invoices carry
its GSTIN with 18% GST. Everything follows docs/CONVENTIONS.md (module packages, ports, `kit.ts` wiring) and the
standing UI rules in docs/batch4.md (shadcn + Framer Motion, Field primitive, English + Tamil, no Hindi terms,
mobile-first, dark mode). Money is integer paise; dates are IST.

## Server

### `packages/subscriptions` (new module, id `subscriptions`, mounted at `/v1/subscriptions`)

Tables (platform-owned, keyed by `tenant_id`, but NOT behind tenant row filtering for super-admin reads):
- `subscriptions`: one current row per tenant (`unique(tenant_id)`). `planId`, `interval` (`monthly`|`yearly`),
  `status` (`trialing`|`active`|`past_due`|`cancelled`|`expired`), `trialEndsAt`, `currentPeriodStart`,
  `currentPeriodEnd`, `cancelAtPeriodEnd`, `graceEndsAt`, `provider` (`razorpay`|`mock`|`manual`),
  `providerSubscriptionId`, `providerPlanId`, `authUrl` (mandate short URL), `pendingPlanId`/`pendingInterval`
  (a downgrade that applies at period end), timestamps.
- `subscription_events`: provider webhook dedup (`provider`, `eventId` unique) + the raw payload.
- `platform_invoices`: `number` (series `SR/2026-27/00001`, financial-year reset), `tenantId`, `subscriptionId`,
  `planId`, `interval`, `periodStart`/`periodEnd`, `subtotalPaise`, GST split (`cgst`/`sgst` when the shop's state =
  the platform's state, else `igst`), `totalPaise`, `status` (`paid`|`void`), `providerPaymentId`, buyer details
  snapshot (shop legal name, GSTIN, state, address). GST maths with `@srirealtime/gst`.
- `provider_plans`: cache of Razorpay plan ids per (`planId`, `interval`, `amountPaise`) so a price change makes a new
  Razorpay plan.

Driver interface `SubscriptionProvider` (`createPlan`, `createSubscription` → `{id, shortUrl}`, `cancel(atCycleEnd)`,
`fetch`, `verifyWebhook`): a Razorpay implementation (`/v1/plans`, `/v1/subscriptions`, webhook HMAC) using the
**platform** account from env (`PLATFORM_RAZORPAY_KEY_ID`, `PLATFORM_RAZORPAY_KEY_SECRET`,
`PLATFORM_RAZORPAY_WEBHOOK_SECRET`) and a mock used when those are unset (outside production). The mock's
`shortUrl` points at the shop app's billing page with `?mockAuth=<subId>`; `POST /mock/authorize` completes it.

Ports: `plans` (get plan + price, list public), `tenancy` (get tenant, `setPlan`), `notify` (send to the owner),
`documents` (platform invoice PDF), `settings` (shop legal name, GSTIN, state, address for the invoice buyer).

Lifecycle rules:
- Sign-up with a paid plan → `trialing`, `trialEndsAt = now + 14 days`, tenant plan = the chosen plan. Free plan →
  `active` free, no provider. One trial per owner phone/email (the second shop starts without a trial).
- **Choose / change plan** while trialing: just updates the trial plan (no payment).
- **Pay** (`POST /checkout {planId, interval}`): creates the provider subscription (start at trial end if still
  trialing, else now) and returns `{authUrl}`; the UI opens it. Webhooks: `subscription.authenticated` /
  `subscription.activated` → `active`; `subscription.charged` → new period + a `platform_invoices` row (paid) + PDF +
  email; `payment.failed` / `subscription.pending` → `past_due`, `graceEndsAt = now + 7 days`;
  `subscription.halted` / `cancelled` / `completed` → handled per rules below.
- **Upgrade** while active: cancel the old provider subscription, create a new one starting now, prorated credit is
  out of scope (note it), plan applies immediately. **Downgrade**: stored as pending, applies at period end.
- **Cancel**: `cancelAtPeriodEnd = true` (provider cancel at cycle end); at period end → `cancelled` → tenant plan =
  `free`. **Resume** before the end clears it.
- Daily job `subscriptions.lifecycle` (09:00 IST): trial reminders at 3 days and 1 day before `trialEndsAt`; trial end
  without an authorised mandate → `expired`, tenant plan `free`; past_due past `graceEndsAt` → `expired`, plan
  `free`; apply pending downgrades at period end; renewal reminder 3 days before a yearly renewal. Every transition is
  idempotent and audited. Downgrading never deletes data: plan limits/features simply stop new use (existing 402 and
  feature gates).
- Notify templates (global, `tenantId: null`, English + Tamil): `subscription.trial_ending`,
  `subscription.trial_ended`, `subscription.activated`, `subscription.charged` (with the invoice PDF attached),
  `subscription.payment_failed`, `subscription.expired`, `subscription.cancelled`, `subscription.renewal_reminder`.

Routes:
- Shop owner/admin (tenant context, permission `subscriptions.manage`, granted to owner/admin only):
  `GET /current` → `{subscription, plan, trialDaysLeft, usage, canTrial}`; `POST /change {planId, interval}`;
  `POST /checkout {planId, interval}` → `{authUrl}`; `POST /cancel`; `POST /resume`; `GET /invoices`;
  `GET /invoices/:id.pdf`.
- Public: `POST /webhooks/razorpay` (raw body, signature check, dedup). `POST /mock/authorize {subscriptionId}` and
  `POST /mock/charge {subscriptionId}` / `POST /mock/fail` (non-production only, for tests).
- Super-admin: `GET /admin/subscriptions?status=&q=` (with shop name, plan, MRR contribution), `GET /admin/stats`
  (MRR, ARR, active, trialing, past_due, churned last 30 days, trial conversion), `POST /admin/:tenantId/extend-trial
  {days}`, `POST /admin/:tenantId/comp {planId, until}` (provider `manual`, no charge), `GET /admin/invoices`,
  `POST /admin/invoices/:id/void`.

### Sign-up (`packages/tenancy` + `packages/auth` + kit wiring)
- `GET /v1/tenancy/slug-available?slug=` (public, rate-limited): `{available, reason?, suggestions[]}` using
  `validateSlug`; suggestions add the city/area or a number.
- `POST /v1/signup` (signed-in user, the OTP session from the landing site): `{shopName, slug, appId: "BL"|"EC",
  planId, interval, businessType?, state, gstin?, phone?}` → creates the tenant (owner membership) and the
  subscription in one go, then runs an **on-tenant-created hook** list (new `TenancyService` hook, wired in `kit.ts`):
  seed default settings (business name, state, invoice series), branding colour, onboarding checklist, plans
  usage, the subscription. Returns `{tenant, appUrl, handoff}`.
- **Login handoff** across origins (the landing site and the shop/billing apps are different origins, so the token in
  localStorage does not carry over): `POST /v1/auth/handoff` (signed in) → single-use code, 60 s TTL, bound to the
  user; `POST /v1/auth/handoff/redeem {code}` → `{token, user}`. The web kit login page accepts `?handoff=<code>`,
  redeems it and lands on the dashboard.
- Make the web kit's reserved slug list match `packages/tenancy` (`RESERVED_SLUGS`, 3–40 chars), exported from one
  place.

### E2E
`apps/api/test/e2e/batch5.mjs` (wired into `run-all.mjs`): slug check, sign-up on an `e2e-*` slug (cleaned by
`cleanup:e2e-data`), trial state, change plan in trial, checkout → mock authorise → active, mock charge → platform
invoice with correct GST (intra- and inter-state), payment failure → past_due → grace expiry (via the job with a
clock override) → free, downgrade pending → applied, cancel/resume, a 402 on a free-plan limit after expiry,
super-admin stats, handoff redeem single-use. Webhook signature rejected when wrong.

### As built (server): routes, shapes and deviations
Read this together with the contract above; where they differ, this section is what the API does. Dates are ISO
strings, money integer paise (plan prices GST-exclusive; provider charges and invoice totals include 18% GST).

**Subscription object** (`subscription` below): `{ id, tenantId, planId, interval, status, trialStartedAt,
trialEndsAt, currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd, graceEndsAt, provider ("razorpay" | "mock" |
"manual" | null for free), providerSubscriptionId, authUrl, checkoutPlanId, checkoutInterval, pendingPlanId,
pendingInterval, createdAt, updatedAt }`. `authUrl` is set while a mandate waits for authorisation and cleared once
authorised (so "has a mandate" = `providerSubscriptionId && !authUrl`). Errors are the usual
`{ error: { code, message, details } }`.

Shop routes (`/v1/subscriptions`, tenant + `subscriptions.manage`; owners/admins always pass, no built-in staff role
has it; no `config.feature`, so the page works on every plan and app):
- `GET /current` → `{ subscription, plan, pendingPlan, trialDaysLeft (trialing only, else null), graceDaysLeft
  (past_due only, else null), usage: [{ key, period, limit, used, remaining }], canTrial }`. Shops without a row
  (older shops) get one on first call: their plan as `active` `manual` (paid) or free.
- `POST /change { planId, interval }` → `{ subscription, applied: "now" | "period_end" | "none", authUrl,
  requiresCheckout }`.
  - Trialing: switches the trial plan now (any unauthorised mandate is dropped).
  - Active paid (razorpay/mock): an upgrade creates a new mandate starting now, applies the plan now, starts a new
    period, and returns `authUrl`. Prorated credit for the old period is out of scope. A downgrade (or a move to
    free) is stored as `pendingPlanId` and applied at the period end. Same plan monthly → yearly is an upgrade;
    yearly → monthly is a downgrade.
  - Free, manual or ended: if this owner never had a trial, a 14-day trial of the plan starts (`applied: "now"`).
    Otherwise `requiresCheckout: true` and nothing changes; call `/checkout`.
- `POST /checkout { planId, interval }` → `{ authUrl, providerSubscriptionId, provider, subscription }`. While
  trialing, the mandate starts at the trial end and the trial plan becomes `planId`. 409 `conflict` when that exact
  plan is already paid.
- `POST /cancel` → `{ subscription }`.
  - Trial: ends at the trial end as `cancelled`.
  - Active: sets `cancelAtPeriodEnd` (the provider cancels at the cycle end).
  - Past due, or manual without an end: cancelled now.
  - Free: 400.
- `POST /resume` → `{ subscription, authUrl }`. This clears a scheduled cancel or downgrade. A Razorpay subscription
  set to cancel at the cycle end can't be revived, so resuming a cancel creates a new mandate starting at the period
  end and returns its `authUrl`.
- `GET /invoices` → `{ items: PlatformInvoice[] }`.
- `GET /invoices/:id.pdf` → the PDF (A4 tax invoice; "Bill of supply" while `PLATFORM_GSTIN` is unset).
- `PlatformInvoice`: `{ id, number ("SR/2026-27/00001"), fy, seq, tenantId, subscriptionId, planId, interval,
  periodStart, periodEnd, date (IST YYYY-MM-DD), placeOfSupply, gstRate, subtotalPaise, cgstPaise, sgstPaise,
  igstPaise, totalPaise, status ("paid" | "void"), provider, providerPaymentId, buyer { legalName, gstin, stateCode,
  address }, seller {…}, voidedAt, voidReason, createdAt, updatedAt }`.

Lifecycle details beyond the contract:
- Mandate authorised while trialing → `active` at once, with the period starting at the trial end (the first charge
  happens then).
- Sign-up with a paid plan when the owner already had a trial → the shop starts `active` on **free**
  (`trial: false`); paying is `/checkout`.
- The job also:
  - moves an active paid subscription to `past_due` (7 days' grace) when its period ended a day ago without a
    renewal charge;
  - expires a comp (`manual` with an end date) at its end.
- Notifications go to every owner/admin by email (the charged one with the invoice PDF attached) and WhatsApp, in
  the user's language. They are logged with `tenantId: null`. The template variables are `shop`, `plan`,
  `interval`, `amount`, `date`, `days`, `grace`, `number` and `link` (the shop's Plan & billing page).

Provider:
- `SubscriptionProvider` has an optional `changePlan(id, providerPlanId)`. Razorpay implements it as
  `PATCH /v1/subscriptions/:id` with `schedule_change_at: "cycle_end"`; downgrades between paid plans use it.
- The mock's `authUrl` is `<shop app>/settings/plan?mockAuth=<providerSubscriptionId>`.
- Public mock routes (non-production): `POST /mock/authorize`, `/mock/charge { subscriptionId, amountPaise? }` and
  `/mock/fail`. Each returns `{ ok, duplicate, outcome, subscription }`; `/mock/charge` also returns `invoice`.
- `POST /mock/lifecycle { tenantId, now? }` (super-admin, non-production) runs the daily job for one shop with a
  clock override.
- Webhooks:
  - `POST /webhooks/razorpay` returns `{ ok, duplicate, outcome }`, or 400 `invalid_signature`.
  - Dedup uses `x-razorpay-event-id`.
  - The mock verifies with the development secret `mock_webhook_secret`.

Super-admin:
- `GET /admin/subscriptions?status=&q=&limit=&offset=` → `{ items: [subscription + { tenant { id, slug, name,
  appId, status }, plan { id, name }, mrrPaise }], total }`.
- `GET /admin/stats` → `{ mrrPaise, arrPaise, active, trialing, pastDue, cancelled, expired, free, comp, churned30d,
  trialsEnded, trialsConverted, trialConversion (0–1 or null), total }`.
  - MRR counts only razorpay/mock subscriptions with an authorised mandate (active or past due), GST-exclusive;
    yearly plans count as 1/12.
  - `active` excludes free and comped (manual) subscriptions.
  - Churn = paid subscriptions that ended in the last 30 days.
- `POST /admin/:tenantId/extend-trial { days }` → `{ subscription }`. It extends a running trial, or re-opens a
  trial of the shop's paid plan for an expired, cancelled, free or manual shop.
- `POST /admin/:tenantId/comp { planId, until: ISO date | null }` → `{ subscription }`.
- `GET /admin/invoices?status=&tenantId=&q=` → `{ items: [PlatformInvoice + tenant { id, slug, name }], total }`.
- `GET /admin/invoices/:id.pdf` (added).
- `POST /admin/invoices/:id/void { reason? }` → the invoice.

Sign-up and tenancy:
- `GET /v1/tenancy/slug-available?slug=&city=` (or `area=`) → `{ slug, available, code?: "taken" | "length" |
  "format" | "reserved", reason?, suggestions }`. It returns up to 4 free suggestions and allows 60 requests a
  minute per IP.
- `POST /v1/signup` → `{ tenant { id, slug, name, appId, status, planId }, appUrl, handoff { code, expiresAt,
  expiresInSeconds }, loginUrl, subscription { status, planId, interval, trialEndsAt }, trial }`.
  - `state` is a 2-digit GST code. `gstin` must be valid and match `state`.
  - Errors:
    - 409 `slug_taken` or 400 `invalid_slug`, with `details { field: "slug", suggestions }`.
    - 400 with `details.field` for `gstin`, `state` or `planId` (a public plan is required).
    - 429 after 5 shops an hour per user.
  - `appUrl` comes from env `APP_PUBLIC_URL` (BL → :3001, EC → :3002).
- On-tenant-created hooks (`TenancyService.onTenantCreated`, run after every `create`; a failing hook is logged and
  the shop stays):
  - `defaults`:
    - billing: `legalName`, `stateCode`, `gstin`, `phone`;
    - general: `businessName`, `supportPhone`, `gstin`;
    - store contact phone (EC);
    - branding `appName` and a colour by business type;
    - tenant `metadata.signup`.
  - `subscription`: a trial or free, for sign-ups only.
- `POST /v1/auth/handoff { tenantId? }` → `{ code, expiresAt, expiresInSeconds }`. With `tenantId` (a shop the user
  belongs to, else 404) the response also has `appUrl` and `url` (`<appUrl>/login?handoff=<code>`).
- `POST /v1/auth/handoff/redeem { code }` → `{ token, expiresAt, user, isNewUser }`, or 400 `invalid_handoff`.
- Reserved slugs: `RESERVED_SLUGS` / `validateSlug` / `slugify` / `slugCandidates` live in
  `@srirealtime/tenancy/slug`, which is browser-safe. The web kit re-exports `RESERVED_SLUGS` and `validateSlug`.
  The list grew to include `signup`, `login`, `pricing`, `billing`, `store`, `shop` and more.

Env (apps/api):
- `PLATFORM_RAZORPAY_KEY_ID`, `PLATFORM_RAZORPAY_KEY_SECRET`, `PLATFORM_RAZORPAY_WEBHOOK_SECRET`: all three or none.
  With none, development uses the mock and production answers 503 on checkout.
- `PLATFORM_LEGAL_NAME` (default "Srirealtime"), `PLATFORM_GSTIN`, `PLATFORM_STATE_CODE` (default 33) and
  `PLATFORM_ADDRESS`.
- `PLATFORM_INVOICE_PREFIX` (default SR).
- `WWW_PUBLIC_URL` (default http://localhost:3005).
- `APP_PUBLIC_URL` (default `BL=http://{slug}.localhost:3001,EC=http://{slug}.localhost:3002`).

## UI

### `apps/www` (new, port 3005, the root host `localhost:3005`; in production the apex domain)
Public marketing site, server-rendered, SEO (metadata, OpenGraph, JSON-LD `Organization` + `Product`/`Offer` on
pricing, sitemap, robots), English + Tamil (language switch, `?lang=` / cookie), shadcn + Framer Motion, fast.
- `/` landing: hero for Tamil Nadu shops ("Billing and online store for your shop"), the two products (Billing,
  Online Store) with screenshots/illustrations, feature grid (GST bills, credit book, WhatsApp, POS, inventory,
  online store, loyalty, reports), how it works (3 steps), testimonials placeholder, FAQ, CTA.
- `/billing` and `/online-store` product pages.
- `/pricing`: plans from `GET /v1/plans` (monthly/yearly toggle with the yearly saving, GST-exclusive prices noted),
  plan comparison table generated from plan modules/limits, FAQ, "Start 14-day free trial" per plan.
- `/signup`: wizard — 1) what you need (Billing / Online Store), 2) phone or email OTP, 3) shop details (name, live
  slug availability with suggestions, state, business type, optional GSTIN), 4) plan + interval (pre-selected from
  pricing), 5) creating your shop (animated) → redirect to `<slug>.<app host>/login?handoff=<code>`.
- `/login`: "Open my shop" — OTP, then list the user's shops (`GET /v1/auth/me` tenant roles) with links via handoff.
- Legal pages: `/terms`, `/privacy`, `/refunds` (placeholder text, clearly marked).

### Shop side (`packages/workspace-ui` + web kit)
- **Settings → Plan & billing** (`subscriptions.manage`): current plan + status, trial days left (progress), usage vs
  limits (meters), plan cards to change (upgrade now / downgrade at period end, interval toggle), "Add payment
  method"/"Pay now" → opens `authUrl` (mock: an in-app authorise dialog when `?mockAuth=`), cancel/resume, invoices
  list with PDF download.
- Web kit: a slim **trial / past-due banner** in the shell for owners/admins (days left, "Choose plan" link; red when
  past_due with grace days), and a global handler for 402 `plan_limit` / feature `plan` errors that shows an
  **upgrade dialog** (limit name, used/limit, plan that unlocks it, link to Plan & billing).
- Web kit login page: `?handoff=` redeem.

### `apps/admin` (super-admin)
- **Platform → Subscriptions**: stats tiles (MRR, ARR, active, trialing, past due, churn, trial conversion), list
  with status filters/search, row actions: extend trial, comp plan, open shop; **Platform invoices** list with void
  + PDF.
