# Recurring invoices, export / multi-currency bills and GSTIN lookup

Gap items #41, #43 and #42 (`docs/gap-analysis.md`). Migration **0052** (`apps/api/drizzle/0052_recurring_export_gstin.sql`):
tables `recurring_profiles`, `recurring_runs`, `gstin_lookups`, `gstin_lookup_log`; columns `invoices.supply_type /
currency / exchange_rate / foreign / export_details / recurring_run_id`, `invoice_payments.currency / foreign_amount /
exchange_rate / forex_diff`, `billing_customers.country`. Nothing changes for a shop that doesn't use them: a bill without
a supply type is `domestic` in rupees, exactly as before.

Code: `packages/invoices/src` — `recurring-calc.ts` (schedule maths, pure), `recurring.ts` (service + scheduler),
`recurring-routes.ts`, `export-calc.ts` (supply types, currency conversion, foreign receipts, pure), `export-routes.ts`,
`gstin-lookup.ts` (service, provider interface, HTTP provider, fake provider), `gstin-routes.ts`, tables in
`schema-recurring.ts`; `packages/gst/src/currency.ts`, `countries.ts`, `parseGstin` in `gstin.ts`, state code 96 in
`states.ts`. Wiring: `apps/api/src/kit-recurring.ts`. UI: `packages/billing-ui` (`recurring.tsx`, `pages/recurring*.tsx`,
`components/recurring`, `components/export`, `components/gstin`).

## 1. Recurring invoices (#41)

Sell > Recurring. Feature `invoices.recurring` (shop toggle; `invoices.*` plans, starter and the EC profile in
`seed-fixtures.ts`). Permissions `recurring.view`, `recurring.manage` (create / edit also need `invoices.create`; a line
discount needs `invoices.discount`). Roles: manager `recurring.*`, accountant `recurring.view`, default staff view.

A **profile** belongs to one saved customer and holds:

