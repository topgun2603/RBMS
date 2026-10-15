# Batch 1 contract: catalogue, inventory locations, orders, coupons, staff, audit, documents, importexport

Conventions as in docs/CONVENTIONS.md, docs/features.md (every route declares `config.feature`), docs/billing-v2.md
(money = integer paise, qty ≤ 3 decimals, dates `YYYY-MM-DD` IST, lists `{ items, total }`, CSV via `format=csv`).
"Staff routes" = owner/admin/staff members (super-admin passes). Packages never import each other: ports + apps/api/src/kit.ts.
**All existing APIs keep working unchanged** (billing-ui is live on them).

---

## 1. `@srirealtime/catalogue` (`/v1/catalog`) — the one product list for store, billing and POS

Tables (tenant-scoped, `pk()`, timestamps):
- `catalog_categories` (parent_id null, name, slug (unique per tenant), description, image_url, sort, active, seo jsonb)
- `catalog_products` (name, slug (unique per tenant), description (markdown), brand, category_id null, hsn, gst_rate,
  unit default 'pcs', tax_inclusive bool default false, status `active|draft|archived`, channels text[] default
  `{store,billing}` (where it can be sold), tags text[], attributes jsonb (`{ "Fabric": "Cotton" }`), options jsonb
  (`[{ name: "Size", values: ["S","M"] }]`), images jsonb (`[{ url, alt }]`), seo jsonb, deleted_at)
- `catalog_variants` (product_id, sku (unique per tenant, nullable), barcode (unique per tenant, nullable), title ("M / Red";
  "" for the default variant), option_values jsonb (`{ "Size": "M" }`), price (paise), mrp (paise null), cost (paise null),
  weight_grams null, position, is_default bool, deleted_at)

Rules:
- Every product has ≥ 1 variant; a "simple" product has exactly one default variant (title "").
- **A variant is the sellable unit.** Its id is what invoices (`itemId`), inventory (`itemId`) and orders (`variantId`) store.
- `tax_inclusive`: price includes GST (typical for MRP retail). `exclusiveRate(price, gstRate, taxInclusive)` =
  `taxInclusive ? round(price * 100 / (100 + gstRate)) : price` — export it from `@srirealtime/gst` as `exclusiveOf()`
  and use it wherever a catalogue price becomes an invoice/order line rate.
- Slugs auto-generated from name (Tamil names → transliteration not required; fall back to `p-<shortid>`), unique per tenant.

**Migration of billing items:** a one-off, idempotent `catalogue.service.importLegacyItems(tenantId, rows)` + an apps/api
migration script `pnpm --filter @srirealtime/api migrate:items` that copies every `billing_items` row into a product with
one default variant **whose id equals the old item id** (so bills, stock and purchases keep pointing at the same id).
Afterwards invoices' items API is a facade over the catalogue (see 1.1); `billing_items` stays in the schema, unused.

API (staff routes, feature `catalogue`; variant-related writes `catalogue.variants`):
- Categories: `GET /categories` (flat with parentId + `GET /categories/tree`), `POST`, `PATCH /:id`, `DELETE /:id` (only empty), `PUT /categories/order` `{ ids }`
- Products: `GET /products?q=&categoryId=&status=&channel=&tag=&limit=&offset=` → `{ items: ProductSummary[], total }`;
  `POST /products` (product fields + `variants: VariantInput[]` (≥1); omitted → one default variant from `price`, `sku`, `barcode`);
  `GET /products/:id` → `Product` (with variants); `PATCH /products/:id` (product fields); `DELETE /products/:id` (soft; archived);
  variants: `POST /products/:id/variants`, `PATCH /variants/:id`, `DELETE /variants/:id` (not the last one);
  `POST /products/:id/variants/generate` `{ options }` → creates the cartesian product of option values (keeps existing).
- Lookup: `GET /variants?ids=a,b` (batch, includes product name/hsn/gst/unit/taxInclusive), `GET /variants/lookup?code=` (sku or barcode — POS scanning), `GET /variants/search?q=&channel=` (flattened "Product – Variant" rows for pickers).
- Public (no auth; tenant from host/`x-tenant`; only `status=active` with channel `store`): `GET /public/categories`,
  `GET /public/products?categoryId=&q=&sort=new|price-asc|price-desc|name&limit=&offset=`, `GET /public/products/:slug`.

