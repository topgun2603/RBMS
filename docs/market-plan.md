# Market plan: every trade, and mobile apps

Drafted 2026-10-20. Goal: **no shop is turned away.** Any business that signs up gets a setup that fits it, the trades
we don't cover yet are recorded so we know what to build next, and shops and their customers get mobile apps.

Five tracks, run as two lanes in parallel: web + back end (tracks A, B, C, E) and mobile (track D, then F).

| Track | What | Batches |
|---|---|---|
| A | Never say no: general packs, typed-trade capture, grouped picker, 30 new packs | 8, 9 |
| B | Small engine changes that unlock more trades | 10 |
| C | New verticals for big markets | 12, 13, 14 |
| D | Flutter apps: srikit Business, then srikit Shops | M0–M4 |
| E | Market levers: import from other software, more languages, printing, open items | 11 |
| F | White-label branded apps for top-plan shops | after M4 |

**Before batch 8:** commit the home-sections work now in the tree (`packages/verticals/src/starter.ts`, cms, site-ui,
storefront-ui). Batch 8 edits the same files.

## Track A: never say no

### Batch 8: nobody bounces (1–2 weeks)

Today an unknown trade (`packFor("other")` → `null`) falls back to the app's default pack, so a lodge that signs up on
EC gets a clothing store. Fix that and capture demand:

