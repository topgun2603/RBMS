# srikit Business (Flutter)

The owners' and staff app for every trade (docs/market-plan.md, track D). Package id `in.srikit.business`, display
name "srikit Business". Android first; iOS builds from the same code.

So far: splash → app version check → session restore → phone sign-in (OTP) → shop picker → home shell (Home
dashboard, **Bill: counter billing**, **Orders**, More → **Products**, **Stock**, **Customers**, **Credit book** and
**Expenses**), shop branding as the theme,
English + Tamil.

## Run against the local API

```sh
# repo root: API on :4000 (plus the web apps)
pnpm dev

# apps/mobile_business
flutter pub get
flutter run                                             # Android emulator: API at http://10.0.2.2:4000 (default)
flutter run --dart-define=SRIKIT_API=http://localhost:4000      # iOS simulator
flutter run --dart-define=SRIKIT_API=http://192.168.1.20:4000   # a phone on the same Wi-Fi (your PC's LAN IP)
```

Sign in with a test number. In `apps/api/.env` (development only; the API ignores it in production):

```
TEST_OTP_CODE=123456
TEST_OTP_TARGETS=+9199990*
```

then enter `99990 00001` and code `123456`. The app shows a "test number" hint when `GET /v1/auth/config` lists the
number in `testTargets`. Other numbers get a real code from the configured SMS driver (the console driver in dev logs
it in the API output).

Debug Android builds allow plain http (`android/app/src/debug/AndroidManifest.xml`); release builds need https. iOS
allows local networking only (`NSAllowsLocalNetworking`).

### dart-defines

| Define             | Default                                     | Meaning                                         |
| ------------------ | ------------------------------------------- | ----------------------------------------------- |
| `SRIKIT_API`       | `http://10.0.2.2:4000`                      | API origin, without `/v1`                       |
| `SRIKIT_STORE_URL` | Play page of `in.srikit.business` (Android) | Store link on the update screens; none on iOS until the App Store id exists (the button is hidden) |

## Layout

```
apps/mobile_business          this app
  lib/main.dart               wiring: ApiClient, secure storage, AppController
  lib/src/app_controller.dart app state (stages, session, shops, language) + AppScope
  lib/src/app.dart            MaterialApp: theme from brand tokens, l10n, screen per stage
  lib/src/screens/            splash, update_required, sign_in, shop_picker, home_shell, dashboard, more
  lib/src/counter/            counter billing: cart.dart + tender.dart (rules ported from pos-ui), counter_controller.dart
                              (bill / payments / till with Idempotency-Keys), bill_tab, till_sheet, customer_sheet,
                              line_sheet, scan_screen, pay_screen, done_screen, counter_text (receipt mapping)
  lib/src/orders/             order_rules (transitions / permissions, ported from packages/orders), order_actions
                              (OrdersWatcher polling + writes with keys), orders_tab, order_detail, order_text
  lib/src/products/           product_rules (codes, defaults, stock-adjust validation), products_screen,
                              product_detail (+ VariantEditSheet), product_form (new product)
  lib/src/stock/              stock_screen (list, StockItemScreen with movements, AdjustSheet)
  lib/src/books/              books_rules (access, receipts, ledger rows, customer / expense validation and bodies, IST
                              ranges), books_actions (writes with keys), books_text, customers_screen (list, detail,
                              form), credit_book_screen, ledger_screen, credit_flows (receive sheet, statement,
                              reminder), expenses_screen (list + summary, form, categories)
  lib/src/pos/                POS terminal mode (docs/pos-terminals.md): pairing (QR / code), pin_pad, idle_lock, catalog
                              (sync + JSON file store + local index), weigh (tickets, ScaleReader, weighing station),
                              terminal_controller, pair / lock / weighing / ticket screens, terminal_shell
  lib/src/links.dart          UrlOpener for WhatsApp / the dialer (AppController.openUrl, replaced in tests)
  lib/l10n/app_{en,ta}.arb    every string (gen-l10n writes app_localizations*.dart next to them)
  test/                       unit + widget tests over a fake API (test/fake_api.dart, fake_counter.dart, fake_shop.dart,
                              fake_books.dart)
dart/srikit_api               pure-Dart typed client over package:http (dart test)
dart/srikit_theme             BrandTokens → Material 3 ThemeData; srikit_defaults.dart is generated
dart/srikit_kit               SessionStore, AuthRepository, ShopRepository, PhoneSignIn, PushRegistrar, Gates / Gate,
                              ActionKeys (one Idempotency-Key per user action), formatPaise
dart/srikit_print             Receipt model, ESC/POS formatter (58 / 80 mm), ReceiptPrinter interface (dart test)
scripts/mobile/gen-theme.mjs  writes srikit_defaults.dart from packages/branding/src/tokens.ts (--check for CI)
scripts/mobile/check-api-models.mjs  checks srikit_api's models against the typed API document
```

