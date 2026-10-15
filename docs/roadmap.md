# Roadmap

Decided 2026-10-15: build every module that Ecommerce (EC) and Billing (BL) need from waves A and B, then sign-up +
subscriptions, the safety net (tests in CI, backups, audit) and AWS deployment. Ecommerce = **each shop's own branded
store** (D2C); the multi-vendor marketplace comes in wave B.

Every module = a back-end package (`packages/<id>`, ports, features) + a UI module (`packages/<id>-ui` or part of a
larger UI module) that any app mounts. Nothing app-specific.

| Batch | Scope | Status |
|---|---|---|
| 0 | Foundation P1, gst, invoices (credit book, WhatsApp, reports), inventory, payments, features, web + billing-ui | done |
| 1 | catalogue (products/variants/categories; billing items move here), inventory locations + reservations, orders, coupons, staff (roles + permissions), audit, documents (PDF), importexport | in progress |
| 2 | storefront (customer accounts, cart, checkout), delivery, search, reviews, favourites, cms, seo, onboarding, analytics, expenses, custom-domain; UI: catalogue/orders/coupons/staff/audit/import UIs, store admin, storefront app | |
| 3 | marketplace + payouts, chat, support, whatsapp inbox + campaigns, kyc, loyalty, gst-einvoice, multi-branch, api + webhooks, advanced reports (back end) | |
| 4 | Wave B UIs: POS counter, vendor dashboard, chat, inbox, support desk, KYC flows, loyalty, e-invoice, branches, API keys, report builder | |
| 5 | sign-up + onboarding, plan subscriptions (Razorpay Subscriptions / UPI Autopay), landing + pricing | |
| 6 | safety net: e2e tests in repo + CI, backups + restore drill, monitoring | |
| 7 | AWS: RDS, ElastiCache, S3, ECS/App Runner, wildcard domain + SSL, CI/CD | |
