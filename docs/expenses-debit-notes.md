# Expenses (suppliers, recurring, branches) and debit notes to customers

Gap items #37 and #10 (`docs/gap-analysis.md`). Migration **0055** (`apps/api/drizzle/0055_expenses_debit_notes.sql`):
tables `expense_recurring`, `expense_recurring_runs`, `sales_debit_notes`, `sales_debit_note_series`,
`sales_debit_note_allocations`; columns `expenses.supplier_id / branch_id / due_date / amount_paid / recurring_id /
recurring_run_id`, `purchase_payments.expense_id`. Nothing is back-filled: existing expenses have no supplier, are
shop-wide and are paid (cash / bank ... as before); existing shops see no change until they use the new fields.

Code:

- `packages/expenses/src` — `service.ts` (supplier link, credit, branch, drafts, the report), `recurring.ts` (recurring
  expenses and the scheduler), `routes.ts`, `csv.ts`, tables in `schema.ts`.
- `packages/core/src/schedule.ts` — the schedule maths, now shared by recurring invoices and recurring expenses
  (`packages/invoices/src/recurring-calc.ts` re-exports it under its old names).
- `packages/inventory/src` — `ExpenseBillsPort` (`ports.ts`), Payables in `purchasing.ts` (pay, reverse, statement,
  ageing, summary) and the supplier list balance in `service.ts`.
- `packages/invoices/src` — `debit-notes-calc.ts` (pure), `debit-notes.ts` (service), `schema-debit-notes.ts`, routes in
  `routes.ts`; the credit book (`service.ts` customer query, receipts, ledger, ageing, GST summary) and `ledger.ts`.
- `packages/accounting/src/rules.ts` (`expensePostings` on credit, `salesDebitNotePostings`), `tds.ts` (TDS on a credit
  expense); `packages/einvoice/src/gstr1.ts` (DBN, note type "D"); `packages/gstfiling/src` (`gstr3b.ts`, `gstr1x.ts`,
  `composition.ts`); `packages/documents/src/renderers/debit-note.ts` (PDF, English / Tamil).
- Wiring: `apps/api/src/kit-expenses.ts` (the Payables port over the expenses table, supplier and branch lookups),
  `kit-accounting.ts`, `kit-batch3.ts` (GSTR-1 / e-invoice sources), `kit-io.ts` (PDF), `kit-valuation.ts` (branch
  report), `kit.ts` (job), `permissions.ts`.
- UI (`packages/billing-ui`): Expenses page (Expenses / Recurring / Report tabs, `components/expenses/*`), the Pay
  supplier dialog (`components/inventory/payables-dialogs.tsx`), bill page "Create debit note"
  (`components/debit-notes/*`), `pages/sales-debit-notes.tsx` and `pages/sales-debit-note-detail.tsx` (routes
  `sales-debit-notes`, `sales-debit-notes/:id`; `debit-notes` stays the supplier debit notes of purchase returns), credit
  book ledger, GST summary and GSTR-3B drill-down labels. Strings in English and Tamil (`lib/messages/expenses-b.ts`,
  `lib/messages/debit-notes.ts`).

## 1. Expenses (#37)

### Supplier link and buying on credit

An expense can name a **supplier** (the inventory suppliers, optional). Its name and GSTIN fill the vendor fields that are
left empty, so the GST input credit works as before (the credit needs a valid vendor GSTIN; IGST when the GSTIN is from
another state than the shop, else CGST + SGST — the same rule for the books, the expense list and GSTR-3B / ITC, which
already read expenses).

Payment method **`credit`** ("On credit, pay later") needs a supplier and takes an optional due date. Such an expense is a
**bill in the supplier's Payables**, exactly like a purchase bill:

| Where | What happens |
|---|---|
| Supplier list | balance = unpaid purchase bills + unpaid credit expenses + opening − on-account payments |
| Supplier statement | a row of type `expense` (ref = the expense reference, else the category) |
| Payables ageing / summary | aged from its due date (the expense date when none); "due in 7 days" counts it |
| Pay supplier | a lump sum is spread oldest first over the opening balance, purchase bills **and** credit expenses; a chosen part names `purchaseId` or `expenseId` (`POST /v1/inventory/suppliers/:id/payments`, `allocations: [{ expenseId, amount }]`) |
| Payment rows | `purchase_payments.expense_id`; the expense's `amount_paid` is kept in step from its live rows (`ExpenseBillsPort.setPaid`) |
| Reverse a payment | gives the balance back to the expense |
| Expense edits | with money paid: supplier and payment method can't change, the amount can't drop below what was paid, and it can't be cancelled (reverse the payment first) |

The expense view carries `balance` (amount − paid for a recorded credit expense, else 0); list filters `supplierId`,
`unpaid=true`. The inventory module never reads the expenses table itself: `apps/api/src/kit-expenses.ts` implements the
port (`bills`, `setPaid`, `unpaidSql`).

### Books (docs/accounting.md)