**Packages are linked with `path:` dependencies, not a pub workspace.** A Dart workspace needs its root
`pubspec.yaml` in a common parent of every member, which here would be the repo root (next to the pnpm files). Path
dependencies work with plain `flutter pub get` in each folder, on Windows too. When `apps/mobile_shops` arrives, move to
a root workspace (or Melos) as the market plan says.

Checks, per package:

```sh
cd dart/srikit_api   && dart pub get && dart analyze && dart test
cd dart/srikit_theme && flutter pub get && flutter analyze && flutter test
cd dart/srikit_kit   && flutter pub get && flutter analyze && flutter test
cd dart/srikit_print && dart pub get && dart analyze && dart test
cd apps/mobile_business && flutter pub get && flutter analyze && flutter test && flutter build apk --debug
node scripts/mobile/gen-theme.mjs --check
node scripts/mobile/check-api-models.mjs
```

On a machine short of memory, `flutter test --concurrency=1` avoids the test VM failing to start threads.

### Checking the models against the API document

The API writes a typed OpenAPI 3.1 document of the routes that declare their shapes (`documented(...)`,
packages/developer/src/openapi.ts):

```sh
pnpm --filter @srirealtime/api openapi -- --typed openapi.typed.json   # → apps/api/openapi.typed.json
node scripts/mobile/check-api-models.mjs                                # or pass another path to the document
```

