# Roadmap

Decided 2026-10-15: build every module that Ecommerce (EC) and Billing (BL) need from waves A and B, then sign-up +
subscriptions, the safety net (tests in CI, backups, audit) and AWS deployment. Ecommerce = **each shop's own branded
store** (D2C); the multi-vendor marketplace comes in wave B.

Every module = a back-end package (`packages/<id>`, ports, features) + a UI module (`packages/<id>-ui` or part of a
larger UI module) that any app mounts. Nothing app-specific.

| Batch | Scope | Status |
|---|---|---|
| 0 | Foundation P1, gst, invoices (credit book, WhatsApp, reports), inventory, payments, features, web + billing-ui | done |
| 1 | catalogue (products/variants/categories; billing items move here), inventory locations + reservations, orders, coupons, staff (roles + permissions), audit, documents (PDF), importexport | done (e2e `apps/api/test/e2e/batch1.mjs`) |
| 2a | server: storefront (shoppers, cart, checkout, tracking, wishlist), delivery, search + collections, reviews, cms + seo, onboarding, analytics, expenses, custom-domain (docs/commerce-batch2.md) | done (e2e `batch2.mjs`) |
| 2b | UI: storefront app (SSR), store-admin screens (catalogue, orders, coupons, delivery, CMS, reviews), Team & roles, audit log, import/export, onboarding, expenses, analytics | done (see below; browser test `apps/store/test/e2e.cjs`) |
| 3 | marketplace + payouts, chat, support, whatsapp inbox + campaigns, kyc, loyalty, gst-einvoice, multi-branch, api + webhooks, advanced reports (back end) — contract docs/batch3.md | done (e2e `batch3.mjs`) |
| 4 | Wave B UIs: POS counter, vendor dashboard, chat, inbox, support desk, KYC flows, loyalty, e-invoice, branches, API keys, report builder — contract docs/batch4.md | admin UIs done (pos-ui, marketplace-ui + apps/seller :3004, inbox-ui, growth-ui, e-invoice/loyalty in billing-ui, admin KYC queue) + storefront chat widget, help centre, seller pages, loyalty — done (store e2e 16/16) |
| 5 | sign-up + onboarding, plan subscriptions (Razorpay Subscriptions / UPI Autopay), landing + pricing | |
| 6 | safety net: e2e tests in repo + CI, backups + restore drill, monitoring | |
| 7 | AWS: RDS, ElastiCache, S3, ECS/App Runner, wildcard domain + SSL, CI/CD | |

## Batch 2a + 2b status (2026-10-15)

**2a (server)** done: storefront, delivery, search + collections, reviews, cms + seo, onboarding, analytics, expenses
and custom domains, covered by `apps/api/test/e2e/batch2.mjs` on the dedicated e2e shops (`test:e2e:all`).

**2b (UI)** done:
- `apps/store` (:3003) + `packages/storefront-ui`: SSR storefront (home sections from the CMS, catalogue, search,
  product, cart, OTP checkout, online/COD payment, order + tracking, account, wishlist, reviews, Tamil/English),
  analytics beacon. Branded gradient hero when a shop has no hero photo.
- Store admin (`apps/shop`): `orders-ui` (orders, coupons, delivery), `commerce-ui` (products, variants, categories,
  collections), `site-ui` (home editor with hidden sections, pages, menus, blog, store settings, reviews, analytics,
  custom domain), `billing-ui` at `/billing` (incl. expenses), `workspace-ui` (team & roles, audit log, import/export,
  onboarding checklist). `apps/billing` mounts billing-ui + workspace-ui.
- Web kit: permission gating (`Gated.permission`, "No access" page) on top of feature gating; scrollable settings tabs.
- Polish (wave 2b): tax-inclusive order lines exact to the paisa (₹999 no longer shows ₹999.01; invoices from orders
  carry `inclusiveTotal` and balance), analytics source attribution, demo content (branded hero, generated product
  images), test data kept out of the demo shops (`cleanup:e2e-data`, browser test on e2e-store).

Open after 2b: per-product purchase analytics (the purchase beacon sends only the order value), a CLI for the analytics
backfill window, CI for the e2e scripts (batch 6).
