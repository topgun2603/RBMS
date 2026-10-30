# Verticals: pharmacy and restaurant

Two products built on the same kit as Billing (`BL`) and the online store (`EC`). Each is a thin Next.js shell with its
own app profile, mounting the shared UI modules plus one vertical module.

| App | Port | App profile | Vertical back end | Vertical UI | Demo shop (`pnpm seed`) |
|---|---|---|---|---|---|
| `apps/pharmacy` | 3006 | `PH` (with the online store) | `@rbms/medicines` (`/v1/medicines`) | `@rbms/pharmacy-ui` at `/pharmacy` | `thunai.localhost:3006` (store #22, `pnpm seed:stores thunai`) |
| `apps/restaurant` | 3007 | `RS` | `@rbms/dining` (`/v1/dining`) | `@rbms/restaurant-ui` at `/dine` | `arusuvai.localhost:3007` |
| `apps/services` | 3008 | `SV` | `@rbms/bookings`, `jobcards`, `memberships` | `bookings-ui` at `/appointments`, `jobcards-ui` at `/jobs`, `memberships-ui` at `/members` | `glow` (salon), `quickfix` (repair), `ironfit` (gym) `.localhost:3008` |

What a shop sees is still app profile ∩ plan ∩ shop switches (docs/features.md). `PH` is the Billing profile plus
`medicines.*`. `RS` is the online-store profile plus `dining.*`, without inventory (dishes are cooked to order, so stock
never blocks an order) and so without branches. Plans: `medicines` and `dining` on every plan; the `.*` parts from
starter up.

## Pharmacy (`@rbms/medicines`)

- **Medicine details** per billing item (`itemId` = catalogue variant id): composition (salt), manufacturer, schedule
  (`otc`, `G`, `H`, `H1`, `X`, `narcotic`), pack size / unit, rack. Same composition = substitutes
  (`GET /items/:itemId/substitutes`).
- **Batches** (`medicine_batches`): batch no., expiry (month expiries are stored as the month's last day), MRP, purchase
  rate, qty, distributor. Receiving (`POST /batches`) adds to the batch and to inventory (`StockPort`); counts and
  write-offs (`POST /batches/:id/adjust`: expired, damaged, returned to distributor) move inventory too.
- **First expiry, first out:** when a bill is issued, the kit's invoice `issued` hook calls `onInvoiceIssued`, which
  takes each batched item's quantity from its unexpired batches, soonest expiry first. Expired batches are never sold.
  Idempotent per bill. Cancelling the bill puts it back. Items with no batches are left alone; a shortfall is logged
  and the sale stands. Ledger: `medicine_batch_movements`.
- **Batch choice at the counter:** `GET /batches/tracking?ids=` and `GET /batches/pick?itemId=&qty=` (same shape as
  inventory's). The POS offers a pharmacy item's batches (tap the batch on the line); the chosen batch travels as the
  invoice line's `batchId`, and `onInvoiceIssued` takes it first, then first-expiry-first-out for the rest (an expired
  or empty choice falls back to FEFO).
- **Prescriptions** (`medicines.prescriptions`): patient, prescriber (registration no.), date, linked to the bill.
- **Schedule H1 register** (`medicines.register`): every net sale of an H1 / X / narcotic medicine with batch,
  prescriber and patient; `missingRx=true` lists sales still without a prescription.
- **Expiry summary** (`GET /reports/expiry?within=90`): expired and expiring stock at cost; the dashboard's
  "Expiry watch" card.
- Permissions: `medicines.manage` (details, receive, adjust), `medicines.dispense` (read, prescriptions). Manager gets
  `medicines.*`, cashier `medicines.dispense`, stock keeper `medicines.manage`.

## Restaurant (`@rbms/dining`)

- **Floor:** areas and tables (`dining_areas`, `dining_tables`). Each table has a `qrToken` for guest ordering;
  `POST /tables/:id/qr` issues a new one.
- **Orders** (`dining_orders`, `dining_order_items`): `dine_in` (one open order per table: 409 `table_busy` with the
  open order's id), `takeaway`, `delivery`, `online`. Numbered per shop per day. Lines start `pending`; sending makes a
  **KOT per station** (`dining_kots`, station from `dining_menu_items`, default `kitchen`). A sent line can only be
  cancelled with a reason (`POST /orders/:id/items/:lineId/cancel`, `dining.bill`); its KOT shows the void.
  Move / join tables (`PATCH` `tableId`, `POST /orders/:id/merge`).
- **Bills:** `POST /orders/:id/bill { splits? }` sends anything pending, then makes one GST bill per split (identical
  lines merged) through the kit's `BillingPort` (invoices; issued, payment taken on the bill). The order is claimed
  first so two devices can't bill it twice.
- **Kitchen display** (`dining.kitchen-display`): `GET /kitchen?station=&recent=15`, `PATCH /kots/:id { status }`
  (new → preparing → ready → served, one step back allowed). The screen polls every 5 s; the floor every 10 s.
- **QR table ordering** (`dining.qr-ordering`): the store app's `/table/<qrToken>` shows the menu
  (`GET /public/menu`: active catalogue items with veg mark and sold-out flag) and posts the guest's order
  (`POST /public/tables/:token/orders`), which joins or opens the table's order and goes to the kitchen at once.
  Rates always come from the catalogue, never the guest. The store proxy allows `/v1/dining/public/*` only.
- **Online store orders:** when the restaurant confirms a store order, `diningOrderSync` (kit) opens an `online`
  takeaway / delivery dining order with KOTs; cancelling or returning it cancels the tickets; delivering it closes it.
- Amounts on dining orders are before GST (catalogue rates); bills add GST (5% for restaurants).
- Permissions: `dining.serve` (orders, KOTs), `dining.kitchen` (display), `dining.bill` (bills, voids, cancel),
  `dining.manage` (tables, stations, sold out). Manager gets `dining.*`, cashier `dining.serve` + `dining.bill`.

## Wiring (apps/api/src/kit.ts)

`createMedicines` and `createDining` are built after invoices / inventory / catalogue and reached lazily from the
invoice `issued` / `cancelled` events and the store order `statusChanged` event. Migrations `0014_medicines`,
`0015_dining`. `seedRestaurantSetup` (seed-fixtures) gives restaurant demo shops two areas, ten tables and a
`beverages` station for drinks.

## Business packs and store themes (`@rbms/verticals`, `@rbms/branding` theme)

Thirty trades ship as **business packs** (`packages/verticals`, pure data): fashion, pharmacy, restaurant,
cloud_kitchen, grocery, bakery, fresh, electronics, repair, salon, gym, jewellery, hardware, optical, tailoring, organic,
footwear, stationery, toys, cosmetics, and (EC) crackers (Sivakasi fireworks, made-locally badge), florist_pooja (flowers
and garlands on the scales: loose flowers by weight, strings by the muzham), mobile_accessories (no serials: phones with
IMEI stay on electronics), furniture, home_decor, pet_shop, sports (size guide: clothing chart, shoe chart for sports
shoes), (RS) tea_stall (counter-first: QR table ordering off, like cloud_kitchen) and (SV) spa (books through `/book`,
no job cards, like salon; `spa` is no longer a salon alias) and school (a school's website: admissions, programmes, campus,
news; preset `campus-navy`, `ctaHref` `/admissions`). A pack
holds the app it runs on, its theme preset, the storefront's words in English and Tamil (search box, "new arrivals",
hero, call to action, newsletter, categories title), whether the clothing size guide and the "made locally" badge apply,
starter categories, a starter home page (CMS sections) and product-editor hints. `site: true` (only `school`) marks a
website, not a shop: the store hides the cart, wishlist, shopper account and product search, and the main button goes to
`ctaHref`; its `off` list also switches off job cards, memberships, serials, coupons, delivery, loyalty, wishlist and returns.

- **Where the trade lives:** `store` settings `businessType` (public). Empty = the app's default pack
  (`DEFAULT_PACK_FOR_APP`). Changed in Settings → Appearance.
- **Storefront:** `StoreConfig.shop.businessType | theme | fonts`. The translator overlays the pack's words
  (`translatorFor(locale, businessType)`); the size guide shows only for `sizeGuide` packs; the "Made in Tamil Nadu"
  badge only for `localMade` packs. The CMS default home (no published home) uses the pack's words too.
- **New shops:** the on-tenant-created `starter` hook (`apps/api/src/kit-verticals.ts`) saves the trade from sign-up,
  applies the pack's preset, creates the starter categories and publishes the starter home (each step skipped when the
  shop already has its own). www sign-up offers every pack (`BUSINESS_TYPES`), the chosen app's first.
- **Product editor** (commerce-ui `usePack()`): name / description placeholders, attribute and option suggestions and
  the category example come from the pack.

**Themes** live in the brand tokens (`tokens.theme`, `packages/branding/src/theme.ts`, also importable as
`@rbms/branding/theme`): `header` (classic, centered, minimal, bold), `hero` (slider, split, full, compact),
`card` (standard, minimal, framed, overlay), `imageRatio` (portrait, square, landscape), `buttons` (rounded, pill,
square), `density`, `sections` (plain, tinted, boxed), `motif` (none, kolam, dots, waves, grid, stripes), `headings` (display,
uppercase, underline). Ten presets (heritage, boutique, fresh, care, bistro, tech, luxe, power, workshop, atelier) set
every token, plus one look per trade (`theme-presets-trades.ts`) and one per demo store of the series (`theme-presets-stores.ts`, e.g. `industrial`); tests require each preset's structure to differ, not just its colours. The storefront puts the theme on
`.sf-root` as `data-sf-*` attributes (CSS variants in storefront-ui `styles.css`), renders the header, hero and card
variants in their components, follows `--sf-image-ratio` everywhere a product picture is drawn, and loads the shop's
Google Fonts. Shops edit all of it in **Settings → Appearance** (site-ui): trade, preset gallery, colours, fonts and
every option, with a live sketch of the store.

## How to add a new store look + demo shop (the "20+ stores" series)

Each store of the series is one believable demo shop with a look of its own. Store #1 is **Murugan Hardwares**
(`murugan.localhost:3003`, preset `industrial`, trade `hardware`, app EC); store #2 is **Porunai Sweets & Bakery**
(`porunai.localhost:3003`, preset `mithai` in `theme-presets-porunai.ts`, trade `bakery`, app EC, added the `scallop`
motif). The recipe they followed:

1. **Pick the trade and the app.** The trade is a business pack (`packages/verticals/src/packs.ts`). The shop must run
   on an app with the online store (EC, PH, RS or SV; a BL shop has no store and 404s). Keep the pack's `appId` as it is
   (it is the app sign-up recommends and the app the solution preset's switches are stored for); the demo shop just
   sets `appId: "EC"` with `businessType: "<trade>"` — `packOrDefault`, `starter.apply` and `solutions.toggles` all
   accept a shop whose app differs from its pack's.
2. **Design the look** in `packages/branding/src/theme-presets-stores.ts` (`STORE_PRESETS`, merged into
   `THEME_PRESETS`, so it shows in Settings → Appearance's preset gallery automatically). Set every colour (primary,
   accent, background, foreground), both fonts (add new Google Fonts to `STORE_FONTS`; they need 400 and 700 weights
   and are loaded by name; Tamil falls back to Noto Sans Tamil), radius, mode and **every** theme option.
   `theme-presets-stores.test.ts` requires ≥ 6 options different from every other preset, a primary and a font pair no
   other preset uses, contrast ≥ 4.5:1 (text ≥ 7:1 on page and accent) and the mode matching the background. A new
   option value (store #1 added the `stripes` motif) needs: `THEME_OPTIONS` in theme.ts, the union in
   storefront-ui `types.ts` (`StoreThemeView`), its CSS in storefront-ui `styles.css` (`[data-sf-<option>="<value>"]`),
   the editor sketch (site-ui `theme-preview.tsx`) and its label in site-ui `messages.ts` (en + ta).
   From store #2 on, put the preset in its own file `theme-presets-<slug>.ts` (only a `import type` from theme.ts)
   with its own `theme-presets-<slug>.test.ts`, and register it with one line in `STORE_PRESETS`: stores built in
   parallel then don't edit the same lines. Check the structural distance before settling: count the differing options
   against every preset (store #2's nearest preset differs in 11 of 28).
3. **Write the store** as data in `apps/api/src/demo-stores/<slug>.ts` (type `DemoStore`, `types.ts`) and add it to
   `DEMO_STORES` (`demo-stores/index.ts`): shop and billing profile (placeholder GSTIN with a valid check digit,
   `+9198765000xx` phone), `preset`, store settings and policies, delivery zones, categories (the pack's names, so the
   starter's categories are reused), 30–60 products (generic names, no brands; HSN, GST rate from `GST_RATES`, unit,
   MRP ≥ price in paise incl. GST, options/variants, stock), rule collections, coupons, pages, menus and the home.
   Check the HSN's rate after the GST rate notification in force (store #2 used CGST 9/2025-Central Tax (Rate), from
   22 Sept 2025: cakes, biscuits, rusk, puffs 1905 at 5%, sweetmeats and namkeen 2106 90 at 5%, plain bread 1905 90 10
   nil) and say which in the file's header comment. Goods sold loose on the counter scale (trades with the `scales`
   feature) get `unit: "kg"` and a per-kg price; pre-packed weights are options (`250 g` / `500 g` / `1 kg`) on a
   `box` / `pack` unit, never `kg`. **Apparel and footwear** (HSN chapters 61, 62, 63 made-ups, headings 6401–6405)
   are taxed by price, not by one rate: export `products: withPriceBandGst(PRODUCTS)` (`demo-stores/gst-band.ts`
   gives every such HSN the price-band rule, see "Price-band GST" below) and keep `gstRate` as the fallback. Avoid
   tax-inclusive prices between ₹2,625 and ₹2,950 (the dead band: billed at 18% and flagged in the editor).
4. **Home in English and Tamil.** `home(ctx)` returns the CMS home: sections with **stable ids** (`<prefix>-…`, never
   `starter-…`) and `translations.ta` = section id → the same section's words in Tamil (arrays by position). The
   storefront shows them to Tamil shoppers (`localizeSections`, `@rbms/cms/localize`); only text is taken from a
   translation, links / pictures / references always come from the section. The home editor (site-ui) edits English
   only and saves without `translations`, so an owner's edit drops the Tamil words rather than leaving stale ones.
   Menus, pages and product names are single-language. Typing pitfall: a literal array whose objects differ in shape
   (`[{ name, description }, { name }]`) infers `description?: undefined`, which `TranslationValue` rejects; build such
   items with a helper typed `Record<string, string>` (store #2's `dish()`). `image-text` sections take either
   `imageSide` (the text column is padded on its outer side both ways).
5. **Photos.** Pick Pexels photos (free licence; search `https://www.pexels.com/search/<query>/`, look at contact
   sheets, avoid legible brand logos, shop price signs and people who look like customers being quoted; check the
   picture really shows the product: Pexels titles are often wrong, e.g. "brownies" that are Tirunelveli halwa). Use
   them by id:
   `photo: <id>` on products and categories, `ctx.photo(<id>, "wide" | "tile" | "square")` in the home and pages, and
   credit every one in `photos` (photographer + alt); the photo-credits page is generated from that list. The seed
   downloads each from the Pexels CDN at a reduced, cropped size and stores it as a public `storefront` file named
   `<slug>-pexels-<id>-<size>`, which later runs reuse. Offline, products fall back to the generated placeholder.
6. **Seed** (idempotent: everything is matched by name / slug / code and only created when missing; the home is written
   only when the shop has none or still shows the untouched starter home):
   `pnpm --filter @rbms/api seed:stores <slug>` (only the demo stores; `pnpm seed` runs them too). While building
   the home, `seed:stores <slug> --refresh-home` rewrites a home that is still the store's own seeded one. In dev,
   override `DATABASE_URL` / `REDIS_URL` in the environment if the database runs elsewhere than `.env` says. The seed
   exits before its store-cache refresh fires, so a running store keeps serving the old home after `--refresh-home`
   until its time-based revalidate; drop the cache yourself:
   `curl -X POST -H "content-type: application/json" -H "x-revalidate-secret: dev-store-revalidate-secret" -d '{"keys":["<slug>"],"resources":["home"]}' http://127.0.0.1:3003/api/revalidate`.
   The seed creates the shop without a sign-up plan, so the on-created `subscription` hook skips it
   (`signupSubscriptionStart`) and `ensureShop` starts the subscription once it has set the app's plan.
7. **Test and look.** `apps/api` `src/demo-stores/demo-stores.test.ts` checks every store (catalogue sanity, photo
   credits, home schema, a Tamil translation for every section, valid pages and menus, one look per store); then the
   branding, cms, storefront-ui and site-ui tests, one package at a time. Load the home, a category and a product page
   in English and Tamil in a browser (zero hydration errors, no horizontal overflow, no missing pictures) and compare the
   screenshots with the other stores of the series: the look must read as a different store, not a recolour. In Git
   Bash, run browser scripts that take URL paths with `MSYS_NO_PATHCONV=1` (otherwise `/` becomes a Windows path and
   the navigation fails). Check a phone width too (390 px, with a mobile viewport so a too-wide page widens the layout
   viewport and shows up in `document.documentElement.scrollWidth`), and toggle the light / dark switch once: the shop's
   other scheme is derived from its brand colours (`storefront-ui` `lib/scheme.ts`), so check it stays readable. The overflow check misses text clipped inside `overflow: hidden` boxes: read the Tamil product
   page screenshots too (store #2 found the trust badges clipping Tamil words; Tamil now shows them two per row).

## Services (`apps/services`, app profile `SV`)

Salons, spas, gyms, repair shops, tailors and opticals (packs salon, gym, repair, tailoring, optical). Three engines,
all billing through the kit's shared `billFromLines` adapter (`apps/api/src/kit.ts`, the same one dining uses):

- **Appointments** (`@rbms/bookings`, `/v1/bookings`): services (catalogue items with duration and buffer),
  staff with the services they do, shop and staff weekly hours with breaks, time off, IST slot maths, a day calendar per
  staff, status flow booked → confirmed → arrived → in_service → completed (cancel / no-show), bills. Online booking on
  the store at `/book` (feature `bookings.online`), the customer's booking at `/booking/<code>` (view, cancel until 2 h
  before).
- **Job cards** (`@rbms/jobcards`, `/v1/jobcards`): templates device (brand, model, IMEI, issue, accessories),
  garment (measurements, trial date), eyewear (Rx per eye, PD, lens) and general; received → diagnosed → awaiting
  approval → in progress → trial → ready → delivered (delivered only once billed); parts and labour lines, advance,
  bill, timeline. Customers follow their job at `/job/<code>` on the store (feature `jobcards.tracking`).
- **Memberships** (`@rbms/memberships`, `/v1/memberships`): plans (days, sessions or unlimited, price, GST,
  freeze days), members with codes (M-0001), sell / renew / freeze / cancel with bills, a front-desk check-in screen
  (one check-in a day unless the `memberships` settings allow more), expiring lists and check-in reports.

Permissions: managers get `jobcards.*`, `bookings.*`, `memberships.*`; cashiers `jobcards.view`, `bookings.desk`,
`memberships.checkin`. Migration `0016_services`.

**Pitfall found while wiring:** in a single-table select, drizzle prints columns without their table, so a correlated
subquery like `${lines.jobId} = ${jobs.id}` becomes `job_id = id` and compares a row with itself. Correlated
subqueries in these packages name their columns in full (`jl.jobcard_id = "jobcards"."id"`).

## Trades: weighing scales, serial numbers, jewellery

Three engines that sit in the app profiles of several trades. Their features start **off** for every shop
(`offByDefault` in `apps/api/src/kit.ts`); the business pack switches them on (`features` in
`packages/verticals/src/packs.ts`), or the owner does in Settings → Features.

- **Weighing scales** (`@rbms/scales`, `/v1/scales`, UI at `/weighing`; packs grocery, bakery, fresh, organic, florist_pooja; apps BL
  and EC): PLUs per catalogue item (by weight or by count, tare), today's price list (writes catalogue prices), CSV
  export for the scale, label preview. Scale labels (EAN-13, prefix 20–29, 5-digit PLU, 5-digit weight) scanned at the
  counter become a weighed line (`qty` = kg).
- **Serial numbers / IMEI + warranty** (`@rbms/serials`, `/v1/serials`; packs electronics, repair; apps EC and
  SV): tracked items with warranty months and dual IMEI, units received with IMEI check digits, scanning an IMEI at the
  counter adds that unit, the serial prints on the bill (`serials` on the bill line), issue marks it sold with its
  warranty from the bill date, cancel puts it back in stock; warranty lookup and claims. The billing app's bill editor has a
  "Serial numbers / IMEI" box on lines of tracked items (one per line, at most one per unit).
- **Jewellery** (`@rbms/jewellery`, `/v1/jewellery`; pack jewellery; app EC): the day's metal rates (24K / 999
  entered, other purities derived), pieces with gross / stone weight, wastage %, making (per gram, % or flat), stones,
  HUID and tag; saving rates reprices every piece in stock into the catalogue (GST-exclusive; tax-inclusive products
  get GST added by the kit). Bills mark pieces sold (cancel: back in stock). Old gold exchange (OG-0001) values old
  gold at the buying rate less deduction and is applied to a bill as a payment (method "other"). Public rates at
  `/v1/jewellery/public/rates`.

The counter resolver (`/v1/counter/resolve`, `createCounter` in `kit-verticals.ts`) tries the scales and serials
resolvers when a code isn't a catalogue barcode or SKU. Permissions: managers get `scales.*`, `serials.*`,
`jewellery.*`; cashiers `serials.view` and `jewellery.exchange`. Migration `0017_trades`. Demo shops: `techzone`
(electronics) and `lakshmi` (jewellery), both EC on localhost:3002.

## Admin: Solutions

Platform → **Solutions** lists the 15 solutions by app with their look, starter categories and shop counts
(`GET /v1/solutions`, super-admin). Platform → Shops shows each shop's solution and **Change solution** applies another
one (look, starter content, optionally moving the shop to that solution's app: `PUT /v1/solutions/tenants/:id`).

## Solution presets

Each of the 15 solutions has a feature preset: the app's optional (`shopToggle`) features a new shop of that trade
starts with. The default comes from the business pack (features the app has on by default, plus `pack.features`,
minus `pack.off`, e.g. no job cards for a gym); super-admins change it in Platform → Apps & features (stored in the
platform layer of the `solutions` settings, `GET/PUT /v1/solutions/:id/preset`). It is applied as shop switches when a
shop is created and on "Change solution"; saving can also apply it to the solution's existing shops. Features the shop
can't switch are the same for every solution of the app.

## Plans per app

Each app has its own plans, one per tier (`free`, `starter`, `pro`, `enterprise`): `plans.app_id` + `plans.tier`, ids
like `sv-pro`. Prices, wording, features and limits differ per app (seeded as placeholders in `seed-fixtures.ts`
`APP_PLAN_PRICES` / `APP_PLAN_COPY`; super-admins set them in Platform → Apps & features or Platform → Plans).

- `GET /v1/plans` lists the requesting shop's app's plans, or `?app=XX` (pricing and sign-up pages); nothing without
  an app. Super-admins: `?all=1` (every plan), `?all=1&app=XX`.
- A shop can only change to, check out or be comped a plan of its own app; sign-up checks the plan against the app.
- Shops without a plan get their app's free plan (`PlansService.defaultPlanFor`, subscriptions `freePlanOf`).
- Moving a shop to another app (`tenancy.setApp`) moves its subscription to the same tier of the new app
  (`SubscriptionsService.moveToApp`); a Razorpay subscription keeps charging its plan until the next change.
- Plans without an app are shared templates (private), offered only to apps without plans of their own.
- Migration `0018_app_plans` copied the four shared plans to every app and moved shops and subscriptions to their
  app's copy.

## Plan add-ons

Paid extras on top of a plan (migration `0022_plan_addons`). Catalogue `plan_addons` (plans module): per app
(`<app>-<code>`, e.g. `ec-extra-staff`); an app's add-on replaces the shared one (no app) with the same `code`.
Kinds: `limit` (adds `limits` per unit × quantity), `feature` (unlocks `modules`, only what the app profile offers),
`credits` (a one-time pack of credits for a `_per_month` key). `tiers` (empty = all), min/max quantity, monthly /
yearly / once prices (GST-exclusive). Placeholders seeded by `seed-fixtures.ts` (`ADDON_TEMPLATES`), edited in
Platform → Apps & features → app → Add-ons.

- Entitlements: plan → override limits → + add-on limits (unlimited stays unlimited) → feature add-ons → override
  `removeModules` last. Monthly keys: the allowance first, then credits (`usage_credits`, never reset).
- A shop's add-ons: `subscription_addons` (subscriptions module), `plan` (billed with the plan) or `comp`
  (super-admin). Recurring add-ons ride the plan's provider subscription: its provider plan is re-priced to plan +
  add-ons from the next cycle (Razorpay `PATCH /subscriptions/:id`, `schedule_change_at: cycle_end`). More of one
  mid-period is a one-time payment (Razorpay Payment Link) for the prorated rest of the period, applied once paid;
  fewer or none apply at the period end. Credits packs are payment links too. Invoices carry add-on lines.
- Plan changes: an upgrade restarts the add-ons it can keep with the new period (their unused part credited); a
  downgrade or cancel ends the ones the new plan can't have at the period end (notice + `subscription.addon_ending`).
- Routes: `GET/PUT/DELETE /v1/plans/addons[/:id]`; shop `GET /v1/subscriptions/addons`, `POST /addons`,
  `/addons/preview`, `/addons/:addonId/cancel`, `/addons/payments/:id/cancel`; super-admin
  `/v1/subscriptions/admin/:tenantId/addons` (+ `/comp`, `/:addonId/end`); mock `POST /mock/pay`.

## Layout catalogue (for store builders)

Every home is a list of CMS sections (`packages/cms/src/content.ts`, edited in the shop admin's Home page editor) on a
page layout (theme options in Settings → Appearance). Two stores should differ in **which** sections they use, their
order and rhythm, and the page layout, not just colours. Pick from this list; ask for anything missing in
`docs/layout-requests.md`. Every section also takes the shared **style** (background brand / muted / dark / photo /
gradient, spacing, width, alignment, entrance animation, hide on phone / desktop) and, new, **Row: half** — two
neighbouring half sections sit side by side from 1024 px (stacked on phones): pair a testimonial with an offer, a
gold-rate board with a location, a text story with a newsletter.

### Page layouts (Settings → Appearance → Page layout; `tokens.theme.pageLayout` / `mobileNav`)

Kept apart from `THEME_OPTIONS` (`LAYOUT_OPTIONS` in `packages/branding/src/theme.ts`), so presets don't have to set
them; a demo store sets them in its preset's `theme` (`{ …, pageLayout: "rail", mobileNav: "tabs" }`; the store-preset
test accepts these two keys on top of every theme option and checks their values). The seed applies a preset only to a
new shop (or one still on its trade's look), so an existing demo shop also needs them in its brand tokens once
(`branding.service.update(tenantId, { tokens: { theme: { pageLayout, mobileNav } } })`, which merges). Stores #1–#5 use
rail + tabs (Murugan), sidebar + tabs (Porunai), standard + tabs (Cauvery), sidebar (Vayal) and magazine (Thari). All eight combinations of page layout and phone nav are now taken (rail + off by Malligai and QuickFix, the services demo shop: a repair catalogue browsed by device). Store #20 (Thaiyal Tailors, preset `madder-thread`) shares sidebar + tabs with Porunai only. Store #22 (Thunai Pharmacy, preset `saline-blue`, `thunai.localhost:3003`, counter `:3006`) uses rail + tabs and a home with no hero: finder (chips) → need tiles → prescription block → timeline → two comparisons → monthly-box pricing table → shelf → team → FAQ → location → doctor note.

| Option | What changes | Use for |
| --- | --- | --- |
| `pageLayout: standard` | Header on top, pages full width (the default). | Most shops. |
| `pageLayout: rail` | A sticky category rail (pictures or icons, the open category's sub-categories) beside home, listing and product pages on desktop; a category chip strip under the header on phones (home and listings). The transparent-over-banner header is off. | Big catalogues: hardware, grocery, pharmacy, stationery — marketplace feel. |
| `pageLayout: sidebar` | On desktop the header becomes a fixed 16 rem menu down the left: logo, search, the header menu, categories, language, light/dark, account and cart. Phones keep the normal header. | Boutiques, galleries, portfolios, salons — an app/agency look. |
| `pageLayout: magazine` | Editorial: home section headings get a numbered kicker ("01 —") and display size, product grids (home and listings) get a 2×2 feature tile every 6th product, text sections run in two columns with a drop cap (not in Tamil), the product title is set large. | Fashion, sarees, jewellery, books, lifestyle. |
| `mobileNav: tabs` | An app-like bottom tab bar on phones: Home, Categories (a sheet of category tiles), Search, Cart (opens the mini cart, with count), Account; WhatsApp / buy bar / compare tray move above it. | Grocery, pharmacy, food: repeat shoppers on phones. |

### Home sections

Product & catalogue: `collection`, `products`, `product-tabs` (new / bestsellers / sale / a collection, in tabs),
`bestsellers`, `recommended`, `recently-viewed`, `deal` (one product + countdown), `shop-the-look` (photo with product
dots), `categories` (12 layouts: circles, cards, slider, chips, big tiles, app icons, story rings, pills, tiles,
banner row, bento, minimal list), `category-mosaic`.
Story & trust: `hero` (slider), `hero-split`, `hero-video`, `banner`, `text`, `image-text`, `gallery` (grid / masonry
/ carousel), `logos`, `usp` (cards / inline / centered / split), `testimonials` (carousel / cards / single), `stats`,
`timeline`, `team`, `before-after`, `faq`, `location`, `newsletter` (band / split / card / inline), `instagram`,
`blog-posts`, `reviews-summary`, `offer` (coupon + countdown).
Trade: `menu-board` (restaurants), `appointment` and `pricing-table` (services, gyms), `gold-rates` (jewellery).

New layout sections (`pages/home-layouts.tsx` in storefront-ui, forms in site-ui `section-forms-layouts.tsx`):

| Type | What the shopper sees | Owner controls | Use for |
| --- | --- | --- | --- |
| `flash-sale` | A brand-gradient band ("Live now", "Up to n% off" from real discounts, a d/h/m/s countdown) over a carousel or grid of the sale's products; shows from `startsAt` to `endsAt`, then hides itself (server and client). | Title, text, start / end, products: picked · biggest discounts now · a collection, layout, how many, a button. | Weekend / festival sales, grocery evening deals. |
| `finder` | 1–3 questions as answer tiles one at a time (wizard, with progress, Back / Skip) or as chip rows (chips); matches load live under it, or (`results: button`) a "Show my list (22)" button opens the filtered listing. Optional picture beside and a second button (WhatsApp). | Questions and answers; each answer filters by category, **tag** (exact; new `tag` filter on `/catalog/public/search` and `/search?tag=`), option/attribute (`Size = 8`), words or a price range, or opens its own page (a class's collection). | Shop by class (stationery), age (toys), concern (beauty), budget, room. |
| `stories` | A strip of story bubbles (`rings`) or tall 9:16 reels (`reels`, muted clips play while on screen) that open a full-screen viewer: progress bars, tap / arrow keys, pause, a button per story. | Stories: picture, optional video, title, text, link + button text. | Fashion drops, "on the loom this week", new arrivals, recipes. |
| `category-shelf` | Categories down the side (tabs; chips on phones) with the chosen category's products beside them and "View all in …". | Title, which categories (or the first six), pictures on/off, products per category. | Hardware aisles, grocery departments, pharmacy. |
| `sticky-story` | A picture that stays in view while numbered chapters scroll past it, crossfading to each chapter's picture (desktop); each picture above its text on phones. | Title, picture side, chapters: eyebrow, heading, text (markdown), picture, button. | Brand / farm / weaving story, how it's made. |
| `comparison` | A real table of 2–4 products: picture and name, price, stars, the owner's rows, Add buttons; one column can be highlighted ("Most bought"). Scrolls sideways on phones with the feature column pinned. | Products, highlight + badge, show ratings, rows (one value per product). | Electronics, tools, shirts, plans. |
| `tiles` | "Shop by need" tiles: picture (or an icon from the name), name, a "what helps" note and the product count; each opens its link / collection / tag listing. Row (sideways on phones) or grid. | Title, text, layout, counts on/off; tiles: name, note, picture, collection or tag or link. | Beauty concerns, occasions, projects, rooms. |
| `size-finder` | "Find your size": Men / Women / Kids toggle, size chips that open the listing in that size (`opt.Size`) and category, optional foot-length box (cm) that marks the size from the UK/India shoe scale. | Title, text, picture, option name, foot-length box, groups (name, category, sizes). | Footwear, school uniforms, rings. |
| `swatches` | Shade finder: colour swatches of the products' shade option (tabs per product), a skin-tone filter, and the chosen shade's name, price and Add (that variant). | Products (1–6), option name, shades: name, colour, skin tone. | Lipstick, foundation, nail paint, paint, thread, saree colours. |

All of them: English + Tamil words through `translations.ta` (filters, tags, sizes, shade values, links and dates are
never translated), light and dark, 390 px phones, keyboard and screen readers (tabs, radio groups, `aria-pressed`
answers, live match counts, a captioned table).

## Price-band GST (apparel and footwear)

From 22 Sept 2025 (Notification No. 9/2025-Central Tax (Rate), 17.09.2025, and the matching IGST / SGST
notifications) clothing and footwear are taxed by their sale value:

| Goods | 5% (Sch. I) | 18% (Sch. II) |
| --- | --- | --- |
| Ch. 61 apparel and clothing accessories, knitted or crocheted | S.No. 388, "of sale value not exceeding Rs 2500 per piece" | S.No. 197, exceeding |
| Ch. 62 apparel and clothing accessories, not knitted | S.No. 389 | S.No. 198 |
| Ch. 63 other made-up textile articles, sets (not 6305 32 00, 6305 33 00, 6309) | S.No. 390 | S.No. 199 |
| 6401–6405 footwear | S.No. 392, "of sale value not exceeding Rs.2500 per pair" | the 6401–6405 entries |

- **What is compared.** "Sale value" is the value of supply under Sec 15 of the CGST Act: the transaction value,
  which excludes the GST itself, less discounts given before or at the time of supply and shown on the invoice
  (Sec 15(3)(a)). So the test is on the **taxable value per piece / pair after the bill's discounts**: ₹2,500.00 is
  5% ("not exceeding"), ₹2,500.01 is 18%, a ₹2,999 kurta marked down to ₹2,399 on the bill is 5%. Each piece is
  tested on its own (a bill of several pieces is not added up). A credit note issued later does not change the
  rate of the original supply: it credits at the bill line's rate.
- **Tax-inclusive (MRP) prices.** For an inclusive price P per piece: P ≤ ₹2,625.00 (2,500 × 1.05) → 5%;
  P > ₹2,950.00 (2,500 × 1.18) → 18%. Between them no rate is consistent (at 5% the taxable value is above ₹2,500,
  at 18% it is at or below it); srikit charges **18%** there (never under-pays tax; excess tax collected is simply
  paid over, Sec 76) and the product editor warns so the shop re-prices to ₹2,625 or less, or above ₹2,950. Brands
  publish the same cut-offs ("MRP up to ₹2,625 attract 5% GST, while those above ₹2,950 are taxed at 18%").
- **Model.** `@rbms/gst` `rate-rule.ts`: `GstRateRule = { kind: "price-band", threshold: 250000 (paise of
  taxable value per unit), below: 5, above: 18 }` (`APPAREL_FOOTWEAR_GST_RULE`), `effectiveGstRate(rule | rate,
  unitTaxable, qty)`, `gstRateForInclusive(rule | rate, inclusive, qty)` (with `deadBand`), `gstRateAtPrice`,
  `lineGstRate(line)` and `priceBandRuleForHsn(hsn)`. Comparisons are integer (`taxable × 1000 ≤ threshold ×
  qty-in-thousandths`), so a 3-piece line of ₹7,500.00 taxable is exactly at the threshold.
- **Catalogue.** `catalog_products.gst_rule` (jsonb, migration `0025_gst_rule`); `gstRate` stays as the fallback /
  filter value. The editor's "GST by price band (apparel / footwear)" switch sets the rule. Billing items, POS items
  and store variants are banded at their own price (`gstRate`, `rate`) and carry `gstRule`.
- **Bills, POS, orders, checkout.** Invoice lines take an optional `gstRule`; `computeLine` re-bands the line on its
  unit taxable value after the line discount (from `inclusiveTotal` for inclusive lines) and stores the effective
  `gstRate`, so rate-wise and HSN-wise summaries (GSTR-1 HSN rows are keyed by HSN + rate) group by the rate actually
  charged; a loyalty / bill discount (`applyBillDiscount`) re-bands too. The POS cart (`cartLineGstRate`) and the
  billing form do the same client side. Store orders (`computeOrderTotals`) band each line after its coupon and
  loyalty shares and write the effective rate on the order line, which the order's invoice copies. Credit notes use
  the original line's rate and split. Products without a rule behave exactly as before.

Sources: the notification's schedule text as reproduced at cmaknowledge.in ("GST Rate Changes Effective 22.09.2025",
Notification 09/2025-CT(R)) and the CBIC copy of 9/2025-Integrated Tax (Rate); CGST Act Sec 15 and the CBIC GST flyer
on valuation (discounts before / at supply); the dead band cut-offs as published by brands (e.g. jockey.in "GST
Regulations"). The notification has been amended since (e.g. by 19/2025-CT(R) and in May 2026 to align with the
Finance Act, 2026); re-check the entries before changing the rule.

## Not done yet

- A live push channel for the kitchen display (it polls; the WhatsApp SSE in `kit-live.ts` is the pattern to copy).
- Printed KOT slips (thermal) and a "print bill at table" button.
- Recipes / raw-material stock for restaurants.
- Terraform (`infra/terraform/envs/staging`) still lists only the original apps.
- SMS / WhatsApp for the service engines (booking confirmations, "your job is ready", membership expiry reminders):
  the ports exist (`NotifyPort`, `ReminderPort`) but aren't wired to templates yet; `memberships.service
  .remindAllExpiring` is ready for a daily job.
- Price-embedded scale labels (the scale prints the price, not the weight): the resolver turns the price into a
  quantity at today's unit price; a line amount override at the counter would be exact.