The check finds the operations `dart/srikit_api/lib/src/srikit_api.dart` calls and, for each one the document types,
makes sure every documented response property is read (`json['name']`) by the Dart class mapped to that level of the
response (the `MODELS` table at the top of the script). It fails on a missing property, or on a typed operation the
client calls without a `MODELS` entry. Two markers stand in for a class: `"map"` for a property kept as raw JSON
(e.g. branding `tokens`, a bill's `messages`): the property must be read, what is inside is not checked; and
`"ignore"` for a property the client deliberately skips (say why next to it). Operations not typed yet and extra Dart
fields are printed as notes. All 84 operations the client calls are typed (including 15 of the 23 /v1/pos ones; the PIN admin and terminal
create / edit / delete routes are web-only). This is a name-level check, not a code generator: types and nullability are still checked by the unit
tests. Generating `srikit_api` from the document is the M0 follow-up.

## How it talks to the API

Every request sends `authorization: Bearer <token>`, `x-tenant: <shop slug>` once a shop is open,
`accept-language: en|ta`, and `x-client: srikit-business/<version> (android|ios)`. The API's `parseClient` accepts that
header and gives the session the long, sliding mobile lifetime. Errors `{ error: { code, message, details } }` become
`ApiException(status, code, message)`; the app shows `message`, and its own words for network / timeout failures.
Money is paise (`int`), shown with `formatPaise` (`₹1,23,456.78`, Indian grouping).

### App versions

On launch, before the session is restored, the splash calls `GET /v1/mobile/config` (public; the API reads the
version from `x-client`). `updateRequired` → the blocking "Update the app" screen (store button, "check again").
`updateAvailable` → a banner on Home that "Later" hides for this run. If that call fails (offline, older API) the app
carries on. Separately, any request answering 426 `app_update_required` throws `UpdateRequiredException` (with
`details.minVersion`) and `ApiClient.onUpdateRequired` moves the app to the same screen from wherever it was;
the stage stays there until "check again" passes. Bump `appVersion` (lib/src/config.dart) with `version:` in
pubspec.yaml.

### Idempotent writes

Every write in `SrikitApi` takes an optional `idempotencyKey`, sent as `Idempotency-Key` (8–128 of
`[A-Za-z0-9_.:-]`, checked before sending). Keys are `<deviceId>:<uuid v4>` from `IdempotencyKeys`;
`SessionStore.deviceId()` makes the device id once (32 hex digits, secure storage) and keeps it across sign-outs.
Make one key per user action and reuse it for that action's retries. Answers:
`ApiResponse.replayed` / `Ok.replayed` is true when the API replayed the stored answer (`idempotent-replayed: true`);
409 `idempotency_in_progress` → `IdempotencyInProgressException` (`retryable`: retry with the same key after a pause);
422 `idempotency_key_reused` → `IdempotencyKeyReusedError`, an `Error` (a bug: one key, two different requests).
Nothing in the app sends keys yet; counter billing will.

### Counter billing (Bill tab)

Shown when the shop has `invoices` and the user holds `invoices.create` (the web counter's module gate). The flow and
rules are ported from the web counter, packages/pos-ui:

- **Till** (`pos.till` for actions): `GET /invoices/till/current?register=` per device register (default "Counter 1",
  stored on the phone). Not open → open with an opening float. Open → today's X report, cash in / out (signed amount,
  reason ≤ 120), close with the counted cash (note ≤ 300) → Z summary with the difference. Billing does not require an
  open day (as on the web); bills made while the day is open carry `tillSessionId`.
- **Items**: search with a 150 ms debounce (`/catalog/variants/search`, 24 results; `/invoices/items` when the
  `catalogue` feature is off); camera scan (mobile_scanner) or a typed code: `/catalog/variants/lookup`, and only on 404
  `/counter/resolve` (scale labels set the quantity, IMEI / serial labels carry the serial).
- **Cart** (cart.ts): the same item merges unless the line has a discount; a serial unit is added once; quantities keep
  3 decimals; − stops at 1. Price change and line discount (₹ or %) need `invoices.discount`.
- **Customer**: none (nothing sent), walk-in (`customer: { name, phone }`, default name "Walk-in Customer"), or a saved
  customer (search from 3 characters, 200 ms debounce; quick add needs `customers.create`).
- **Totals**: lines are sent exactly as the web builds them (`toLineInput`: exclusive rate, discount on the exclusive
  basis, `inclusiveTotal` for tax-inclusive prices). The Charge button shows an **estimate** only; the pay screen and
  everything after show the server's numbers.
- **Pay**: `POST /invoices` with `issue: true`, then one `POST /invoices/:id/payments` per tender in the web's order
  (UPI → card → cash), each capped at the server's balance. Cash (quick notes, change), UPI (needs "received"), card,
  and the rest on credit when the shop has `invoices.credit-book` and the customer is saved; all can be split.
  Nothing typed = exact cash.
- **Done**: bill number and total, change, credit, missing payments; Share on WhatsApp (`POST /invoices/:id/share` →
  `https://wa.me/<phone>?text=…`), Print (preview), New bill.

Every write sends an Idempotency-Key made once per user action and reused when that action is retried (the same cart,
the same planned payment, the same till entry). A retry after a dropped connection therefore never makes a second
bill or payment, and an `idempotent-replayed` answer is taken as success.

Deliberate differences from the web counter:

- The bill is made **before** the money screen (the web makes it on Complete), so the cashier collects against the
  server's total, not a client-side computation. Leaving the money screen before paying offers to cancel the bill
  (`POST /invoices/:id/cancel`).
- After a failed payment the cashier can **retry** it with the same key, or finish without it (the web always
  finishes and reports the missing amount).
- Change is cash tendered − the cash kept for the bill, even if that cash payment could not be recorded (the web
  subtracts only recorded cash).

Not yet on the phone: held bills, returns / credit notes, loyalty points, stock badges, branch selection
(`x-branch`), denomination counting for the till, the thermal PDF / Z report print, `/invoices/:id/send`
(WhatsApp from the shop's number), offline billing (M3).

**Printing**: `dart/srikit_print` formats the receipt for 58 mm (32 columns) and 80 mm (48 columns) ESC/POS printers
from the server's bill. There is no Bluetooth plugin yet: Print shows the preview text and "Bluetooth printers come
next". Thermal printers have no Tamil font, so the receipt is printed in English (`Rs`, English / SKU names for Tamil
item names); see dart/srikit_print/README.md.

**Camera**: Android declares `CAMERA` (with `android.hardware.camera` not required, so phones without a camera can
still bill by search); iOS has `NSCameraUsageDescription` (English only for now).

### Products and stock (More → Products / Stock)

They live under More rather than in the bottom bar: products and stock are managed now and then, billing and orders
all day, and four tabs is what the bar holds comfortably.

- **Products** (feature `catalogue`; writes need `catalogue.manage`): search (name, SKU, barcode), category filter,
  archived toggle, infinite scroll; the row's stock badge follows the API (no `stock` key = the shop doesn't track
  stock, `null` = "Not tracked", else qty with ok / low / out).
