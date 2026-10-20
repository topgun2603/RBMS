# Verticals: pharmacy and restaurant

Two products built on the same kit as Billing (`BL`) and the online store (`EC`). Each is a thin Next.js shell with its
own app profile, mounting the shared UI modules plus one vertical module.

| App | Port | App profile | Vertical back end | Vertical UI | Demo shop (`pnpm seed`) |
|---|---|---|---|---|---|
| `apps/pharmacy` | 3006 | `PH` (with the online store) | `@srirealtime/medicines` (`/v1/medicines`) | `@srirealtime/pharmacy-ui` at `/pharmacy` | `medplus.localhost:3006` |
| `apps/restaurant` | 3007 | `RS` | `@srirealtime/dining` (`/v1/dining`) | `@srirealtime/restaurant-ui` at `/dine` | `annapoorna.localhost:3007` |
| `apps/services` | 3008 | `SV` | `@srirealtime/bookings`, `jobcards`, `memberships` | `bookings-ui` at `/appointments`, `jobcards-ui` at `/jobs`, `memberships-ui` at `/members` | `glow` (salon), `quickfix` (repair), `ironfit` (gym) `.localhost:3008` |

What a shop sees is still app profile ∩ plan ∩ shop switches (docs/features.md). `PH` is the Billing profile plus
`medicines.*`. `RS` is the online-store profile plus `dining.*`, without inventory (dishes are cooked to order, so stock
never blocks an order) and so without branches. Plans: `medicines` and `dining` on every plan; the `.*` parts from
starter up.

## Pharmacy (`@srirealtime/medicines`)

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
- **Prescriptions** (`medicines.prescriptions`): patient, prescriber (registration no.), date, linked to the bill.
- **Schedule H1 register** (`medicines.register`): every net sale of an H1 / X / narcotic medicine with batch,
  prescriber and patient; `missingRx=true` lists sales still without a prescription.
- **Expiry summary** (`GET /reports/expiry?within=90`): expired and expiring stock at cost; the dashboard's
  "Expiry watch" card.
- Permissions: `medicines.manage` (details, receive, adjust), `medicines.dispense` (read, prescriptions). Manager gets
  `medicines.*`, cashier `medicines.dispense`, stock keeper `medicines.manage`.

## Restaurant (`@srirealtime/dining`)

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

## Business packs and store themes (`@srirealtime/verticals`, `@srirealtime/branding` theme)

Fifteen trades ship as **business packs** (`packages/verticals`, pure data): fashion, pharmacy, restaurant,
cloud_kitchen, grocery, bakery, fresh, electronics, repair, salon, gym, jewellery, hardware, optical, tailoring. A pack
holds the app it runs on, its theme preset, the storefront's words in English and Tamil (search box, "new arrivals",
hero, call to action, newsletter, categories title), whether the clothing size guide and the "made locally" badge apply,
starter categories, a starter home page (CMS sections) and product-editor hints.

- **Where the trade lives:** `store` settings `businessType` (public). Empty = the app's default pack
  (`DEFAULT_PACK_FOR_APP`). Changed in Settings → Appearance.
- **Storefront:** `StoreConfig.shop.businessType | theme | fonts`. The translator overlays the pack's words
  (`translatorFor(locale, businessType)`); the size guide shows only for `sizeGuide` packs; the "Made in Tamil Nadu"
  badge only for `localMade` packs. The CMS default home (no published home) uses the pack's words too.
- **New shops:** the on-tenant-created `starter` hook (`apps/api/src/kit-verticals.ts`) saves the trade from sign-up,
  applies the pack's preset, creates the starter categories and publishes the starter home (each step skipped when the
  shop already has its own). www sign-up offers the 15 trades.
- **Product editor** (commerce-ui `usePack()`): name / description placeholders, attribute and option suggestions and
  the category example come from the pack.

