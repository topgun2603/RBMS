# Gap analysis vs Vyapar / Marg / Busy / Tally / Gofrugal / Petpooja / Zoho Books

Audit date 2026-10-23. Read-only: evidence comes from package schemas, routes, UI file lists and docs. Items marked
"(not deep-verified)" were judged from file names/routes, not by reading every code path. Severity = customer impact
for an Indian small-business billing/POS/ERP buyer; effort S (days) / M (1-3 weeks) / L (month+).

## Critical

| # | Area | Status | Evidence | Effort |
|---|---|---|---|---|
| 1 | Double-entry accounting: ledgers, day book, trial balance, P&L, balance sheet | Missing | No such tables/routes. Only `reports/profit` (expenses package) and the customer ledger (`packages/invoices/src/ledger.ts`). Accountants of Tally/Busy/Zoho users need these | L |
| 2 | Supplier payables: part-payments, supplier ledger/ageing, advances | Missing | `purchases.paid` is a boolean (`packages/inventory/src/schema.ts`); only `POST /purchases/:id/paid`. No payment rows, no supplier statement | M |
| 3 | Purchase workflow: PO, GRN, purchase returns / debit notes | Missing | Only direct `purchases` (recorded/cancelled). No PO/GRN tables; no debit-note concept (sales credit notes exist) | M |
| 4 | Batch / expiry for non-pharmacy stock (FMCG, cosmetics, food) | Partial | Batches+expiry exist only in `packages/medicines`; `packages/inventory` has none | M |
| 5 | Import from Vyapar / Tally / Busy / Marg / Excel (parties, items, opening balances, history) | Partial | `packages/importexport/src/specs.ts` handles items + customers (CSV/xlsx) only; no vendor-format mappers, no opening balances or past bills. Migration is the main switching barrier | M |
| 6 | Offline billing (sales queued when internet drops) | Partial | Catalogue cached in IndexedDB (`pos-ui/src/lib/catalog-idb.ts`, `catalog-sync.ts`) and an online flag (`online.ts`), but no offline invoice queue/sync or offline number allocation | L |
| 7 | Thermal printing: ESC/POS / direct USB-Bluetooth-LAN, cash-drawer kick | Partial | Web prints a PDF via hidden iframe / `window.print()` (`pos-ui/src/lib/print.ts`); the Flutter app has ESC/POS text (`counter_text.dart`). No WebUSB/serial, no drawer kick for web | M |
| 8 | 2FA / security hardening | Missing | Auth is OTP/Firebase only; no TOTP; no general HTTP rate-limit plugin found in `apps/api/src/server.ts` (only OTP, ticket and PIN-specific limits); no security-header plugin found | M |

## High

| # | Area | Status | Evidence | Effort |
|---|---|---|---|---|
| 9 | GSTR-3B/ITC: outward summary only; no 2B/ITC reconciliation, no RCM, no composition scheme | Partial | `gstr3b` outward block in `packages/invoices/src/reports.ts`; GSTR-1 in `packages/einvoice/src/gstr1.ts`. Purchases carry ITC fields but nothing matches GSTR-2B. `rcm` appears only in the NIC payload | M-L |
| 10 | GSTR-1 gaps: exports, nil/exempt table, debit notes, advances, portal upload | Partial | `gstr1.ts` header comment lists them as not produced | M |
| 11 | Quotation / estimate / proforma / sale order / delivery challan | Missing | `INVOICE_STATUSES` = draft/issued/partially_paid/paid/cancelled; no document types (jobcards has estimates for repair only) | M |
| 12 | Discount approval / manager override, per-user discount cap | Partial | Only the flat permission `invoices.discount` (`staff/templates.ts`); no % cap or manager-PIN approval at the counter | S |
| 13 | Shift / cash drawer close, Z-report | Partial | Till sessions with denomination counts, expected cash, X/close (`invoices/src/till.ts`, `pos-ui day-dialog`). Pay-in/out categories and multi-cashier handover not verified | S |
| 14 | Bank reconciliation, bank accounts, cheque (PDC) tracking | Missing | "cheque" is only a payment-mode label; no statement import/match | M-L |
| 15 | TDS/TCS (194Q, 206C(1H), 194C etc.) | Missing | No calculation or reports | M |
| 16 | Stock audit / physical count with variance | Missing | Only `adjust` + movements (`inventory/src/routes.ts`) | S-M |
| 17 | Stock transfer between branches | Partial | `POST /transfers` is an immediate move (`stockTransfers`); no in-transit/receive-confirm, no challan/e-way for transfer | S-M |
| 18 | Valuation (FIFO / weighted avg), landed cost, item-wise profit | Partial | `unitCost` per movement and `cost` on items; no freight/duty allocation; no item-margin dataset found in `apps/api/src/kit-reports.ts` | M |
| 19 | Packaged reports: by staff, by hour, by category/brand, day/cash book | Partial | Report builder + datasets exist (sales-lines, bills, payments, customers, stock, expenses); canned: top-items, top-customers, sales-trend, ageing | S-M |
| 20 | Payables ageing | Missing | Receivables ageing done (`/reports/ageing`); payables depend on #2 | S |
| 21 | Data privacy (DPDP) | Partial | `packages/consent`: consent log, export, delete-account with grace period. Breach process, retention rules, notice templates not found | S-M |
| 22 | Customer-side full data export / Tally export | Partial | DB backups are vendor-side (`docs/ops.md`); customers get per-entity CSV only; no all-data zip, no Tally XML | M |
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

Done 14, Partial 17, Missing 14. By severity: Critical 8, High 15, Medium/Low 22.

## Recommended order

1. Supplier payments + payables ageing + purchase returns/debit notes (#2, #3, #20)
2. Offline billing queue (#6) and direct ESC/POS/WebUSB printing (#7)
3. Vyapar/Tally/Busy importers incl. opening balances (#5) and Tally export (#22)
4. Simple accounting layer: day book, cash/bank books, P&L, balance sheet, trial balance (#1, #14)
5. GST completeness: 3B with ITC/RCM, GSTR-1 gaps, composition (#9, #10); TDS/TCS (#15)
6. Stock: expiry batches for general items, stocktake, transfer receive flow, landed cost (#4, #16-18)
7. Quotes/challans/sale orders (#11); discount caps (#12); price tiers/UoM (#31)
8. Security: rate limiting, 2FA for owners, DPDP additions (#8, #21)
