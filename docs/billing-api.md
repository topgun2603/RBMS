# Billing: invoices module API contract

Shared contract between `packages/invoices` (API, mounted at `/v1/invoices`) and `apps/billing` (Next.js).
All money is **integer paise**. Quantities are decimals with up to 3 places (e.g. 2.5 metres of cloth).
Dates are `YYYY-MM-DD` strings in IST. Tenant comes from the `x-tenant` header; staff routes need a signed-in
member of the tenant with role owner, admin or staff (super-admins always pass).

## Shared calc (`@rbms/invoices/calc`, pure and browser-safe)

```ts
type GstRate = 0 | 0.25 | 3 | 5 | 12 | 18 | 28;
interface LineInput { description: string; hsn?: string; qty: number; unit?: string; rate: number /*paise per unit*/; discount?: number /*paise, whole line*/; gstRate: GstRate }
interface LineTotals extends LineInput { amount: number /*round(qty*rate)*/; taxable: number /*amount - discount*/; cgst: number; sgst: number; igst: number; total: number }
interface InvoiceTotals { lines: LineTotals[]; subtotal: number; discount: number; taxable: number; cgst: number; sgst: number; igst: number; roundOff: number; total: number; taxBreakup: { gstRate: GstRate; taxable: number; cgst: number; sgst: number; igst: number }[] }
computeInvoice(lines: LineInput[], opts: { sellerState: string; placeOfSupply: string; roundToRupee?: boolean /*default true*/ }): InvoiceTotals
isInterState(sellerState, placeOfSupply): boolean   // different 2-digit GST state codes → IGST
financialYear(date: string): string                  // "2026-10-14" → "26-27"; April starts the FY
formatInvoiceNumber(prefix, fy, seq): string         // "INV", "26-27", 1 → "INV/26-27/0001" (≤ 16 chars, GST rule)
amountInWordsINR(paise): string                      // 123456 → "One Thousand Two Hundred Thirty Four Rupees and Fifty Six Paise Only" (Indian system: lakh, crore)
formatINR(paise, locale?): string                    // "₹1,234.56"
GST_STATES: { code: string; name: string }[]         // all GST state codes, "33" = Tamil Nadu
isValidGstin(gstin): boolean                          // format + checksum
stateFromGstin(gstin): string | null                  // first 2 digits
upiLink({ vpa, name, amountPaise, note }): string     // upi://pay?pa=..&pn=..&am=123.45&cu=INR&tn=..
```

Tax per line: intra-state → `cgst = sgst = round(taxable * gstRate / 200)`; inter-state → `igst = round(taxable * gstRate / 100)`.
`roundOff` brings the grand total to the nearest rupee when `roundToRupee`.

## Seller profile

Read through a port from the `billing` settings namespace (defined in apps/api):
`{ legalName, gstin, address, city, pincode, stateCode, phone, email, invoicePrefix ("INV"), terms, bankName, accountNumber, ifsc, upiId }`
Edit it with `GET /v1/settings/billing` and `PUT /v1/settings/billing/tenant` (owner/admin).

## Endpoints (`/v1/invoices`)

### Customers (the shop's buyers)
- `GET /customers?q=&limit=&offset=` → `{ items: Customer[], total }`
- `POST /customers` `{ name, phone?, email?, gstin?, address?, stateCode? }` → `Customer`
- `PATCH /customers/:id` (same fields, partial) → `Customer`
- `DELETE /customers/:id` → `{ ok: true }` (soft delete; existing invoices keep their snapshot)

`Customer = { id, name, phone, email, gstin, address, stateCode, outstanding /*paise, issued unpaid*/, createdAt }`

### Items (saved products/services)
- `GET /items?q=&limit=&offset=` → `{ items: Item[], total }`
- `POST /items` `{ name, hsn?, unit? ("pcs"), rate, gstRate }` → `Item`
- `PATCH /items/:id`, `DELETE /items/:id`

`Item = { id, name, hsn, unit, rate, gstRate, createdAt }`

### Invoices
- `GET /?status=&q=&customerId=&from=&to=&limit=&offset=` → `{ items: InvoiceSummary[], total }`
- `GET /summary` → `{ month: { invoiced, collected, count }, outstanding, overdueCount, recent: InvoiceSummary[] }` (month = current IST month)
- `POST /` `{ customerId?, customer?: { name, phone?, gstin?, address?, stateCode? } /*walk-in*/, date, dueDate?, placeOfSupply?, lines: LineInput[] (1–200), notes?, issue?: boolean }` → `Invoice`.
  `placeOfSupply` defaults to the customer's state, else the seller's. `issue: true` issues straight away.
- `GET /:id` → `Invoice`
- `PATCH /:id` (drafts only) same body as POST → `Invoice`
- `POST /:id/issue` → `Invoice` (assigns the next number in the FY series; consumes plan quota `invoices_per_month`)
- `POST /:id/cancel` `{ reason? }` → `Invoice` (issued invoices are cancelled, never deleted)
- `DELETE /:id` (drafts only) → `{ ok: true }`
- `POST /:id/payments` `{ amount, method: "cash"|"upi"|"card"|"bank"|"cheque"|"other", date, reference? }` → `Invoice`
- `DELETE /:id/payments/:paymentId` → `Invoice`
- `POST /:id/share` → `{ token, url }` (creates or returns the public token; url = `${publicBaseUrl}/i/${token}`)

```ts
InvoiceStatus = "draft" | "issued" | "partially_paid" | "paid" | "cancelled"
InvoiceSummary = { id, number /*null for drafts*/, status, date, dueDate, customerName, total, paid, balance, isOverdue }
Invoice = InvoiceSummary & {
  customerId, customer: { name, phone, email, gstin, address, stateCode },  // snapshot at issue time
  seller: SellerProfile,                                                  // snapshot at issue time (live for drafts)
  placeOfSupply, interState, lines: LineTotals[], totals: InvoiceTotals (without lines),
  amountInWords, notes, payments: { id, amount, method, date, reference, createdAt }[],
  shareToken, cancelledAt, cancelReason, createdAt, updatedAt
}
```

### Public (no auth, no tenant header)
- `GET /public/:token` → `{ invoice: Invoice (without internal ids of payments), branding: { appName, logoUrl, css } }`

## Errors
Standard `{ error: { code, message, details } }`. Plan limit → `402 plan_limit` with `{ key, limit, used }`;
module not in plan → `402 plan_limit` with `{ module: "invoices" }`.
