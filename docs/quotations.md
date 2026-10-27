# Quotations (estimates)

Feature `invoices.quotations`; routes under `/v1/quotations`; UI in `@srirealtime/billing-ui` (`/quotations`, public page `/q/:token`).
A quotation is a priced offer before the order. It never changes stock, sales reports, GSTR-1/3B, loyalty or the credit book:
only the bill or order made from it does.

## Design

- Code lives in `packages/invoices`: `quotations.ts` (service), `quotations-calc.ts` (pure rules), `quotations-routes.ts`,
  tables `quotations` and `quotation_series` in `schema.ts` (migration `0033_quotations`). Wiring: `apps/api/src/kit-quotations.ts`.
- GST maths is `computeInvoice` from `@srirealtime/gst` (place of supply from the customer's state/GSTIN, round-off to the rupee).
  Customers, items, share tokens and WhatsApp/SMS/email sending (notify template `quotation.sent`) are the invoices ones.
- Numbering: `QT/26-27/0001`, one series per tenant, branch and FY (`quotation_series`, same locking as `invoice_series`).
  Prefix, default validity (15 days) and default terms are the shop settings namespace `quotations` (Settings -> Quotations).
- Statuses stored: draft, sent, accepted, declined, cancelled, converted. **expired** is derived: sent and past valid-until.
- Revisions: each revision is its own row with the same number (`groupId`, `rev`, `latest`). Only a draft is edited in place; anything
  sent is revised (new draft, rev + 1, old kept as history). An acceptance does not carry over. Old public links say the quotation was revised.
- Public page: `GET /v1/quotations/public/:token`, `POST .../respond { decision, name, note? }` (no sign-in; final; audited).
  PDF: `/v1/documents/public/quotation/:token.pdf`, staff `/v1/documents/quotation/:id.pdf` and `quotation-thermal`.
  The PDFs reuse the invoice renderer (title "Quotation" / "மதிப்பீடு", validity, own terms, delivery time, advance, accepted-by).
- Convert (`POST /:id/convert`, latest revision only): `to: "invoice"` makes a draft bill (or issues it with `issue`), `to: "order"` goes through the
  orders module (every line must be a catalogue item; the order reserves stock). `recordAdvance` records `advancePercent` of the total as a
  payment on the new bill (which must then be issued) or order. The quotation becomes `converted` and links to it; if that bill is deleted or cancelled
  it can be converted again. The bill page shows "Made from quotation" with a shortcut to record the advance.
  `to: "proforma"` / `to: "sale_order"` make an issued proforma invoice or a sale order instead (feature `invoices.sales-docs`,
  permission `sales-docs.manage`; the advance is then recorded on the new document; `docs/sales-documents.md`).
- Dashboard: `GET /summary` gives open value, accepted this month and the 90-day conversion rate (tile `kpi-quotations`, list header).

## Features and permissions

- Feature `invoices.quotations` (shop toggle, depends on `invoices`). Granted by `invoices.*` (BL, PH, RS, SV, pro plans); listed explicitly for the EC
  app profile and the free and starter plans (`seed-fixtures.ts`).
- `quotations.view` (list, detail, PDFs) and `quotations.manage` (create, edit, revise, send, cancel, convert). Convert also needs
  `invoices.create` (bill) or `orders.manage` (order), plus `payments.receive` to record the advance; discounts need `invoices.discount`.
  Roles: manager `quotations.*`; cashier view + manage; default staff manage (and `*.view`); accountant view; demo view (`*.view`).
- Audit actions: `quotations.create|update|revise|duplicate|cancel|share|send|convert`, and `quotations.accept|decline` for the customer's answer.

## Demo data

`pnpm --filter @srirealtime/api exec tsx src/scripts/seed-quotations.ts` (API on :4000, dev OTP) makes ten quotations in techzone, kumar and thaiyal
through the API (sent, accepted, converted to an order / issued bill with advance / draft bill, expired, declined, revised, draft). Re-runnable.

## Tests

`packages/invoices`: `quotations-calc.test.ts`; `quotations.db.test.ts` (needs `INVOICES_TEST_DATABASE_URL`, uses a throw-away schema).
`packages/documents/src/quotation.test.ts`, `packages/billing-ui/src/quotations.test.ts`, staff role templates.
