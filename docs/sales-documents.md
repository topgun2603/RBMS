# Proforma invoices, sale orders and delivery challans

Feature `invoices.sales-docs`; routes under `/v1/sales-docs`; UI in `@srirealtime/billing-ui` (Sell section: Proforma
invoices, Sale orders, Delivery challans; public page `/d/:token`; Settings > Proformas, orders & challans). Gap item #11
together with quotations (`docs/quotations.md`).

None of the three is a tax invoice. GST returns, sales reports, loyalty and the books only see the bills made from them
(and the advance receipts). Only a delivery challan moves stock.

## Design

- Code lives in `packages/invoices`, next to quotations: `sales-docs-calc.ts` (pure rules), `sales-docs-base.ts` (ports,
  series, customers, GST build, sending), `proformas.ts`, `sale-orders.ts`, `challans.ts`, `sales-docs.ts` (facade: quotation
  conversion, bill hooks, linked docs, PDF data, public page), `sales-docs-routes.ts`, tables in `schema-sales.ts` (re-exported
  by `schema.ts`). Wiring: `apps/api/src/kit-sales-docs.ts`; the bill hooks in `kit.ts` (`issued` puts advances on the bill,
  `cancelled` reopens challans and sale orders).
- Migration `0048_sales_documents`: tables `sales_doc_series`, `proforma_invoices`, `sale_orders`, `sale_order_invoices`,
  `delivery_challans`; columns `customer_receipts.against_kind / against_id / against_number` (advances) and
  `invoices.stock_moved_by` (a bill whose goods left on challans).
- GST maths is `computeInvoice` (place of supply from the customer's state / GSTIN, round-off to the rupee), customers and
  items are the invoices ones; the seller block is the branch over the billing profile, like bills.
- Numbering: `PI/26-27/0001`, `SO/26-27/0001`, `DC/26-27/0001`, one series per tenant, kind, branch and FY
  (`sales_doc_series`, same locking as `invoice_series`). Prefixes, proforma validity (15 days, 0 = no expiry), default terms
  of each, the advance % new documents start with and "hold stock" for new sale orders are the shop settings namespace
  `sales-docs`.
- Share and send like quotations: `POST .../:id/share` (a draft proforma becomes issued), `POST .../:id/send { channel, to?,
  locale? }` with notify templates `proforma.sent`, `sale-order.sent`, `challan.sent` (en + ta; vars shop, customer, number,
  amount, link). The customer opens `/d/:token` (`GET /v1/sales-docs/public/:token`, no ids) and downloads the PDF.
- PDFs: `/v1/documents/proforma|sale-order|challan/:id.pdf` (staff, `sales-docs.view`) and
  `/v1/documents/public/sales-doc/:token.pdf`. They use the invoice layout with the document's own title, number label,
  header rows, totals rows, footer blocks and terms (`packages/documents/src/renderers/sales-doc.ts`), English and Tamil.
  The screen shows the same through `InvoiceDocument`'s `doc` prop.

### Proforma invoice

- Statuses stored: draft, issued, converted, cancelled; **expired** is derived (issued and past valid-until). Editable until
  billed or cancelled (edits after issue are on the timeline).
- From scratch, or from a quotation (`POST /v1/quotations/:id/convert { to: "proforma" }`; issued at once, the quotation
  links to it; cancelling the proforma lets the quotation be converted again).
- **Advance** `POST /proformas/:id/advance { amount, method, date?, reference?, note? }` needs a saved customer: it is a
  customer receipt with `against_kind = proforma`, kept whole as advance (never allocated to the customer's other open
  bills). The books post it like any customer receipt: money account / Debtors (`docs/accounting.md`). On the GSTR side
  advances on goods carry no GST; Table 11 stays typed in (#10).
- **Make tax invoice** `POST /proformas/:id/convert { issue? }`: a bill with the same customer and lines (draft, or issued).
  Stock moves when that bill is issued, like any bill. The proforma's unapplied advances are allocated to the bill when it is
  issued (now, or later from the draft through the `issued` hook); the books skip allocations (the receipt was posted). A
  cancelled / deleted bill gives the advance back to the receipt and the proforma can be billed again. Cancelling a
  proforma leaves its advances in the credit book.

### Sale order

- Lines carry a key; ordered, delivered and invoiced are tracked per line from the order's live challans (sent less
  returned) and the bills made straight from it (`sale_order_invoices`). Status (stored, recomputed on every change and
  read): open, partly_delivered, delivered (everything delivered), invoiced (everything billed), cancelled. A cancelled bill
  reopens what it billed.
- `POST /sale-orders/:id/deliver { lines?: [{ key, qty }], reason?: before_invoice | approval, transport?, ewbNo?, ... }`
  makes a delivery challan for (part of) the undelivered quantities; `POST /:id/invoice { lines?, issue? }` bills undelivered
  quantities straight from the order (that bill moves the stock); `POST /:id/invoice-challans { challanIds?, issue? }` bills
  the delivered challans (no stock move). More than what is left is refused (400 "Only 6 left of ...").
- **Hold stock** (`reserveStock`, default from settings, only with inventory): an inventory reservation with ref type
  `sale_order` for the undelivered quantities at the branch's stock location; released and re-held after every delivery,
  bill or cancel. Creating with a hold when the stock isn't there answers 409 `insufficient_stock` and saves nothing.
  Reservations only move `stock_items.reserved`: stock quantity and valuation (qty x moving-average cost) never change.
- Lines (and customer, place of supply) can change only while open; dates, notes, terms, advance % and the hold any time
  before it is fully billed. Cancel only before anything was delivered or billed. Advances work like the proforma's
  (`against_kind = sale_order`) and go on each bill of the order when issued.

### Delivery challan (CGST Rule 55)

- Reasons: `before_invoice` (supply, tax invoice to follow), `approval` (on approval / sale or return; return-by defaults to 7
  days), `job_work`, `exhibition`, `other` (not a supply). Printed: purpose, consignee, delivery address, items with HSN,
  quantity, taxable value, GST and total, transport (mode, transporter name / GSTIN, vehicle no., LR no. / date, distance),
  e-way bill no. / date, goods returned so far, the shop's signature and the receiver's, and the Rule 55 note with the
  three copies (original for consignee, duplicate for transporter, triplicate for consigner).
- Stock (`InventoryService.applyChallan`, movement reasons `challan_out` / `challan_return` / `challan_cancel`, ref type
  `challan`): goods leave the branch's location when the challan is saved (catalogue items with stock tracking; the batch
  chosen or first-expiry-first-out), come back where they left from on `POST /challans/:id/return { lines?, date?, note? }`
  (into the batches they came from; each return applied once), and what is still out comes back on cancel. Stock failures are
  logged and never block the document, like bills. The stock screen links the movements to the challan.
