# Accounting (Part A): the shop's books

`packages/accounting` is a double-entry general ledger for a small Indian shop. It does not replace any money logic: bills,
purchases, payments, expenses and the till keep working exactly as before, and the books **read** them through ports
(`ports.ts`, implemented in `apps/api/src/kit-accounting.ts`) and write only their own five tables. Compared with Tally,
Zoho Books and Vyapar it gives the same core books (chart of accounts, vouchers, day book, ledgers, trial balance, P&L,
balance sheet, period lock, GST ledger) in plain words for an owner who is not an accountant; bank reconciliation, TDS/TCS,
depreciation and the year-end close are Part B (below).

- Feature `accounting` (module `accounting`, depends on `invoices`): off until the owner switches it on (`shopToggle`,
  `defaultOn: false`); the app profile and plan must grant it (Pro and Enterprise in `seed-fixtures.ts`).
- Permissions: `accounting.view` (reports, lists), `accounting.post` (vouchers, accounts, settings, backfill/sync),
  `accounting.lock` (move the period lock). Owners/admins hold all. Built-in roles: **Accountant** gets `accounting.*`;
  **Manager**, the default staff role and the demo role hold `*.view`, which includes `accounting.view`. Cashier and
  stock-keeper have none.
- Migration `0032_accounting` (tables `acct_accounts`, `acct_entries`, `acct_lines`, `acct_settings`, `acct_lock_log`, plus
  two triggers that make posted rows immutable at the database).

## Design

**Accounts.** Seeded per shop on first use from `chart.ts` (about 38 standard accounts, Tally-style groups), topped up
automatically when the standard chart gains an account. Types: asset, liability, equity, income, expense; each account has
a group (`cash_bank`, `receivables`, `stock`, `tax_assets`, `current_assets`, `fixed_assets`, `payables`,
`tax_liabilities`, `current_liabilities`, `loans`, `capital`, `sales`, `other_income`, `direct`, `indirect`). Standard
accounts carry a `key` (cash, bank, debtors, creditors, stock, gst_in_cgst/sgst/igst/cess, gst_out_*, tax_payable,
tds/tcs receivable and payable, capital, drawings, opening_equity, sales, sales_returns, discount_allowed, other_income,
discount_received, purchases, purchase_returns, round_off, cash_short_excess, stock_adjustment, till_clearing,
other_expense); the automatic postings find accounts by key, never by name, so owners may rename them. They can't be
deleted or retyped. Each expense category gets its own expense account (`expcat:<id>`) the first time an expense of that
category is posted. Bank accounts are ordinary asset accounts with `is_bank` (bank name, last 4 digits, IFSC); the
bank-reconciliation hooks for Part B are exactly these columns. Opening balances are a signed paise column on the account,
posted as one journal ("Opening balances of accounts") against Opening balance equity.

**Journal.** `acct_entries` (header: number, date, narration, voucher type, origin manual/auto, source type/id/version,
content hash, reversal links) and `acct_lines` (account, debit or credit in paise, optional customer/supplier party).
An entry is balanced (debits = credits, checked in the service and per line by a DB check), dated, and immutable: no
route edits or deletes. Triggers reject `UPDATE`/`DELETE` of lines and of anything but the reversal marks of an entry. A
mistake is fixed by **reversal**: a new entry with debits and credits swapped (`voucher_type = reversal`), the original
marked `reversed`. Automatic entries can't be reversed by hand (change the source document instead).

**Automatic posting.** Instead of hooking each write path (which would mean editing the invoice, inventory and expense
money code), the engine *derives* postings from the current state of the documents and reconciles them with what was
posted. `sync()` loads every source document of a shop through the ports, runs the pure rules in `rules.ts`, and for each
(source type, source id) compares the content hash of the wanted posting with the active entry:

| Situation | Action |
|---|---|
| nothing posted yet | post version 1 |
| same hash | nothing (idempotent: re-runs and backfill never double-post) |
| content changed (an edited expense) | reverse the active entry, post version n+1 |
| document gone (a deleted payment or receipt) | reverse the active entry |