- **Product detail**: variants with price, MRP (struck, "% off" when MRP > price), SKU, barcode and stock
  (`GET /inventory/stock/:variantId` per variant). **Quick edit** sends only the changed fields to
  `PATCH /catalog/variants/:id` (feature `catalogue.variants`); the barcode can be scanned. Without that feature only
  the price can change, through `PATCH /invoices/items/:id { rate }` (GST-exclusive), exactly as the web editor falls
  back. SKU / barcode: no spaces, ≤ 64; a duplicate shows the server's 409 message.
- **New product**: the web form's body — one variant, 5% GST, `pcs`, **tax-inclusive** (the web's default, not the
  server's), active, store + billing — then opening stock as a separate `adjust { mode: set, note: "Opening stock" }`
  (when `inventory` is on and the user has `inventory.adjust`); a failed opening stock only warns.
- **Archive / make active**: `PATCH /catalog/products/:id { status }` (the web's archive; delete is not offered).
- **Stock** (feature `inventory`): all / low / out (`status=low`, `status=out`), search, stock value and low / out
  counts; a location picker only with `inventory.locations` and more than one active location (reads then pass
  `locationId`). Item screen: qty, reserved / available, low-stock level, average cost, value, movements (newest first,
  with bill / order numbers). **Adjust** (`inventory.adjust`): add / remove / set, up to 3 decimals for any unit,
  add / remove > 0, set ≥ 0, note ≤ 500; shows the stock after and warns (but allows, as the web does) below zero.

### Orders (Orders tab, feature `orders`)

- **List**: status chips with the server's `counts` (All = their sum), search (number, customer, phone), pull to
  refresh, infinite scroll; rows show number, customer, status and payment pills, IST time, items, total.
- **Detail**: status / payment / channel, customer and note, ship-to address, lines and the server's totals, payments
  (the API's `payment` events), shipment, invoice number, timeline.
- **Moves** come from the order's `nextStatuses` (the server's table: any forward step, cancel only before shipping,
  return after delivery with `orders.returns`), filtered by permission: `orders.manage` for most, `orders.ship` /
  `orders.deliver` also allow shipping / delivering, `orders.cancel` for cancel. The primary button is the next flow
  step; the menu has "Skip to …", return and cancel. Ship asks for courier / tracking number / link (`https?://`);
  cancel needs a reason (preset chips, like the web); return confirms. A 409 (moved meanwhile) reloads the order.
- **Record payment** while a balance is due on a live order (`orders.manage`); delivering a COD order records the
  balance as paid on the server, after which the button is gone. **Make invoice** retries the server's automatic
  invoice (shown after a failed invoice event, or on a delivered order without one).
- **New-order badge**: until push arrives, `GET /orders/summary` is polled every 60 s **only while the Orders tab is
  visible** (once more when the shop opens); the badge shows `pending.placed`, and a rise reloads the list.
  `TODO(fcm)` in `OrdersWatcher`.

Every product, stock and order write sends an Idempotency-Key from `ActionKeys` (srikit_kit), one per user action
(e.g. `order.status:<id>:<from>:<to>`), reused if that action is retried.

Not on the phone yet: manual orders, refunds, order notes, returns screen details, bulk actions, packing slips,
delivery-module shipments, stock transfers and purchases, reorder-level / tracking settings, categories and
variants / options editing, product images, deleting products.

### Customers, credit book and expenses (More)

They live under More next to Products and Stock: collecting dues and noting a cost happen a few times a day, the
counter and orders all day, and the bottom bar keeps its four tabs. Every gate is the server's own check
(`BooksAccess`): the staff role every /invoices and /expenses route requires, the route's feature, and the permission
apps/api/src/permissions.ts attaches.

| Screen / action | Feature | Permission |
| --- | --- | --- |
| Customers (list, detail, bills) | `invoices` | (owner / admin / staff) |
| Add / edit a customer | `invoices` | `customers.create` |
| Credit book, ledger, share statement | `invoices.credit-book` | `invoices.credit-book` |
| Receive payment | `invoices.credit-book` | `invoices.credit-book` + `payments.receive` |
| Send reminder (only while something is due) | `invoices.whatsapp` | `invoices.credit-book` |
| Expenses, categories | `expenses` | `expenses.manage` |

- **Customers** (customers.tsx): search (name, phone, GSTIN), all / has dues / advance / settled with the server's
  counts, infinite scroll, "Over credit limit". **Detail** (customer-detail.tsx): call (`tel:`) and WhatsApp (`wa.me`,
  the web's `whatsappNumber`), balance due / advance / settled, the credit-limit meter (with the credit book only; dues
  only; warning above 80%), the latest 10 bills (`GET /invoices?customerId=`). **Form** (customer-dialog.tsx): name,
  phone, email, GSTIN (format + check character, ported from packages/gst), address; with the credit book the opening
  balance (owes / advance, signed) and credit limit (empty = none). Edits send only the changed fields
  (`PATCH /invoices/customers/:id`).
- **Credit book** (credit-book.tsx): to receive / advance held / customers with dues, due / advance / all, the age
  buckets (`current`, `1-30` … `90+`) with the `facets.age` counts, the web's sorts (`-due` by default, oldest due,
  latest payment, name), search; rows show due since / last activity, overdue, Receive and Remind.
