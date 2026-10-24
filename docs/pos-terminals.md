# POS terminals: pairing, PINs, catalogue, weighing station

Contract for multi-terminal POS (2026-10-22). The back end (`@srirealtime/pos`, `/v1/pos`) implements exactly this;
the web POS (`pos-ui`, admin screens) and the Flutter app build against it. Change this file first if the contract has
to change, and tell the other workstreams.

## Concepts

- **Terminal**: one checkout or weighing point of a shop ("Counter 1", "Weighing 1"). Row in `pos_terminals`. Role
  `pos` (billing counter) or `weighing` (weighing station). Its name is also the till `register` name, so each terminal
  has its own till session (`/v1/invoices/till/*?register=<terminal name>`).
- **Paired device**: the one browser or phone that runs a terminal. It holds a long-lived **device token**. Pairing a
  new device to a terminal replaces the old one (its token stops working).
- **Staff PIN**: 4–6 digits per member per shop, unique within the shop. On a paired device the cashier unlocks with
  the PIN alone (no phone OTP); that gives a short staff session bound to the device.
- **Weigh ticket**: a weighing station weighs loose goods and issues a ticket with a barcode; the POS scans it and the
  lines go into the cart at the server's prices. A ticket is used once.

## Feature, permissions, limits

- Features (module `pos`): `pos.terminals` (paired terminals + PIN unlock; on for apps BL, EC, PH, RS; starter plan
  up) and `pos.weighing` (weighing station + weigh tickets; dependsOn `scales`; off by default, the grocery / bakery /
  fresh packs switch it on with `scales`).
- Plan limit `pos_terminals` (count of non-deleted terminals): free 1, starter 2, pro 5, enterprise unlimited.
  Creating one over the limit: 402 `plan_limit` (same shape as other plan limits).
- Permissions: `pos.devices` (manage terminals, pairing codes, reset staff PINs; manager), `pos.weigh` (use a weighing
  station; cashier and manager), existing `pos.till`. Owners/admins have everything.

## Tables (migration `0024_pos_terminals`; 0020–0023 were already taken)

```
pos_terminals
  id uuid pk, tenant_id uuid, name text (1..40, unique per tenant among non-deleted), role text 'pos'|'weighing',
  branch_id uuid null, location_id uuid null,
  settings jsonb default {}  -- { printerWidth: 58|80, autoPrint: bool, lockAfterMinutes: 1..60 (default 5) }
  device_token_hash text null unique, device jsonb null  -- { platform: 'web'|'android'|'ios', model, appVersion, name }
  paired_at timestamptz null, last_seen_at timestamptz null,
  pairing_code_hash text null, pairing_expires_at timestamptz null,
  deleted_at timestamptz null, created_at, updated_at

pos_staff_pins
  tenant_id uuid, user_id uuid, pin_lookup text  -- HMAC-SHA256(APP_SECRET, tenantId + ':' + pin), hex
  updated_at; pk (tenant_id, user_id); unique (tenant_id, pin_lookup)

pos_pin_attempts            -- lockout bookkeeping
  terminal_id uuid pk, failures int, locked_until timestamptz null, updated_at

pos_weigh_tickets
  id uuid pk, tenant_id uuid, terminal_id uuid, code text (unique per tenant), status 'open'|'used'|'cancelled',
  lines jsonb  -- [{ itemId, name, unit, qty (3 decimals), unitPrice (paise, as the catalogue sells), amount (paise),
               --    taxInclusive, gstRate, hsn, tareKg? }]
  total int (paise), created_by uuid, used_invoice_id uuid null, used_at, created_at, expires_at (end of the IST day)
```

Tokens and codes are random (crypto); only hashes (sha256) are stored, never the raw values.

## Headers and request context

- A paired device sends `x-device-token: <token>` on **every** request. A context hook (after tenancy, before auth)
  resolves it: sets `ctx.tenant` from the terminal when no shop was given (and refuses a mismatch with `x-tenant`
  / host: 403 `device_shop_mismatch`), sets `ctx.device = { terminalId, role, branchId, locationId }`, and updates
  `last_seen_at` at most once a minute. Unknown or revoked token: 401 `device_not_paired`.