A later business fact is its own posting that mirrors the first: a cancelled bill posts `invoice_cancel` dated at the
cancellation, a reversed supplier payment posts `supplier_payment_reversal`, and so on. Uniqueness is enforced by a
partial unique index on `(tenant, source_type, source_id, source_version)`, and a sync takes a per-shop Postgres advisory
lock. Triggers: `POST /v1/accounting/backfill` (preview with `dryRun`, then real; the first real run switches automatic
posting on), the shop's bill/payment/credit-note events (`emit` in `kit.ts`, debounced 1.5 s), every report read when the
last sync is older than 20 s, and `POST /v1/accounting/sync`. Purchases, supplier payments, debit notes and expenses
have no events, so they reach the books on the next read or sync (within 20 s of any report/journal view).

**Period lock.** `acct_settings.locked_through`. Manual vouchers and reversals dated on or before it are refused (409).
Automatic postings that fall in a locked period are not refused (that would break the sync); they are dated the first open
day and carry `late_for` = the document's own date, shown on the entry and counted in the sync result. Moving the lock
needs `accounting.lock`, can't go into the future, and is recorded in `acct_lock_log` (who, from, to, why) and, like every
mutating request, in the audit log.

## Posting rules

Money is paise. "Money account" = the account of the payment method: cash goes to *Cash in hand*; UPI, card, bank, cheque
and other go to the main bank account unless Settings maps the method to another cash/bank account. Party lines carry the
customer or supplier id so the control accounts can be reconciled per party.