**Themes** live in the brand tokens (`tokens.theme`, `packages/branding/src/theme.ts`, also importable as
`@srirealtime/branding/theme`): `header` (classic, centered, minimal, bold), `hero` (slider, split, full, compact),
`card` (standard, minimal, framed, overlay), `imageRatio` (portrait, square, landscape), `buttons` (rounded, pill,
square), `density`, `sections` (plain, tinted, boxed), `motif` (none, kolam, dots, waves, grid), `headings` (display,
uppercase, underline). Ten presets (heritage, boutique, fresh, care, bistro, tech, luxe, power, workshop, atelier) set
every token; tests require each preset's structure to differ, not just its colours. The storefront puts the theme on
`.sf-root` as `data-sf-*` attributes (CSS variants in storefront-ui `styles.css`), renders the header, hero and card
variants in their components, follows `--sf-image-ratio` everywhere a product picture is drawn, and loads the shop's
Google Fonts. Shops edit all of it in **Settings → Appearance** (site-ui): trade, preset gallery, colours, fonts and
every option, with a live sketch of the store.

## Services (`apps/services`, app profile `SV`)

Salons, spas, gyms, repair shops, tailors and opticals (packs salon, gym, repair, tailoring, optical). Three engines,
all billing through the kit's shared `billFromLines` adapter (`apps/api/src/kit.ts`, the same one dining uses):

- **Appointments** (`@srirealtime/bookings`, `/v1/bookings`): services (catalogue items with duration and buffer),
  staff with the services they do, shop and staff weekly hours with breaks, time off, IST slot maths, a day calendar per
  staff, status flow booked → confirmed → arrived → in_service → completed (cancel / no-show), bills. Online booking on
  the store at `/book` (feature `bookings.online`), the customer's booking at `/booking/<code>` (view, cancel until 2 h
  before).
- **Job cards** (`@srirealtime/jobcards`, `/v1/jobcards`): templates device (brand, model, IMEI, issue, accessories),
  garment (measurements, trial date), eyewear (Rx per eye, PD, lens) and general; received → diagnosed → awaiting
  approval → in progress → trial → ready → delivered (delivered only once billed); parts and labour lines, advance,
  bill, timeline. Customers follow their job at `/job/<code>` on the store (feature `jobcards.tracking`).
- **Memberships** (`@srirealtime/memberships`, `/v1/memberships`): plans (days, sessions or unlimited, price, GST,
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

- **Weighing scales** (`@srirealtime/scales`, `/v1/scales`, UI at `/weighing`; packs grocery, bakery, fresh; apps BL
  and EC): PLUs per catalogue item (by weight or by count, tare), today's price list (writes catalogue prices), CSV
  export for the scale, label preview. Scale labels (EAN-13, prefix 20–29, 5-digit PLU, 5-digit weight) scanned at the
  counter become a weighed line (`qty` = kg).
- **Serial numbers / IMEI + warranty** (`@srirealtime/serials`, `/v1/serials`; packs electronics, repair; apps EC and
  SV): tracked items with warranty months and dual IMEI, units received with IMEI check digits, scanning an IMEI at the
  counter adds that unit, the serial prints on the bill (`serials` on the bill line), issue marks it sold with its
  warranty from the bill date, cancel puts it back in stock; warranty lookup and claims.
- **Jewellery** (`@srirealtime/jewellery`, `/v1/jewellery`; pack jewellery; app EC): the day's metal rates (24K / 999
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

## Not done yet

- A live push channel for the kitchen display (it polls; the WhatsApp SSE in `kit-live.ts` is the pattern to copy).
- Printed KOT slips (thermal) and a "print bill at table" button.
- Recipes / raw-material stock for restaurants, and batch choice at the pharmacy counter (today FEFO picks the batch).
- Terraform (`infra/terraform/envs/staging`) still lists only the original apps.
- SMS / WhatsApp for the service engines (booking confirmations, "your job is ready", membership expiry reminders):
  the ports exist (`NotifyPort`, `ReminderPort`) but aren't wired to templates yet; `memberships.service
  .remindAllExpiring` is ready for a daily job.
- Price-embedded scale labels (the scale prints the price, not the weight): the resolver turns the price into a
  quantity at today's unit price; a line amount override at the counter would be exact.
- A serial number field in the billing app's bill editor (the counter and the API take serials today).
- Every Services shop sees all three engines; switching off the ones a trade doesn't use (e.g. job cards for a gym) is
  manual in Settings → Features.