Types:
```ts
ProductSummary = { id, name, slug, status, categoryId, categoryName, image, priceMin, priceMax, variantCount, channels, updatedAt }
Product = { id, name, slug, description, brand, categoryId, hsn, gstRate, unit, taxInclusive, status, channels, tags, attributes, options, images, seo, variants: Variant[], createdAt, updatedAt }
Variant = { id, productId, sku, barcode, title, optionValues, price, mrp, cost, weightGrams, position, isDefault }
CatalogItem /* for ports */ = { id /*variant id*/, productId, name /* "Product" or "Product – M / Red" */, sku, barcode, hsn, unit, rate /* exclusive paise */, price, taxInclusive, gstRate, image }
```
Features: `catalogue` (base), `catalogue.variants` (options/variants UI + writes), both `dependsOn: []`. Add to plans seed:
free `catalogue`; starter/pro via `catalogue.*`. Add to app profiles: BL `catalogue` (no variants), EC `catalogue.*`.

### 1.1 Invoices items → catalogue facade
- invoices gets an `ItemSourcePort { list(tenantId, { q, limit, offset }); get(tenantId, id); create(tenantId, ItemInput); update(tenantId, id, Partial<ItemInput>); remove(tenantId, id) }` (optional dep). When present, `/v1/invoices/items*` routes and `getItem/listItems/createItem` delegate to it (Item shape unchanged: `{ id, name, hsn, unit, rate, gstRate, createdAt }`; `rate` = exclusive rate). Without it, the old table is used (tests).
- kit: implement the port with catalogue (create = simple product with one default variant, channels `{billing, store}`).
- The inventory `ItemCatalogPort` is implemented from the catalogue too (variants).

## 2. Inventory: locations and reservations (extend `@srirealtime/inventory`, backward compatible)

- `stock_locations` (tenant, name, code, type `store|warehouse`, address, is_default, active). Every tenant gets a default
  location lazily ("Main") on first stock operation; existing rows migrate to it (migration sets `location_id` = default).
- `stock_items` unique (tenant, location_id, item_id) + `reserved numeric(14,3) default 0`. `available = qty - reserved`.
- Movements get `location_id`. All existing endpoints accept optional `locationId` (default location when omitted) and
  aggregate across locations in lists when `locationId` is omitted (`qty`, `reserved`, `available` per item = sums).
- New: `GET/POST/PATCH /locations`, `POST /transfers` `{ fromLocationId, toLocationId, lines: { itemId, qty }[], note }`
  (immediate; movements `transfer_out` / `transfer_in`), `GET /transfers`.
- Reservations (for orders): `service.reserve(tenantId, { refType, refId, locationId?, lines })` (idempotent per ref;
  fails with 409 `insufficient_stock` `{ itemId, available }[]` when a tracked item lacks availability, unless
  `allowBackorder`), `service.release(tenantId, refType, refId)`, `service.commit(tenantId, refType, refId)` (turns the
  reservation into a sale movement: qty −, reserved −). `applySale` stays for bills (no reservation).
- `GET /availability?itemIds=` → `{ itemId, available, tracked }[]` (public variant for the storefront: `GET /public/availability?itemIds=`, booleans/ranges only: `{ itemId, inStock, lowStock }`).
- Feature `inventory.locations` (dependsOn inventory, shopToggle false) for the locations/transfers routes.

## 3. `@srirealtime/orders` (`/v1/orders`)

Tables: `orders` (tenant, number (series per FY: `ORD/26-27/0001`, prefix from settings), channel `store|manual|pos|marketplace`,
customer jsonb `{ name, phone, email, customerId?, accountId? }`, shipping_address jsonb, billing_address jsonb,
lines jsonb (`OrderLine[]`), totals jsonb, total, currency 'INR', status, payment_status `unpaid|pending|paid|cod|refunded|partially_refunded`,
payment_method `online|cod|cash|upi|card|other`, fulfillment jsonb (`{ carrier, trackingNumber, trackingUrl, shipmentId }`),
coupon_code, invoice_id null, location_id null, notes, customer_note, cancel_reason, placed_at, timestamps),
`order_events` (order_id, type `status|payment|note|fulfillment|refund`, from_status, to_status, message, actor_user_id, data jsonb, created_at),
`order_series` (like invoice_series).