| Document | Source type | Debit | Credit |
|---|---|---|---|
| Invoice issued (not draft) | `invoice` | Debtors (total), Discount allowed (discount) | Sales (total + discount - GST - round-off), GST output CGST/SGST/IGST, Round off (if positive; a negative round-off is a debit) |
| Invoice cancelled | `invoice_cancel` (dated at cancellation) | mirror of the invoice | mirror of the invoice |
| Payment on a bill (any method, incl. online) | `invoice_payment` | Money account | Debtors |
| Refund (negative payment, with a credit note) | `invoice_payment` | Debtors | Money account |
| Allocation of a customer receipt to a bill | skipped (the receipt itself is posted) | | |
| Customer receipt (credit book) | `customer_receipt` | Money account | Debtors (whole amount, advance included) |
| Advance against a proforma invoice or sale order (docs/sales-documents.md) | `customer_receipt` (it is a customer receipt kept for that document) | Money account | Debtors |
| Credit note issued (bill not cancelled) | `credit_note` | Sales returns (taxable), GST output (reversal) | Debtors (total) |
| Purchase bill | `purchase` | Purchases (total - GST - round-off, freight inside), GST input CGST/SGST/IGST | Creditors (total) |
| Purchase bill cancelled | `purchase_cancel` | mirror | mirror |
| Supplier payment | `supplier_payment` | Creditors | Money account (by mode) |
| Supplier refund | `supplier_payment` | Money account | Creditors |
| Supplier payment reversed | `supplier_payment_reversal` (dated at reversal) | mirror | mirror |
| Debit note issued | `debit_note` | Creditors (total) | Purchase returns (taxable), GST input (reversal) |
| Debit note cancelled | `debit_note_cancel` | mirror | mirror |
| Expense recorded | `expense` | Expense category account (amount - ITC), GST input (ITC; IGST when the vendor GSTIN is from another state than the shop's, else CGST+SGST halves) | Money account (amount) |
| Expense cancelled | `expense_cancel` | mirror | mirror |
| Till closed with a difference | `till_difference` | Cash (excess) or Cash short and excess (short) | the other side |
| Cash put in / taken out of the drawer by hand | `till_cash` | Cash / Till cash in-out (to review) | the other side |
| Composition tax paid by challan (GST filing > Composition) | `gst_payment` (and `gst_payment_cancel` when cancelled) | Composition tax (expense, account 5930) | Money account (by method) |
| Opening stock (`opening` movement) | `stock_adjustment` | Stock in hand | Opening balance equity |
| Stock added/removed by hand (`adjustment`) and the differences of an approved stock audit (`audit`) | `stock_adjustment` | Stock in hand / Stock gains and write-offs | the other side |
| Payroll made final (docs/payroll.md) | `payroll_run` (dated the month's last day) | Salaries and wages (gross), Employer PF and ESI, Round off (net rounded up) | Salaries payable (net), PF / ESI payable (both shares), Professional tax payable, TDS on salaries payable, Advances to staff (recovered), Other income (other deductions), Round off (rounded down) |
| Salary paid / advance to staff / PF, ESI, PT or salary TDS deposited | `salary_payment` / `staff_advance` / `payroll_due` | Salaries payable / Advances to staff / the dues account | Money account (by method) |
| Customer and supplier opening balances | `opening_parties` | Debtors (customers who owed), Creditors (suppliers we had paid in advance) | Creditors, Debtors for the opposite, and Opening balance equity for the difference |
| Opening balance typed on accounts | `account_opening` | accounts with a debit balance | accounts with a credit balance, Opening balance equity for the difference |
| Imported historical bills and their payments, credit notes, supplier payments | same as above, **only when** Settings > "Bills imported from another software" is "Post like other bills"; default is left out (they were in the old books) | | |

Rules that mirror the existing modules exactly: the customer ledger counts a cancelled bill as bill plus cancellation,
keeps payments of cancelled bills, and leaves credit notes of cancelled bills out; the books do the same, so the
receivables control equals the credit book.

## Reports

All under `GET /v1/accounting/reports/...`, `format=csv` for a CSV (rupees, UTF-8 BOM) and a PDF at
`GET /v1/documents/accounting-report/<report>.pdf?from=&to=` (a document type registered in `kit.ts`; the HTML comes from
`pdf.ts`, wrapped by the documents module like every other PDF; Tamil locale supported).

| Report | Route (`/v1/accounting/...`) | Notes |
|---|---|---|
| Day book | `reports/day-book` | entries with lines, paged; filters origin, voucher type, dates |
| Account ledger | `reports/ledger?accountId=` | running balance from the opening balance; optional `partyId` |
| Cash book | `reports/cash-book` | ledger of the cash account (or `accountId` of a bank account) |
| Trial balance | `reports/trial-balance?from&to` | opening / period / closing, Dr and Cr, balanced flag |
| Profit and loss | `reports/profit-loss?from&to&compare=previous` | sales, COGS (opening stock + purchases - closing stock), gross profit, other income, expenses, net profit; optional comparison period |
| Balance sheet | `reports/balance-sheet?asOf` | assets, liabilities, equity; stock at live valuation, profit to date carried to equity; `balanced` flag |
| GST ledger summary | `reports/gst-ledger?from&to` | output vs input per CGST/SGST/IGST/cess |
| Reconciliation | `reconcile?from&to`, `reconcile/parties?type=customer|supplier` | see below |

**Stock valuation (periodic method).** Closing stock = sum over tracked items of quantity at the date x current
moving-average cost (`stock_items.avg_cost`); quantity at an earlier date is the current quantity less later movements, so
historic balance sheets use today's cost and are an estimate. The Stock in hand account only carries opening stock and hand
adjustments (above); the balance sheet shows the live value instead of the account balance and carries the difference to
profit, which is what keeps the sheet balanced whatever the valuation. The P&L's stock effect is
`closing - (value the day before + movements of the Stock account in the period)`. Turn off in Settings for shops that do
not track stock.

**Reconciliation checks:** trial balance debits = credits; sales in the books = bills issued (total + discount - GST -
round-off); sales less discount = taxable value stored on the bills; sales returns = credit notes; receivables control =
credit book total; payables control = Payables total; GST collected = the invoices GST summary; GST input = purchases ITC +
claimable expense GST - debit notes. Differences that are not errors are listed as explained items: walk-in bills (no
customer, so not in the credit book), manual entries on the debtors/creditors accounts, imported history left out. Per
customer / supplier differences are listed by `reconcile/parties`.

## UI

Billing UI, section **Accounts** (feature `accounting`, permission `accounting.view`; EN and TA in
`lib/messages/accounting.ts`, parity and key-use tests in `module.test.ts`): Books (overview, self-check status),
Journal entries (list, filters, entry detail, reverse), New entry (money paid out, money received, cash to bank, adjustment
journal with a live debit/credit check), Day book, Ledger (with cash book buttons), Trial balance, Profit and loss (with
comparison), Balance sheet, GST summary, Chart of accounts (add/edit/switch off, opening balance, bank account details),
Self-check (reconciliation), Books and period lock (also in the settings rail at `/settings/accounting`: lock, imported
bills, stock valuation, payment method to bank account mapping, post history, preview), and "How your books work" for owners.
Report screens have CSV and PDF downloads. Part B adds Bank and cheques (accounts, statement import, matching,
reconciliation statement, cheque register), TDS and TCS (with settings and PAN), Fixed assets and Year-end close; they are
added to the Accounts section by `withAccountingPartB` (`billing-ui/src/accounting-b.tsx`, EN/TA in
`lib/messages/accounting-b.ts`, tests in `accounting-b.test.ts`).

## Operations

- Dev script: `pnpm --filter @srirealtime/api exec tsx --env-file-if-exists=.env src/scripts/accounting-check.ts <slug> [--keep|--wipe]` posts a
  shop's history, runs the reconciliation, prints the checks and removes the accounting rows again (`--keep` to leave them).
  Deleting posted rows needs `set_config('acct.allow_delete','on', true)` in the transaction (the service's `wipe()` does it).
- Backfill speed: about 1,000 entries/s in a dev database (Theneer, 28,858 bills: 56,576 entries in 63 s). A repeat sync
  of the same shop costs one scan of its documents (a second or two at that size).

## Limits and decisions

1. **Accrual basis.** Sales, purchases and GST are booked on the bill date, whether or not money moved; GST is not on a
   cash/payment-date basis. Decision for the owner/CA: composition shops and shops that account for GST on receipt need a
   cash-basis switch (not built).
2. **Stock: periodic, average cost.** No perpetual inventory and no per-sale cost of goods (sales don't carry their cost).
   Gross profit is only as good as the stock valuation. Old dates use today's average cost.
3. Year-end closing entries are optional (Part B, Year-end close). Until a year is closed, P&L accounts run on and the
   balance sheet shows "profit to date".
4. Expense ITC is split CGST+SGST unless the vendor GSTIN is from another state. Purchases/debit notes use the split on the
   bill. CGST/SGST/IGST set-off order and the GST payment entries are done by hand with journal entries on *GST payable*.
5. Bills for walk-in customers (no customer record) are in the books but not in the credit book; the self-check explains
   the difference.
6. A source document edited or removed **after its period is locked** is corrected on the next open day (marked late)
   rather than in the past.
7. Manual entries on the debtors/creditors accounts are allowed (with an optional customer/supplier on the line) but show
   in the self-check as manual adjustments.
8. Payments by UPI/card/cheque all go to the main bank account unless mapped in Settings; no clearing account, no card
   settlement lag.
9. Multi-branch shops share one set of books; no per-branch P&L yet. No multi-currency.
10. Reads run an incremental-by-full-scan sync at most every 20 s per shop; very large shops (100k+ documents) should
    move this to a scheduled job and an events feed from the source modules (the ports are the seam).
11. The audit page does not yet name accounting actions (they are logged as `accounting.post /journal-entries` and so on).

## Part B (built 2026-10-26)

Bank reconciliation with statement import and a cheque register, TDS/TCS, fixed assets with depreciation, and the
financial-year close. Details: `docs/bank-reconciliation.md` and `docs/tds.md`. Migration `0044_accounting_part_b` (12 new
tables, additive; no Part A table changed): `acct_bank_statements`, `acct_bank_lines`, `acct_bank_matches`,
`acct_bank_recons`, `acct_cheques`, `acct_tds_settings`, `acct_party_tax`, `acct_tds_entries`, `acct_tds_challans`,
`acct_fixed_assets`, `acct_depreciation`, `acct_year_closes`.

**Design.** Part B lives in the same package (`bank.ts`, `tds.ts`, `assets.ts` with `YearEndService`, routes in
`routes-b.ts`; pure logic in `bank-import.ts`, `xlsx-lite.ts`, `bank-match.ts`, `tds-rules.ts`, `assets-logic.ts`). Every
journal it posts goes through two new engine methods, `postModuleEntry` / `reverseModuleEntry`: origin `auto`, its own
source type (`bank_entry`, `bank_difference`, `cheque_bounce`, `tds_deduction`, `tcs_collection`, `tds_challan`,
`asset_purchase`, `asset_opening`, `depreciation`, `asset_disposal`, `year_close`, each with a `*_reversal`;
`part-b-types.ts`). These are outside the document sync's `SOURCE_TYPES`, so a sync never reverses them, and the journal
screen can't reverse them (they are cancelled from their own screen, which posts the `*_reversal`). They respect the
period lock like manual vouchers (refused in a locked period), except the year-end close. New standard accounts (seeded
on top-up; a code clash falls back to a free code): 1590 Accumulated depreciation, 3050 Retained earnings, 4120 Interest
received, 4130 Profit or loss on sale of assets, 5940 Bank charges, 5945 Interest paid, 5950 Depreciation, 5955 Interest
and late fee on taxes. Permissions: `accounting.bank` (statements, matching, cheques) and `accounting.tds` (TDS/TCS) are
new; fixed assets need `accounting.post`; year-end close and re-open need `accounting.lock`. The Accountant role
(`accounting.*`) gets them all; everything is readable with `accounting.view`.

**Posting rules (Part B).**

| Event | Source type | Debit | Credit |
|---|---|---|---|
| Statement line not in the books (preset) | `bank_entry` | money out: Bank charges / Interest paid / Other expenses / Drawings / Cash / chosen account; money in: the bank | the other side |
| Grouped match with a difference (card / UPI fee) | `bank_difference` | chosen account (fee) | bank (and the other way for an extra receipt); reversed when the match is removed |
| Cheque bounced, bank's charges | `cheque_bounce` | Bank charges | the bank account. A manual payment entry linked to the cheque is reversed; an automatic one is fixed in its document (the bill or Payables) |
| TDS on a supplier bill or payment | `tds_deduction` | Creditors (with the supplier) | TDS payable; the same amount is settled on the bill in Payables (a supplier payment of mode "other", reference `TDS:<id>`, which the document sync skips) |
| TDS on an expense | `tds_deduction` | the expense's money account (the expense is recorded gross) | TDS payable |
| TDS, other payee | `tds_deduction` | chosen account | TDS payable |
| TCS on a sale | `tcs_collection` | Debtors (with the customer) | TCS payable |
| Challan (ITNS 281) | `tds_challan` | TDS/TCS payable (tax), Interest and late fee on taxes | the cash / bank account paid from |
| Fixed asset bought (optional) | `asset_purchase` | the fixed-asset account | cash / bank / loan (not Debtors / Creditors) |
| Depreciation charged before the books | `asset_opening` | Opening balance equity | Accumulated depreciation |
| Depreciation run | `depreciation` | Depreciation (one line per asset) | Accumulated depreciation |
| Asset sold or scrapped | `asset_disposal` | money account (sale), Accumulated depreciation | the asset account at cost; Profit or loss on sale of assets for the difference |
| Year-end close | `year_close` (dated 31 March) | income accounts, Stock (up to valued closing stock) | expense accounts, Retained earnings (profit; a loss the other way) |

**Year-end close.** Moves each income and expense account's net for the year, and brings Stock in hand to the valued
closing stock (periodic method; so the balance sheet's live-value adjustment restarts from that value), into Retained
earnings; locks the books to 31 March when the lock is earlier (logged in `acct_lock_log`). The profit and loss and the
trial-balance movement columns leave out `year_close` entries (`balancesBetween(..., { excludeClosing: true })`), so a
closed year still reports its own profit; the opening of the next year (balances before 1 April) includes them, so
income and expense open at zero and Retained earnings holds the profit. Re-open (permission `accounting.lock`, reason
required, recorded in `acct_year_closes` and the audit log): reverses the closing journal on the same date and moves the
lock back to where it was before the close; a later closed year must be re-opened first. Checks before closing: trial
balance (blocking), the year has ended (blocking), open statement lines, undeposited TDS, depreciation not posted
(warnings).

**Self-check.** The receivables and payables checks now set aside Part B entries on the control accounts that the
credit book / Payables don't know about (TCS collected, bank-statement entries with a party, TDS not settled on the bill),
listed as explained items.

**Per-branch books: not built (gap).** Journal lines have no `branch_id`; a branch dimension would need a column on
`acct_lines`, the branch on every source document read through the ports, and branch filters on every report. Not cheap,
so left for later (see Limits).

**Limits (Part B).** PDFs: the bank reconciliation, TDS quarterly data and certificate summary are report tables served
through `/v1/documents/accounting-report/<name>.pdf` (CSV works the same way); in this dev environment every
accounting PDF (Part A ones too) hung in the renderer during testing, so the PDFs were not seen. A bounced cheque on a bill
payment must be undone in the bill (the books follow the document). TDS reasons, quarterly notes and alerts built on the
server are English in the Tamil screens. Depreciation is book depreciation (SLM / WDV by days in use), not the
income-tax block method. One closing journal per year; no partial-year closes.

## Not built yet

Budgets, cost centres, per-branch books, multi-currency, recurring journals, GSTR-3B set-off entries, e-way-bill and
e-invoice cross-checks against the ledger, scheduled sync and an events feed for purchases/expenses, bank feeds (API),
MT940 / PDF statements, TDS returns in the FVU format, salary TDS returns (24Q; payroll takes a manual monthly salary TDS, `docs/payroll.md`).