| Event | Debit | Credit |
|---|---|---|
| Expense paid at once (as before) | expense category (amount − ITC), GST input (ITC) | money account of the payment method |
| Expense **on credit** | expense category (amount − ITC), GST input (ITC) | **Creditors (the supplier)** |
| Supplier payment allocated to it | Creditors (the supplier) | money account (the existing supplier payment rule) |
| Cancelled | mirror of the expense | |
| TDS on a credit expense | **Creditors (the supplier)** | TDS payable; with "settle on the bill" the tax is settled on that expense in Payables |

Drafts are not posted. Payables and the books therefore agree per supplier (the reconciliation page compares them).

### Recurring expenses

Expenses > Recurring: rent, electricity, internet, subscriptions, a fixed salary-like payment (staff payroll stays in
`packages/payroll`). A recurring expense holds the expense (category, supplier, vendor, GSTIN, branch, GST rate, payment
method; credit: due after N days) and its schedule (weekly / monthly / quarterly / yearly, every N, weekday or day of the
month with month-end handling, start / end). Amount:

- **fixed** — with mode `auto` the expense is recorded on its date and posted; with mode `draft` a draft with the amount
  is made to check;
- **ask each time** (no amount) — always a **draft** with amount 0, a reminder to fill in. The Expenses page shows
  "N recurring expenses are waiting for you to fill in"; `POST /v1/expenses/:id/record` records a draft (with the amount
  and any other field). Drafts are left out of lists (by default), totals, the summary, the profit report, the books,
  ITC / GSTR-3B and the branch report until recorded.

The **scheduler** (job `expenses.recurring`, `20 6 * * *` IST, shops with the `expenses` feature on) follows recurring
invoices (`docs/recurring-export-gstin.md`): every date is a run row unique per (recurring, date); the run row and its
expense are written in **one transaction** with the recurring row locked, so a job that runs twice — or two at once —
makes one expense per date, and there is no half-done run to repair. Catch-up: the latest 3 missed dates are made,
older ones recorded as `skipped`. A date on or before the books' locked period is recorded as `locked` and makes
nothing. Owner actions: pause (dates while paused are not made), resume (from the next date on or after today), skip
next, make now (a run dated today, once a day), end, delete (only when it never made an expense). Audited
(`expenses.recurring.*`).

Routes `/v1/expenses/recurring`: `GET /` (`status`, `q`), `GET /summary` (drafts waiting, due in 7 days), `GET /preview`,
`POST /`, `GET|PATCH|DELETE /:id`, `POST /:id/pause|resume|skip|end|run`. Permission `expenses.manage`.

### Branch

Each expense has a branch: left out = the user's current branch (`req.ctx.branch`), `null` = shop-wide. Filters
`branchId` (comma list) and `shopWide=true`. The **branch report** (Reports > Branches, `apps/api/src/kit-valuation.ts`,
`docs/valuation-reports.md`) now shows expenses under their branch (net of ITC, like the books); expenses without a
branch — or of a branch that was deleted — are in the "Shop-wide / not by branch" column.

### Attachments and the report

The bill / receipt photo was already there (`receipt_url`, upload from the form, AI receipt scan in `docs/ai.md`).
`GET /v1/expenses/reports/expenses?from&to&groupBy=category|supplier|branch|month[&branchId][&format=csv]`: per group the
number of expenses, amount, GST, ITC, net of ITC and what is still unpaid, with a total (typed-in vendors without a
supplier are grouped by name). The expense list CSV gained branch, due date, paid and balance.

## 2. Debit notes to customers (#10)

CGST Act s.34(3): when the taxable value or tax charged on a bill was less than it should be — a price revised upwards,
quantity short-billed, freight or other charges billed later — the supplier issues a **debit note**. Bill page > More >
"Create debit note" (permission `invoices.debit-note`, feature `invoices`).

