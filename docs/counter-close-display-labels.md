# Counter close, customer display and barcode labels

Gap items #13 (shift / cash drawer close, Z report), #30 (customer-facing display) and #29 (barcode label printing).
Migration **0053** (`apps/api/drizzle/0053_counter_close_display.sql`): `till_sessions` gets `z_number`, `handovers`,
`difference_reason`, `close_approved_by`, `close_approved_by_name` and a unique Z-number index; new table `pos_displays`.
Nothing else is stored for labels (designs live in the settings namespace `labels` and in the browser).

What was already there (and kept as it was): till sessions per register with opening cash or a note count, cash in / out,
the X report, closing with a denomination count, the 80 mm Z slip (`packages/invoices/src/till.ts`, `till-calc.ts`,
`pos-ui day-dialog`), the offline queue (`docs/offline-billing.md`), the AI unusual-activity alerts that read closed tills
(`packages/ai/src/counter`) and the accounting posting of the closing difference (`docs/accounting.md`).

## 1. Shift close, Z report and handover (#13)

### Pay-in and pay-out

`POST /v1/invoices/till/:id/cash` takes `category`: `petty_expense`, `owner_drawing`, `change_float` or `other` (the
default; entries made before categories existed read as "other"), the signed `amount` and a note (`reason`, up to 120
characters). The counter offers "out": petty expense, owner drawing, other; "in": change float, other. The Z report totals
cash in and out by category. Accounting posts the entry as before (against the till clearing account) with the category in
the narration ("Cash taken out of Counter 1 (petty expense): tea").

### X report and Z report

- **X report** (`GET /till/:id/x`, "Today (X report)" in the day dialog): the running totals of the open session, nothing is
  reset, printable any time.
- **Z report**: the same report frozen when the day is closed, numbered **Z1, Z2 ...** per register and branch. The number
  is taken inside the closing transaction under an advisory lock and a unique index backs it, so two closes never get the
  same number. A closed session cannot be closed again, receive cash or be re-opened (409 `till_closed`); the next day is a
  new session. Past Z reports stay reprintable from the day dialog ("Earlier Z reports", needs the reports permission).
- The report carries: bills and their total, **bill number range** (first and last by year and sequence), **discounts
  given**, **voids** (cancelled bills, count and value), **returns** (credit notes, count and value), net sales, **tax by GST
  rate** for the bills and the tax returned with credit notes, takings and refunds **by payment mode**, the cash block
  (opening, cash sales, cash refunds, cash in, cash out, handover differences, **expected**, **counted**, **difference**, the
  **reason** and the manager who approved it), pay-in / pay-out by category, the count by denomination, the handovers and a
  line for the cashier's and manager's signature. Reports frozen before this change simply lack the newer blocks and still
  print.
- **Printing**: `GET /v1/documents/till-z/:id.pdf` (80 mm), `till-z-58/:id.pdf` (58 mm) and `till-z-a4/:id.pdf` (A4), `?locale=ta`
  for Tamil. The counter remembers the paper per computer. File names are `Z7-Counter-1-2026-10-27.pdf`.

### Difference, reason and the manager PIN

Closing (and a handover) compares the count with the cash expected. A difference of any size needs a **reason**
(400 `till_reason_required`); it is stored (`difference_reason`) and printed. Beyond the shop's limit it also needs a
**manager's POS PIN** (403 `till_approval_required` with `details: { difference, limit }`; the counter asks for the PIN and
repeats the request with the `x-approval-pin` header). This is the same PIN and the same permission as discount approvals
(`invoices.discount-approve`, held by managers, owners and admins), with the same lockout (five wrong PINs in five minutes
per cashier, 429) and the same audit trail (`invoices.till.approved`, `invoices.till.approval_failed`). Owners and admins
close without a PIN. The manager who approved is printed on the Z report. The limit is `Settings, Counter rules`
(settings namespace `till`, `varianceLimit` in paise, default ₹100; 0 asks for every difference).

### Handover between cashiers

`POST /v1/invoices/till/:id/handover { toName, count | countedCash, reason?, note? }` (permission `pos.till`). Cashier A
counts the drawer, names cashier B and the day **stays open**. The handover (time, from, to, expected, counted, difference,
reason, approving manager) is added to the session and printed on the Z report; the session shows B as the current cashier.
A's difference stays with A: the next leg starts from the counted cash (`cash.handoverAdjust` moves the expected cash), so B
is only judged on what B handled. Accounting posts a handover difference like a closing one (cash short / excess). The
same reason and manager-PIN rules apply.