- **General packs:** `general_shop` (EC), `general_counter` (BL), `general_services` (SV), with neutral words ("Our
  products", "Order now", "Book now") and a neutral preset. `DEFAULT_PACK_FOR_APP` points EC / BL / SV at them; PH and RS
  keep pharmacy and restaurant because the app itself sets the trade.
- **Typed trade:** sign-up and Settings → Appearance keep what the owner typed in `store` settings `businessLabel` (free
  text, private), even when it maps to a pack.
- **Demand list:** Platform → Solutions gets a "Not covered" tab (`GET /v1/solutions/demand`): typed labels on general
  packs, counted and grouped (lower-cased, trimmed). This decides what we build next.
- **Aliases:** many more entries in `ALIASES` (lodge, tuition, milk, dairy, xerox, driving school, florist, footwear,
  stationery…), each to the nearest pack, or to a general pack until the trade has its own.
- **Grouped, searchable picker:** a `group` field on `BusinessPack` (food, retail, health, services, education, auto,
  building, general). Sign-up and Appearance show groups with search and a last option "Not listed: tell us" (general
  pack + typed label). One shared picker component.
- Tests: `packs.test.ts` drops the fixed count of 15 and checks groups; aliases resolve; unknown → general pack.

**Done when:** a sign-up with any trade text lands on a sensible pack, and the admin sees the demand list.

### Batch 9: 30 new packs (2 weeks, three sets of 10)

Pure data in `packs.ts` + `starter.ts` (layout, services, FAQ, hours), English + Tamil, using engines we already have.

| Group | Pack ids (app) |
|---|---|
| Retail | `footwear`, `stationery`, `gifts_toys`, `cosmetics`, `organic`, `florist_pooja`, `crackers`, `sports`, `pet_shop`, `furniture`, `textiles_wholesale` (EC) |
| Food | `tea_stall` (RS, counter-first, QR ordering off), `catering` (SV, bookings + quotations) |
| Services | `spa`, `pet_grooming`, `photo_studio`, `laundry`, `event_decor`, `ac_service` (SV); `print_shop` (BL) |
| Education | `tuition`, `dance_music`, `yoga`, `driving_school` (SV, memberships with sessions + bookings) |
| Building | `paints`, `electricals`, `tiles_sanitary` (BL) |

Plus the three general packs from batch 8: 48 packs in all. Each gets a solution preset (`off` lists) so, for example,
a tuition centre doesn't see job cards. Laundry, AC service and tiles start on today's engines and get their proper
features in batch 10.

**Done when:** all 45+ packs pass the pack and starter tests, and each one has a demo shop render checked on the
storefront.

## Track B: small engine changes

### Batch 10: engines that unlock trades (3 weeks)

- **Job-card templates** (`packages/jobcards/src/templates.ts`):
  - `vehicle`: registration no., km reading, fuel level, service type; a service reminder after N months or N km.
  - `laundry`: garment count by type, tag numbers, pickup / drop through `delivery`.
  - `appliance`: site visit with address and slot, AMC (annual maintenance contract) number.
- **Area units:** sq ft / sq m with box coverage (one box = 15.5 sq ft) in catalogue + inventory, beside the scales
  quantity logic; the counter and the storefront sell by area and stock moves by box.
- **Batches engine:** take batch, expiry and FEFO (first-expiry-first-out) out of `medicines` into `@srirealtime/batches`.
  `medicines` keeps schedules, prescriptions and the H1 register on top of it. Grocery, bakery and cosmetics can turn it
  on. Migration moves `medicine_batches` without losing history.
- **Shoe size chart:** `sizeGuide: boolean` becomes `sizeGuide: "clothing" | "shoes" | null`.
- **Notifications for the service engines:** wire `NotifyPort` / `ReminderPort` to WhatsApp and SMS templates for
  booking confirmed, job ready, membership expiring (daily job on `memberships.service.remindAllExpiring`).
- New packs on top: `two_wheeler_service`, `car_service` (SV, vehicle template), `agri_inputs` (BL, batches + dealer
  licence no. on the bill), `auto_parts` (BL, part no. and fits-vehicle attributes).

**Done when:** each engine has unit tests and an e2e case, and the four new packs are live.

## Track C: new verticals

Each is a back-end package + UI module, same contract as the others (docs/web-modules.md), and mobile screens in M2+.

| Batch | Vertical | Package | Covers | Size |
|---|---|---|---|---|
| 12 | **Daily subscriptions** | `@srirealtime/standing-orders` | milk, water cans, newspapers, tiffin: delivery days, pause / skip, route sheet for the delivery boy, monthly bill with running balance | 3–4 wk |
| 13 | **Wholesale / distributor** | `@srirealtime/wholesale` | price tiers per customer, credit limits, beat (route) plans for salesmen, schemes (buy 10 get 1), collections; retailers on srikit order through `marketplace` | 4 wk |
| 14 | **Lodges & homestays** | `@srirealtime/stays` | rooms, rates, check-in / out, guest ID through `kyc`, restaurant bills charged to the room through `dining` | 3 wk |
| 14 | **Clinics & labs** | `@srirealtime/clinic` | patients, consultations through `bookings`, test orders, sample collection, PDF reports through `documents`, prescriptions shared with `medicines` | 4 wk |
| 14+ | **Rentals** | `@srirealtime/rentals` | availability by date, deposit, late fees, return condition | 3 wk |

## Track D: Flutter apps

**Under the srikit Play / App Store account:** srikit Business (owners and staff, every trade) and srikit Shops (one
customer app for every shop). No per-shop apps on our account: Google Play's repetitive-content policy and Apple 4.2.6
both forbid a template service publishing apps for its clients, and one strike could take down the account. Branded
apps for shops are track F.

The API is already mobile-friendly: Bearer tokens, `x-tenant` for shop switching, `POST /v1/auth/firebase` for native
phone sign-in, and features / permissions decided on the server.

Repo layout (Dart workspace managed with Melos, its own CI job):

```
apps/mobile_business      srikit Business
apps/mobile_shops         srikit Shops (and the white-label template, track F)
dart/srikit_api           generated API client
dart/srikit_theme         theme generated from @srirealtime/branding tokens
dart/srikit_l10n          ARB files generated from the web message files
dart/srikit_kit           shared widgets, auth, shop switcher, feature / permission gates
```

### M0: back end ready for mobile (2 weeks)

- **Typed API document:** `packages/developer/src/openapi.ts` has no request / response schemas today. Generate them
  from the routes' zod schemas, then generate `srikit_api` (Dart) in CI. A schema change that breaks the client fails CI.
- **Devices and push:** `devices` table (user, tenant, FCM token, platform, app version); `POST /v1/devices`; push as a
  `notify` channel. The kitchen display and new-order alerts move from polling to push.
- **Mobile sessions:** refresh tokens with device binding and per-device sign-out; `GET /v1/app/config` returns the
  minimum app version (forced update) and feature flags.
- **Idempotency:** an `Idempotency-Key` header on creating bills, payments and orders (needed for M3, safe to add now).
- **Theme and words:** scripts that turn the brand tokens and message files into `srikit_theme` and `srikit_l10n`.

**M0 status (2026-10-20):**
- Done: push already existed (`push_tokens`, FCM driver, `POST/DELETE /v1/notify/push-tokens`).
- Done: long mobile sessions. Sign-ins with `x-client: srikit-<app>/<version> (<platform>)` get 90-day sessions that
  slide with use (`MOBILE_SESSION_TTL_DAYS`); `auth_sessions.client` records the app.
- Done: `GET /v1/mobile/config` and forced updates (426 `app_update_required` below `MOBILE_MIN_VERSIONS`;
  `MOBILE_LATEST_VERSIONS` for the update banner), in `apps/api/src/kit-mobile.ts`.
- Done: `Idempotency-Key` on signed-in writes (`@srirealtime/idempotency`, table `idempotency_keys`, migration
  `0019_mobile`).
- Done: typed API document. `documented({ body, query, response })` (core) on a route puts its JSON Schemas in
  `/v1/developer/openapi.json`; `pnpm --filter @srirealtime/api openapi -- --typed` writes only the typed operations.
  Typed so far: auth config / OTP / Firebase / me / logout, tenancy mine / current, features (full `FeatureState`),
  branding, invoices summary, push tokens, mobile config, and the counter-billing set (catalogue variant search and
  barcode / SKU lookup, `counter/resolve`, billing items, bill list / create / get / issue / payments / cancel / share /
  send, customers list / get / create, till current / open / cash / X report / close), products and stock (catalogue
  categories list, products list / get / create / update / archive, variant add / update / delete; inventory stock
  list with the low-stock filter, one item, adjust add / remove / set, reorder level and tracking, movements, summary,
  locations), orders (list, summary, manual create, get, status, notes, payments, refunds, fulfillment, invoice
  retry), the credit book (`credit-book`, customer update, ledger, receipts, statement link, reminder) and expenses
  (list / get / create / update / cancel, summary, categories list / create / update / delete). Response schemas are
  checked against real route answers in `api-schemas.db.test.ts` tests in invoices, catalogue, inventory, orders and
  expenses (each runs with `<PACKAGE>_TEST_DATABASE_URL`, e.g. `INVOICES_TEST_DATABASE_URL`). Each M1 screen adds
  schemas to the routes it calls.
- Done: Flutter workspace (`apps/mobile_business`, `dart/srikit_api`, `dart/srikit_theme`, `dart/srikit_kit`,
  `scripts/mobile/gen-theme.mjs`): OTP sign-in, shop picker, branded home with the dashboard summary, feature-gated
  tabs, English + Tamil. Firebase phone sign-in and FCM are stubbed behind interfaces until the Firebase project files
  exist.
- Open: Dart client generation from the typed document (hand-written models checked against it for now), the CI job
  for the Dart packages, real Firebase / FCM config.

### M1: srikit Business v1 (6–8 weeks)

Sign-in (Firebase phone), shop switcher, dashboard, **counter billing** with camera barcode scan and Bluetooth thermal
printing, bill share on WhatsApp, products and stock, orders with push alerts, customers and credit book, expenses,
basic reports, settings that matter on a phone. English + Tamil. Android first; iOS from the same code once Android is
stable. Every screen is gated by the same feature and permission keys as the web.

### M2: trade screens (4–6 weeks)

Waiter (tables, KOTs) and kitchen display; appointments calendar; job cards with photos; membership check-in by QR;
pharmacy batches and expiry; weighing scales over Bluetooth; IMEI scan; today's gold rate. Then standing-orders
route sheets (batch 12) and wholesale beat sales (batch 13) as they land.

### M3: offline billing (3–4 weeks)

Local database (SQLite through drift), a bill number series per device, a sync queue using the M0 idempotency keys,
and rules for stock after sync (sales are never blocked offline; stock can go negative and is flagged for review).
Prices and items cached on the phone, refreshed when online.

Web counter first (2026-10-24, docs/offline-billing.md): the same rules are built for the web POS (IndexedDB queue,
reserved number blocks of the real series, idempotent sync, flags for review). The Flutter app can reuse the server side
as is (`/v1/pos/offline/*`); only the local database and screens remain.

### M4: srikit Shops (6 weeks)

The customer app over `storefront` + `marketplace`: nearby shops, search, cart and checkout, bookings, job and order
tracking, loyalty, chat. Each shop's page uses that shop's theme. The web storefronts stay, and each one already installs
as its own home-screen web app (PWA, done 2026-10): a per-shop manifest with the shop's name, logo or lettermark icon and
brand colours, an "Install <shop> app" banner on Android / Chrome and "Share → Add to Home Screen" steps on iPhone (the
owner can switch the banner off), and a service worker that keeps build files, fonts and product images cached and shows
a shop-branded offline page (cart, checkout and account pages are never cached). Details: docs/commerce-batch2.md §6.

## Track E: market levers

### Batch 11: switch-over and reach (2–3 weeks)

- **Import from other software** in one click, on top of `importexport`: Tally (XML), Vyapar and Khatabook exports,
  Excel / CSV for items, customers with balances, and opening stock. This makes it easy for shops to move to srikit.
- **More languages:** pack copy goes from `{ en, ta }` to one entry per locale. Add Hindi, Telugu, Kannada, Malayalam
  (one at a time, starting with whichever the demand list shows first).
- **Printing:** thermal bill and KOT slips from the web (QZ Tray or the browser print dialog) and the "print bill at
  table" button.
- **Open items from docs/verticals.md:** push for the kitchen display (done in M0), recipes and raw-material stock for
  restaurants, batch choice at the pharmacy counter, the serial number field in the billing app's bill editor, the
  shared plan ids in `batch5.mjs`, Terraform for the new apps, plan add-ons (extra branches, WhatsApp credits).

## Track F: branded apps for top-plan shops (after M4)

The Shopify + Tapcart way:

- Only on pro / enterprise plans. The shop opens its own Play Console account (and Apple account if they want iOS)
  and invites us as admin. Their account fees and our setup charge are part of the plan price.
- One Flutter template (`apps/mobile_shops` in single-shop mode). A build only changes the name, icon, colours and shop
  id; everything else is loaded from the API at start-up.
- A build pipeline (fastlane + Codemagic or GitHub Actions) builds, signs and uploads every branded app, so 100 apps
  are not 100 times the work.
- Each store listing gets its own screenshots and text from that shop's data, so the apps don't look repetitive.
- Every other shop gets its web storefront plus a listing in srikit Shops.

## Order of work

Two lanes, weeks from the start of batch 8:

| Weeks | Web + back end | Mobile |
|---|---|---|
| 1–2 | Batch 8: general packs, typed trade, picker, aliases | M0: API schemas, Dart client, devices + push, mobile sessions |
| 3–4 | Batch 9: 30 packs | M1 starts |
| 5–7 | Batch 10: templates, area units, batches engine, notifications, 4 packs | M1 |
| 8–10 | Batch 11: import, languages, printing, open items | M1 ends: Android beta to demo shops |
| 11–14 | Batch 12: daily subscriptions | M2: trade screens |
| 15–18 | Batch 13: wholesale | M3: offline billing |
| 19–24 | Batch 14: lodges, clinics, rentals | M4: srikit Shops |
| 25+ | Next trades from the demand list | Track F: branded apps |

The sizes assume today's pace on the web side and at least one person mainly on Flutter.

## Risks

- **Too many packs, thin quality:** every pack needs a demo shop check, not just passing tests. The demand list keeps
  us building what shops actually ask for.
- **Offline billing** is the hardest part of mobile (numbering, double bills, stock). It waits for the idempotency
  keys from M0 and gets its own e2e suite.
- **Play Store policy:** never publish per-shop apps from our account. Check the current Play and Apple rules before
  track F.
- **Android developer verification** reaches India in 2027 (Google's timeline). Installing an APK outside the store will
  need a verified developer too, so plan on the Play Store, not APK files sent to shops.
- **Two lanes, one API:** API changes must keep the Dart client building (M0's CI check) and keep old app versions
  working until the minimum version is raised.

## Open decisions

1. Customer app: one srikit Shops app plus branded apps on top plans (this plan's assumption), or something else?
2. App ids for the new verticals: their own apps (e.g. `HS` for stays, `CL` for clinics) or packs on existing apps?
3. iOS: with M1, or after Android is stable (this plan's assumption)?
4. Which language after Tamil: Hindi, Telugu, Kannada or Malayalam?
5. Team: who owns the Flutter lane?
6. Pricing of the branded app (setup fee and which plans).