`OrderLine = { variantId, productId, name, sku, image, qty, unit, price /*as charged, incl. tax if taxInclusive*/, rate /*exclusive*/, gstRate, hsn, discount, taxable, cgst, sgst, igst, total }` — totals via `computeInvoice` from `@srirealtime/gst` with seller state + place of supply (shipping address state).

Status flow (configurable later; v1 fixed): `placed → confirmed → packed → shipped → delivered`; `cancelled` from placed/confirmed/packed;
`returned` from delivered (feature `orders.returns`). Side effects via ports:
- placed: `stock.reserve` (refType `order`), coupon redeem (CouponPort), notify `order.placed` (customer + shop owner).
- confirmed: notify `order.confirmed`.
- shipped: notify `order.shipped` with tracking; requires fulfillment info or not (optional).
- delivered: `stock.commit`; invoice via `InvoicingPort.createFromOrder(tenantId, order)` → `{ invoiceId, number }` (issued; customer snapshot; lines with `itemId = variantId`; place of supply) — **when** controlled by settings `orders.invoiceOn: "confirmed" | "delivered"` (default delivered; if confirmed, it happens there instead). COD → mark paid on delivered.
- cancelled: `stock.release` (or reverse sale if committed), coupon release, invoice cancel if any, notify.
- returned: stock back (reason `return`), invoice → credit note later (v1: invoice cancel), refund recorded (manual).
- Payments purpose `order` (wired in kit): `paymentTarget(orderId or token)`, `onPaid` → payment_status paid + event.

API (staff routes, feature `orders`):
- `GET /?status=&paymentStatus=&channel=&q=&from=&to=&limit=&offset=` → `{ items: OrderSummary[], total, counts: Record<status, number> }`
- `GET /:id` → `Order` (with events); `POST /` (manual order: customer, address, lines `{ variantId, qty, price? }`, couponCode?, paymentMethod) → Order
- `POST /:id/status` `{ status, note?, fulfillment? }` (only allowed transitions; 409 otherwise) → Order
- `POST /:id/notes` `{ message }`; `POST /:id/payments` `{ amount, method, reference }` (manual payment); `POST /:id/refunds` `{ amount, reason }` (records only)
- `GET /summary` → `{ today: { count, total }, pending: { placed, confirmed, packed }, month: { count, total } }`
- Service methods for the storefront (batch 2): `createFromCheckout(tenant, input)`, `getForCustomer(tenantId, accountId, id)`, `listForCustomer(...)`.
Features: `orders`, `orders.returns` (shopToggle). Settings namespace `orders` (defined in apps/api): `{ prefix: "ORD", invoiceOn: "delivered", allowBackorder: false, autoConfirm: false }`.
Notify templates (en + ta, sms + whatsapp + email): `order.placed`, `order.confirmed`, `order.shipped`, `order.delivered`, `order.cancelled`.

## 4. `@srirealtime/coupons` (`/v1/coupons`)

Tables: `coupons` (tenant, code (unique per tenant, uppercase), description, type `percent|flat|free_shipping`, value (percent 1–100 or paise),
max_discount null, min_order (paise) default 0, starts_at null, ends_at null, usage_limit null, per_customer_limit null,
first_order_only bool, applies_to `all|categories|products`, target_ids uuid[], channels text[] default `{store}`, active, timestamps),
`coupon_redemptions` (coupon_id, tenant, ref_type `order|invoice`, ref_id, customer_key, amount, status `active|released`, created_at; unique (coupon_id, ref_type, ref_id)).