Note for the AI alerts: they still read the closing difference of closed sessions and attribute it to the person who opened
the till, as before. A handover difference is **not** part of that number, so it is not alerted on; it is on the Z report and
in the books.

### Offline queue

Bills made offline are tagged with the session but reach the server only when the queue syncs. The server cannot know what
is still on a device, so the day dialog does: when the device's queue has pending bills, **Close day** shows how many, offers
"Sync now" and stays disabled until they are synced or the cashier ticks "Close anyway" (those bills will not be in the Z
report). A bill that syncs after its session closed is kept and flagged `till_closed` for review, as before (not in any Z).

## 2. Customer-facing display (#30)

A second monitor or tablet shows the shop logo and name, the bill as the cashier adds lines, the total, the amount saved
(line discounts, price-list prices under the catalogue price, loyalty points), then a **UPI QR** for the amount being paid by
UPI (the same `upi://pay` link the payment dialog draws, from the shop's UPI id), then **Thank you** with the change for 12
seconds, then the idle screen: the shop's welcome and offer lines (Settings, Counter rules; English and Tamil) and rotating
photos of items with a photo, offers (MRP above price) first. Words follow the language the cashier uses for the bill (a
screen can be fixed to English or Tamil). Only the first name of a saved customer is ever shown: no phone, address or GSTIN.

**Pairing and security**

- The counter: top bar menu, **Customer display**. "On this computer" opens `/pos/display?local=<register>` in a pop-up to drag
  to the other monitor; it is fed by a `BroadcastChannel`, needs no setup and no server.
- Another screen or tablet: the counter makes a **6-digit code** (`POST /v1/pos/displays { name, register }`, valid 10 minutes,
  single use). The screen opens `/pos/display` on the shop's address and types the code (`POST /v1/pos/display/pair`, public,
  10 tries per address per 10 minutes). It gets a random **display token**, stores it in that browser and uses it as the
  `x-display-token` header. Only the SHA-256 of the token and of the code is stored (`pos_displays`).
- The token is scoped: it can read one register's feed and the idle content, nothing else (no account, no other route).
  The counter lists the screens of its register and can **remove** one (`DELETE /v1/pos/displays/:id`): the token stops at
  once and its open feed is closed. A removed screen shows the code form again.
- Staff routes need `invoices.create` or `pos.devices` and the `invoices` feature.

**Live updates.** The counter sends the state (`PUT /v1/pos/display/state`, at most about six times a second, and only
when it changed) and screens read `GET /v1/pos/display/stream`, server-sent events like the WhatsApp inbox (`kit-live.ts`). The
screen reads it with `fetch` so the token travels in a header, not the URL. States spread across API instances through the
same pub/sub as chat and the inbox (Redis, in memory in development); the last state is replayed to a screen that opens late,
out-of-order updates are dropped, a feed is cut after 30 minutes and the screen reconnects by itself ("Reconnecting").
The state is validated (`displayStateSchema`: at most 60 lines, only `upi://pay?` links, no unknown fields).

## 3. Barcode label designer (#29)