- **Ledger**: this financial year by default (as the web), this month, last month or picked dates; the balance brought
  forward, each entry with debit / credit and the running balance as an amount + due / adv., totals, closing balance.
- **Receive payment** (receive-dialog.tsx): the balance prefilled, method, date (IST, not after today), reference,
  note; then the server's answer: the bills settled oldest first, the advance kept, or "no open bills". Key:
  `receipt:<customer>:<balance before>:<amount>:<method>:<date>:<ref>:<note>`, so a retry after a lost answer is
  replayed, not a second receipt.
- **Share statement**: `POST …/statement/share` → the web's due / advance / settled message →
  `https://wa.me/<phone>?text=…` (no usable phone: WhatsApp asks whom to send it to). **Remind**: `POST …/remind` sends
  from the shop's number; when that fails, the message offers "Use WhatsApp" with the statement link (the web's
  fallback).
- **Expenses** (expenses.tsx): this month / last month / picked dates and a category filter; the period's summary
  (`/expenses/summary`: spent, GST, entries, by category) and the list (recorded and cancelled, as the web: cancelled
  struck through and out of the totals). **Form**: amount incl. GST, date (IST, not after today), category (default
  the built-in Other), paid by, note ≤ 1000, reference ≤ 100; edits send only the changes; **Cancel** (`DELETE` answers
  with the cancelled expense). **Categories**: add, rename, delete (built-ins can't be deleted; the server's 409 for a
  used or duplicate name is shown). Built-in names are translated.

