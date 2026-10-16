# Batch 3 contract (server): wave B modules

Same conventions as docs/commerce-batch1.md and docs/commerce-batch2.md: money in paise, IST dates, `{ items, total }`,
`config.feature` on every route, `config.permission` on staff writes, ports only (packages never import each other),
CSV via `format=csv`, every external provider behind a driver with a **mock driver** for development and tests,
secrets encrypted with AES-256-GCM (copy the payments `crypto.ts` pattern), and every package declares its
FeatureDefs and PermissionDefs on its module. Cross-package hooks (e.g. "earn loyalty points when an invoice is paid")
are declared as ports/events here and wired in `apps/api/src/kit.ts` by the integration step.

Round A: marketplace, chat, support, kyc, loyalty. Round B: whatsapp, einvoice, branches, developer, reports.

---

## A1. `@srirealtime/marketplace` (`/v1/marketplace`) — multi-vendor store + payouts

- Tables: `vendors` (tenant, name, slug, status `pending|active|suspended`, kyc_status `none|pending|verified|failed`,
  commission_bps (default from settings), contact name/phone/email, gstin, address, payout_account_enc (bank/UPI or
  Razorpay Route linked account id), payout_account_status, timestamps), `vendor_users` (vendor_id, user_id, role
  `owner|staff`), `vendor_orders` (tenant, order_id, vendor_id, lines jsonb, subtotal, shipping_share, commission,
  net, status mirrors the order, settlement_status `pending|eligible|settled|reversed`, eligible_at), `vendor_ledger`
  (tenant, vendor_id, type `sale|commission|refund|payout|adjustment`, amount (signed paise), ref_type, ref_id, note,
  created_at), `vendor_payouts` (tenant, vendor_id, amount, status `pending|processing|paid|failed`, provider,
  provider_ref, period_from/to, created_at, paid_at).
- Product ownership: products get a `vendorId` (catalogue extension, see integration) and vendors manage only theirs.
- Splitting: when an order is placed, lines are grouped per vendor into `vendor_orders` (pure split function, unit
  tested: shipping shared proportionally, coupon discount allocated proportionally, commission = round(net × bps / 10000)).
  Status changes follow the order. Delivered + return window (settings `marketplace.returnWindowDays`, default 7) →
  eligible → included in the next payout run.
- Payouts: `runPayouts(tenantId, { until })` sums eligible ledger per vendor, creates payouts through a driver:
  `mock` (instant paid) or `razorpayRoute` (transfer to the linked account via a `TransferPort` implemented in kit with
  the shop's payments credentials). Failed payouts can be retried. Minimum payout setting.
- Vendor-scoped API (signed-in vendor user; `x-vendor` header when a user belongs to several): `GET /vendor/me`,
  `GET /vendor/orders`, `GET /vendor/ledger`, `GET /vendor/payouts`, `PATCH /vendor/profile`, product writes go through
  catalogue routes with vendor scoping (integration). Staff API (`marketplace.manage`): vendors CRUD + approve/suspend,
  commission per vendor, `GET /vendor-orders`, payouts list + `POST /payouts/run`, ledger adjustments. Public:
  `GET /public/vendors/:slug` (storefront seller page). Vendor onboarding: `POST /public/vendors/apply` (signed-in).
- Features: `marketplace` (base), `marketplace.payouts` (dependsOn marketplace). Permission `marketplace.manage`.
- **Product review.** A seller's write that makes their product `active` is held: the catalogue keeps it a `draft`
  (so store, search, sitemap, collections and the seller page never show it) and tells marketplace through its
  `ListingReviewPort` (`needsReview` / `onListing`: submitted, published, withdrawn). Marketplace keeps one
  `vendor_product_reviews` row per product (`pending|approved|rejected|withdrawn`, reason). Staff:
  `GET /product-reviews`, `POST /product-reviews/:id/approve` (catalogue publishes it as staff) and `/reject`
  `{ reason }`; the seller gets `marketplace.product_approved|product_rejected` and resubmits by asking for `active`
  again. Approved products stay live when the seller saves them. Setting `autoApproveProducts` (default false) restores
  direct publishing. When the seller changes a live product's customer-facing content (name, description, photos,
  price/MRP, variants, GST/HSN; stock and same-value saves don't count) it stays live but its review goes back to
  `pending` with `changedAfterApproval` and `changedFields` (a re-review); approving clears them, rejecting takes the
  product back to draft with the reason. No re-reviews while `autoApproveProducts` is on.
  Seller: `GET /vendor/product-reviews?productIds=&status=`. Staff list a seller's products with
  `GET /v1/catalog/products?vendorId=` (any status).
- **Seller stock** (features `marketplace` + `inventory`): `GET /vendor/stock?productIds=` and
  `POST /vendor/stock/:variantId/adjust { mode: set|add|remove, qty, reason }`, only the seller's own variants (others
  404), at the seller's `vendors.stock_location_id` or the shop's default location; the movement note carries the seller
  and reason, and the request is audited (`marketplace.vendor_stock.adjust`, before/after qty).