| Field | Meaning |
|---|---|
| lines | bill lines as entered; units checked and lines priced by the host when saved (`kit-pricing.ts`) |
| priceMode | `fixed` = the saved prices; `list` = lines of saved items priced again from the customer's price list on the bill date |
| frequency, interval | weekly / monthly / quarterly / yearly, every N (1–24) |
| dayOfMonth / weekday | 1–31 (29–31 bill on the month's last day in shorter months, and go back to the day next month); weekly: 0 Sunday … 6 Saturday |
| startDate, endDate, maxCount | the schedule's anchor; optional end date and / or number of bills |
| dueDays | due date = bill date + N days |
| issueMode | `draft` (to check and issue by hand) or `issue` (numbered at once, counted against the plan's monthly bills) |
| sendChannel | `none` / `whatsapp` / `sms`: after an automatic issue, the bill's share link through notify (template `invoice.issued`); never for drafts |

**Scheduler** (`invoices.recurring` job, `15 6,14 * * *` IST; `runDue`): every active profile whose next date has come,
in shops with the feature on.

- Each date is a **run** row, unique per (profile, date). The run is claimed (inserted) and the next date moved on in one
  transaction with the profile row locked; only then is the bill made, through `InvoicesService.create` (so numbering per
  branch / FY, plan quota, price lists, stock and events are exactly those of a bill made by hand). A job that runs twice,
  or two at once, makes one bill per date. The bill carries `recurring_run_id`; a run left "pending" by a crash is matched
  to its bill (or marked failed) on the next run.
- **Catch-up**: when the scheduler was down, the latest 3 missed dates are billed (dated on their own dates) and older ones
  are recorded as `skipped` ("Missed: older than the catch-up limit").
- **Period lock**: a date on or before the books' `locked_through` is not billed (run `locked`).
- **Failures** (plan limit, customer deleted, …): run `failed` with the reason on the profile; retried by the next runs up
  to 3 attempts, while the date is within 45 days.
- Ends by itself when the end date or the number of bills is reached.
- Owner actions: pause (no bills; dates missed while paused are not billed after resume), resume (from the next date on or
  after today), skip next (recorded as skipped), bill now (a run dated today, once a day), end, delete (only when no bill
  was made). Every action is in the audit log (`recurring.*`).

Routes `/v1/recurring`: `GET /` (paged: `status`, `customerId`, `frequency`, `q`; sort `next`, `name`, `customer`,
`created`, `count`; status facets), `GET /summary`, `GET /preview?frequency&interval&dayOfMonth&weekday&startDate&endDate&maxCount`,
`POST /`, `GET|PATCH|DELETE /:id`, `POST /:id/pause|resume|skip|end|run`.

## 2. Export invoices and foreign currency (#43)

On the bill form: "Export, SEZ or foreign-currency bill".

| Supply type | Tax | Place of supply | GSTR-1 | e-invoice `SupTyp` |
|---|---|---|---|---|
| `domestic` | as before | customer's state | B2B / B2CL / B2CS | B2B |
| `export_wpay` (with payment of IGST) | IGST | 96 Other Countries | 6A `exp` WPAY | EXPWP |
| `export_wopay` (under LUT / bond) | none (lines at 0%) | 96 | 6A `exp` WOPAY | EXPWOP |
| `sez_wpay` | IGST, even inside Tamil Nadu (IGST Act s. 7(5)(b)) | SEZ unit's state | B2B, `inv_typ` SEWP | SEZWP |
| `sez_wopay` | none | SEZ unit's state | B2B, `inv_typ` SEWOP | SEZWOP |

- **Rupees are the truth.** Totals, GST, the books, GSTR-1 / 3B and every report use the rupee columns. A foreign-currency
  bill (`foreign: { currency, exchangeRate, lines: [{ rate, discount? }] }`, one entry per line, minor units) gets each line's
  rupee price = foreign price × the typed rate (to the paisa per unit); the foreign figures (`invoices.foreign`: lines,
  taxable, IGST at the bill's rate, total) are stored next to them. Currencies: ISO 4217 list with minor-unit digits
  (`@srirealtime/gst` `CURRENCIES`; JPY 0, KWD / OMR / BHD 3). No live rate feed: the shop types the rate.
- **LUT**: number (ARN) and date in Settings > Business profile (`billing` namespace `lutNumber`, `lutDate`); a bill
  without IGST can't be issued without them (400 `lut_missing`) and freezes them in `export_details` at issue.
- Shipping bill no., date and port code (6 characters) on the bill; the buyer's country (`billing_customers.country`, ISO
  alpha-2; such a customer gets state code 96 and no GSTIN). An SEZ supply needs the SEZ unit's GSTIN.
- **PDF** (A4 and 80 mm, English and Tamil): the declaration "Supply meant for export under LUT without payment of IGST" /
  "… with payment of IGST" (SEZ: "Supply meant for SEZ unit or developer …"), LUT no. and date, shipping bill, port,
  exchange rate, the foreign amount per line and the foreign total next to the rupee figures, the buyer's country, place of
  supply "96 – Other Countries".
- **GSTR-1** (`packages/einvoice/src/gstr1.ts`, `packages/gstfiling/src/gstr1x.ts`): exports are left out of B2B / B2CL /
  B2CS (before this they also landed in B2CS / B2CL — a double count with table 6A) and go to `exp` with `sbpcode`,
  `sbnum`, `sbdt` when known; SEZ supplies are B2B SEWP / SEWOP with IGST only; credit notes on exports go to CDNUR as
  EXPWP / EXPWOP; HSN lines of exports in the B2C tab. GSTR-3B counts SEZ and export lines as zero-rated (3.1(b)).
- **E-invoice** (`nic.ts`): buyer GSTIN `URP`, state and place of supply 96, PIN 999999, `ExpDtls { ShipBNo, ShipBDt, Port,
  RefClm (Y for WPAY), ForCur, CntCode }`; SEZ supplies validated as IGST-only.
- **Payments in the currency**: `POST /v1/export-billing/invoices/:id/payments { amount (minor units), realisedRate,
  method, date, reference? }` (`payments.receive`). The bill is settled at its own rate (the last payment clears the whole
  rupee balance); `invoice_payments.forex_diff` = rupees the bank paid − rupees settled. The books (docs/accounting.md):
  money account at the realised rupees, Debtors at the settled rupees, the difference to **Foreign exchange gain or loss**
  (account 4140, new standard account). `GET /v1/export-billing/currencies`, `/countries`.

## 3. GSTIN lookup (#42)

On the customer and supplier forms, under the GSTIN field:

1. **Offline, at once** (`parseGstin`): format and check character (a typo shows the character the number needs), State
   (filled in), PAN, PAN holder type (company, individual, firm, LLP …), entity number.
2. **Online, when a provider is configured**: "Look up" → legal and trade name, address, PIN, status (active / cancelled /
   suspended / inactive), registration type, constitution, registration / cancellation dates; "Use these details" fills
   name, address and state. With no provider the form says the lookup isn't set up and only the offline part runs.

`GET /v1/gstin/:gstin[?refresh=1]`, `GET /v1/gstin/info`, `POST /v1/gstin/status { gstins }` (cached status only, never a
provider call). Answers are cached for every shop in `gstin_lookups` (public registration data) for 30 days; provider
calls are logged per shop in `gstin_lookup_log` and limited to 30 an hour and 200 a day per shop (env
`GSTIN_LOOKUP_PER_HOUR`, `GSTIN_LOOKUP_PER_DAY`, `GSTIN_LOOKUP_CACHE_DAYS`). Over the limit or when the provider fails,
an older cached answer is shown, else the offline part. **Cancelled GSTIN warning**: the bill page, the purchase form and
the purchase page show a warning when the party's GSTIN is cancelled, suspended or inactive in the cache.

**Provider** (`GstinLookupProvider { name; lookup(gstin) → details | null }`, `apps/api/src/kit-recurring.ts`):

| Env | Meaning |
|---|---|
| `GSTIN_LOOKUP_PROVIDER` | `gstn-search` (unset = offline only) |
| `GSTIN_LOOKUP_URL` | endpoint with `{gstin}` where the number goes |
| `GSTIN_LOOKUP_KEY` | API key (sent as `Authorization: Bearer …` unless `GSTIN_LOOKUP_HEADER` names another header) |

The `gstn-search` provider reads the GSTN taxpayer-search JSON (`lgnm`, `tradeNam`, `sts`, `dty`, `ctb`, `rgdt`, `cxdt`,
`pradr.addr`), bare or under `data` / `result`, which most GSPs pass through; 404 = not registered. No provider is signed
up and nothing is called at start-up. Tests use `fakeGstinProvider`.

## Tests

- `packages/gst/src/export-gstin.test.ts` (GSTIN parts, currencies, countries, 96).
- `packages/invoices/src/recurring-export-calc.test.ts` (schedule, month end, catch-up plan, conversions, payment split);
  `recurring-export.db.test.ts` (needs `INVOICES_TEST_DATABASE_URL`: one bill per date with concurrent runs, catch-up,
  period lock, plan limit and retry, pause / skip / resume / count, HTTP; export under LUT with LUT frozen, WPAY and SEZ
  IGST, foreign receipts with gain and loss; GSTIN offline, provider, cache, rate limit, statuses).
- `packages/einvoice/src/export.test.ts` (GSTR-1 JSON: EXP out of B2CS, SEZ SEWP / SEWOP, CDNUR EXPWOP, HSN; ExpDtls
  payload validates), `packages/gstfiling/src/export.test.ts` (6A with shipping bill and port; zero-rated), 
  `packages/accounting/src/forex.test.ts`, `packages/documents/src/export-invoice.test.ts` (declarations, both
  currencies, Tamil, 80 mm), `packages/billing-ui/src/recurring.test.ts`, `export-gstin.test.ts`.

## To be confirmed by a CA

- GSTR-1 6A rate for exports under LUT: the bill's lines are at 0% and the file reports `rt: 0` with no IGST; some portal
  versions expect the applicable rate with zero tax.
- Rupee value of a foreign line = quantity × the unit price converted to the paisa (not the converted line total); the
  customs value uses the rate notified by CBIC, while the bill uses the rate the shop types.
- The exchange difference on realisation as other income / expense (no year-end revaluation of open foreign balances).
- Whether recurring bills back-dated by the catch-up (the latest 3 missed dates) are acceptable, or should be dated on the
  day they are made.

## Not done

Recurring export / foreign-currency bills; an e-mail channel for recurring bills; foreign-currency receipts on account in
the credit book; foreign figures on credit notes; e-way bills for exports; deemed exports (DEXP); a GSTIN provider
(choose a GSP); re-checking saved parties' GSTIN status in the background; Flutter screens. The screens were type-checked
and unit-tested but not tried in a browser.