Not on the phone yet (web only): deleting customers or receipts; state on the customer form; the PDF / CSV statement
and ledger downloads; the statement QR and editing the WhatsApp number before sending; expense GST rate, vendor /
vendor GSTIN and receipt photos (an existing expense's GST is shown and kept on edits); the by-month chart, CSV export
and profit report.

### POS terminal mode (docs/pos-terminals.md)

Two ways to use the app: the owner / staff sign-in, or **"Use this phone as a POS terminal"** on the sign-in screen.

- **Pairing**: scan the pairing QR (`srikit-pair:1:<apiOrigin>:<code>`, mobile_scanner) or type the code (`ABCD-2345`,
  case-insensitive, dash optional) → `POST /v1/pos/pair` with `device { platform, model, appVersion }`. The device
  token goes to secure storage (`SessionStore.saveTerminal`) and `ApiClient.deviceToken` sends it as
  `x-device-token` on **every** request. When the QR names another API origin than the build's `SRIKIT_API`, the
  client switches to it (`ApiClient.setBaseUrl`) and the origin is stored with the token. A paired phone opens on its
  lock screen at launch; no owner session is used. A 401 `device_not_paired` from any request (`ApiClient.onUnauthorized`)
  forgets the pairing and shows pairing with "This phone was unpaired"; Terminal → Unpair calls `/device/unpair`.
- **Lock screen**: shop · terminal name, the team from `/staff` (a null name shows "Team member", no PIN → "No PIN yet"),
  a big PIN pad (4–6 digits). `POST /session` → the PIN token is the bearer (12 h, no slide; the phone keeps it in
  memory only and locks when it expires). `pin_invalid` shows the tries left, `pin_locked` a countdown that closes the
  pad, `pin_not_allowed` its message. Auto-lock after `settings.lockAfterMinutes` without a touch, and on coming back
  from the background after that long (`IdleLock`). "Switch cashier" → `/session/lock`. Another cashier gets a fresh
  counter (cart, keys); the same cashier comes back to the cart.
- **Unlocked**: role `pos` → the Bill tab (counter/) with the till register fixed to the terminal's name; role
  `weighing` → the weighing station. Gates come from the PIN session's roles / permissions and `/device` features.
- **Catalogue on the device** (`PosCatalog`): `GET /v1/pos/catalog` full sync, then `since` deltas (`removed` and
  inactive items leave, `full: true` replaces), paging with `next` (later pages send `after` alone), ETag /
  If-None-Match → 304 on the first page. Applied only after the last page (a failure keeps the old cache). Synced on
  unlock, every 5 min while unlocked, and from Terminal → Sync items / pull-to-refresh (weighing). Search and scans use
  it first: a code matches any barcode, then the SKU (any case), then a scales PLU; search ranks barcode → SKU → name
  prefix → the rest; then the API lookup / resolve as before. Categories from `/catalog/categories` are chips on the
  Bill tab and the weighing station. `soldBy: weight` items ask for the weight in kg (3 decimals).
- **Storage choice: a JSON file per shop** (`pos_catalog_<shopId>.json` in the app support directory), read and written in
  a background isolate, search over an in-memory index. Measured with 5,000 items (2.1 MB): AOT on a loaded Windows
  desktop, encode ~150 ms + write ~60 ms, read ~60 ms + decode ~150 ms + parse ~50 ms; flutter test JIT: index build
  ~340 ms, search ~8 ms. The file is written only when items or categories changed. sqflite / drift would save
  incremental upserts but add a native plugin (drift also code generation) for a cache that is rebuilt from the server
  anyway; revisit past ~20k items.
- **Weigh tickets at the counter**: a ticket code (`W` + 11 digits, scanned or typed) → `GET /weigh-tickets/by-code/:code`
  → its lines go in as fixed lines at the server's prices (no qty / price / discount changes; tapping one offers to remove
  the whole ticket). 404 / 409 used / 409 cancelled / 410 expired have their own messages; `/counter/resolve` answers
  tickets too (state checked on the phone). After the bill is created, `POST /weigh-tickets/:id/use { invoiceId }` per
  ticket with an ActionKeys Idempotency-Key per (bill, ticket); a lost answer is retried with the same key before the
  payments (the server answers a repeat with the ticket), a 409 from another bill is shown on the done screen.