- A PIN session is an ordinary auth session (`auth_sessions`) with `terminal_id` set and `client = "srikit-pos"`.
  It is valid **only together with that terminal's device token**; without it, 401 `device_required`. TTL 12 h,
  no sliding.
- `ctx.branch` for a device request = the terminal's branch (the branches hook honours `ctx.device.branchId`).

## Endpoints (`/v1/pos`)

All bodies JSON, money in paise, errors `{ error: { code, message, details } }`. Writes accept `Idempotency-Key`.
Every route is `documented()` (typed in the API document).

### Terminals (staff session with `pos.devices`, feature `pos.terminals`)

| Method | Path | Body → Response |
|---|---|---|
| GET | `/terminals` | → `{ items: Terminal[], total, limit: number \| null }` |
| POST | `/terminals` | `{ name, role, branchId?, settings? }` → `{ terminal: Terminal, pairing: Pairing }` |
| PATCH | `/terminals/:id` | `{ name?, role?, branchId?, settings? }` → `Terminal` |
| POST | `/terminals/:id/pairing-code` | → `Pairing` (new code; the old code stops working; the paired device keeps working until a new device pairs) |
| DELETE | `/terminals/:id/device` | → `Terminal` (unpairs: token invalid, its PIN sessions revoked) |
| DELETE | `/terminals/:id` | → `{ ok: true }` (soft delete + unpair) |

```
Terminal = { id, name, role: 'pos'|'weighing', branchId, locationId, settings: { printerWidth, autoPrint,
  lockAfterMinutes }, paired: boolean, device: { platform, model, appVersion, name } | null, pairedAt, lastSeenAt,
  pairingPending: boolean, createdAt }
Pairing = { code: "ABCD-2345" (8 chars from 23456789ABCDEFGHJKMNPQRSTUVWXYZ, dash after 4), expiresAt (15 min),
  qr: "srikit-pair:1:<apiOrigin>:<code>" }
```

### Pairing (public, no session)

| Method | Path | Body → Response |
|---|---|---|
| POST | `/pair` | `{ code, device: { platform, model?, appVersion?, name? } }` → `{ deviceToken, terminal: Terminal, shop: { id, slug, name, appId } }` |

Code is case-insensitive, dash optional. Wrong / expired code: 400 `pairing_code_invalid`. Rate limit 10 per IP per
10 min: 429 `too_many_attempts`. Pairing clears the code (single use).

### Device (header `x-device-token`)

| Method | Path | Body → Response |
|---|---|---|
| GET | `/device` | → `{ terminal: Terminal, shop: { id, slug, name, appId }, features: string[] }` |
| POST | `/device/unpair` | → `{ ok: true }` (the device forgets itself) |
| POST | `/session` | `{ pin }` → `{ token, expiresAt, user: { id, name }, permissions: string[], tenantRoles: string[] }` |
| POST | `/session/lock` | (with the PIN session) → `{ ok: true }` (revokes it) |
| GET | `/staff` | → `{ items: [{ userId, name, hasPin }] }` (names for the lock screen; no PINs) |

PIN rules: wrong PIN 401 `pin_invalid` with `details.remaining`; 5 wrong in a row on a terminal → 429 `pin_locked`
with `details.retryAfterSeconds` (5 min). A correct PIN resets the count. A member removed from the shop or without
any POS-capable permission (`invoices.create` for `pos`, `pos.weigh` for `weighing`) gets 403 `pin_not_allowed`.

### Staff PINs (staff session)

| Method | Path | Body → Response |
|---|---|---|
| PUT | `/pins/me` | `{ pin }` → `{ ok: true }` |
| PUT | `/pins/:userId` | `{ pin }` (needs `pos.devices`) → `{ ok: true }` |
| DELETE | `/pins/:userId` | (needs `pos.devices`, or own) → `{ ok: true }` |
| GET | `/pins` | (needs `pos.devices`) → `{ items: [{ userId, name, hasPin, updatedAt }] }` |