Service: `evaluate(tenantId, code, ctx: { channel, subtotal, shipping, lines: { productId, categoryId, amount }[], customerKey?, isFirstOrder? })`
→ `{ valid: true, couponId, discount, freeShipping } | { valid: false, reason: "not_found"|"inactive"|"not_started"|"expired"|"min_order"|"usage_limit"|"customer_limit"|"first_order_only"|"not_applicable"|"wrong_channel" }`
(pure evaluation logic unit-tested); `redeem(tenantId, code, ref, customerKey, amount)` atomic against usage limits (conditional insert/count in a tx);
`release(tenantId, refType, refId)`.
API (staff, feature `coupons`): CRUD, `GET /:id/redemptions`; public `POST /public/validate` `{ code, subtotal, lines, customerKey? }` (store checkout preview).

## 5. `@srirealtime/staff` — custom roles and permissions + `@srirealtime/audit`

### Permissions
- core: `PermissionDef { key: "invoices.cancel"; module; label; description }`, `SrModule.permissions?: PermissionDef[]`,
  `UserRef.permissions: string[]` (filled by auth from memberships), route config `permission?: string | string[]`, `requirePermission(ctx, key)`.
- Membership roles stay in `tenant_memberships.roles`: exactly one **base level** `owner|admin|staff` plus optional custom
  role keys (`role:cashier`). Existing `requireRole(..., "staff")` keeps working because every member with access has a base level.
- `staff` package: `tenant_roles` (tenant, key (`cashier`), name, description, permissions text[], builtin bool). Built-in
  role templates seeded lazily per tenant: Manager (all except settings/staff), Cashier (bills create, payments receive, customers create, catalogue read), Accountant (reports, credit book, purchases, expenses), Delivery (orders read + status shipped/delivered).
  Built-in rows keep a `template_hash` (hash of the template permissions they were seeded/synced with): on lazy seeding,
  built-ins whose permissions still match it (or, for rows from before the column, a previous template in
  `PREVIOUS_BUILTIN_PERMISSIONS`) move to the current template; owner-edited built-ins are left alone.
- Resolution: owner/admin/super-admin → `["*"]`; staff → union of their custom roles' permissions; staff with no custom role → the tenant's
  "staff default" set (all `*.view` + create bills) so today's staff keep working.
- Host preHandler (after features): route `config.permission` → `requirePermission`. Annotating existing billing routes happens in the
  integration step, not in this batch (other agents are editing those files).
- API (`/v1/staff`, owner/admin, feature `staff`): `GET /members` (with user name/phone/email + roles + lastActive), `POST /invites` `{ target, roleKeys }`
  (uses tenancy + auth via ports; consumes plan limit `staff`), `PATCH /members/:userId` `{ roleKeys, active }`, `DELETE /members/:userId`,
  roles CRUD (`GET/POST /roles`, `PATCH/DELETE /roles/:key`; builtin roles editable but not deletable), `GET /permissions` (registry grouped by module).
- Each package declares its permissions (catalogue.manage, orders.manage, orders.cancel, coupons.manage, inventory.adjust, inventory.purchases, invoices.create, invoices.cancel, invoices.discount, invoices.credit-book, reports.view, settings.manage, staff.manage, audit.view) — packages built in this batch declare theirs; for invoices/inventory/payments the integration step adds them.
- Features: `staff` (base, team & roles UI).

### Audit
- core: `AuditPort { record(e: AuditEvent): Promise<void> }`, `AuditEvent = { tenantId, actorUserId, action /* "invoice.cancel" */, entityType, entityId, summary, before?, after?, ip, userAgent }`, route config `audit?: { action: string; entity: string; idParam?: string } | false`.
- `audit` package: table `audit_events` (append-only; indexes (tenant, created_at desc), (tenant, entity_type, entity_id)). A host
  `onResponse` hook records every successful (2xx) mutating request (POST/PUT/PATCH/DELETE) of a signed-in user: action from
  `config.audit.action` or `<module>.<method> <routePattern>`, entity id from params, no request bodies (privacy) except a
  short `summary` the route may set via `req.auditSummary`. Services may call `audit.record` with before/after for important
  changes (invoice cancel, stock adjust, role change).
