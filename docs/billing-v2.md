# Billing v2: payments, inventory, WhatsApp, credit book, reports

Extends [billing-api.md](billing-api.md). Same conventions: money in **integer paise**, quantities up to 3 decimals,
dates `YYYY-MM-DD` (IST), tenant from `x-tenant`, errors `{ error: { code, message, details } }`, lists `{ items, total }`.
"Staff routes" = signed-in member with role owner, admin or staff (super-admin passes). "Owner routes" = owner or admin.
Every report/list endpoint that returns rows accepts `format=csv` and then responds `text/csv; charset=utf-8` with a UTF-8 BOM
and `Content-Disposition: attachment; filename="<name>-<from>-<to>.csv"`.

GST maths lives in **`@srirealtime/gst`** (pure, browser-safe; `@srirealtime/invoices/calc` re-exports it).
`LineInput` gains an optional **`itemId?: string`** (saved item the line came from); it is kept in `LineTotals`.

---

## 1. `@srirealtime/payments` — online collection (`/v1/payments`)

Razorpay, with **each shop using its own Razorpay account** (keys stored AES-256-GCM encrypted, never returned).
A **mock provider** exists for development: when a tenant has no account configured and `allowMock` is on, checkout
returns `provider: "mock"` and the client completes it with `POST /mock/complete`.

Generic "purposes": modules register what can be paid for. Invoices registers kind `"invoice"` (wired in apps/api).
```ts
interface PaymentPurpose {
  resolve(ref: string): Promise<{ tenantId: string; purposeId: string; amount: number; description: string;
    customer?: { name?: string; phone?: string; email?: string }; payable: boolean; reason?: string }>;
  onPaid(p: { tenantId: string; purposeId: string; amount: number; method: "upi"|"card"|"bank"|"wallet"|"other";
    provider: "razorpay"|"mock"; providerPaymentId: string; paidAt: Date }): Promise<void>;   // called exactly once per order
}
service.registerPurpose(kind, purpose); service.isEnabled(tenantId): Promise<{ enabled: boolean; provider: "razorpay"|"mock"|null; mode: "test"|"live"|null }>
```

Endpoints:
- Owner: `GET /account` → `{ configured, provider: "razorpay", keyId, mode: "test"|"live", enabled, webhookUrl }`
  (`mode` derived from key id prefix `rzp_test_` / `rzp_live_`; `webhookUrl` = `${webhookBaseUrl}/v1/payments/webhooks/razorpay/${tenantId}`).
- Owner: `PUT /account` `{ keyId, keySecret?, webhookSecret?, enabled }` (secret optional on update = keep). Validates the keys by
  calling Razorpay `GET https://api.razorpay.com/v1/payments?count=1` with Basic auth; 400 `invalid_credentials` if rejected.
- Owner: `DELETE /account`.
- Owner/staff: `GET /orders?purposeKind=&purposeId=&limit=&offset=` → recent online payments.
- Public: `POST /checkout` `{ kind: "invoice", ref: <share token> }` →
  `{ orderId, provider: "razorpay"|"mock", keyId (razorpay only), amount, currency: "INR", name (shop), description, prefill: { name, contact, email } }`.
  Re-uses an unpaid order for the same purpose+amount created in the last 30 minutes. 400 `not_payable` when the purpose says so (paid/cancelled).
  Razorpay order: `POST https://api.razorpay.com/v1/orders` `{ amount, currency: "INR", receipt: <purposeId>, notes: { tenantId, kind, purposeId } }`.
- Public: `POST /verify` `{ orderId, paymentId, signature }` → checks `HMAC_SHA256(orderId + "|" + paymentId, keySecret) == signature`,
  fetches the payment (`GET /v1/payments/:id`) for amount + method, marks the order paid → `{ status: "paid", amount }`.
- Public (dev only, provider mock): `POST /mock/complete` `{ orderId, method?: "upi" }` → `{ status: "paid", amount }`.
- Public: `POST /webhooks/razorpay/:tenantId` — raw body, header `x-razorpay-signature` = HMAC_SHA256(rawBody, webhookSecret).
  Handles `payment.captured` and `order.paid` (idempotent by Razorpay event id and payment id). Always 200 for verified events
  that are ignored; 400 for bad signatures.

Tables: `payment_accounts` (tenant_id pk, provider, key_id, key_secret_enc, webhook_secret_enc, enabled, timestamps),
`payment_orders` (tenant_id, purpose_kind, purpose_id, amount, currency, provider, provider_order_id unique, status
`created|paid|failed`, provider_payment_id unique null, method, paid_at, notes jsonb, timestamps),
`payment_events` (provider_event_id unique, tenant_id, type, payload jsonb, processed_at, created_at).
Marking paid is a conditional update `WHERE status = 'created'` so `onPaid` runs once even if verify and webhook race.