PIN `^\d{4,6}$`, not all-same digits and not 1234 / 123456 / 0000 style sequences: 400 `pin_weak`. Taken by another
member: 409 `pin_taken` (message does not say who).

### Catalogue for the POS (device token + PIN session, or a staff session)

| Method | Path | Query → Response |
|---|---|---|
| GET | `/catalog` | `since?` (cursor), `limit?` (default 1000, max 2000), `after?` (page token) → `{ items: PosItem[], removed: string[], cursor, next: string \| null, full: boolean }` |
| GET | `/catalog/categories` | → `{ items: [{ id, name, parentId, position }] }` |

```
PosItem = { itemId (variant id, or billing item id when the catalogue is off), productId | null, name, variantTitle,
  sku | null, barcodes: string[], categoryId | null, price (paise), mrp | null, taxInclusive, gstRate, hsn | null,
  unit, soldBy: 'unit'|'weight', plu: string | null (scales PLU), image: string | null (thumbnail url),
  stock: { qty: number, status: 'ok'|'low'|'out'|'untracked' } | null, active: boolean, updatedAt }
```

Every active, POS-sellable item (store-only products excluded; billing-only included). `since` returns items changed
after the cursor plus ids removed / archived since then; `full: true` when `since` is absent or too old (> 7 days),
meaning "replace your cache". Clients page with `next` until null, then keep `cursor` for the next sync. ETag on each
page. `soldBy = 'weight'` when the item's unit is kg / g or it has a by-weight scales PLU.

### Weigh tickets (feature `pos.weighing`)