- API (`/v1/audit`, owner/admin, feature `audit`, permission `audit.view`): `GET /?entityType=&entityId=&actorUserId=&action=&from=&to=&limit=&offset=` (csv);
  super-admin `GET /platform?...` across tenants. Retention job: delete older than 400 days.

## 6. `@srirealtime/documents` (`/v1/documents`) — PDFs

- HTML → PDF with headless Chromium via `puppeteer-core`; executable from config `chromePath` or auto-detect (Windows Edge/Chrome,
  Linux `/usr/bin/chromium`, `CHROME_PATH`). One browser instance, page pool (max 2), 30 s timeout. Driver interface so a Lambda/
  container driver can replace it.
- Fonts bundled from `@fontsource/noto-sans`, `@fontsource/noto-sans-tamil` (woff2 inlined as data URLs in the HTML) so Tamil renders correctly.
- Registry: `registerType({ key: "invoice", paper: "A4" | "80mm" | "A6", load(tenantId, id): Promise<data>, render(data, { locale, branding }): string /* html */, filename(data) })`.
  Built-in renderers (pure functions, unit-tested HTML snapshots): `invoice` (GST tax invoice A4, same content as billing-ui's printable invoice: seller/buyer, HSN table, tax breakup, amount in words, bank, UPI QR (svg via `qrcode`), terms, signatory, CANCELLED stamp), `invoice-thermal` (80 mm receipt), `statement` (customer ledger), `packing-slip` and `shipping-label` (orders), `purchase`.
  Data comes through ports wired in kit (invoices/orders/inventory services), never by importing those packages.
- API: `GET /:type/:id.pdf?locale=` (staff, feature per type: invoice → invoices, statement → invoices.credit-book, packing-slip → orders),
  public `GET /public/invoice/:token.pdf` (share token, via invoices port). Cache rendered PDFs in uploads storage keyed by
  `type:id:updatedAt:locale` (optional; skip if complex).
- Feature `documents` (always on; no shopToggle).

## 7. `@srirealtime/importexport` (`/v1/import`, `/v1/export`)

- Engine with a registry: `registerImporter({ key: "catalog.products", label, feature, permission, columns: { key, label, required, example, parse(value) }[], validate(row), commit(tenantId, rows, opts) })` and `registerExporter({ key, label, feature, columns, rows(tenantId, query) })`.
- Files: CSV (UTF-8 with/without BOM) and XLSX via `exceljs`. Upload as multipart or raw body (`content-type` text/csv or xlsx), ≤ 10 MB / 20 000 rows.
- Flow: `POST /v1/import/:key/preview` (file) → `{ jobId, columns (detected → mapped by header label/key, case-insensitive), rows: first 50 with errors, totals: { rows, valid, invalid } }`;
  `POST /v1/import/:jobId/commit` `{ mapping?, skipInvalid: true }` → runs via jobs (in-memory driver in dev) → `GET /v1/import/:jobId` `{ status, processed, created, updated, failed, errors: { row, message }[] }`;
  `GET /v1/import/:key/template.xlsx` (headers + example row + a "Help" sheet). Store job rows in `import_jobs` (tenant, key, status, file meta, summary jsonb, errors jsonb) — keep the parsed rows in jsonb (bounded).
- `GET /v1/export/:key.(csv|xlsx)?…` streams the exporter rows.
- Registered in apps/api kit (via ports): importers `catalog.products` (product + variant columns: name, sku, barcode, category, hsn, gst, unit, price, mrp, cost, tax_inclusive, opening_stock), `invoices.customers` (name, phone, email, gstin, state, opening_balance, credit_limit), `inventory.suppliers`, `inventory.stock` (sku/barcode, location, qty); exporters for the same + `catalog.products`.
- Feature `importexport`.

---

### Plans and app profiles (apps/api seed, integration step)
- New features go to plans: free `catalogue`, `orders`, `documents`; starter + `coupons`, `importexport`, `staff`, `audit`;
  pro `*.`-wildcards for all. EC profile gets catalogue.*, orders.*, coupons, inventory (+locations), staff, audit, importexport, documents; BL gets catalogue, staff, audit, importexport, documents (no orders/coupons for now).
