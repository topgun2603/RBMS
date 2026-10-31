# Offline billing for the web POS

Built 2026-10-24 (market-plan M3 for the web counter). A cashier keeps billing when the internet drops, and the bills
reach the server safely later: once, with the right number, with anything odd flagged for a person.

Status: server and queue logic are tested (Postgres + unit tests); the React screens and the IndexedDB adapter are
type-checked but **not exercised in a browser** (no browser in the build environment). See "Verified and assumed".

## What the cashier gets

| Situation | Behaviour |
|---|---|
| Internet drops while the POS is open | Red bar: "You're offline. Keep billing". Scan / search keeps working from the cached catalogue; the bar shows how old the prices are ("Prices as of 12 min ago", a warning after 24 h). |
| Pay | The payment screen stays usable: cash, UPI (QR is made on the device, "received" is confirmed by hand) and card (manual, with a reference). Credit book and loyalty points are hidden (they need the server). A cart with a weigh ticket can't be billed offline. |
| Slip | Printed / shown from the device. Number = a **reserved invoice number** when the counter holds one (final, see below), else a clearly different `OFF-A1B2-0007`. |
| Back online | Automatic: reserve numbers, send waiting bills oldest first, toast with the result. Also "Sync now" and a retry every minute while bills wait. |
| Pending bills | Button in the bar (and the count). Lists queued / failed bills and synced bills that need a look: status, number, error, flags in English and Tamil, Retry, Cancel bill, Slip (reprint with the final number), Export JSON for support. |
| Leaving | Closing the tab asks first; "Exit" / "Lock" on the counter confirms when unsynced bills exist. |
| Hold / resume | Works offline (held bills were always on the device). |
| Returns | Against a bill that is **already on the server**: needs the connection (said on the Returns screen). A bill made offline that hasn't been sent can be **cancelled** from Pending bills; it syncs as cancelled so its number is accounted for. Partial returns of an offline bill wait until it has synced. |
| Customers | Customers the counter has seen (search or pick) are remembered (latest 500, in IndexedDB) and searched offline. An unknown customer is billed as a walk-in with the mobile number typed. |

## Bill numbering: the decision

GST needs a consecutive serial number, unique per financial year, at most 16 characters (Rule 46). The repo issues numbers
in `invoice_series (tenant, branch, FY)`, locked per issue; `invoices` has a unique index on `(tenant, branch, fy, seq)`.

**Chosen: reserved blocks of the real series, with a provisional label as the fallback.**

1. While online, a counter asks for a block of 50 numbers (`POST /v1/pos/offline/blocks`). The server takes them from the
   *same* series in one transaction (`InvoicesService.reserveSeqBlock`: locks the series row, bumps `next_seq` by 50) and
   records the block (`pos_number_blocks`) in that same transaction, so no number is taken without a record of who holds it.
2. Offline, each bill takes the next number of the block and prints it. It is the final legal number, so the customer's
   slip is already a correct tax invoice. At sync the bill is issued with exactly that FY/prefix/sequence
   (`InvoicesService.create(..., { presetNumber })`).
3. Online bills continue after the block. So two counters, or an online till and an offline one, can never share a number
   (tested with parallel reservations against Postgres).
4. **No silent gaps.** Every reserved number ends in exactly one of: a synced bill (`pos_offline_bills.block_id + seq`), a
   bill cancelled at the counter (recorded in the block's `voided` list as `bill_voided`), or an explicit release of the
   unused numbers when the block is closed (`unused`, or `lost_device` by a manager), each with who and when, plus an audit
   entry (`pos.offline.block.*`, `pos.offline.void`). The counter closes a block by itself when its financial year ends and
   all its bills have synced; a manager can close a block of a stolen / dead device (`POST /offline/blocks/:id/close`
   `{ reason: "lost_device" }`).
5. If the block is used up (or none was ever reserved, e.g. a brand-new counter that was never online), the bill gets
   `OFF-<last 4 of device>-<n>` on the slip and the **server assigns the legal number at sync**. The slip is then not the
   tax invoice: the synced bill shows the final number, "Slip" in Pending bills reprints it, and the WhatsApp receipt (sent
   by the normal path once synced) carries the final number.
6. If a reserved number can't be used at sync (the block was closed meanwhile, a different device sent it, the FY differs
   from the bill date, the number is already taken) the bill still posts with a fresh number and carries the flag
   `number_reassigned`; the slip given to the customer shows a different number, so reprint / re-share it.

