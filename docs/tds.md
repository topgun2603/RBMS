# TDS and TCS (accounting Part B)

Part of `packages/accounting` (`tds.ts`, rules in `tds-rules.ts`). Routes under `/v1/accounting/tds`, feature `accounting`;
read with `accounting.view`, change with `accounting.tds`. UI: Accounts > TDS and TCS, and its Settings and PAN page
(billing-ui `pages/acctb-tds.tsx`, `acctb-tds-settings.tsx`). Off until the owner switches it on in the TDS settings.

**Nothing here files a return or talks to TRACES / the e-filing portal.** The product records deductions, posts them,
records challans and produces the quarterly data and certificate summaries; the return is prepared with the Return
Preparation Utility and validated with the File Validation Utility (FVU) of Protean (NSDL), or by the CA.

## Legal basis and assumptions (to be confirmed by a CA)

Income-tax Act, 1961 as amended by the Finance (No. 2) Act, 2024 and the Finance Act, 2025 (thresholds from 1 April 2025).
**From 1 April 2026 the Income-tax Act, 2025 replaces the 1961 Act** and renumbers TDS (section 393 and its tables); the
1961 section numbers are kept as labels because accountants, challans and the return utilities still use them. Every rate
and threshold below is an **assumption to be confirmed by a chartered accountant**; each can be overridden per shop
(TDS settings > Sections).

| Key | Section | For | Rate | Without PAN | Threshold (as modelled) |
|---|---|---|---|---|---|
| 194C | 194C | Contractors, job work, transport, advertising | 1% individual/HUF, 2% others | 20% (206AA) | Rs 30,000 one payment, or Rs 1,00,000 in the year (then earlier untaxed payments are taxed too) |
| 194J-b | 194J | Professional fees, royalty | 10% | 20% | Rs 50,000 a year (from 1.4.2025; Rs 30,000 before) |
| 194J-a | 194J | Technical services, call centre | 2% | 20% | Rs 50,000 a year |
| 194H | 194H | Commission, brokerage | 2% (from 1.10.2024; 5% before) | 20% | Rs 20,000 a year (from 1.4.2025; Rs 15,000 before) |
| 194I-b | 194I | Rent: land, building, furniture | 10% | 20% | Rs 50,000 for a month or part (from 1.4.2025); modelled as "a payment above Rs 50,000" |
| 194I-a | 194I | Rent: plant, machinery | 2% | 20% | as above |
| 194A | 194A | Interest other than on securities (payer not a bank) | 10% | 20% | Rs 10,000 a year (from 1.4.2025; Rs 5,000 before) |
| 194Q | 194Q | Purchase of goods | 0.1% of purchases above Rs 50 lakh from one seller in the year, value without GST (CBDT Circular 13/2021) | 5% | only when the shop's turnover last year was above Rs 10 crore (a setting); off by default |
| 206C1H | 206C(1H) | TCS on sale of goods | 0.1% above Rs 50 lakh per buyer | 1% (206CC) | **omitted by the Finance Act, 2025 from 1 April 2025**; off by default, flagged after 31.3.2025 |

Not covered: salary (192, Form 24Q), dividends, 194-O, 194-IB, 194-R, 194-S, non-residents (195), 206AB (omitted by the
Finance Act, 2025). Section 197 lower/nil deduction certificates: a rate, number and validity per party. The transporter
exemption under 194C(6) is not checked. Tax is rounded to the nearest rupee (**assumption**).

PAN: typed per party (`acct_party_tax`; suppliers' and customers' own tables are unchanged), or read from the GSTIN
(characters 3-12). Deductee type from the 4th letter (P individual, H HUF, C company, F firm/LLP, else other). "Earlier this
year" = bases of TDS already recorded for the party and section in the financial year, and for 194C / 194Q the purchase
bills from that supplier in the year (value without GST).

## Postings

- Supplier bill / payment: Dr Creditors (with the supplier) / Cr TDS payable. By default the same amount is settled on the
  bill in Payables (the inventory service records a supplier payment of mode "other", reference `TDS:<id>`; the document
  sync skips those rows, so nothing is posted twice). The owner then pays the supplier the bill less the tax. Cancelling
  reverses the entry and the Payables row.
- Expense: the expense is recorded at the full amount; Dr the expense's money account / Cr TDS payable (the tax kept).
- Other payee: Dr the chosen account / Cr TDS payable.
- TCS: Dr Debtors (with the customer) / Cr TCS payable (shown as an explained difference in the self-check, since the
  credit book does not carry TCS).
- Challan (ITNS 281: BSR code, challan serial, date): Dr TDS/TCS payable (tax) and Interest and late fee on taxes /
  Cr the cash or bank account. The month's open deductions (or chosen ones) are marked deposited, up to the challan's tax.

## Dates, returns, alerts

- Deposit: by the 7th of the next month; tax deducted in March by 30 April (TCS: 7 April) (Rule 30, 37CA).
- Quarterly statements: 26Q by 31 July, 31 October, 31 January, 31 May; 27EQ by 15 July, 15 October, 15 January, 15 May
  (Rule 31A). Certificates: Form 16A by 15 August, 15 November, 15 February, 15 June; Form 27D by 30 July, 30 October,
  30 January, 30 June (Rules 31, 37D).
- Late deposit interest shown as a hint: 1.5% a month or part from deduction to payment (201(1A)(ii)); 1% for TCS
  (206C(7)). Late filing fee (234E) is typed in on the challan. Holiday shifts and CBDT extensions are not tracked.
- Alerts: TAN missing, deposits past due, payees without PAN.

## Outputs

- `GET /tds/payable?fy=` month-by-month deducted / deposited / balance with due dates; ledger balance of TDS payable.
- `GET /tds/quarterly?quarter=2026-27-Q3&kind=tds|tcs` (and `format=csv`): deductee-wise rows (section, name, PAN or
  PANNOTAVBL, date, amount paid, rate, tax, BSR / challan / date) and section totals, with issues (no TAN, no PAN,
  undeposited tax).
- Certificate summary PDF: `/v1/documents/accounting-report/tds-certificate.pdf?partyId=|partyName=&quarter=`,
  marked as a summary from the shop's books, **not** Form 16A / 27D (those come from TRACES after filing).
- `GET /tds/candidates`: purchase bills of suppliers with a usual section, or 194Q purchases past Rs 50 lakh, without TDS.
- `GET /tds/calendar`: due dates and alerts.

## Limits

- No FVU / RPU text file, no TRACES download, no Form 26AS reconciliation, no 24Q.
- Thresholds are checked against what is in the books; payments made outside the product are not seen.
- GST filing is not changed (TDS/TCS under GST, sections 51/52 CGST, are a separate matter and not built).
- Compute reasons and quarterly notes come from the server in English.