- **Own series** per branch and financial year: `DN/26-27/0001` (or `DN` + the bill's own prefix, e.g. `DNMDU/...`),
  table `sales_debit_note_series` (same locking as bill numbers). Not the supplier debit notes of purchase returns.
- **Links to the original bill** (number, date and total kept on the note). Only on an issued, not cancelled, not
  imported bill; dated on or after the bill and not in the future. Reasons: `price_revision`, `short_billed`, `freight`,
  `other_charges`, `other`.
- **GST by line**: a line on a bill line (`line` index; the bill line's description, HSN, unit and GST rate — the rate
  can't change) with `qty × rate` = the extra value, or a new charge (description and GST rate required, HSN optional).
  The bill's tax split is kept (CGST + SGST, or IGST — also for SEZ); the total is rounded to the rupee like a bill.
- **PDF** A4 in English and Tamil ("DEBIT NOTE" / "பற்றுக் குறிப்பு"), the bill's number and date, the reason and the
  s.34 line: `/v1/documents/debit-note/:id.pdf?locale=en|ta`. E-invoicing: the note is a `DBN` document referencing its
  bill (the e-invoice module finds it by its id), for shops that e-invoice.
- **Books**: Dr Debtors (the customer) / Cr Sales and output GST (and round-off), source `sales_debit_note`; a cancel posts
  the mirror (`sales_debit_note_cancel`).
- **Credit book**: the customer owes the note's total (customer balance, ledger row "Debit note", receivables ageing from
  the note's own due date). Customer receipts settle the open bills first, then open debit notes oldest first
  (`sales_debit_note_allocations`); what is left is advance. Deleting the receipt gives the note its balance back.
- **Cancel**: on the day it was issued and only while nothing was received against it (delete the receipt first). The
  number stays used. A bill with issued debit notes can't be cancelled.
- **GSTR-1**: registered buyer → **CDNR**, unregistered buyer of a B2CL bill (inter-State, original bill above ₹1 lakh)
  → **CDNUR** (`typ` B2CL; export bills EXPWP / EXPWOP), with `ntty: "D"`, per rate; a note on a B2CS bill is **added**
  to the B2CS row of its place of supply and rate; the HSN summary goes up; Table 13 lists "Debit Note" (`doc_num` 4)
  with cancelled numbers; Table 8 rows add their 0% lines. Declared in the return of the month of the note's date.
- **GSTR-3B**: added to 3.1(a) (3.1(c)/(e) for nil / non-GST lines) and to 3.2 for unregistered inter-State buyers;
  `counts.debitNotes`; the drill-down lists them as "Debit note to customer".
- **GST summary** (Reports > GST): CDNR / CDNUR rows with note type D, totals and GSTR-3B figures include them,
  `debitNoteTotals`.

Routes under `/v1/invoices`: `GET /debit-notes` (paged; `status`, `reason`, `invoiceId`, `customerId`, `branchId`,
`from`, `to`, `q`; sort `number`, `date`, `total`; `format=csv`), `GET /debit-notes/:id`, `POST /debit-notes/:id/cancel`,
`GET /:id/debit-notes`, `POST /:id/debit-notes`. UI routes `sales-debit-notes`, `sales-debit-notes/:id`, linked from
the Bills page and the bill.

## Tests

- `packages/expenses`: `recurring.db.test.ts` (one expense per date when the job runs twice at once, catch-up cap, lock,
  ask-each-time drafts and recording, pause / skip / resume, supplier fill, credit guards, branch default, filters, report
  by branch / supplier), `logic.test.ts` (report groups, balance, CSV).
- `apps/api/src/kit-expenses.db.test.ts`: a credit expense with the real Payables — supplier balance, ageing, statement,
  lump payment oldest first across a purchase bill and the expense, chosen allocation, reversal, payment list — and the
  books' postings balanced with the supplier netting to what Payables shows.
- `packages/accounting/src/rules.test.ts`: expense on credit (Creditors with the party, mirror on cancel, cleared by the
  supplier payment), debit note postings (intra / inter-State, round-off, cancel).
- `packages/invoices`: `debit-notes.test.ts` (GST by line, freight, rounding, rate kept, input errors, prefix, cancel
  rule, receipt allocation, GST summary CDNR / CDNUR / B2CS with D), `debit-notes.db.test.ts` (series, credit book,
  ledger, receipts after bills, delete receipt, ageing, cancel guards, bill cancel blocked, GST summary).
- `packages/einvoice/src/gstr1.test.ts`: the GSTR-1 JSON — CDNR `ntty: "D"` intra and inter-State, CDNUR B2CL, B2CS
  added, HSN up, Table 13 doc type 4, cancelled note only in Table 13.
- `packages/gstfiling/src/filing.test.ts`: GSTR-3B 3.1(a) / 3.2 with debit notes and their contributions, Table 13 and
  Table 8.
- `apps/api/src/kit-valuation.test.ts`: branch report expenses per branch and shop-wide.

## To be confirmed by a CA

- GST rate and HSN of a charge billed later on a debit note (freight, packing): the form defaults to the bill's highest
  line rate and the owner can change it; whether it follows the principal supply (composite supply) or its own rate.
- Rounding a debit note's total to the rupee like a bill.
- A debit note on an unregistered buyer's small B2C bill added into B2CS of the month of the note (not Table 9).
- Expense ITC: an expense on credit claims ITC in the month of the expense date like a paid one (the ITC module's own
  rules — eligibility, 180-day payment rule (Rule 37), GSTR-2B match — apply as for purchases).
- TDS on a credit expense debited to the supplier's account.

## Not done

- No "make recurring" button on an existing expense; recurring expenses are not sent anywhere.
- Debit notes: no 80 mm slip, no webhook event (the books are nudged), not in the sidebar (reached from Bills and the
  bill), the credit book's "oldest due" / overdue columns count bills only (the ageing report counts notes).
- Per-branch books (journal lines still carry no branch).
- The supplier filter on the Expenses page loads the first 100 suppliers; the Pay supplier dialog lists unpaid credit
  expenses only for users with `expenses.manage`.
