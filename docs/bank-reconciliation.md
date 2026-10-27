# Bank reconciliation and the cheque register (accounting Part B)

Part of `packages/accounting` (`bank.ts`, pure logic in `bank-import.ts`, `xlsx-lite.ts`, `bank-match.ts`). Routes under
`/v1/accounting`, feature `accounting`; read with `accounting.view`, change with `accounting.bank`. UI: Accounts > Bank and
cheques (billing-ui `pages/acctb-bank*.tsx`, `acctb-cheques.tsx`). Posting rules and the overall Part B design are in
`docs/accounting.md`.

## Flow

1. **Bank accounts.** Any account with `is_bank` (chart of accounts). Payment-method mapping (UPI, card, cheque, bank ->
   account) stays in accounting settings; the books post to those accounts and the statement is matched against them.
2. **Import** (`POST /bank/import/preview`, then `POST /bank/import`; the file is the raw request body, up to 8 MB,
   `?accountId=&mapping=&headerRow=&dateOrder=`). Reads `.xlsx` (own ZIP/XML reader on `node:zlib`, no dependency), CSV /
   TSV / semicolon / pipe text, and the HTML-table ".xls" files many banks give. Refused with a plain message: old binary
   `.xls` (BIFF), PDF. MT940 is not read.
3. **Match** (`GET /bank/workspace`, `POST /bank/match`, `POST /bank/auto-match`, `DELETE /bank/matches/:groupId`).
4. **Entries from statement lines** (`POST /bank/lines/:id/entry` with a preset; `DELETE` cancels it) and **leave out**
   (`POST /bank/lines/:id/exclude`).
5. **Reconciliation statement** (`GET /bank/reconciliation?accountId=&asOf=&bankBalance=`, `format=csv`; PDF at
   `/v1/documents/accounting-report/bank-reconciliation.pdf`), **confirm** (`POST /bank/reconciliation/confirm`) and
   **re-open** (`POST /bank/reconciliation/reopen`).

## Import: layouts and tolerance

Columns are found by **name**, never by position: the header row is the row (in the first 60) that names a date and the
money columns, with the most recognised names. Field names recognised (normalised to lower-case words):

| Field | Names (examples) |
|---|---|
| date | Date, Txn Date, Transaction Date, Tran Date, Posting Date |
| value date | Value Date, Value Dt |
| narration | Narration, Description, Particulars, Transaction Remarks, Remarks, Details |
| reference | Chq./Ref.No., Cheque Number, Ref No./Cheque No., CHQNO, Chq / Ref No., UTR, Reference |
| debit / credit | Withdrawal Amt., Withdrawal Amount (INR ), Debit, DR / Deposit Amt., Deposit Amount (INR ), Credit, CR |
| one amount + Dr/Cr | Amount + Dr / Cr, Type, Transaction Type |
| balance | Closing Balance, Balance (INR ), Balance, BAL (a trailing "Dr" or a Dr/Cr column after it makes it negative) |

Layouts named on screen (HDFC, ICICI, SBI, Axis, Kotak, generic) are detected from the words above the table and the
column set. **Assumed, not verified:** these column names come from commonly seen downloads, not from current files of
each bank. Anything else with recognisable headings imports as "generic"; the owner can choose every column and the
header row in the wizard.

Values: amounts are read exactly in paise ("1,23,456.78", "500.00 Cr", "(250.00)", "75-", "1.5E3"); dates day-first
(dd/mm/yyyy, dd-mm-yy, dd.mm.yyyy, 01-Apr-2026, 1 Apr 2026, 2026-04-01, Excel day numbers; month-first only when chosen).
Rows that continue the previous narration are joined; footers ("Statement summary", "Computer generated", asterisk lines)
end the table; a date that looks like a date but is invalid is reported with its row number. Newest-first files are
turned oldest-first. The running balance is checked and a likely debit/credit swap is flagged.

**Idempotent re-import.** Each line's hash = date + amount + reference (leading zeros ignored) + narration (case and
punctuation ignored) + the occurrence number of identical lines in the same file; unique per account. Importing the same
or an overlapping statement adds only the new lines.

## Matching

Signs: statement + = money in; book line = debit - credit on the bank account.

- One to one: equal amount, within 7 days (45 when the cheque / reference number agrees). Confidence = 50 (amount) + up
  to 25 (date) + 30 (reference or cheque number from the register) + up to 15 (words of the narration / party) + 10 when
  the amount is unique on both sides (-10 when many lines share it). "Accept the sure ones" accepts 85 and above.
- Many book lines to one statement line (UPI / card settlements, several cheques in one deposit): exact subset sum of 2-5
  book lines dated up to 7 days before; capped at 85.
- One book line to several statement lines: the other way; capped at 80.
- A match with a difference (a card settlement less the fee) posts the difference to a chosen account
  (`bank_difference`), reversed if the match is removed.
- Book lines that undo each other (an engine reversal and its original, or a document's posting and its
  `_cancel` / `_reversal` posting) are hidden when both are unmatched. When a matched posting is later replaced by the sync
  (an edited payment), the stale match is removed automatically (unless confirmed) and the reversal and new version are
  suggested as "cancel each other".

## Reconciliation statement

On a date: book balance; less book receipts not yet cleared; add book payments not yet cleared (cheques issued); add
statement credits not in the books; less statement debits not in the books = balance the bank should show; compared with
the statement balance on that date (last printed balance plus later lines that day) or a typed balance. **Assumption:**
book entries dated before the first imported statement line count as already in the bank (the statement's opening
balance includes them); one that clears later shows on the statement and is matched then. Confirming records the date,
the two balances, the difference and a note (required when not zero), and freezes the matches up to it; the screen then
suggests moving the period lock to that date (a hint, not enforced). Re-opening from a date unfreezes them.

## Cheque register

Issued and received cheques, post-dated included: pending (not presented) -> deposited (received) -> cleared or bounced;
cancelled; reopen. Linking a cheque to its book line feeds its number to the matcher; matching that line clears the
cheque with the statement date. Bounce: posts the bank's charges (Dr Bank charges / Cr bank) and reverses a manual payment
entry; for a payment that came from a bill or Payables the screen names the document to change (the books follow it).
Unlinked pending cheques are listed on the reconciliation statement.

## Limits

- No bank feeds or account aggregator; statements are files. No PDF or MT940.
- Layout names are informational; column detection is by name and may need a manual choice for unusual files.
- Charges recovered from a customer for a bounced cheque are not posted (they would not be in the credit book).
- Statement balances are per account; overdraft accounts work (negative balances) but cash credit limits are not tracked.
- The matcher looks at up to 1,500 open statement lines and 4,000 open book lines per screen.