- **Seller fulfilment** (only after the shop confirmed the order; a placed order answers 409 `not_confirmed`):
  `POST /vendor/orders/:id/packed` and `/shipped { carrier?, trackingNumber }` mark the seller's
  vendor order (`packed_at`, `shipped_at`, tracking). When every line of the order is a seller's and every seller part
  reached the step, the whole order moves through `orders.updateStatus` (its state machine, events and customer
  messages; tracking passed on single-seller orders); otherwise the shop moves it. The shop gets
  `marketplace.vendor_order_packed|shipped`.
- Public settings keys (sellers may read): `minPayoutPaise`, `returnWindowDays`, `autoApproveProducts`.

## A2. `@srirealtime/chat` (`/v1/chat`) — real-time messages

- Tables: `chat_conversations` (tenant, type `direct|support|order|group`, subject_type/subject_id (e.g. order),
  title, last_message_at, created_by), `chat_participants` (conversation_id, user_id, kind `staff|shopper|vendor`,
  last_read_at, muted, joined_at), `chat_messages` (conversation_id, sender_id, body (≤ 4000), attachments jsonb (upload
  urls, images), reply_to, edited_at, deleted_at, created_at).
- Real time via **Server-Sent Events** (no new dependency): `GET /stream` (auth; one stream per tab; events
  `message`, `read`, `typing`, `conversation`), heartbeat every 25 s; an in-process pub/sub with a `PubSubPort` (Redis
  pub/sub driver for multiple API instances, in-memory driver for dev). Sending is plain HTTP.
- API: `GET /conversations` (unread counts), `POST /conversations` (direct with a user, or shopper ↔ shop "support"
  conversation, or about an order), `GET /conversations/:id/messages?before=` (cursor), `POST /conversations/:id/messages`,
  `PATCH/DELETE /messages/:id` (own, within 15 min edit), `POST /conversations/:id/read`, `POST /conversations/:id/typing`.
  Shoppers can only open a conversation with the shop; staff see shop conversations they're in or all support ones
  (`chat.manage`).
- Offline push via a `NotifierPort` (notify push/WhatsApp template `chat.message` when the recipient has no open
  stream for 60 s). Rate limit 20 messages/min per user. Features `chat`. Permission `chat.manage`.

## A3. `@srirealtime/support` (`/v1/support`) — help desk + FAQ

- Tables: `support_tickets` (tenant, number `TKT-0001` series, requester user_id or name/phone/email, subject, status
  `open|pending|resolved|closed`, priority `low|normal|high|urgent`, channel `web|email|whatsapp|chat|phone`,
  assignee_id, tags, related ref (order/invoice), first_response_at, resolved_at, sla_due_at, timestamps),
  `support_messages` (ticket_id, author_id, kind `reply|note`, body markdown, attachments, created_at),
  `faq_categories`, `faq_articles` (category, slug, title, body markdown, status, helpful_yes/no, sort, seo).
