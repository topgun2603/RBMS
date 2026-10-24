# Gap analysis vs Vyapar / Marg / Busy / Tally / Gofrugal / Petpooja / Zoho Books

Audit date 2026-10-23. Read-only: evidence comes from package schemas, routes, UI file lists and docs. Items marked
"(not deep-verified)" were judged from file names/routes, not by reading every code path. Severity = customer impact
for an Indian small-business billing/POS/ERP buyer; effort S (days) / M (1-3 weeks) / L (month+).

## Critical

| # | Area | Status | Evidence | Effort |
|---|---|---|---|---|
| 1 | Double-entry accounting: ledgers, day book, trial balance, P&L, balance sheet | Missing | No such tables/routes. Only `reports/profit` (expenses package) and the customer ledger (`packages/invoices/src/ledger.ts`). Accountants of Tally/Busy/Zoho users need these | L |
| 2 | Supplier payables: part-payments, supplier ledger/ageing, advances | Done (2026-10-23) | `purchase_payments` + `amount_paid`/`due_date` on purchases, supplier opening balance, lump "pay supplier" allocated oldest-first or to chosen bills, reversals, statement + CSV, advances on account (migration 0026; `packages/inventory/src/payables.ts`, `purchasing.ts`; UI: Payables, Supplier statement, Pay dialogs). Old `paid` flag kept (back-filled; `POST /purchases/:id/paid` now records/reverses payments). Not done: bank/cheque clearing, TDS on supplier payments | - |
| 3 | Purchase workflow: PO, GRN, purchase returns / debit notes | Done (2026-10-23) | `purchase_orders` (draft/sent/partially_received/received/cancelled), `goods_receipts` (partial GRNs add stock, freight/other charges spread by value into cost), PO to bill (receive+bill or convert), `debit_notes` (stock out, balance reduced or refund recorded, numbered PO/GRN/DN per FY). Limits: bill uses PO rates, one bill per GRN, a GRN cancel does not rewind the moving-average cost, no quotes/RFQ, no PO WhatsApp. Batch 1 (2026-10-24) added: cancel a goods receipt (`POST /v1/inventory/goods-receipts/:id/cancel`: stock back out, order received quantities and status rewound; refused when billed or when the stock was already sold or moved; migration 0029) and the purchase-order PDF / print (`GET /v1/documents/purchase-order/:id.pdf`, English + Tamil; Print and PDF buttons on the order page) | - |
| 4 | Batch / expiry for non-pharmacy stock (FMCG, cosmetics, food) | Partial | Batches+expiry exist only in `packages/medicines`; `packages/inventory` has none | M |
| 5 | Import from Vyapar / Tally / Busy / Marg / Excel (parties, items, opening balances, history) | Done (2026-10-24) | Guided wizard (EN/TA) with source picker, header-row detection, manual column mapping, preview with row errors, downloadable error report, undo per batch, idempotent re-import (stable external keys in `import_records`). Items (+stock, batch/expiry in note), parties (customers and suppliers with opening balances both sides), past sale/purchase bills as `imported` history (no stock change, no messages/e-invoice, out of GSTR-1, original numbers). Tally XML masters and vouchers read directly. Migration 0030; `packages/importexport/src/{history,vendors,tally}.ts`, `apps/api/src/kit-switch.ts`, docs/importing.md. Vendor layouts are tolerant/assumed, not verified against real exports; returns/credit notes, receipts, PDC and bill-wise Tally allocations are not imported | - |
| 6 | Offline billing (sales queued when internet drops) | Partial | Catalogue cached in IndexedDB (`pos-ui/src/lib/catalog-idb.ts`, `catalog-sync.ts`) and an online flag (`online.ts`), but no offline invoice queue/sync or offline number allocation | L |
| 7 | Thermal printing: ESC/POS / direct USB-Bluetooth-LAN, cash-drawer kick | Partial | Web prints a PDF via hidden iframe / `window.print()` (`pos-ui/src/lib/print.ts`); the Flutter app has ESC/POS text (`counter_text.dart`). No WebUSB/serial, no drawer kick for web | M |
| 8 | 2FA / security hardening | Done (2026-10-24) | Global HTTP rate limit (`apps/api/src/http-guard.ts`: per IP, per user, per shop, stricter on sign-in routes, Redis-shared with memory fallback, health and webhooks exempt, `RATE_LIMIT_*` env, 429 `rate_limited` + `Retry-After`); API security headers (nosniff, no-referrer, DENY framing of JSON answers, HSTS in production) and conservative headers in every Next app's `next.config.ts` (no framing rule, so the storefront preview iframe is untouched); explicit `BODY_LIMIT_BYTES` (1 MiB). TOTP two-factor (RFC 6238) for staff and owner accounts: enrol with QR + 10 hashed recovery codes, second step after the OTP / Firebase / Google step (`mfa_required` + 5-minute challenge token, `POST /v1/auth/mfa/verify`), disable and new codes need a current code, per-shop policy `requireMfa` for owners / admins / managers (in the staff sign-in options; forces setup at the next sign-in), secrets AES-256-GCM encrypted with a key derived from `APP_SECRET`, replay-proof, rate-limited and audited (`auth.mfa.*`); test identities (TEST_OTP) skip it. UI: Settings > Security, login second step in the business apps, the landing site and admin. Migration 0029. Not done: WebAuthn / SMS second factor, the Flutter business app's second step, force-sign-out when a shop turns the policy on (applies at sign-in), DPDP items (#21) | - |

## High

| # | Area | Status | Evidence | Effort |
|---|---|---|---|---|
| 9 | GSTR-3B/ITC: outward summary only; no 2B/ITC reconciliation, no RCM, no composition scheme | Partial | `gstr3b` outward block in `packages/invoices/src/reports.ts`; GSTR-1 in `packages/einvoice/src/gstr1.ts`. Purchases carry ITC fields but nothing matches GSTR-2B. `rcm` appears only in the NIC payload | M-L |
| 10 | GSTR-1 gaps: exports, nil/exempt table, debit notes, advances, portal upload | Partial | `gstr1.ts` header comment lists them as not produced | M |
| 11 | Quotation / estimate / proforma / sale order / delivery challan | Missing | `INVOICE_STATUSES` = draft/issued/partially_paid/paid/cancelled; no document types (jobcards has estimates for repair only) | M |
| 12 | Discount approval / manager override, per-user discount cap | Done (2026-10-24) | Per-role and per-member limits (max discount % per bill line and / or max discount per bill, table `staff_discount_limits`, `GET/PUT/DELETE /v1/staff/discount-limits`, Team & roles > Discount limits). Enforced on the server for `POST /v1/invoices` and `PATCH /v1/invoices/:id` (`apps/api/src/discount-guard.ts`): over the limit the API answers 403 `discount_approval_required`; the counter (POS) and the billing invoice form then ask a manager for their POS PIN (`x-approval-pin`); permission `invoices.discount-approve` (managers via `invoices.*`, owners/admins always), wrong PINs counted (5 per 5 minutes per cashier), approvals and refusals audited (`invoices.discount.approved` / `.approval_failed`). Owners, admins and anyone without a limit are not capped (existing shops unchanged). Not done: limits on quotes / orders / bill-level loyalty discount, offline POS queue approvals | - |
| 13 | Shift / cash drawer close, Z-report | Partial | Till sessions with denomination counts, expected cash, X/close (`invoices/src/till.ts`, `pos-ui day-dialog`). Pay-in/out categories and multi-cashier handover not verified | S |
| 14 | Bank reconciliation, bank accounts, cheque (PDC) tracking | Missing | "cheque" is only a payment-mode label; no statement import/match | M-L |
| 15 | TDS/TCS (194Q, 206C(1H), 194C etc.) | Missing | No calculation or reports | M |
| 16 | Stock audit / physical count with variance | Missing | Only `adjust` + movements (`inventory/src/routes.ts`) | S-M |
| 17 | Stock transfer between branches | Partial | `POST /transfers` is an immediate move (`stockTransfers`); no in-transit/receive-confirm, no challan/e-way for transfer | S-M |
| 18 | Valuation (FIFO / weighted avg), landed cost, item-wise profit | Partial | `unitCost` per movement and `cost` on items; freight and other charges on purchases / goods receipts are now spread by value into the moving-average cost (no customs duty split, no FIFO); no item-margin dataset found in `apps/api/src/kit-reports.ts` | M |
| 19 | Packaged reports: by staff, by hour, by category/brand, day/cash book | Partial | Report builder + datasets exist (sales-lines, bills, payments, customers, stock, expenses); canned: top-items, top-customers, sales-trend, ageing | S-M |
| 20 | Payables ageing | Done (2026-10-23) | `GET /v1/inventory/reports/payables-ageing` (0-30/31-60/61-90/90+ from due date, CSV) + `/payables/summary` dashboard tile + Payables page | - |
| 21 | Data privacy (DPDP) | Partial | `packages/consent`: consent log, export, delete-account with grace period. Breach process, retention rules, notice templates not found | S-M |
| 22 | Customer-side full data export / Tally export | Done (2026-10-24) | `POST /v1/export/all` (owner only, background job, zip of CSV + Excel for items, customers, suppliers, invoices, invoice lines, payments, receipts, purchases, purchase lines, supplier payments, expenses, stock movements; signed/auth download, audited, kept 7 days) and `GET /v1/export/tally/vouchers.xml|xlsx` (sales/purchase vouchers in Tally import format). Tally XML shape follows Tally's documented tags but is not tested against a live Tally; the zip is built in memory (datasets over 50k rows get CSV only) | - |
| 23 | Flutter Business app is thin | Partial | `apps/mobile_business/README.md`: billing, orders, products, stock, customers, credit book, expenses; no reports, GST, purchases, e-invoice, offline | L |

## Medium

| # | Area | Status | Evidence | Effort |
|---|---|---|---|---|
| 24 | Hold / resume bills | Done | `pos-ui/components/holds-dialog.tsx` | - |
| 25 | Counter returns / credit notes | Done | `returns-dialog.tsx`, `invoices/credit-notes.ts`, GSTR cdnr | - |
| 26 | Split payments | Done | `invoicePayments`, `payment-dialog.tsx`, `tender.ts` | - |
| 27 | Keyboard-only flow, scanner | Done | `shortcuts.ts`, `use-keys.ts`, `scanner.ts`, `camera-scan.tsx` | - |
| 28 | Weighing scale | Done | `packages/scales`, POS weigh tickets, `scale-serial.ts` | - |
| 29 | Barcode label printing | Partial | `documents/src/labels.ts` exists; label-designer UI (sizes, MRP, pack date) not verified | S-M |
| 30 | Customer-facing display | Missing | no hits | S |
| 31 | Price lists / wholesale tiers / alternate units (box-piece) | Missing | catalogue has a single `unit` | M |
| 32 | Loyalty, coupons | Done | `packages/loyalty`, `coupons` | - |
| 33 | Credit/udhaar limits and reminders | Done | credit book, limits, reminders, statements | - |
| 34 | WhatsApp / SMS | Done | `packages/whatsapp` (Meta + mock), `notify`, campaigns | - |
| 35 | E-invoice IRN, e-way bill, cancel | Done | `packages/einvoice` (GSP driver + mock); real-GSP production use unproven | - |
| 36 | HSN summary | Done | gstr1 hsn section, gst-tab | - |
| 37 | Expenses | Partial | categories, entries, profit report; no recurring, no vendor link, no cash/bank accounts | S-M |
| 38 | Roles / multi-user | Done | `packages/staff` templates + custom roles, POS PINs | - |
| 39 | Multi-branch | Partial | `packages/branches`, branch locations, per-branch series; no consolidated cross-branch P&L view | M |
| 40 | Audit log | Done | `packages/audit` with CSV | - |
| 41 | Recurring invoices to customers | Missing | none in invoices | S-M |
| 42 | GSTIN lookup (autofill party from GSTIN) | Missing | only checksum validation (`gst/src/gstin.ts`) | S |
| 43 | Multi-currency / export invoices | Missing | INR only | M |
| 44 | Payroll / attendance | Missing | no module | M |
| 45 | Period lock / financial-year close / backdating controls | Missing (not deep-verified) | no code found | S-M |

## Already strong / out of scope for the competitors

- Vendor billing: plans, Razorpay subscriptions, UPI Autopay, add-ons (`packages/subscriptions`, `plans`; docs/batch5.md): Done.
- Support: tickets, FAQ, SLA, chat (`packages/support`, `chat`): Done.
- Onboarding + industry packs (`packages/onboarding`, `verticals`): Done, a differentiator.
- Online store, aggregators (Zomato/Swiggy/ONDC), marketplace: beyond Vyapar scope.
- Vendor-side backups + restore drill: Done, but AWS deployment is "prepared, not applied" (docs/roadmap.md batch 7).

## Counts (45 items)

Done 21, Partial 14, Missing 10. By severity: Critical 8, High 15, Medium/Low 22.

## Recommended order

1. ~~Supplier payments + payables ageing + purchase returns/debit notes (#2, #3, #20)~~ done 2026-10-23
2. Offline billing queue (#6) and direct ESC/POS/WebUSB printing (#7)
3. ~~Vyapar/Tally/Busy importers incl. opening balances (#5) and Tally export (#22)~~ done 2026-10-24
4. Simple accounting layer: day book, cash/bank books, P&L, balance sheet, trial balance (#1, #14)
5. GST completeness: 3B with ITC/RCM, GSTR-1 gaps, composition (#9, #10); TDS/TCS (#15)
6. Stock: expiry batches for general items, stocktake, transfer receive flow, landed cost (#4, #16-18)
7. Quotes/challans/sale orders (#11); ~~discount caps (#12)~~ done 2026-10-24; price tiers/UoM (#31)
8. ~~Security: rate limiting, 2FA for owners (#8)~~ done 2026-10-24; DPDP additions (#21) remain
