# Batch 2a contract (server): storefront, delivery, search, reviews, CMS, SEO, onboarding, analytics, expenses, custom domain

Same conventions as docs/commerce-batch1.md (money = paise, IST dates, `{ items, total }`, `config.feature` on every route,
`config.permission` on staff writes, ports only, CSV via `format=csv`). **Public** routes take the tenant from the host /
`x-tenant` header (tenancy hook) and need no staff role. **Shopper** routes need a signed-in user (auth OTP, the same
`/v1/auth/otp/*` flow on the store's host) and are scoped to that user's store-customer record in the current tenant —
shoppers are never tenant members.

The storefront is each shop's own branded site (D2C). UI comes in batch 2b; this batch is the API.

---

## 1. `@srirealtime/storefront` (`/v1/store`)

Tables: `store_customers` (tenant, user_id (unique per tenant), name, phone, email, marketing_opt_in, orders_count, total_spent,
last_order_at, timestamps), `store_addresses` (tenant, customer_id, label, name, phone, line1, line2, landmark, city, district,
state_code, pincode, is_default, timestamps), `store_carts` (tenant, token (unique, random 24+ chars), customer_id null,
lines jsonb `{ variantId, qty }[]`, coupon_code, pincode, updated_at, expires_at (30 days)), `store_wishlist` (tenant,
customer_id, product_id, created_at; unique).

Ports (kit wires them): `CatalogPort` (variants by ids incl. status/channels/images/productSlug/mrp; product by id),
`AvailabilityPort` (inventory public availability + reserve semantics are inside orders), `CouponPort` (evaluate),
`DeliveryPort { quote(tenantId, { pincode, stateCode?, weightGrams, subtotal, cod }) }`, `OrdersPort { createFromCheckout; listForCustomer; getForCustomer; getByToken; cancelForCustomer }`,
`StoreSettingsPort` (settings namespace `store`), `BrandingPort`, `FeatureGatePort`.

Endpoints (feature `storefront`):
- Public: `GET /config` → `{ shop: { name, logoUrl, css, contactPhone, contactEmail, social }, open, closedMessage, codEnabled, codMaxAmount, minOrderValue, guestCheckout: false, policies: { shipping, returns, privacy, terms }, installBanner }`
- Cart (public, by token): `POST /cart` → `{ token }`; `GET /cart/:token?pincode=` → `PricedCart`; `PUT /cart/:token/lines` `{ variantId, qty }` (0 removes; qty capped by availability and 1–99) → PricedCart;
  `POST /cart/:token/coupon` `{ code }` / `DELETE /cart/:token/coupon` → PricedCart; `POST /cart/:token/pincode` `{ pincode }` → PricedCart; `POST /cart/:token/merge` (shopper) → PricedCart of the shopper's cart.
  ```ts
  PricedCart = { token, lines: { variantId, productId, productSlug, name, variantTitle, image, price, mrp, qty, lineTotal, available: boolean, maxQty, problem?: "unavailable" | "price_changed" | "qty_reduced" }[],
    itemCount, subtotal, discount, coupon: { code, valid, reason?, freeShipping } | null, pincode, delivery: { serviceable, options: DeliveryOption[] } | null, total /* subtotal − discount (shipping chosen at checkout) */, warnings: string[] }
  ```
- Shopper: `GET /me` (creates the store-customer row on first call) `{ customer, counts: { orders, wishlist } }`, `PATCH /me` `{ name, email, marketingOptIn }`,
  addresses `GET/POST /me/addresses`, `PATCH/DELETE /me/addresses/:id`, `POST /me/addresses/:id/default`;
  `GET /me/orders`, `GET /me/orders/:id`, `POST /me/orders/:id/cancel` `{ reason }` (only placed/confirmed);
  wishlist `GET /me/wishlist` (products with price range + image), `POST /me/wishlist` `{ productId }`, `DELETE /me/wishlist/:productId` (feature `storefront.wishlist`).
- Checkout (shopper): `POST /checkout` `{ cartToken, addressId? | address?, deliveryOptionId, paymentMethod: "online" | "cod", customerNote? }` →
  `{ order: { id, number, total, status, paymentStatus }, accessToken, payment: { kind: "order", ref } | null }`. Validates: store open, cart not empty, every line available, min order, COD enabled + under COD max + rate allows COD (adds COD fee),
  delivery option valid for the address pincode; prices always re-read from the catalogue; clears the cart on success.
- Public tracking: `GET /track/:accessToken` → order status timeline, lines, totals, fulfillment (no address details beyond city/pincode).
- Settings namespace `store` (defined in apps/api): `{ open: true, closedMessage: "", codEnabled: true, codMaxAmount: 500000, minOrderValue: 0, contactPhone: "", contactEmail: "", social: { instagram, facebook, youtube, whatsapp }, policies: { shipping, returns, privacy, terms }, installBanner: true }` (`installBanner`: the storefront's "Install <shop> app" banner, see §6).
Features: `storefront` (base, label "Online store"), `storefront.wishlist` (shopToggle). Permissions: none (shopper routes check the shopper).

## 2. `@srirealtime/delivery` (`/v1/delivery`)

Tables: `delivery_zones` (tenant, name, states text[], pincode_prefixes text[], pincodes text[], active, sort), `delivery_rates` (tenant, zone_id, name, type `flat|weight|free_above`,
amount, free_above null, weight_slabs jsonb `{ upToGrams, amount }[]`, eta_min_days, eta_max_days, cod_allowed, cod_fee, active, sort),
`delivery_accounts` (tenant pk, provider `shiprocket`, credentials_enc, pickup_location, enabled, default_package jsonb `{ lengthCm, breadthCm, heightCm, weightGrams }`),
`shipments` (tenant, order_id, provider `manual|shiprocket|mock`, provider_shipment_id, awb, courier, status `created|pickup_scheduled|in_transit|out_for_delivery|delivered|rto|cancelled`, label_url, tracking_url, events jsonb, cost, timestamps).

- Zone matching: exact pincode > longest prefix > state > zone with no rules ("Rest of India"). Rates of the matched zone; `free_above` gives 0 when subtotal ≥ free_above. Pure + unit-tested.
- `quote(tenantId, { pincode, stateCode?, weightGrams, subtotal, cod })` → `{ serviceable, options: { id, name, amount, etaDays: [min, max], codAllowed, codFee }[] }`.
- Pincode lookup `GET /public/pincode/:pin` → `{ pincode, city, district, state, stateCode } | 404` via a driver (`https://api.postalpincode.in/pincode/:pin`, cached 30 days in a `pincode_cache` table) with a fallback from the first digits to the state (pure table) when offline.
- Carriers behind a driver: `manual` (staff enters courier + AWB + tracking URL), `mock` (dev: instant AWB, advances status on `POST /shipments/:id/mock-advance`), `shiprocket` (token auth with email/password → create adhoc order → assign AWB → generate label → track; webhook `POST /webhooks/shiprocket/:tenantId` with the shop's token header). Credentials encrypted (AES-GCM like payments).
- Shipment status → orders via `OrderFulfillmentPort { setFulfillment(tenantId, orderId, fulfillment); markShipped(tenantId, orderId); markDelivered(tenantId, orderId) }` (idempotent).
- Staff API (feature `delivery`, permission `orders.manage` for shipments, `settings.manage` for zones/rates/account): zones + rates CRUD, `POST /quote` (test), account `GET/PUT/DELETE /account`,
  shipments `POST /orders/:orderId/shipments` `{ provider, courier?, awb?, trackingUrl?, package? }`, `GET /shipments?orderId=`, `POST /shipments/:id/cancel`, `GET /shipments/:id/label` (redirect to label url).
- Public: `POST /public/quote` `{ pincode, weightGrams, subtotal, cod }`, pincode lookup.
- Job `delivery.track` every 2 h for open shiprocket shipments.
Features: `delivery` (zones, rates, quotes, manual shipments), `delivery.carriers` (Shiprocket + label printing; shopToggle). Default for a tenant with no zones: one implicit "All India" flat ₹0 rate (so checkout works out of the box) — document it.

## 3. Catalogue search + collections (extend `@srirealtime/catalogue`) and `@srirealtime/reviews`

### Search (catalogue)
- Migration: `pg_trgm` extension; `catalog_products.search_text` (lowercased name + brand + tags + attribute values + category name, maintained by the service on write) with a GIN trigram index; plus `tsvector` (simple config) for multi-word queries.
- `GET /public/search?q=&categoryId=&priceMin=&priceMax=&attr.Fabric=Cotton&opt.Size=M&inStock=1&sort=relevance|new|price-asc|price-desc|rating&limit=&offset=` →
  `{ items: PublicProductSummary[], total, facets: { categories: { id, name, count }[], price: { min, max }, attributes: Record<string, { value, count }[]>, options: Record<string, { value, count }[]> } }`.
  `inStock` and `rating` sort use optional ports (availability, ratings) — skip gracefully when absent.
- `GET /public/search/suggest?q=` → `{ products: { name, slug, image, priceMin }[], categories: { name, slug }[] }` (top 6 + 4; prefix/trigram).
- Staff `GET /products?q=` uses the same matching.

### Collections (catalogue)
- `catalog_collections` (tenant, name, slug, description, image_url, type `manual|rule`, product_ids uuid[] (manual, ordered), rule jsonb `{ categoryId?, tag?, priceMax?, onSale? (mrp > price), sort }`, active, seo).
- Staff CRUD (`catalogue.manage`); public `GET /public/collections` and `GET /public/collections/:slug?limit=&offset=` → collection + products. Feature `catalogue`.

### `@srirealtime/reviews` (`/v1/reviews`)
Tables: `product_reviews` (tenant, product_id, user_id, author_name, order_id null, rating 1–5, title, body, photos jsonb (urls), status `pending|approved|rejected`, verified, helpful_count, reply, replied_at, timestamps; unique (tenant, product_id, user_id)), `review_votes` (review_id, user_id; unique).
- Public: `GET /public/products/:productId/reviews?sort=recent|helpful|rating-desc|rating-asc&rating=&limit=&offset=` (approved) → `{ items, total, summary: { average, count, distribution: { 1..5 } } }`; `GET /public/ratings?productIds=` → `{ productId, average, count }[]`.
- Shopper: `POST /public/products/:productId/reviews` `{ rating, title?, body?, photos? }` (one per product; editing replaces; verified = `OrdersPort.hasDelivered(tenantId, userId, productId)`), `POST /public/reviews/:id/helpful`.
- Staff (permission `reviews.manage`): `GET /?status=&rating=&productId=` , `POST /:id/approve`, `POST /:id/reject`, `POST /:id/reply` `{ reply }`, `DELETE /:id`.
- Settings namespace `reviews`: `{ autoApprove: "none" | "verified" | "all" }` (default "verified").
- Feature `reviews` (shopToggle). Ratings port for catalogue search sort.

## 4. `@srirealtime/cms` (`/v1/cms`) — content + SEO

Tables: `cms_home` (tenant pk, draft jsonb, published jsonb, published_at), `cms_pages` (tenant, slug, title, blocks jsonb, status `draft|published`, seo jsonb, published_at, timestamps),
`cms_posts` (tenant, slug, title, excerpt, cover_url, blocks jsonb, tags text[], author_name, status, published_at, seo, timestamps), `cms_menus` (tenant, key `header|footer`, items jsonb).

- Home sections (validated with zod discriminated unions): `hero` `{ slides: { imageUrl, mobileImageUrl?, heading?, subheading?, cta?: { label, href } }[] }`, `categories` `{ title, categoryIds?: [] }`,
  `collection` `{ title, collectionSlug, layout: "carousel" | "grid", limit }`, `products` `{ title, productIds }`, `banner` `{ imageUrl, href?, alt }`, `text` `{ heading?, markdown }`,
  `image-text` `{ imageUrl, heading, markdown, cta?, imageSide }`, `testimonials` `{ items: { quote, name }[] }`, `usp` `{ items: { icon, title, text }[] }` (free shipping, COD, returns…), `newsletter` `{ heading, text }`.
- Page/post blocks: `heading` `{ level 2|3, text }`, `paragraph` `{ markdown }` (rendered client-side with a safe markdown renderer; no raw HTML stored), `image` `{ url, alt, caption }`, `gallery`, `button` `{ label, href }`, `faq` `{ items: { q, a } }`, `video` `{ youtubeId }`, `divider`.
- Menu items: `{ label, href? , type: "url" | "page" | "category" | "collection" | "post", ref? , children? }` (max depth 2).
- Staff (permission `cms.manage`): home `GET` (draft + published), `PUT /home` (draft), `POST /home/publish`; pages/posts CRUD + publish/unpublish; menus `GET/PUT /menus/:key`.
- Public: `GET /public/home` (published; sections resolved: categories → names/slugs/images, collection/products → product summaries via `CatalogPort`), `GET /public/pages/:slug`, `GET /public/posts?tag=&limit=&offset=`, `GET /public/posts/:slug`, `GET /public/menus`.
- Default content: if a tenant has no home yet, `GET /public/home` returns a sensible default (hero with shop name + "Shop now", categories, newest products).
- **SEO** (same package, feature `seo`, always on with storefront): `GET /public/seo/sitemap.xml` (products, categories, collections, pages, posts with lastmod; absolute URLs from the store base URL port `StoreUrlPort { baseUrl(tenantId) }`), `GET /public/seo/robots.txt` (allow all, sitemap link, disallow /account /checkout /cart),
  pure exported helpers (also importable by the storefront app — put them in `src/seo/jsonld.ts` with no server imports and export `@srirealtime/cms/seo`): `productJsonLd`, `breadcrumbJsonLd`, `organizationJsonLd`, `websiteSearchJsonLd`, `defaultMeta(shop, entity)`.
- Features: `cms` (home, pages, menus), `cms.blog` (posts; shopToggle), `seo`.

## 5. Business tools

### `@srirealtime/onboarding` (`/v1/onboarding`)
- Steps registry: `registerStep({ key, module, feature?, label, description, href /* UI route hint, relative to the app, e.g. "settings/business" */, order, check(tenantId): Promise<boolean> })` — registered in kit, e.g. business profile (legalName + stateCode), logo/colour set, first product, first bill or first order, payments connected, delivery zone set (EC), store published (home published) (EC).
- `onboarding_state` (tenant pk, skipped text[], dismissed_at, completed_at). `GET /` → `{ steps: { key, label, description, href, done, skipped }[], completed, total, dismissed }` (only steps whose feature is on); `POST /:key/skip`, `POST /:key/unskip`, `POST /dismiss`. Owner/admin. Feature `onboarding` (always on).

### `@srirealtime/analytics` (`/v1/analytics`)
- Public ingest `POST /public/events` `{ anonymousId, sessionId, events: { type: "page_view"|"product_view"|"add_to_cart"|"remove_from_cart"|"begin_checkout"|"purchase"|"search", path?, productId?, variantId?, value?, query?, referrer?, utm?: { source, medium, campaign } , at? }[] }` (≤ 50 per call; ≤ 120 calls/min per IP — in-memory limiter; bot user agents ignored; IP stored only as sha256(ip + daily salt)).
- Tables `analytics_events` (tenant, at, type, session_id, anonymous_id, path, product_id, variant_id, value, query, referrer_host, utm_source, utm_medium, utm_campaign, device `mobile|desktop|tablet`, ip_hash), `analytics_daily` (tenant, date, metric, dimension, value; unique). Job `analytics.rollup` hourly (idempotent for today and yesterday); raw events purged after 90 days.
- `GET /overview?from=&to=` (owner/admin or `reports.view`) → `{ visitors, sessions, pageViews, productViews, addToCart, checkouts, purchases, revenue, conversionRate, trend: { date, visitors, purchases, revenue }[], funnel: { step, count }[], topProducts: { productId, name, views, addToCart, purchases }[], topSearches: { query, count }[], sources: { source, sessions }[], devices: { device, sessions }[] }` (product names via CatalogPort). Feature `analytics`.

### `@srirealtime/expenses` (`/v1/expenses`)
- `expense_categories` (tenant, name, sort, builtin) seeded lazily: Rent, Salaries, Electricity, Transport, Packaging, Marketing, Repairs, Other; `expenses` (tenant, date, category_id, amount (paise, incl. GST), gst_rate, gst_amount (ITC claimable when vendor GSTIN given), vendor_name, vendor_gstin, payment_method, reference, note, receipt_url, status `recorded|cancelled`, created_by, timestamps).
- API (permission `expenses.manage`, feature `expenses` shopToggle): CRUD, categories CRUD, `GET /summary?from=&to=` → by category + by month; `GET /reports/profit?from=&to=` →
  `{ sales: { taxable, tax }, purchases: { taxable, itc }, expenses: { total, itc }, grossProfit /* sales.taxable − purchases.taxable */, netProfit /* grossProfit − (expenses.total − expenses.itc) */, gst: { output, itc, payable } }` via `SalesReportPort` (invoices gst-summary totals) and `PurchasesReportPort` (inventory purchases report). CSV for the list.

### Custom domain (extend `@srirealtime/tenancy`)
- `GET /v1/tenancy/domains/:id/instructions` → `{ domain, records: [{ type: "TXT", host: "_srikit-verify.<domain>", value: <token> }, { type: "CNAME", host: <domain or www>, value: <CNAME_TARGET> }], status }` (token stored on tenant_domains).
- Verifier implemented in apps/api with `node:dns/promises` (`resolveTxt`, `resolveCname`); `POST /domains/:id/verify` uses it; job `tenancy.domains.verify` every 30 min for pending domains.
- Env `CNAME_TARGET` (default `stores.srikit.in`). Feature `custom-domain` declared by tenancy (dependsOn nothing; plan pro). Verified custom domains already resolve tenants (tenancy.resolve).

## 6. Installable storefront (PWA)

Every shop's online store (`apps/store` + `packages/storefront-ui`) installs as its own home-screen app, with the shop's
name, icon and colours. Same host resolution as the pages (`<slug>.srikit.in` / verified custom domain); a host without a
shop (unknown subdomain, unverified domain, store switched off) gets 404 for every URL below.

- `GET /manifest.webmanifest` (`server/pwa.tsx` manifestHandler; linked from the root metadata): `name` = shop name,
  `short_name` ≤ 12 letters (whole words where they fit, counted as read, so Tamil isn't cut mid-letter), `description`
  (en / ta), `lang` en-IN / ta-IN (the shopper's language cookie when the browser sends it, else en), `start_url`
  `/?source=pwa` (storefront analytics records these launches as source `pwa`, medium `app`), `scope` `/`, `display`
  standalone, `theme_color` = brand primary, `background_color` = brand background (dark-mode shops default dark),
  `categories` from the business pack (gym → fitness/health/sports, restaurant → food, …). Cached 10 min.
- `GET /app-icon/{192.png,512.png,maskable-512.png,apple-touch-icon.png}`: PNGs drawn with next/og from the shop's logo
  (PNG/JPEG/GIF/SVG; the dark logo on a dark background), else a lettermark: up to two initials in Plus Jakarta Sans Bold
  on the brand primary, black or white ink by contrast (a Tamil-only name gets a bag glyph). Maskable icons keep the mark
  inside the safe zone. The manifest links them with `?v=<hash of name, colours, logo>`; cached a day.
- Root layout: `<link rel="manifest">`, `apple-touch-icon`, `apple-mobile-web-app-title`, and `theme-color` = brand
  primary (`storeViewport`).
- `GET /sw.js`: one service worker for every shop, cache names versioned by the Next build id (`.next/BUILD_ID`, or env
  `SR_BUILD_ID`); `activate` deletes older `sr-store-*` caches. Install precaches `/offline.html` (the shop-branded,
  self-contained offline page) and the 192 icon. Rules (`lib/pwa.ts` swStrategy, embedded into the script by source and
  unit-tested): cache-first for `/_next/static/*` and Google Fonts files; stale-while-revalidate for product images under the
  uploads URL (`<NEXT_PUBLIC_API_URL>/v1/uploads/`, plus `NEXT_PUBLIC_UPLOADS_URL` when a CDN is used; refetched with CORS so
  they are storable, which needs the store's origin in the API's `CORS_ORIGINS`: otherwise they load as before, uncached) and the app icons; network-first for page navigations with the offline page as fallback. Never handled:
  `/cart`, `/checkout`, `/account`, `/order(s)`, `/api`, `/track`, `/booking`, `/job`, RSC fetches, live preview, non-GET.
  Never stored: responses with set-cookie, `cache-control: private` / `no-store`, `vary: *`, opaque or non-200 (so the
  dynamic, per-shopper pages are not kept; offline navigations get the offline page).
- Registration (`client/pwa.tsx`): production builds only, when the browser supports service workers. A new worker takes
  over at once; the shopper's next navigation then loads in full (never on cart / checkout / order pages).
- Install banner: Chrome / Android / Edge get "Install <shop> app" (the captured `beforeinstallprompt`) after 2 pages in a
  visit, never on cart / checkout / account / order / track / table pages or when already installed; iOS Safari gets a short
  "Share → Add to Home Screen" card instead. "Not now" / close is remembered for 30 days (localStorage). Strings in
  `lib/messages-pwa.ts` (en + ta); styled with the shop's theme tokens. Owners can switch it off: Settings → Online store →
  "Show install app banner" (`store.installBanner`, default on, public in `GET /v1/store/config`).
- Tests: `storefront-ui` `lib/pwa.test.ts` (manifest builder, short names, colours, icons, worker rules and script,
  offline page, banner eligibility) and `server/pwa-icons.test.ts` (icon rendering, logo fallback); `apps/store/test/e2e.cjs`
  checks the manifest, icons, offline page and worker on the e2e shop.
- Later: web push for shoppers (order updates, back-in-stock) on top of this worker; Android TWA / Play Store listing.