| Method | Path | Body → Response |
|---|---|---|
| POST | `/weigh-tickets` | (weighing terminal + PIN session with `pos.weigh`) `{ lines: [{ itemId, weightKg?, qty?, tareKg? }], note? }` → `WeighTicket` |
| GET | `/weigh-tickets` | `status?, limit?` → `{ items: WeighTicket[], total }` (this terminal's, today) |
| GET | `/weigh-tickets/by-code/:code` | (any POS session) → `WeighTicket` (404 `ticket_not_found`; used → 409 `ticket_used`; expired → 410 `ticket_expired`) |
| POST | `/weigh-tickets/:id/use` | `{ invoiceId }` → `WeighTicket` (status used; 409 `ticket_used` if already) |
| POST | `/weigh-tickets/:id/cancel` | → `WeighTicket` |

```
WeighTicket = { id, code ("W" + 11 digits, also the Code 128 barcode text), terminalId, status, lines: [...as the
  table], total, note, createdAt, expiresAt, usedInvoiceId }
```

Server computes every line from the catalogue (price per kg × net weight, rounded to the paisa; `qty` for count
items). Net weight = weightKg − tareKg, must be > 0 and ≤ 999.999. Clients never send prices.

The counter resolver (`GET /v1/counter/resolve?code=`) also recognises a ticket code and answers
`{ weighTicket: WeighTicket }` so existing scan paths can handle it.

When a bill is issued from a POS with ticket lines, the client calls `/weigh-tickets/:id/use` right after the bill is
created (with the same Idempotency-Key family). The invoice `cancelled` hook reopens tickets used by that bill.

## As implemented (back end, 2026-10-22)

Additions and precisions the back end settled; nothing above was removed or renamed.

- **Feature dependency:** `pos.weighing` depends on `pos.terminals` **and** `scales` (a weighing station is a terminal).
- **Extra error codes** (all `{ error: { code, message, details } }`):
  - `409 terminal_name_taken` (name unique per shop, case-insensitive, among non-deleted terminals); `404 terminal_not_found`;
    `404 branch_not_found` for an unknown / closed `branchId`.
  - `pin_weak` carries `details.reason`: `"format"` (not 4–6 digits) or `"simple"`; `404 member_not_found` for
    `PUT /pins/:userId` of someone who is not on the team.
  - `POST /session/lock` with a session that is not a PIN session of this terminal: `400 not_a_pin_session`.
  - Device routes without `x-device-token`: `401 device_not_paired`.
  - `POST /weigh-tickets` from a `pos` terminal: `403 weighing_terminal_required`; a bad line:
    `400 invalid_line` with `details: { index, reason }`, reason one of `item_not_found` (not sold at the counter),
    `weight_required`, `invalid_tare`, `invalid_weight`, `invalid_qty`.
  - Cancelled ticket on `by-code` / `use`: `409 ticket_cancelled`; `use` with an unknown bill: `404 invoice_not_found`.
- **`/pair`** ignores a stale `x-device-token` (a device can pair again). The rate limit counts every attempt;
  `429 too_many_attempts` carries `details.retryAfterSeconds`. Pairing to a shop with `pos.terminals` off: `403 feature_disabled`.
- **Device hook** also refuses a device of a suspended shop (403). The paired terminal's branch wins over `x-branch`.
- **PIN session** response `permissions` are the member's full permission list (owners/admins `["*"]`). A member needs
  `invoices.create` (pos terminal) or `pos.weigh` (weighing terminal); owners/admins always may. A correct PIN for a
  member who may not use the terminal still resets the wrong-PIN count.
- **Catalogue** routes have no feature gate (any shop member with `invoices.create`, `pos.weigh` or `catalogue.view`).
  Sellable = live variant of an active product on the `billing` or `pos` channel. `name` is "Product – Variant";
  `productId` is null when the shop's `catalogue` feature is off. An item counts as changed when its variant, product,
  scale PLU or (stock on) its stock row changes. `soldBy = 'weight'` for units kg / kgs / g / gm / gms / gram(s) or a
  by-weight PLU. `cursor` is opaque (quantised to the minute, 30 s overlap, so deltas may repeat a few items: upsert).
  `limit` default 1000, max 2000; send `since` *or* `after` (with `after` the token carries the sync's `since`).
  `ETag` + `If-None-Match` → 304.
- **Weigh tickets:** unknown body fields (e.g. a `price`) are ignored. `tareKg` defaults to the scale PLU's tare.
  Gram-priced items (unit g): `qty` is grams, price per g. `GET /weigh-tickets` from a device = that terminal's today;
  from a staff session without a device = every terminal's today. Permissions: create `pos.weigh` (weighing terminal);
  list / cancel `pos.weigh` or `invoices.create`; by-code `invoices.create` or `pos.weigh`; use `invoices.create`.
  `use` repeated with the same `invoiceId` answers the ticket again (retry-safe); another bill → 409 `ticket_used`.
- **Counter resolve** answers `{ weighTicket }` for a ticket code in **any** state (the counter's resolvers never fail):
  check `status === "open"` and `expiresAt` yourself, or call `by-code` for the error codes. It needs the counter's
  existing permissions (`invoices.create` + `invoices.view`).
- **Audit:** `pos.terminal.create | update | pairing_code | unpair | delete`, `pos.device.pair | unpair`,
  `pos.pin.set | reset | delete`, `pos.pin.locked`, `pos.session.create | refused | lock` (never PINs, codes or tokens).

## Scale reading (client side)

- Web weighing station: Web Serial API (Chrome / Edge) for USB / RS-232 scales that stream weight lines (e.g.
  `"  1.234kg"`, `"ST,GS,+  1.234kg"`); parser accepts kg / g, stable flag when present. Always a manual entry
  fallback. Settings remember baud rate (default 9600) per terminal (browser storage).
- Flutter weighing station: manual entry now; Bluetooth scales later behind a `ScaleReader` interface.

## Done means

Back end: migration, service, routes, hooks, permissions, plan limits, features; unit tests + Postgres tests
(`POS_TEST_DATABASE_URL`) for pairing, device auth, PIN rules and lockout, catalogue sync (full + delta + removed),
weigh tickets (pricing, use once, cancel-reopen); every route typed. Web: admin terminals page with QR + code, PIN
management in Team, pairing + PIN lock + cashier switch in the POS, full catalogue grid with offline cache, weighing
station page, ticket scan at the POS. App: pairing by QR, PIN lock, catalogue sync + local cache, ticket scan,
weighing-station mode.