### GST implications (read before relying on it)

- Numbers are consecutive in the series but **not in date order**: bills made offline at 11:00 and synced at 14:00 take lower
  numbers than online bills issued at 12:00. Rule 46 asks for consecutive numbers, not date-ordered ones, but some auditors
  expect date order. The alternative (provisional numbers only) avoids this at the price of the customer holding a slip that
  is not the invoice. Owner to decide if the shop prefers that (set block size to 0 by not reserving: not exposed yet).
- A cancelled / unused number is a *cancelled document*: GSTR-1 Table 13 (documents issued) must show it in "cancelled".
  The repo has no documents-issued report yet; the data is in `pos_number_blocks.voided` (+ cancelled invoices). A report
  that lists them is the follow-up for a CA-ready filing.
- E-invoice (turnover above the threshold): IRN generation and e-way bill run at sync time, from the normal `issued` event,
  not offline. The portal's reporting window (30 days from the invoice date for large taxpayers) means a long outage can
  make a late sync a compliance problem: bills synced more than a day late get the `late_sync` flag.
- The bill date is the day it was made (device clock, IST); the FY of the number is the bill date's FY. A bill made on
  31 March and synced in April keeps the old FY only if a block of the old FY is held; otherwise it is re-numbered
  (`number_reassigned`).
- Invoice number length stays within 16 characters because the device formats numbers with the same `formatInvoiceNumber`.

## Data model (migration `0031_offline_billing`)

- `pos_number_blocks`: tenant, device_id (paired terminal id, or a browser-made id), terminal_id, branch_id, fy, prefix,
  from_seq, to_seq, status open/closed, `voided` jsonb `[{ seq, reason, at, by, clientId? }]`, reserved_by, closed_*.
- `pos_offline_bills`: tenant, **client_id (UUID, the idempotency key; unique per tenant)**, device_id, user_id, status
  processing/synced/failed/voided, attempts, claimed_at, payload (the bill as sent), billed_at, block_id + seq (unique
  where set), provisional_number, invoice_id, number, flags jsonb, error jsonb, reviewed_at/by/note, synced_at.

Cross-package: `@rbms/pos` owns the tables and the logic; it reaches invoices through a small port
(`PosInvoicesPort`: reserveBlock, issue, pay, get, findBySeq) implemented in `apps/api/src/kit-pos-offline.ts` on
`InvoicesService`. Only two additions to the invoices service: `reserveSeqBlock` and `CreateOptions.presetNumber`.

