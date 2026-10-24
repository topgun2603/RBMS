# Stock depth: batches and expiry, stock audit, transfers with in-transit

Closes gap-analysis items #4 (batch / expiry for any item), #16 (physical stock count with variance) and #17 (branch
transfers with in-transit and receive). Code: `packages/inventory` (`batches.ts`, `audit.ts`, `transfers.ts`,
`batch-logic.ts`), UI in `packages/billing-ui` (Batches, Stock audit, Transfers) and `packages/pos-ui` (batch on the
counter line). Migration `0036_stock_depth`.

## What existed before (audit of the repo)

| Area | Before |
|---|---|
| `stock_items` | qty, reserved, reorder level, moving-average cost per item and location; everything that moves stock goes through one primitive (`InventoryService.change`) and is idempotent per reference |
| `stock_movements` | append-only ledger: opening, adjustment, sale, sale_cancel, sale_return(+cancel), purchase(+cancel), purchase_return(+cancel), transfer_out / transfer_in |
| Locations / branches | `stock_locations` (default Main), branches point at a location; `x-branch` picks the working location |
| Purchases / GRN | purchase orders, partial GRNs, bills, debit notes, per-FY numbers in `purchase_doc_series` (`PO/GRN/DN`) |
| Transfers | `POST /v1/inventory/transfers` moved stock at once (`stockTransfers`, no number, no status, no receive step, no challan, no UI) |
| Batches | **only** in `packages/medicines` (pharmacy): `medicine_batches` per item (no location), expiry required, FEFO in the bill hook, expiry report. Nothing for general items. Imports kept batch / expiry as text in the stock note |
| Stock count | none (only `adjust` per item) |
| Accounting | `stock_adjustment` posting for `opening` and `adjustment` movements (valued at the movement cost / average cost), periodic stock valuation otherwise |

## Design

### Batches sit under the stock totals

`stock_items.qty` stays the item's quantity per location, exactly as before, so every existing screen, report, test and
the books are untouched. `stock_batch_levels` says how much of that is in which batch; the rest is the item's
**unbatched** stock. Tables: `stock_batches` (item, batch no, mfg date, expiry, MRP, cost, supplier), `stock_batch_levels`
(batch x location), `stock_batch_movements` (append-only, carries the bill / credit note / transfer it belongs to),
`stock_batch_items` (per-item switch), `stock_batch_settings` (per shop).

* **Out** (sale, adjustment, transfer, purchase return, audit): `InventoryService.change` takes the quantity from the
  item's batches at that location, first the batch the cashier chose, then first-expiry-first-out (batches without an
  expiry last). Expired batches are used only as a last resort so the ledger stays true. An item without batches is not
  touched, so the rule is "if batches exist, use them".
* **In**: only when the caller names a batch: purchase bill line (`batchNo`, `mfgDate`, `expiry`), goods receipt line
  (`batches: [{ batchNo, expiry, qty }]`), `POST /batches` (receive new stock, or *assign* stock you already have),
  adjust with `batch` / `batchId`, an import row, a transfer receive (same batches).
* **Reversals** (cancel bill, cancel credit note, cancel purchase / GRN / debit note, cancel transfer) undo the batch
  movements of that reference (`reverseRef`, idempotent).
* **Returns** go back to the batch the bill took the goods from (`returnToSource`: oldest allocation first, never more than
  the bill took minus what already came back; the rest goes back unbatched).
* **Tracking**: an item uses batches when switched on (item form, `PUT /stock/:itemId/batches/tracking`), when the shop
  tracks all (`trackAll`) and the item did not opt out, or when it already has batches. The flag drives the UI (pickers,
  prompts); the stock rules above do not depend on it.
* **Expired stock rule** (`block` / `warn` / `allow`): `block` is enforced on `POST /v1/invoices` and
  `PATCH /v1/invoices/:id` (`apps/api/src/kit-stock-depth.ts` guard, 400 `batch_expired`); `warn` shows a warning on the line.
* **Near-expiry discount**: `suggestedDiscount` on every batch from the shop's ladder (default 20% within 30 days, 10% within
  60, 5% within 90); shown in the Batches list, the invoice line and the counter picker. Nothing is applied automatically.
* **Alerts**: dashboard tile "Expiring stock" (hidden when nothing is expiring), `GET /batches/alerts`, and a daily job
  `inventory.expiry-alerts` that emits a `stock.batch_expiring` webhook event per batch inside the alert window.
* **Invoice lines** carry `batchId`, `batchNo`, `mfgDate`, `expiry` (optional, in `@srirealtime/gst` `LineInput`); the A4
  bill, the thermal PDF and the on-screen bill print "Batch X · Exp ..." when present.

### Pharmacy (medicines) keeps working unchanged

I did **not** unify. `medicine_batches` is item-level (no location), requires an expiry, has its own ledger, the H1 register
is built from it, and the bill hook `medicines.onInvoiceIssued` allocates from it. Merging would have meant migrating live
pharmacy data and the register for no gain. Instead:

* An item Pharmacy manages (it has medicine details or medicine batches) can never be switched to generic batches (409),
  and generic batch ingest on purchases / receipts silently skips it. Pharmacy flows (`medicines.receive`, `adjust`) call
  the inventory total only, which is a no-op for the batch layer.
* The expiry summary and the Batches page read the pharmacy totals through `LegacyBatchPort` and link to Pharmacy.
* Imports: when the shop has the medicines feature on, a row with batch + expiry becomes a *medicine batch* (so a pharmacist
  sees it where they look); everything else gets generic batches.

### Physical stock audit

`stock_audits` (+ `stock_audit_lines`, `stock_audit_entries`). `POST /audits` freezes the system quantity of every tracked
item at a location (optionally a few categories): one line per item, or per batch plus an "unbatched" line. Statuses
`draft -> counting -> review -> approved` (or `cancelled`). Counting is blind (the system quantity is hidden): scan a barcode /
SKU (USB scanner, keyboard, or the phone camera through `BarcodeDetector`) or type; every action is an entry by a named
counter and a line's count is the sum of the counters' counts (`set` replaces only that counter's own count), so several
people can count at once. Unknown codes are returned, never silently dropped. An item found that was not in the snapshot gets
a new line (system 0). Review shows system / counted / difference / value at cost with a reason per line (bulk reason,
recount); approval needs a reason on every differing line, posts `adjustment = counted - system at the freeze` as an `audit`
stock movement per line (batch lines move their batch), freezes the totals, and writes audit-log entries
(`inventory.audit.*`). Because it is a delta, sales made while counting are kept. Uncounted lines are skipped (or written
off as zero when the approver chooses so). CSV of all lines or only differences. Permissions: `inventory.audit` (create,
count, review, export) and `inventory.audit.approve` (approve, cancel).

**Books**: `audit` movements are included in the existing stock-adjustment posting (`kit-accounting.ts` reads
`reason in ('opening','adjustment','audit')` and posts them as `adjustment`: Dr Stock gains and write-offs / Cr Stock in hand
for a loss and the reverse for a gain). No new account logic. The books value the movement at the item's moving-average cost,
the audit screen at the cost frozen with the session (batch cost when the line is a batch), so the two can differ by the
cost difference.

### Transfers with in-transit

`stock_transfers` gained `number`, `status`, `sent_at/by`, `received_at/by`, `closed_at`, `transport`, `receive_note`,
`cancelled_at`, `cancel_reason` (old rows are `closed`, number null). Numbers `TR/26-27/0001` use the same per-FY series
table as PO / GRN / DN (`purchase_doc_series`, kind `tr`). Flow: `draft -> send -> in_transit -> receive -> partially_received
-> closed` (cancel while nothing is received). **Send** takes the stock out of the source (`transfer_out`, batches chosen or
first-expiry-first-out, recorded on the line, cost frozen at the source average) and it then lives only on the note: in no
location, not sellable, listed on the in-transit report valued at cost. **Receive** adds the good quantity to the destination
(`transfer_in`, same batches, source cost into the destination average); damaged and short quantities are written off on the
note with a reason (they were already out of the source, so stock valuation falls by itself); a line can be received in parts;
"close with shortage" writes the rest off. The old `POST /v1/inventory/transfers` is `transfers.instant()`: create + send +
receive in one go with the same movements, so existing callers and tests do not change. A `stock.transfer_sent` event goes to
the developer webhooks and a `TransferNoticePort` (not wired to SMS / WhatsApp yet) lets a host notify the receiving branch.
The transfer note PDF (`GET /v1/documents/transfer-note/:id.pdf`, English and Tamil) has its own renderer
(`packages/documents/src/renderers/transfer-note.ts`); it is not a tax document (no tax, own-shop movement).

## Files

* `packages/inventory/src/`: `batch-logic.ts` (pure rules + tests), `batches.ts`, `audit.ts`, `transfers.ts`, `schema.ts`
  (tables), `service.ts` (`change()` takes batches out; sale / return / reversal / adjust / purchase hooks), `purchasing.ts`
  (GRN batches, debit note takes from the purchased batch), `routes.ts`, `permissions.ts`, `ports.ts`, tests
  `batch-logic.test.ts`, `stock-depth.db.test.ts`.
* `packages/gst/src/gst.ts` (`LineInput` batch fields), `packages/invoices` (line schema, stock port passes `batchId`).
* `packages/documents`: `renderers/transfer-note.ts`, batch line in `renderers/invoice.ts`, labels.
* `packages/importexport`: `columns.ts` (`parseBatchDate`: "03/2027", "Mar-27"), `specs.ts` (Mfg date), `vendors.ts`.
* `apps/api/src`: `kit-stock-depth.ts` (pharmacy port, expired-sale guard, transfer PDF, expiry job), `kit-io.ts` (batch
  import), `kit-switch.ts` (undo removes empty batches), `kit-accounting.ts` (one word: `'audit'`), `kit.ts` (small hunks).
* `packages/billing-ui`: pages `batches`, `stock-audits`, `stock-audit-detail`, `transfers`, `transfer-new`,
  `transfer-detail`; components in `components/inventory` (`batch-*`, `line-batch-select`, `item-batch-toggle`,
  `grn-batch-fields`, `scan-dialog`, `audit-bits`); `widgets/expiry.tsx`; messages `lib/messages/stock-depth.ts` (en + ta).
* `packages/pos-ui`: `lib/batches.ts`, `components/batch-pick-dialog.tsx`, `lib/messages-batches.ts`, small hunks in
  `cart.ts`, `cart-panel.tsx`, `pos-screen.tsx`.

## Migration

`apps/api/drizzle/0036_stock_depth.sql` (0035 is the AI foundation, not mine): 8 new tables and 11 new columns on
`stock_transfers` (all nullable or defaulted, `status` defaults to `closed` so old rows stay valid) plus indexes. Additive; no
existing column or table is changed. Applied to the dev database.

## API (all under `/v1/inventory`)

Batches: `GET|PUT /batches/settings`, `GET /batches/tracking?ids=`, `PUT /stock/:itemId/batches/tracking`,
`GET /batches/pick?itemId&qty`, `GET /batches/expiry-summary`, `GET /batches/alerts`, `GET /batches/sales/:invoiceId`,
`GET|POST /batches`, `GET|PATCH /batches/:id`, `POST /batches/:id/adjust`, `GET /batches/:id/movements`,
`GET /reports/batches[?format=csv]`. Audits: `GET|POST /audits`, `GET /audits/:id`, `/lines`, `/variance`, `/export`,
`POST /audits/:id/{start,count,submit,reopen,reasons,approve,cancel}`, `PATCH /audits/:id/lines/:lineId`.
Transfers: `GET /transfers`, `GET /transfers/:id`, `POST /transfers` (old, instant), `GET|POST /transfer-notes`,
`GET /transfer-notes/in-transit[?format=csv]`, `GET|PATCH|DELETE /transfer-notes/:id`, `POST /transfer-notes/:id/{send,receive,cancel}`.
Permissions: batches settings / receive / adjust = `inventory.adjust`; transfer notes = `inventory.transfer`; audits =
`inventory.audit` (approve and cancel = `inventory.audit.approve`). Feature keys are unchanged: batches and audits are part of
`inventory`, transfers of `inventory.locations`.

## Tests

* `packages/inventory`: `batch-logic.test.ts` (pure: dates, FEFO, ladder, count merge, variance), `stock-depth.db.test.ts`
  (10 database tests in a throw-away schema: receive / pick / FEFO / chosen batch / cancel / returns to the original batch /
  adjustments / assign / expired rule / purchases and GRN batches and their cancel / audit with two counters through approval /
  transfers in transit with partial receive, damage, shortage, cancel / the old instant transfer / tenant isolation and
  "batches never exceed the stock total"). Run with `INVENTORY_TEST_DATABASE_URL`.
* `packages/documents/src/transfer-note.test.ts`, `packages/importexport/src/batch-date.test.ts`,
  `packages/billing-ui/src/stock-depth.test.ts` (message parity, every literal key used by the new screens exists in both
  languages), `packages/pos-ui/src/lib/batches.test.ts`.
* Smoke on the dev API (bytefix and thunai): see the report; scripts were throw-away.

## Limits and decisions

* Batch sale lines print on the A4 bill, the thermal PDF and the screen; the direct ESC/POS receipt (`receipt-print`) does not
  print the batch yet.
* A bill created without a batch (API client, offline POS sync, store order) is allocated first-expiry-first-out at issue; the
  allocation is visible (`GET /batches/sales/:id`) but not printed on that bill.
* One bill line = one preferred batch; a quantity larger than the batch spills to the next batches by FEFO (the line still
  shows the first batch).
* The `block` rule is checked when a bill is created or edited, not by the offline sync or store orders.
* Debit notes (returns to the supplier) take from the batches the bill brought in, but the debit-note screen has no batch
  picker. Reservations (orders) commit first-expiry-first-out.
* Stock audit counts one location at a time; the camera scan needs a browser with `BarcodeDetector` (Chrome / Edge on
  Android, desktop Chrome); USB scanners and typing work everywhere. Offline counting is not built (each scan is a request).
* The audit's 20,000 line cap (count a few categories at a time for bigger catalogues).
* Transfers: no e-way bill for inter-state own-GSTIN transfers (the note is not a tax document); no notification is sent to the
  receiving branch beyond the webhook event; receiving by scanning is not built.
* Opening a transfer note's PDF needs the Chrome the documents module already uses.
* Pharmacy imports with batch + expiry create medicine batches only when the `medicines` feature is on.