`documents/src/labels.ts` (what the gap analysis pointed at) is the wording of the PDF documents, not label printing; label
printing did not exist. It is built in `packages/receipt-print` (no dependencies, shared with the counter's printing) and the
designer in `packages/billing-ui`.

- **Where to print from**: Items > **Print labels** (header: pick items by name; row menu: that item), a purchase bill >
  **Print labels** (one label per unit received, batch and expiry from the bill lines), and the same dialog for a single item.
- **Sizes**: rolls 38 × 25, 50 × 25, 50 × 30 mm; 2-up roll (2 × 50 × 25, 103 mm wide); 3-up roll (3 × 33 × 22, 105 mm wide);
  A4 sheets of 65 (5 × 13, 38.1 × 21.2), 48 (4 × 12, 45.7 × 21.2) and 24 (3 × 8, 63.5 × 33.9), centred on the page with a
  "cells already used" skip for a part-used sheet and a dotted outline for a plain-paper alignment test. Labels differ a little
  between makers: print one test sheet first.
- **Fields** (a switch each): shop name, name, Tamil name, price, MRP, price-list price, unit / box, barcode, QR, batch,
  pack date, expiry, customer care. **Presets**: shop shelf, big price tag, barcode only, packed goods, wholesale / box.
  Type size small / normal / large, barcode Automatic / Code 128 / EAN-13, captions in English or Tamil.
- **Layout** (`label-layout.ts`, pure): fields stack from the top, the barcode sits at the bottom, a QR code takes the right
  edge. Type shrinks to fit (never below readable at 203 dpi); if it still does not fit, the least important fields are left
  out in a fixed order (customer care, shop name, Tamil name, price-list price ...) and the dialog says which. Fields an
  item has no value for are named, not printed blank. A barcode finer than 0.19 mm per module is flagged.
- **Barcodes** (`barcode.ts`): Code 128 (sets B and C, switching to C inside runs of digits) and EAN-13 (12 digits get their
  check digit; a 13-digit code must have the right one). Automatic uses EAN-13 for valid EAN digits and Code 128 for SKUs and
  internal codes. A box's own barcode (price lists and units, `docs/price-lists-units.md`) is used when the box is chosen,
  with the box price, MRP and "box of 12 pcs".
- **Prices**: the price printed is what the customer pays, GST included (a tax-exclusive item price is grossed up); the MRP is
  the catalogue MRP; the price-list price is resolved from the chosen list (`POST /pricelists/resolve`).
- **Tamil name**: items keep no Tamil name of their own, so it is typed in the designer and remembered on that computer.
- **Output**: (1) the browser's print dialog (A4 sheets, rolls, Save as PDF) from an exact-size HTML page, one page per sheet
  or per row across the roll; (2) a **roll label printer that speaks TSPL** (TSC, TVS, Xprinter and look-alikes) over the same
  USB / serial / Bluetooth / print-bridge connections as the receipt printer, with its own settings in the dialog (it is usually
  a second printer). Each row of labels is drawn as one 203 dpi picture (so Tamil prints with the page fonts) and sent with
  `SIZE`, `GAP`, `BITMAP`, `PRINT`. ZPL is not built. **The TSPL path has not been tried on a physical printer**: print one row
  first; if it comes out inverted, the `invert` option of `tsplLabelJob` is the one thing to flip.
- **Legal Metrology reminder** (a hint, nothing is enforced): when the MRP, pack date, expiry or customer care field is on,
  the dialog reminds that a pre-packed item needs the maker or packer's name and address, the net quantity, the MRP including
  all taxes, the month and year of packing and a customer care number.
- **Remembered**: the design on this computer, or as the shop default (Settings namespace `labels`, owners and admins).

## Where things are

| Piece | Where |
|---|---|
| Till maths, Z report content | `packages/invoices/src/till-calc.ts`, `till.ts`, routes in `routes.ts` |
| Manager PIN for differences | `apps/api/src/till-approval.ts` (wired in `kit.ts`), UI `useDiscountApproval` in `@rbms/web` |
| Z / X PDF (58, 80, A4; en, ta) | `packages/documents/src/renderers/till.ts`, registered in `builtins.ts` |
| Day dialog (X, cash in / out, handover, close) | `packages/pos-ui/src/components/day-dialog.tsx`, `lib/close-check.ts`, `lib/till.ts` |
| Counter rules page | `packages/pos-ui/src/pages/counter-rules.tsx` (Settings, Counter rules) |
| Display service and routes | `packages/pos/src/display.ts`, `display-routes.ts`, table `pos_displays` |
| Display screen and dialog | `packages/pos-ui/src/components/display/`, `lib/display.ts`, `lib/display-client.ts` |
| Label maths, barcodes, HTML, bitmap, TSPL | `packages/receipt-print/src/barcode.ts`, `label-*.ts`, `tspl.ts` |
| Label designer | `packages/billing-ui/src/components/labels/label-dialog.tsx`, `lib/labels.ts` |
| Strings (English, Tamil) | `pos-ui/src/lib/messages-close.ts`, `messages-display.ts`, `messages-rules.ts`; `billing-ui/src/lib/messages/labels.ts`; `documents/src/labels.ts` |

## Not done

- Customer display: slides uploaded by the shop (it shows item photos and the two text lines of Counter rules) and a
  per-screen layout choice.
- Labels: ZPL printers, free drag-and-drop layout, a Tamil name column on items.
- Handover differences are not in the AI unusual-activity alerts.
- Hardware and browser passes: the TSPL printer, the second-monitor display on a real tablet and the 58 mm PDF on a real roll
  have not been tried on physical devices.