- SLA from settings (first response hours per priority); overdue flag; job to mark overdue.
- Shopper/public API: `POST /public/tickets` (signed-in shopper or guest with phone + OTP-verified token), `GET /public/tickets` (own), `GET/POST /public/tickets/:id/messages`, FAQ `GET /public/faq`, `GET /public/faq/:slug`, `POST /public/faq/:slug/helpful`, `GET /public/faq/search?q=`.
- Staff API (`support.manage`): tickets list with filters/counts, get, assign, status, priority, tags, reply/note, merge, CSV; FAQ CRUD + publish. Notifications to requester on reply (notify port) and to assignee on new/assigned.
- Features `support`, `support.faq` (shopToggle). Permission `support.manage`.

## A4. `@srirealtime/kyc` (`/v1/kyc`) — identity and business verification

- Tables: `kyc_subjects` (tenant, subject_type `vendor|shop|user`, subject_id, status `none|pending|verified|failed|manual_review`, verified_name, badges text[], updated_at), `kyc_checks` (subject_id, type `pan|gstin|bank_account|upi|digilocker_aadhaar|selfie`, status, provider, input_masked jsonb, result jsonb (masked), name_match_score, error, created_at), `kyc_documents` (subject_id, kind, file_url, created_at).
- Driver interface per check with `mock` (deterministic: e.g. PAN `ABCDE1234F` verifies as "TEST NAME", anything ending in `Z` fails) and a generic HTTP provider adapter (Surepass/IDfy-like, configurable base URL + token per platform, not per tenant). Never store full Aadhaar numbers or raw bank account numbers (mask to last 4).
- Name matching helper (normalise, initials, token overlap → score 0–100) — pure + tested. GSTIN check also validates the checksum locally first (use @srirealtime/gst-like rules — copy the algorithm, don't import).
- API: subject-scoped `POST /checks` `{ subjectType, subjectId, type, input }` (owner/admin for shop/vendor subjects; the vendor owner for their own), `GET /subjects/:type/:id`, manual review queue for super-admin (`GET /review`, `POST /checks/:id/approve|reject`). `KycStatusPort`-style `status(subjectType, subjectId)` export for marketplace/payouts gating.
- Features `kyc`. Permission `kyc.manage`.

## A5. `@srirealtime/loyalty` (`/v1/loyalty`) — points across store and counter

- Settings namespace `loyalty`: `{ earnPer100: 1, pointValuePaise: 100 /* ₹1 */, minRedeemPoints: 100, maxRedeemPercent: 50, expiryMonths: 12, tiers: [{ name: "Silver", minSpend: 0, multiplier: 1 }, { name: "Gold", minSpend: 2500000, multiplier: 1.5 }] }`.
- Tables: `loyalty_members` (tenant, member_key (normalised +91 phone), name, points_balance, lifetime_spend, tier, joined_at), `loyalty_ledger` (tenant, member_id, type `earn|redeem|expire|adjust|reverse`, points (signed), amount_paise (basis), ref_type, ref_id, expires_at, created_at; unique (ref_type, ref_id, type)).
- Pure functions (tested): points to earn for an amount + tier multiplier, redemption quote (max points usable given order amount, balance, min, max %), FIFO expiry, tier from lifetime spend.
- Service: `earn(tenantId, { memberKey, name?, amount, refType, refId })` idempotent; `quote(tenantId, memberKey, amount)`; `redeem(tenantId, { memberKey, points, refType, refId })` → discount paise (atomic balance check); `reverse(tenantId, refType, refId)` (cancel/refund); `expireDue(now)` job.
- Hooks (wired in kit): invoices paid → earn; storefront order delivered/paid → earn; order cancelled → reverse; checkout and billing can redeem (integration step adds the discount line).
- API: shopper `GET /me` (balance, tier, history) on the store; staff (`loyalty.manage`) members list/search/detail, adjust, settings; `POST /quote` for billing/checkout UIs.
- Features `loyalty` (shopToggle). Permission `loyalty.manage`.

---

## B1. `@srirealtime/whatsapp` (`/v1/whatsapp`) — inbox + campaigns

- Per-shop WhatsApp Business account: `wa_accounts` (tenant pk, phone_number_id, waba_id, display_number, token_enc, app_secret_enc, verify_token, status). Webhook `GET/POST /webhooks/:tenantId` (Meta verification challenge; X-Hub-Signature-256 HMAC check) handling inbound messages and delivery statuses.
- `wa_contacts` (tenant, phone, name, opted_in, opted_out_at, tags, last_inbound_at), `wa_messages` (tenant, contact_id, direction, type `text|template|image|document`, body, template ref, status `queued|sent|delivered|read|failed`, provider_id, error, created_at), `wa_templates` (synced from Meta + local mapping), `wa_campaigns` (name, template, variable mapping, audience jsonb, schedule_at, status, counts), `wa_campaign_recipients`.
- Inbox API: conversations list (by contact, unread), messages, send text (only within 24 h of the last inbound — else template required), send template, mark read, assign to staff, tags. STOP/UNSUBSCRIBE keywords opt out; START opts back in.
- Campaigns: audience builder via `AudiencePort` (all opted-in, tags, customers with dues (credit book), store customers who ordered in N days, loyalty tier), preview count, throttle (settings msgs/min), schedule (jobs), stats from status webhooks. Driver `meta` (Graph API v21.0) + `mock`.
- Features `whatsapp` (inbox), `whatsapp.campaigns`. Permission `whatsapp.manage`.

## B2. `@srirealtime/einvoice` (`/v1/einvoice`) — GST e-invoice (IRN) + e-way bill

- Pure JSON builders (heavily tested): NIC e-invoice schema v1.1 from an invoice (`TranDtls`, `DocDtls`, `SellerDtls`, `BuyerDtls`, `ItemList` with HSN, `ValDtls`, round-off), validation (B2B only: buyer GSTIN valid; HSN present; state codes), e-way bill payload from IRN or standalone (`EwbDtls`: transporter id, mode, distance, vehicle no).
- `einvoice_accounts` (tenant pk, provider, gstin, username, password_enc, client credentials enc, sandbox flag), `einvoice_records` (tenant, invoice_id, irn, ack_no, ack_date, signed_qr, signed_invoice, status `generated|cancelled|failed`, error, ewb_no, ewb_date, ewb_valid_till).
- Driver interface (`authenticate`, `generateIrn`, `cancelIrn`, `getByIrn`, `generateEwb`, `cancelEwb`) with `mock` (deterministic 64-hex IRN, signed QR = base64 JSON) and a configurable GSP adapter (Masters India / ClearTax-like REST; endpoints configurable).
- API (`einvoice.manage`): account settings, `POST /invoices/:invoiceId/irn`, `POST /invoices/:invoiceId/irn/cancel` (within 24 h, reason code), `POST /invoices/:invoiceId/ewb`, `GET /invoices/:invoiceId`, GSTR-1 JSON export `GET /gstr1.json?period=MMYYYY` (via an `InvoiceDataPort` + the invoices GST summary).
- Exposes `irnFor(tenantId, invoiceId)` for documents (PDF shows IRN, Ack no and the signed QR — wired at integration).
- Features `gst-einvoice`, `gst-ewaybill`. Permission `einvoice.manage`.

## B3. `@srirealtime/branches` (`/v1/branches`) — multi-branch shops

- `branches` (tenant, name, code, address, phone, gstin (may differ per state), state_code, stock_location_id (inventory location), invoice_prefix, active, is_default), `branch_users` (branch_id, user_id).
- Current branch per request: header `x-branch` (code or id), validated against the user's branches (owners/admins all branches); exposed on `req.ctx` via a context hook (`ctx.branch`), defaulting to the user's only/default branch.
- Integration contracts (wired by the integration step): invoices get `branch_id` + per-branch number series (prefix from the branch) and branch seller details (GSTIN/address/state); stock moves use the branch's location; orders can be assigned to a branch; reports accept `branchId` filter + a consolidated view.
- API (`branches.manage`): CRUD, assign users, `GET /mine` (branches the user can use), `GET /summary?from&to` (per-branch sales, bills, stock value via ports).
- Features `multi-branch` (dependsOn `inventory.locations`). Permission `branches.manage`.

## B4. `@srirealtime/developer` (`/v1/developer`) — API keys + webhooks

- `api_keys` (tenant, name, prefix (`sk_live_xxxx` first 12 chars), key_hash (sha256), scopes text[] (permission keys), last_used_at, expires_at, revoked_at, created_by). Auth: a context hook accepting `Authorization: Bearer sk_live_...` → `ctx.user` = an API principal (id = key id, platformRoles [], tenantRoles ["staff"], permissions = scopes) for that tenant; rate limit per key (in-memory, 600/min).
- Events: an `EventsPort.emit(tenantId, type, data)` that modules call (wired in kit): `order.created`, `order.status_changed`, `invoice.issued`, `invoice.paid`, `invoice.cancelled`, `payment.received`, `customer.created`, `product.created`, `product.updated`, `stock.low`, `review.created`.
- `webhook_endpoints` (tenant, url (https in production), secret_enc, events text[], active, description), `webhook_deliveries` (endpoint_id, event_id, type, payload jsonb, status `pending|succeeded|failed`, attempts, response_status, response_body (truncated), next_attempt_at, created_at). Signing: `x-srikit-signature: t=<unix>,v1=<hex hmac sha256 of "t.payload">`; retries with exponential backoff (1 m, 5 m, 30 m, 2 h, 12 h) via jobs; auto-disable after 20 consecutive failures; test ping; redeliver.
- OpenAPI: `GET /openapi.json` generated from registered routes (method, path, feature, permission, tags = module) — summary-level, no schemas required.
- Features `developer` (api keys + webhooks). Permission `developer.manage`.

## B5. `@srirealtime/reports` (`/v1/reports`) — report builder + schedules

- Datasets declared through a `DatasetPort` per module (registered in kit): `id`, `label`, `columns` (key, label, type `text|number|money|date|enum`, filterable, groupable, aggregatable), and `query(tenantId, spec)` implemented by the owning module with whitelisted SQL (no user SQL ever). Initial datasets (implemented at integration through ports): sales lines, invoices, payments, orders, stock, expenses, customers.
- Spec: `{ dataset, columns, filters: { column, op: eq|neq|in|gte|lte|between|contains, value }[], groupBy, measures: { column, fn: sum|count|avg|min|max }[], sort, limit, dateRange }` validated against the dataset definition (pure + tested).
- `saved_reports` (tenant, name, spec, created_by, shared), `report_schedules` (report_id, cron (daily/weekly/monthly presets), recipients (emails), format `csv|xlsx`, last_run_at, next_run_at, active).
- API (`reports.view` to run, `reports.manage` to save/schedule): datasets list, `POST /run` (spec → rows + totals, csv/xlsx via `format`), saved CRUD, schedules CRUD, `POST /schedules/:id/run-now`. Scheduled runs email via an `EmailPort` with the file attached (notify gains attachment support at integration).
- Features `reports.advanced`. Permissions `reports.view`, `reports.manage`.

---

## Integration (apps/api)

Wiring lives in `apps/api/src/kit-batch3.ts` (the ten modules and their ports), `kit-live.ts` (live WhatsApp inbox),
`kit-reports.ts` (report datasets) and the batch-3 hooks in `kit.ts`. Migrations: `drizzle/0007_batch3.sql` (all new
tables and columns) and `drizzle/0008_batch3_data.sql` (invoice series → the shop's main branch).

**Request pipeline.** `contextHooks: [tenancy, developer.apiKeyHook, auth, branches]`; `preHandlers: [developer.apiKeyGuard,
features, permissions]`. The route collector (OpenAPI) is a `buildServer` option registered after `routeRules` and before
the modules. API keys act as a principal whose id is the bare key uuid, so `created_by` / audit `actor_user_id` (uuid
columns) record API-key writes; keys are refused on key management, account/session (`/v1/auth/`), staff, payment
account and super-admin areas. Marketplace sellers (users without a tenant role) may use the catalogue product routes
(`CATALOGUE_VENDOR_ROUTE_KEYS`); the host skips `config.permission` for them and the catalogue scopes every read and write
to the seller's own products (`marketplace.service.resolveVendor`, `x-vendor` header).

**Events.** One `EventsPort` (developer webhooks) is passed to invoices (issued, paid, cancelled, payment.received,
customer.created), orders (created, status_changed), catalogue (product.created/updated), inventory (stock.low when an
item at a location drops to low/out) and reviews (review.created). Order events also drive `marketplace.syncOrder` and
loyalty.

**Loyalty.** Earn: a bill becoming paid (not bills made from orders — the order earns), an order delivered or fully paid
(first; idempotent), never for a cancelled/returned order. Reverse: bill cancelled, order cancelled/returned. Redeem:
optional `loyaltyPoints` on `POST /v1/invoices` (with `issue: true`), `POST /v1/invoices/:id/issue`, staff orders and
storefront checkout (`loyalty.redeem` permission for staff; Cashier and Manager templates have it). GST treatment: the
redemption is a discount given at the time of supply and shown on the bill (Sec 15(3)(a) CGST Act), so it reduces the
taxable value: the points value is split over the lines pro-rata by line value (largest remainder, exact paise) and each
line's GST is recomputed on its reduced charge. With whole-rupee point values the bill/order total drops by exactly the
discount (tax-inclusive order lines exactly; exclusive order lines within a paisa before rounding). Sellers in a
marketplace are paid on the coupon-discounted price: points are the shop's own discount.

**Branches.** Bills are numbered per branch series (`invoice_series` keyed by tenant + branch + FY; the shop's existing
series moves to the main branch so numbering continues; a new series never repeats a printed number). The branch's
GSTIN/state/address/prefix are merged into the seller at issue (affects inter-state) and stock moves at the branch
location. Inventory routes without `locationId` work at `ctx.branch`'s location (`locationId=all` = every location).
Orders: `branch_id`; storefront orders go to the main branch and reserve at its location. `GET /v1/branches/summary`
uses `invoices.salesByBranch`. GSTR-1 is per GSTIN (`/v1/einvoice/gstr1.json?period=MMYYYY&gstin=`).

**Live updates.** Chat streams (`/v1/chat/stream`, SSE) fan out over Redis pub/sub (`chat.events`, one publisher + one
subscriber connection, `packages/jobs` `createRedisPubSub`) with single-use stream tokens (`SET chat:nonce:<n> 1 NX PX`).
The WhatsApp inbox reuses the same pieces: `whatsapp.service.onEvent` → channel `whatsapp.events` →
`GET /v1/whatsapp/stream` (`POST /v1/whatsapp/stream-token` for EventSource; staff with `whatsapp.manage`; events
`wa.message|status|conversation|campaign`; no replay — clients reload their lists on reconnect). CORS headers are copied
onto the hijacked SSE replies.

**Support guests.** `POST /v1/auth/otp/request` then `POST /v1/auth/guest/verify { target, code }` (needs a tenant) →
a 60-minute signed guest token (no account) sent as `x-guest-token`. Guest tickets: 5 an hour per verified phone and 20
an hour per IP (in-memory per instance).

**Jobs.** `marketplace.settle` daily 01:30, `marketplace.payouts.refresh` every 30 min, `support.overdue` every 10 min,
`loyalty.expire` daily 00:05 IST, developer delivery sweep and report schedules every 5 min.

**Env.** `CHAT_STREAM_SECRET` (dev default; required in production), `KYC_BASE_URL`/`KYC_TOKEN`/`KYC_PROVIDER_NAME`
(mock without), `WHATSAPP_SECRET_KEY` (default derived from `APP_SECRET`), `EINVOICE_GSP_BASE_URL`,
`EINVOICE_GSP_SANDBOX_URL`, `EINVOICE_GSP_CLIENT_ID`, `EINVOICE_GSP_CLIENT_SECRET` (mock only without).

**End to end.** `pnpm --filter @srirealtime/api test:e2e:3` (`test/e2e/batch3.mjs`, sections in `test/e2e/b3/`,
`node test/e2e/batch3.mjs <name>` runs one) on e2e-store (marketplace, chat, support, checkout loyalty) and e2e-bill
(bill loyalty, WhatsApp, e-invoice, branches, developer, reports). It leaves e2e-store's marketplace settings on mock
payouts with a 0-day return window and e2e-bill with a second branch (`E2EB2`) and a mock e-invoice account.