## API (`/v1/pos/offline`, all need a signed-in staff session or a terminal PIN session)

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/blocks` | `invoices.create` | `{ deviceId?, count (5..200, default 50) }` -> block. A paired terminal's id is used as the device (the body can't spoof it). Max 3 open blocks per device: 409 `block_limit`. |
| GET | `/blocks` | `pos.devices` | `status?`, `deviceId?`; includes `used` counts. |
| POST | `/blocks/:id/close` | `invoices.create` (own) / `pos.devices` | `{ reason: "unused" \| "lost_device", note? }` -> `{ block, released[] }`. 409 `block_has_pending` while a failed / in-flight bill holds a number. Closing twice is a no-op. |
| POST | `/sync` | `invoices.create` | `{ bills: [<=25] }` -> `{ results: [...] }`, one per bill, in order. |
| GET | `/bills` | `pos.devices` | Review list: `status?`, `flagged=true` (unreviewed flags), paged. |
| POST | `/bills/:clientId/review` | `pos.devices` | `{ note? }`: a manager has looked at the flags. |

`/sync` result per bill: `{ clientId, status: synced | voided | failed | in_progress, duplicate, invoiceId, number, total,
paid, balance, flags[], error?: { code, message, retryable } }`.

### Sync rules (server, `packages/pos/src/offline.ts`)

- **Idempotency**: the row `(tenant, client_id)` is claimed first (unique index). A repeat of a synced key returns the
  first result with `duplicate: true` and issues nothing; a repeat while the first is running returns `in_progress`
  (client keeps it queued); a failed key (or a first attempt older than 2 min) is taken over exactly once by one retry.
  A retry after a crash between "invoice created" and "payments recorded" re-uses the stored `invoice_id` and records only
  the payments still missing (`remainingPayments`), and a reserved number whose invoice already exists is adopted
  (`findBySeq`). The generic `Idempotency-Key` middleware (packages/idempotency) is used for the *online* bill: the counter
  now sends one per cart, so a lost answer + second tap returns the first bill. It is the same idea, per request; the sync
  route needs per-bill keys, hence its own table.
- **Never block a sale**:

| Conflict | What happens | Flag |
|---|---|---|
| Stock goes below zero | Sale stands; item left negative | `stock_negative` (line) |
| Catalogue price changed while offline | Offline price kept as sold | `price_changed` (line, both prices) |
| GST rate changed | Offline rate kept | `tax_changed` |
| Item deleted / archived / store-only | `itemId` removed, line posts as free text | `item_missing` |
| Customer not found | Billed as walk-in with the captured name / mobile | `customer_missing` |
| Reserved number unusable | Fresh number from the series | `number_reassigned` (+ reason) |
| Till session closed meanwhile | Bill and payments posted without a till | `till_closed` |
| A payment refused | Bill stands; payment listed | `payment_failed` |
| Synced > 24 h after the sale | | `late_sync` |

  Price / tax flags compare the catalogue price the cashier saw offline (a snapshot sent with the bill) with the price at
  sync, so a manual price override at the counter is never flagged.
- **Failures** (plan limit 402, profile incomplete 400, server error ...) mark that bill `failed` with code, message and
  `retryable`; the others in the batch are unaffected. Retryable failures are retried by the client with backoff
  (15 s, 1 min, 5 min, 15 min, 1 h); others wait for the cashier's Retry. A network failure is never a failure: the bill goes
  back to queued with no attempt counted.
- E-invoice / e-way / WhatsApp / SMS: triggered by the normal `issued` / `paid` events when the invoice is created at sync.
  Nothing is sent offline.

## Client (`packages/pos-ui/src/lib/offline`, `components/offline`)

- `store.ts` (interface + in-memory), `store-idb.ts` (IndexedDB `sr_pos_offline:<shop>`: `bills`, `customers`, `meta`).
  `transact()` reads the numbering state, runs a synchronous callback and writes bill + numbering in **one IndexedDB
  transaction**, so two tabs of the same counter can't take the same reserved number, and a number is never consumed
  without its bill being saved.
- `numbering.ts` (allocate / needsBlock / stale blocks), `queue.ts` (enqueue, void, retry, prune, export), `sync.ts`
  (engine: batches of 25, results per bill, stale "syncing" recovery after a closed tab, block top-up and release),
  `bill.ts` (cart -> payload + the `Invoice` the receipt screen prints), `customers.ts`, `api.ts`.
- `OfflineProvider` (auto-sync on back-online, every minute while bills wait, `beforeunload` guard), `OfflineBar`,
  `PendingBillsDialog`. Strings in `messages-offline.ts` (English + Tamil).
- Without IndexedDB (private mode) the queue is in memory, the bar warns "don't close this tab", and **no blocks are
  reserved** (a block reserved per reload would leak numbers); bills get `OFF-` numbers.

### For the printing code (`receiptData` hook)

Offline slips reuse the existing receipt screen. `offlineInvoice(bill)` / `slipInvoice(bill)` in
`lib/offline/bill.ts` return an `Invoice` whose `id` starts with `offline:` (`isOfflineInvoice(inv)`) and whose `number` is
the slip number. Call `isOfflineInvoice` in `receipt-view` to skip `fetchPdf(thermalPath(id))` and the WhatsApp send for
such an invoice (the thermal PDF and the share link only exist after sync), and to title an `OFF-` slip "Provisional
receipt" instead of "Tax invoice". Once synced, `slipInvoice` returns the real invoice id and final number, so reprints and
WhatsApp work normally. I did not touch `receipt-view.tsx`, `print.ts` or the printing settings.

## Tests

- `packages/invoices/src/offline-numbers.db.test.ts` (needs `INVOICES_TEST_DATABASE_URL`): parallel reservations get
  disjoint blocks, online bills continue after a block, a reserved number is used exactly once, FY mismatch refused.
- `packages/pos/src/offline.db.test.ts` (needs `POS_TEST_DATABASE_URL`; fake invoices / catalogue): routes + permissions,
  reservation limits, sync with a reserved number, replay -> one invoice, three parallel retries -> one invoice, number
  conflicts (taken, wrong device, out of range, unknown / closed block, FY), flags (price, tax, missing item, negative
  stock, missing customer, late), failure then retry, crash between invoice and payments, voided bills, closing a block,
  review list, batch limits.
- `packages/pos/src/offline-logic.test.ts`, `packages/pos-ui/src/lib/offline/offline.test.ts` (in-memory store, fake
  server): numbering, parallel enqueue, queue / void / export / prune, sync batches, replay, offline -> online transitions
  (mock fetch failures: network, 502, 403), retry delay and forced retry, stale syncing recovery, block top-up and release.
- Run: `npx vitest run --maxWorkers=2` per package; DB tests with
  `$env:POS_TEST_DATABASE_URL="postgres://srikit:srikit@127.0.0.1:5432/srikit"` (and `INVOICES_TEST_DATABASE_URL`).

## Verified and assumed

Verified: invoice number blocks and preset numbers against Postgres, including parallel reservations; the whole sync
service and routes against Postgres with fake invoices / catalogue; the real endpoints on the dev API (reserve, sync,
replay, close) with the real invoice service, then cleaned up; the client queue / numbering / sync logic with an in-memory
store; type checks of `invoices`, `pos`, `pos-ui`, `apps/api`.

Assumed (no browser here): the IndexedDB adapter (a transaction that stays open across one awaited read, standard
behaviour), the React components and dialogs, the online -> offline detection timing, printing of an offline slip.

## Limits and decisions for the owner

1. **Reloading the page while offline does not work** (no service worker for the billing app; the page must stay open
   when the internet drops, or be opened once online). An installable app shell is the next step; the Flutter M3 work
   covers the phone.
2. Numbers are consecutive but not date-ordered (see GST implications). Decide: reserved blocks (this build) or provisional
   slips only.
3. A bill's cashier on the server is the person who **syncs** (`created_by` of payments), not necessarily who sold. The
   cashier's name is kept in the device export only.
4. Discount limits / manager approval (`discount_approval_required`) are not enforced for offline bills (no manager PIN
   offline, and the limit is checked on the normal create route); review flagged discounts in the day report.
5. Plan quota: if the plan's invoice limit is reached before the sync, the bill fails with 402 (retryable) until the plan is
   raised. Sales are never refused offline.
6. A lost or wiped device leaves its block open; a manager closes it with `lost_device`. Later bills from that device (if it
   comes back) are re-numbered.
7. Offline offers / coupons / loyalty are not cached; loyalty and credit book are online only. Weigh tickets are online only.
8. Cash-drawer / till: the till session id is sent with the bill; if the shift was closed before sync the bill is posted
   without a till (`till_closed`) and the cash is not in any Z report: close the day after syncing.
9. Block size (50), low-water mark (15) and the 24 h late-sync flag are constants (`numbering.ts`, `offline-logic.ts`).