## 2. `@srirealtime/inventory` — stock, suppliers, purchases (`/v1/inventory`, staff routes)

Items stay owned by invoices; inventory keys stock by `itemId` and reads item details through a port:
```ts
interface ItemCatalogPort { getItems(tenantId: string, ids: string[]): Promise<{ id; name; hsn; unit; rate; gstRate }[]>;
  listItems(tenantId: string, q?: string): Promise<{ id; name; hsn; unit; rate; gstRate }[]> }
service.applySale(tenantId, { refId: invoiceId, lines: { itemId: string; qty: number }[] })   // idempotent per refId
service.reverseSale(tenantId, refId)                                                        // idempotent
```
- `GET /stock?q=&filter=all|low|out|untracked` → `{ items: StockRow[], total, totals: { stockValue, lowCount, outCount } }`
  `StockRow = { itemId, name, unit, hsn, qty, reorderLevel, track, avgCost /*paise|null*/, value /*qty*avgCost*/, status: "ok"|"low"|"out", updatedAt }`
  (all saved items appear; items without a stock row show qty 0, track true).
- `PATCH /stock/:itemId` `{ track?, reorderLevel? }`
- `POST /stock/:itemId/adjust` `{ mode: "add"|"remove"|"set", qty, note?, unitCost? }` → `StockRow` (reason `adjustment`, or `opening` when it's the first movement)
- `GET /stock/:itemId/movements?limit=&offset=` → `{ items: { id, date, reason, delta, qtyAfter, refType, refId, refNumber, note, createdBy }[], total }`
- `GET /summary` → `{ stockValue, lowCount, outCount, lowItems: StockRow[] (top 5) }`
- Suppliers: `GET/POST /suppliers`, `GET/PATCH/DELETE /suppliers/:id` — `{ id, name, phone, email, gstin, address, stateCode, payable /*sum of unpaid purchases*/, createdAt }`
- Purchases (supplier bills; they add stock and carry input tax credit):
  - `GET /purchases?q=&supplierId=&from=&to=` → `{ items: PurchaseSummary[], total }`
  - `POST /purchases` `{ supplierId?, supplier?: { name, gstin?, stateCode? }, billNumber, date, lines: LineInput[] (rate = cost per unit), notes?, paid?: boolean }` → `Purchase`.
    Tax via `computeInvoice(lines, { sellerState: supplier.stateCode ?? ownState, placeOfSupply: ownState })` where ownState comes from
    a `SellerStatePort { stateCode(tenantId): Promise<string | null> }`. Lines with `itemId` increase stock (reason `purchase`) and update
    moving-average cost.
  - `GET /purchases/:id`, `POST /purchases/:id/cancel` (reverses stock, reason `purchase_cancel`), `POST /purchases/:id/paid` `{ paid: boolean }`.
  - `Purchase = { id, billNumber, date, supplier snapshot, lines: LineTotals[], totals, total, paid, status: "recorded"|"cancelled", notes, createdAt }`
- Reports: `GET /reports/stock` (valuation rows, csv), `GET /reports/purchases?from=&to=` → `{ rows: PurchaseSummary[], itc: { taxable, cgst, sgst, igst, total }, byRate: TaxBreakupRow[] }` (csv = rows).

Tables: `stock_items` (tenant_id+item_id unique, track, qty numeric(14,3), reorder_level numeric(14,3), avg_cost int null),
`stock_movements` (tenant_id, item_id, delta, qty_after, reason `opening|adjustment|sale|sale_cancel|purchase|purchase_cancel`,
ref_type, ref_id, ref_number, unit_cost, note, created_by, created_at; index (tenant_id,item_id,created_at)),
`suppliers`, `purchases`. Stock may go negative (shops sell before entering purchases) — rows then show status `out`.

## 3. Invoices additions (`/v1/invoices`)

### Stock hook
`StockPort { applySale(tenantId, { refId, lines }); reverseSale(tenantId, refId) }` (optional dep). Called after issue (lines with
`itemId`) and after cancel. Failures are logged, never block billing.

### Credit book
- Customers gain `openingBalance` (paise, + = they owe the shop, − = advance) and `creditLimit` (paise | null). `Customer.outstanding`
  becomes the **ledger balance** (opening + issued totals − payments − receipts); `Customer.advance` = unallocated receipt money.
- Receipts = money received "on account", not tied to one bill:
  `POST /customers/:id/receipts` `{ amount, method, date, reference?, note? }` → allocates oldest-first to the customer's open bills
  (creates invoice payments linked to the receipt); leftover becomes advance. Returns `{ receipt, allocations: { invoiceId, number, amount }[], advance }`.
  `DELETE /customers/:id/receipts/:receiptId` reverses its allocations.
- `GET /customers/:id/ledger?from=&to=` → `{ customer, openingBalance /*as of from*/, entries: { date, type: "opening"|"invoice"|"payment"|"receipt"|"cancel",
  refId, number, description, debit, credit, balance }[], closingBalance }` (csv too).
- `GET /credit-book?q=&filter=due|advance|all` → `{ items: { customer, balance, overdue, lastActivity }[], totals: { receivable, advance, customersWithDues } }`
  (`format=csv` too, file `credit-book-<filter>.csv`)
- Credit limit: create/issue still succeed but the response `Invoice.warnings` includes `"credit_limit_exceeded"` when the customer's balance
  after this bill exceeds `creditLimit`.
- Statement link: `POST /customers/:id/statement/share` → `{ token, url }` (url = `${publicBaseUrl}/s/${token}`);
  public `GET /public/statement/:token` → `{ customer: { name }, seller, ledger (last 90 days), balance, branding }` (404 when the shop's
  `invoices.credit-book` feature is off).
- Every credit book route belongs to the `invoices.credit-book` feature (docs/features.md).

### WhatsApp / SMS sending
`NotifierPort { send(input: { tenantId; channel: "whatsapp"|"sms"; to: string; template: string; vars: Record<string, string>; locale?: string }): Promise<{ logId: string }> }`
- `POST /:id/send` `{ channel?: "whatsapp"|"sms", to? }` (default: customer phone) → `{ logId, url }` — ensures the share link, sends
  template `invoice.issued` with vars `{ shop, customer, number, amount, dueDate, link }`.
- `POST /customers/:id/remind` `{ channel? }` → sends `invoice.reminder` with `{ shop, customer, amount (balance), link (statement) }`.
- Auto reminders: `service.runReminders(now)` — for tenants whose seller profile has `autoReminders: true`, every issued/partially-paid bill
  whose due date is exactly N days ago for N in `reminderDays` gets `invoice.reminder` (vars `{ shop, customer, number, amount, dueDate, link }`).
  Table `invoice_reminders` (tenant_id, invoice_id, day, channel, log_id, sent_at; unique (invoice_id, day)) prevents repeats.
  apps/api runs it daily at 10:00 IST.
- Online payment received and `sendPaymentReceipts` → `payment.received` `{ shop, customer, number, amount, balance }`.
- `Invoice.messages` = `{ template, channel, to (masked), sentAt }[]` (last 10), recorded in table `invoice_messages`.
- SellerProfile gains `autoReminders: boolean; reminderDays: number[]; sendPaymentReceipts: boolean`.
- Built-in notify templates (en + ta, sms and whatsapp): `invoice.issued`, `invoice.reminder`, `payment.received`.

### Online payment glue (wired in apps/api, methods on InvoicesService)
- `paymentTarget(shareToken)` → `{ tenantId, purposeId: invoiceId, amount: balance, description: "Invoice <number>", customer, payable, reason }`.
- `recordOnlinePayment({ tenantId, invoiceId, amount, method, providerPaymentId, paidAt })` — idempotent on `reference = providerPaymentId`.
- Public invoice response gains `onlinePayment: { enabled: boolean; provider: "razorpay"|"mock"|null }` via
  `PaymentsAvailabilityPort { isEnabled(tenantId) }`.

### Reports (`/v1/invoices/reports/*`, staff routes; `from`/`to` required except trend; cancelled and draft bills excluded)
- `GET /reports/sales-trend?days=30` → `{ items: { date, invoiced, collected, count }[] }` zero-filled, oldest first.
- `GET /reports/sales-register` → `{ items: { id, number, date, customer, gstin, placeOfSupply, taxable, cgst, sgst, igst, total, paid, status }[], totals }` (csv)
- `GET /reports/gst-summary` →
  `{ b2b: { gstin, name, invoices, taxable, cgst, sgst, igst, total }[], b2cl: { placeOfSupply, rate, taxable, igst }[] /*inter-state, unregistered, invoice > ₹1,00,000*/,
     b2cs: { placeOfSupply, rate, taxable, cgst, sgst, igst }[], hsn: { hsn, description, unit, qty, taxable, cgst, sgst, igst, total }[],
     byRate: TaxBreakupRow[], gstr3b: { outwardTaxable, igst, cgst, sgst, nilRated }, totals }` (`format=csv&section=hsn|b2b|b2cs`)
- `GET /reports/payments` → `{ byMethod: { method, amount, count }[], items: { date, number, customer, method, amount, reference, source: "bill"|"receipt"|"online" }[] }` (csv)
- `GET /reports/ageing?asOf=` → `{ buckets: { key: "current"|"1-30"|"31-60"|"61-90"|"90+", amount, count }[], customers: { customerId, name, current, d1_30, d31_60, d61_90, d90_plus, total }[] }` (csv)
- `GET /reports/top-items?limit=10` → `{ items: { itemId, description, qty, unit, taxable }[] }`
- `GET /reports/top-customers?limit=10` → `{ items: { customerId, name, invoices, total }[] }`
- `GET /summary` gains `trend` (last 14 days `{ date, invoiced }[]`) and `prevMonth: { invoiced, collected, count }` for deltas.

## 4. Credit notes (`/v1/invoices`, permission `invoices.credit-note`)

GST credit notes against issued bills: full or partial returns and value corrections. Maths in `@srirealtime/gst`
(`computeCreditNote`, `creditState`): each line takes its share of the original line's taxable value, CGST, SGST and IGST
(same rate, same split, original place of supply); the last return of a line takes exactly what is left; the total is
rounded to the rupee and the note that clears the bill gets `invoice total − earlier notes`.

- `GET /:id/returnable` → `{ invoiceId, number, status, total, paid, credited, balance, creditable, interState, hasCustomer,
  blocked /*reason or null*/, lines: { line, description, unit, itemId, gstRate, qty, returnedQty, remainingQty, credited, remaining }[], creditNotes }`
- `POST /:id/credit-notes` `{ date?, reason: "return"|"price_correction"|"discount"|"other", note?, refundMode: "cash"|"upi"|"card"|"credit_book"|"none",
  refundReference?, lines: { line, qty? | taxable? /*GST-exclusive paise, not for returns*/, restock? }[], tillSessionId? }` → `{ creditNote, invoice }`.
  The part of the note up to the bill's open balance reduces what is owed; the rest was paid and is refunded (an invoice
  payment with a negative amount, `source: "refund"`) or, with `credit_book`, stays as credit in the customer's ledger;
  `none` is refused when money was paid. 409 `credit_note_blocked` for drafts, cancelled or fully credited bills;
  400 `credit_note_qty` / `credit_note_line` / `credit_note_amount` / `credit_note_refund`.
  Numbers: own series per (branch, FY), prefix `CN` or `CN` + the bill's prefix (`CNEB/26-27/0001`, 16-char GST rule).
