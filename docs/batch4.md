# Batch 4 contract (UI): screens for the wave B modules

Every screen follows docs/web-modules.md (UI modules, feature + permission gating, module-relative links) and the
standing UI rules: **shadcn components from @srirealtime/ui, Framer Motion for interaction, the Field layout primitive
and control height scale for every form** (docs: packages/ui field.tsx, lib/control.ts), English + Tamil strings (no
Hindi terms), mobile-first, dark mode, skeleton/empty/error states. Server APIs are in docs/batch3.md and the package
route files.

## UI packages

| Package | Mounted in | Screens |
|---|---|---|
| `@srirealtime/pos-ui` | apps/billing, apps/shop (at `/pos`) | **POS counter**: full-screen billing for a till — barcode/SKU scan (USB scanner as keyboard + phone camera via BarcodeDetector when available), product search grid with categories, cart with qty/price/discount, customer by phone (create on the fly, loyalty balance + redeem), split payments (cash with change, UPI QR, card, credit), hold/recall bills, returns, day open/close with cash count, 80 mm thermal receipt (print CSS + the documents thermal PDF), keyboard shortcuts, works on a tablet, current branch shown (multi-branch). |
| `@srirealtime/marketplace-ui` | apps/shop (admin side) + **apps/seller** (:3004, vendor portal) | Admin: vendors list/approve/suspend, vendor detail (KYC status, commission, payout account, ledger, products, orders), payouts runs/history/retry, marketplace settings. Vendor portal module: onboarding (apply, KYC checks — PAN, bank/UPI with live status), dashboard (sales, pending settlement, next payout), my products (catalogue product editor scoped to the vendor — reuse commerce-ui patterns, copy not import), my orders (vendor orders, mark packed), payouts + ledger, profile/store page. Storefront: seller page + "Sold by" on products (storefront-ui). |
| `@srirealtime/inbox-ui` | apps/shop, apps/billing | **Unified inbox**: chat conversations (SSE live via stream token, typing, read ticks, images, order context card), WhatsApp inbox (24 h window indicator, template picker with variables, opt-out state, assign, tags, notes), **WhatsApp campaigns** (audience builder with live count, template + variable mapping, schedule, live stats), **Support desk** (ticket list with SLA badges/filters, ticket view with replies vs internal notes, assign, merge, macros-lite (saved replies), FAQ manager). Storefront: chat widget + help centre (FAQ, raise ticket, my tickets) (storefront-ui). |
| `@srirealtime/growth-ui` | apps/shop, apps/billing | **Loyalty** (program settings, tiers editor, members, member ledger, adjust), **KYC** (shop KYC status + checks; super-admin review queue lives in apps/admin), **E-invoice** (GSP account settings; on bill detail in billing-ui: Generate IRN / cancel / e-way bill dialog / IRN + QR panel; GSTR-1 download), **Branches** (list/editor, users per branch, per-branch summary; **branch switcher** in the web kit top bar), **Developer** (API keys with scope picker + show-once secret, webhooks with event picker, delivery log + redeliver, signature docs, OpenAPI link), **Report builder** (dataset picker, drag columns, filters, group by incl. month, measures, live preview table + chart, save, schedule with recipients, run history). |

Also: apps/admin gets the KYC review queue and marketplace overview for the platform; billing-ui gets the e-invoice
actions and loyalty redeem on the bill form; storefront-ui gets loyalty in account/checkout, chat widget, help centre,
seller pages.

## New app
`apps/seller` (:3004): a thin shell like apps/billing mounting `marketplaceModule({ portal: "vendor" })` + workspace
basics, tenant from the host (`<shop>.localhost:3004`), signed-in vendor users only.