- **Weighing station** (role `weighing`, `pos.weigh`): search / categories with by-weight items first; weigh sheet with
  the scale's weight (`ScaleReader`: `ManualScaleReader` keypad entry now, `BluetoothScaleReader` is a documented
  stub), tare, net (> 0, ≤ 999.999 kg), count items ask how many; Issue ticket (`POST /weigh-tickets`, one key per set of
  lines) → the ticket screen with the code as a Code 128 barcode (srikit_print's encoder, CustomPainter) and Print
  (srikit_print's weigh-ticket layout, preview); Today's tickets with cancel.

Differences from the web POS: no held bills / returns on the phone; scales are manual entry only (the web reads Web
Serial scales); the PIN session is not kept across an app restart (the web keeps it for a tab reload); the phone's
idempotency keys for `use` are `<deviceId>:<uuid>` from ActionKeys (the web derives `pos-ticket-use:<bill>:<ticket>`).
Live smoke: `test/live/pos_live_test.dart` (skipped unless `SRIKIT_LIVE_API` / `SRIKIT_LIVE_EMAIL` are set; it re-pairs
the shop's "Counter 1" and "Weighing 1").

### Feature gates

Tabs are gated with the same feature keys as the web: Bill needs `invoices`, Orders needs `orders`
(`GET /v1/features` → `enabled`). The Home numbers (`GET /v1/invoices/summary`) need `invoices` and an owner, admin or
staff role, the same rule as the server's route.

## State management: ChangeNotifier + InheritedNotifier

One `AppController` (a `ChangeNotifier`) holds the session, shops, open shop and language, and `AppScope`
(an `InheritedNotifier`) hands it to widgets. The slice has one linear flow and a handful of screens, so Riverpod's
providers and code generation would add a dependency and concepts without removing any code. Screens keep their own
local state (`StatefulWidget`). Navigation is a screen per `AppStage`, not go_router: there are no deep links yet.
Move to go_router when screens need URLs (push notifications opening an order, deep links); the controller stays.

## Stubbed

- **Firebase phone sign-in.** `PhoneSignIn` has an `OtpPhoneSignIn` (used now) and a `FirebasePhoneSignIn` stub
  (TODO-marked in `dart/srikit_kit/lib/src/phone_sign_in.dart`). No Firebase packages or `google-services.json` /
  `GoogleService-Info.plist` yet. `phoneSignInFor` always returns OTP; switch it on `AuthClientConfig.usesFirebase`.
  In production with Firebase on and no SMS provider, `/otp/request` answers `400 sms_via_firebase`, so Firebase must
  be wired before a production release.
- **Push (FCM).** `PushRegistrar` calls `POST /v1/notify/push-tokens` after a shop opens and
  `DELETE /v1/notify/push-tokens` on sign-out, but the token source is `NoPushTokenSource` (returns null, nothing is
  sent) until firebase_messaging is added.
- **Fonts.** `fontSans` / `fontHeading` are set as font families but not bundled, so the platform font is used.
- **Printing** is preview-only (no Bluetooth printer plugin yet). **New-order alerts** poll instead of push.
- **App icon / splash art** are Flutter defaults.