- Lines are fixed once saved; transport, e-way bill, delivery address, return date, notes and terms stay editable
  (`PATCH /challans/:id`).
- **Billing** `POST /challans/invoice { challanIds, issue? }`: one tax invoice for one or more challans of the same customer
  and place of supply, for what is still with the customer (sent less returned). The bill is created with
  `stock_moved_by = "challan"`, so issuing or cancelling it never moves stock (the goods are already with the customer).
  Only `approval` and `before_invoice` challans are billed. A billed challan takes no returns (use a credit note on the bill)
  and can't be cancelled; cancelling the bill makes it billable again. Credit notes on such a bill put returned goods back
  into stock as usual.
- E-way bill: `packages/einvoice` only generates e-way bills by IRN for e-invoiced bills, so a challan stores the number and
  date generated on the portal; above ₹50,000 the screens suggest one (a hint, the portal decides).

## Features and permissions

- Feature `invoices.sales-docs` (shop toggle, depends on `invoices`). Granted by `invoices.*` plans; listed explicitly for the
  EC app profile and the free and starter plans (`seed-fixtures.ts`), like quotations.
- `sales-docs.view` (lists, detail, PDFs) and `sales-docs.manage` (create, edit, send, cancel, deliver, returns). Billing
  also needs `invoices.create`; an advance also needs `payments.receive`; discounts on lines need `invoices.discount`; the
  quotation conversion to a proforma or sale order needs `sales-docs.manage`. Roles: manager `sales-docs.*`; cashier view +
  manage; default staff manage (and `*.view`); accountant view; demo view (`*.view`).
- Audit actions `sales-docs.proforma.*`, `sales-docs.sale-order.*`, `sales-docs.challan.*` (create, update, issue, share,
  send, advance, convert, deliver, invoice, return, cancel).

## Routes

| Route | What |
|---|---|
| `GET /summary`, `GET /settings`, `GET /linked?targetId=<invoice>` | header figures, settings, "Made from" on a bill |
| `GET/POST /proformas`, `GET/PATCH /proformas/:id`, `POST /proformas/:id/issue\|cancel\|share\|send\|advance\|convert` | proforma invoices |
| `GET/POST /sale-orders`, `GET/PATCH /sale-orders/:id`, `POST /sale-orders/:id/cancel\|share\|send\|advance\|deliver\|invoice\|invoice-challans` | sale orders |
| `GET/POST /challans`, `POST /challans/invoice`, `GET/PATCH /challans/:id`, `POST /challans/:id/return\|cancel\|share\|send` | delivery challans |
| `GET /public/:token` | the customer's page (no sign-in) |

Lists are paged, sorted and filtered on the server (`docs/CONVENTIONS.md`): `status`, `customerId`, `branchId`, `from`/`to`,
`q`; sale orders also `overdue` (promised date passed); challans also `reason`, `saleOrderId`, `toBill`, `overdue` (return
date passed). Each answers `totals` and status facets.

## Demo data

`pnpm --filter @srirealtime/api exec tsx src/scripts/seed-sales-docs.ts` (API on :4000, dev OTP) makes, through the API: in
kumar a sale order partly delivered on a challan and billed with its advance, and a proforma with an advance; in techzone an
approval challan with a return, billed; in thaiyal a job work challan. Nothing is sent to customers. Re-runnable.

## Tests

`packages/invoices`: `sales-docs-calc.test.ts`; `sales-docs.db.test.ts` (needs `INVOICES_TEST_DATABASE_URL`, throw-away schema:
numbering, advances kept and applied, partial delivery and billing, stock never moved twice, quotation conversion, routes).
`packages/inventory/src/challan-stock.db.test.ts` (needs `INVENTORY_TEST_DATABASE_URL`: out / return / cancel, batches,
reservations leave quantity and value alone). `packages/documents/src/sales-doc.test.ts` (PDF content, Tamil),
`packages/billing-ui/src/sales-docs.test.ts` (nav, routes, messages), `packages/notify` templates, staff role templates.

## Not done

E-way bill generation for challans (typed in), challan drafts, partial cancel / short-close of a sale order, sale orders from
online-store orders, a dashboard tile, GSTR-1 Table 11 from the advances (still typed in), Flutter app screens.