- `GET /credit-notes?q=&status=&from=&to=&customerId=&invoiceId=&branchId=` (csv) · `GET /credit-notes/:id`
- `POST /credit-notes/:id/cancel` `{ reason? }` — same IST day and nothing refunded (409 `credit_note_locked`).
- Effects: `Invoice.credited` (balance = total − paid − credited; a fully credited bill is `paid`), stock back through
  `StockPort.applyReturn` (reason `sale_return`, where the sale took it), loyalty points earned on the value taken back
  (`LoyaltyRedeemPort.creditNote`), webhooks `credit_note.issued` / `credit_note.cancelled`, audit entries. A bill with
  credit notes can't be cancelled and its payments can't be deleted.
- Ledger entries `credit_note` (credit) and `refund` (debit); sales register rows `type: "credit_note"` with negative
  amounts; GST summary `cdnr` / `cdnur` rows and B2CS / HSN / rate / 3B net of notes (`format=csv&section=cdnr|cdnur`).
- PDFs: `/v1/documents/credit-note/:id.pdf` (A4) and `/credit-note-thermal/:id.pdf` (80 mm). E-invoice: the einvoice
  routes accept a credit note id (document type CRN with the bill as preceding document); GSTR-1 export has cdnr / cdnur.

## 5. POS till sessions (`/v1/invoices/till`)

One open session per register (device name) and branch. Bills (`tillSessionId` on create), payments and credit note
refunds carry the session id; the X report sums them.

- `GET /till/current?register=` → `{ session | null }` · `GET /till/:id` · `GET /till/:id/x` → `{ session, report }`
- `POST /till/open` `{ register, openingCash? | openingCount? /*{ "500": 2 }*/, actorName? }` (permission `pos.till`; 409 `till_open`)
- `POST /till/:id/cash` `{ amount /*signed paise*/, reason }` · `POST /till/:id/close` `{ count? | countedCash?, note? }` (`pos.till`)
- `GET /till/sessions?register=&status=&from=&to=` (other registers: feature `invoices.reports`, permission `reports.view`)
- Report: bills, payments and refunds by method, credit notes, on credit, cash `{ opening, sales, refunds, cashIn, cashOut,
  expected = opening + sales − refunds + in − out }`; close stores expected / counted / difference and freezes it (Z report,
  `/v1/documents/till-z/:id.pdf`, 80 mm).
