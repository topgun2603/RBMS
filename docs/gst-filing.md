# GST filing depth (GSTR-3B, input credit, GSTR-2B, reverse charge, composition, GSTR-1 gaps)

Package `packages/gstfiling` (module id `gstfiling`, routes under `/v1/gstfiling`, migration `0034_gst_filing`, tables
`gst_settings`, `gst_doc_flags`, `gst_adjustments`, `gst_2b_imports`, `gst_2b_rows`, `gst_filings`, `gst_advances`,
`gst_tax_payments`). The UI is the **GST center** in the shared billing UI (nav "GST", page `pages/gst.tsx`, English and
Tamil, `billing.gst.*`). The package reads bills, purchases, expenses and offline-billing blocks through ports
(`ports.ts`, implemented in `apps/api/src/kit-gstfiling.ts`) and writes only its own tables.

**Nothing here talks to the GST portal.** The product builds the files; the owner uploads them on the portal. Likewise
the GSTR-2B reconciliation works on the file the owner downloads from the portal. We make **no claim that the portal
accepts a file**: see "Validated against" below.

Access: feature `invoices.gst-reports` (the same gate as the existing GST summary and GSTR-1 download, so every plan that
has GST reports has this) and permission `reports.view` to read; `gst.manage` (new, owners/admins hold every permission)
to change anything.

## What existed before (audit, 2026-10-24) and what is new

| Area | Before | Now |
|---|---|---|
| GSTR-1 | `packages/einvoice/src/gstr1.ts` (commit cf94fdd, own gate): b2b, b2cl, b2cs, cdnr, cdnur, hsn (B2B/B2C split, UQC), doc_issue; monthly only; no check before download; header comment listed exports, nil/exempt (Table 8), debit notes, advances as not produced | unchanged base; **added** Table 6A `exp`, Table 8 `nil`, Table 11 `at`/`txpd` (typed in), Table 13 rebuilt with voided / unused offline numbers and gap list, a **validation report**, **quarterly (QRMP) file** (the base takes an optional `range`), CSV of the issues. Debit notes to customers: the product has no customer debit notes, so nothing to export (builder-ready: notes with `docType` DBN are skipped with a warning) |
| GSTR-3B | `gstr3b` outward block in `invoices/src/reports.ts` (taxable/nil, tax) and the GST tab | full return: 3.1(a)-(e), 3.2, 4(A)(1-5), 4(B)(1-2), 4(C), 4(D), 5, 5.1, set-off of output tax by credit, cash to pay, portal JSON, CSV, documents behind every cell, comparison with the books' GST ledger |
| ITC | purchases/expenses carried GST; expenses had `itcOf` (valid vendor GSTIN) | per-document credit decision (default + owner override), claim month, ITC register with filters/CSV, Section 16(4) lapse, rule 37 (180 days) alert |
| GSTR-2B | nothing | JSON/Excel import, matching, accept/ignore, supplier-wise, ITC at risk, CSV |
| Reverse charge | only `rcm` flag in the NIC payload | flag per purchase/expense, notified-category list, tax computed, 3.1(d), credit 4(A)(2)/(3) from the month of payment, payment tracking, suggestions |
| Composition | nothing | shop setting, bill of supply with no tax, CMP-08 quarter, GSTR-4 yearly figures, tax payments (posted to the books as an expense) |
| Filing calendar / issues | nothing | due dates (monthly, QRMP, composition) with "mark as filed", issues list |

## Rules implemented (sections and rules) and assumptions

Quote the notification text from the Gazette or ask the accountant before relying on any of this.

**GSTR-3B (Rule 61 CGST Rules, form GSTR-3B).**
- 3.1(a) outward taxable supplies: lines with a rate above 0 in bills dated in the month, minus credit notes dated in the
  month (Section 34); cancelled bills count for nothing. 3.1(b) zero-rated: bills with place of supply 96 (exports).
  3.1(c) nil/exempt and 3.1(e) non-GST: 0% lines, classified by the shop's default and by HSN-prefix rules (settings).
  The product does not carry an exempt/nil/non-GST flag per item, so this is an owner setting. **Assumption.**
- 3.2 inter-State supplies to unregistered buyers by place of supply: taxable inter-State lines of bills whose buyer has
  no valid GSTIN. Composition-dealer and UIN buyers cannot be told apart (no registration type is stored), so those two
  tables are always empty. **Limit.**
- 4(A): credit from purchase bills and expenses dated in the claim month. (1) import of goods and (4) ISD only through the
  owner's class setting or typed figures; (2) import of services and (3) reverse charge from the self-assessed tax;
  (5) all other. 4(B)(1) reversals under rules 38, 42, 43 and Section 17(5); 4(B)(2) other reversals and credit taken
  back for goods returned on a **debit note** the shop issued (**assumption:** the supplier issues the matching credit
  note and the credit is reversed in the month of our debit note). 4(D)(2) shows credit that lapsed (below).
- Rules 42/43 (common credit, capital goods) are **typed in** (adjustments); the product does not compute the ratio.
- 5 inward exempt/nil supplies: purchase lines at 0%; inter/intra by the bill's flag. Non-GST inward: typed in.
- Net credit 4(C) = 4(A) - 4(B). Output tax is set off per Section 49A and Rule 88A (IGST credit against IGST, CGST, SGST;
  CGST credit against CGST then IGST; SGST credit against SGST then IGST; cess only against cess); reverse-charge tax,
  interest and late fee are cash (Section 49(4) and the proviso to Section 41/Rule 86B are **not** modelled).
- Quarterly (QRMP, Rule 61A): the return covers the three months and is named by the last month. The 35% / self-assessed
  PMT-06 monthly payment is not computed.

**Input tax credit (Sections 16, 17, 18).**
- Default: credit is claimable when the supplier has a valid GSTIN and charged tax; otherwise it is "not claimable" with
  the reason. The owner can mark a document ineligible, blocked (Section 17(5)) or reversal (with the rule), choose the
  claim month, and the class (normal, import of goods, import of services, ISD).
- Section 16(4): credit for a bill of a financial year cannot be claimed after 30 November following that year. We treat
  the **October return** (filed by 20 November) as the last month that can claim it; later claim months are shown as
  lapsed (4(D)(2)) and not taken. The relaxation for Sections 16(5)-(6) (waivers for FY 2017-18 to 2020-21) is not modelled.
- Section 16(2)(c)/(aa): the supplier must have reported the invoice (it must appear in GSTR-2B): this is what the
  reconciliation checks; the 3B itself does not stop you claiming a bill missing from 2B (it flags the amount "at risk").
- Second proviso to Section 16(2) and Rule 37: credit on a bill unpaid for 180 days must be reversed with interest.
  The register lists such bills with the unpaid share of the credit; the owner records the reversal (rule37) - it is not
  added automatically. Re-claim after payment is manual.
- Composition: no credit at all from the scheme's start date (Section 10(4)).

**Reverse charge (Section 9(3), 9(4) CGST; Section 5(3), 5(4) IGST).** `rcm-categories.ts` lists the usual notified
services/goods with their entry in Notification 13/2017-CT(R), 4/2017-CT(R), 29/2018, 5/2022 and the section for imports of
services. Rates are suggestions the owner can override. Buying from an unregistered supplier is **not** reverse charge in
general (the blanket Section 9(4) has been suspended since 2017; it applies to notified classes, e.g. promoters buying land):
the screen says so and only suggests categories by keyword on expense names. Time of supply is taken as the document's
month (the real rule is the earlier of payment or the 60th day after the invoice for services - **assumption, owner can
adjust by dating the entry**). The credit (4(A)(2)/(3)) is available from the month the tax is paid in cash (Section 16, Rule
36(1)(b) and Section 49(4)), recorded as "paid on".

**Composition (Section 10, Rules 3-7, 49).**
- Rate by type (percent of turnover): trader 1, manufacturer 1, restaurant 5, other services 6. **Assumption: confirm the
  current rate for your category** (Rule 7 and Notification 2/2019-CT(R) for services).
- A composition shop issues a **Bill of Supply**, with the wording "Composition taxable person, not eligible to collect
  tax on supplies" (Section 31(3)(c), Rule 49), charges no tax, takes no credit, makes no inter-State supply of goods.
- The invoice engine applies this **only to bills dated on or after the start date**, set in GST settings. The switch is
  stored on the shop (not on old bills): an issued bill keeps its own seller snapshot, so old bills print and report
  exactly as before. Drafts and new bills have their lines taxed at 0% (the price stays; no tax is added on top; a
  tax-inclusive line keeps its charged total). The bill form, the POS cart and the PDFs show the same. Bills use the same
  number series (**assumption**: Rule 46A allows a series for bills of supply; separate series not built).
- CMP-08 (Rule 62, due the 18th after the quarter): turnover of bills of supply less credit notes, tax at the rate split
  half central / half State, reverse-charge tax at normal rates, tax paid (challans typed in) and balance. GSTR-4 (annual,
  due 30 April): the four quarters and inward-supply totals as figures to key in.
- Books: composition tax paid is an expense (`Composition tax`, account 5930) posted from the payment entry
  (`gst_payment` source in `packages/accounting`); the bills carry no GST so there is no output tax to post. Turning
  composition on does not move old postings.
- Not built: ITC-03 (reversal of credit on stock when opting in), ITC-01, the turnover limit check by state category
  (a ₹1.5 crore warning on quarterly turnover only), tax on exempt goods turnover exclusions.

**GSTR-1 gaps.** Table 6A, 8, 11 and 13 as in the table above. B2CL threshold (₹1,00,000 inter-State, from 1 Aug 2024, per
invoice value) is the base module's rule and is applied to all periods; the earlier ₹2,50,000 is not applied to old
periods. HSN: 4 digits up to ₹5 crore, 6 above (Notification 78/2020-CT; the check uses "prior turnover" from settings,
default 4). Table 11 advances are **typed in** (the product cannot tell an advance for a service from one for goods; on
goods no tax is due on advances, Notification 40/2017-CT).

**Filing calendar.** Monthly: GSTR-1 on the 11th, GSTR-3B on the 20th of the next month; QRMP: GSTR-1 on the 13th, GSTR-3B
on the 22nd (Category X states: 22, 23, 24, 26, 27, 29, 30, 31, 32, 33, 34, 35, 36, 37) or the 24th, PMT-06 on the 25th;
CMP-08 the 18th; GSTR-4 30 April. Holiday shifts and extension notifications are **not** tracked.

## Design notes

- Every 3B number is a sum of `Contribution`s (document, cell, signed amounts), so a cell can be opened to its documents
  (`GET /gstr3b/cell`) and the CSV/JSON always agree with what is on screen.
- Owner decisions live in `gst_doc_flags` (one row per purchase/expense, unique per document), not on the purchase or expense
  tables, so the inventory and expenses modules and their screens are untouched. Remove the row (`reset`) to return to the default.
- 2B rows are stored with their computed match (`matched`, `fuzzy`, `amount_mismatch`, `missing_in_books`) and the owner's
  action (accept / ignore) separately; importing the same month again keeps the actions of documents that appear again.
  A book document is offered to one 2B row only, and not again once another month's 2B has matched it. Tolerance: ₹1 per
  amount, 5 days for a fuzzy date. Numbers are compared after removing separators and leading zeros ("INV/26-27/0042" ~ "42").
- `GET /overview` is cheap (calendar, profile checks). `GET /issues?period=` loads the period's bills (GSTR-1 check, credit
  checks): its own call. For a shop with thousands of bills a month the first load takes tens of seconds (it reads every
  bill like the existing GSTR-1 download); overlapping calls share one load and a finished load is reused for 15 seconds.
- Seller snapshot of the invoice carries `taxScheme` / `compositionFrom` only when composition is on (`normalizeSeller`).

## Validated against, and not validated

| Piece | Status |
|---|---|
| GSTR-3B JSON keys (`sup_details`: `osup_det`, `osup_zero`, `osup_nil_exmp`, `isup_rev`, `osup_nongst`; `inter_sup`: `unreg_details`, `comp_details`, `uin_details`; `itc_elg`: `itc_avl` (`IMPG`, `IMPS`, `ISRC`, `ISD`, `OTH`), `itc_rev` (`RUL`, `OTH`), `itc_net`, `itc_inelg`; `inward_sup.isup_details`; `intr_ltfee.intr_details`) | **Structure checked against** the sample request body in a GSP's published API documentation (MastersIndia `save_3b_data`, accessed 2026-10-24). `ltfee_details` is not written (not in that sample). Not uploaded to the portal. |
| GSTR-2B JSON (`docdata.b2b[].inv[]`: `inum`, `typ`, `dt`, `val`, `pos`, `rev`, `itcavl`, `rsn`, `items[]` with `txval/igst/cgst/sgst/cess`; `cdnr[].nt[]`: `ntnum`, `typ`; `impg`; `isd[].doclist[]`) | **Structure checked against** a GSP's published GSTR-2B download sample (Vayana). Both wrapper depths and invoice-level or `items` amounts are read. Real portal files were not available to test. |
| GSTR-2B Excel (sheets `B2B`, `B2B-CDNR`, header names such as "GSTIN of supplier", "Invoice number", "Taxable Value (₹)") | **Assumed** from the portal's documented column names; parsed by header names, not positions. Not tested on a real download. |
| GSTR-1 `nil` (`inv[].sply_ty` INTRB2B/INTRB2C/INTRAB2B/INTRAB2C, `expt_amt`, `nil_amt`, `ngsup_amt`), `exp` (`exp_typ` WPAY/WOPAY), `at`/`txpd` (`pos`, `sply_ty`, `itms[].ad_amt`), `doc_issue` | **From the offline tool schema as remembered and the existing base file**; not re-checked against a current portal sample. Shipping-bill fields of `exp` are not produced. |
| CMP-08 and GSTR-4 | **No JSON is produced.** The screens give the figures to key into the portal forms; no offline-utility schema was verified. |
| Tax computations, set-off, matching, calendar | Covered by unit tests with hand-computed figures; the legal rules above are as cited and **not reviewed by a CA**. |

## Owner decisions

1. **QRMP.** It is a setting (from a date). Offered to shops with prior-year turnover up to ₹5 crore; the screen warns above
   that. Choose with the accountant: QRMP cuts returns but needs the monthly PMT-06 payment (not computed here).
2. **Blocked credit.** Section 17(5) credit is never put in 4(A), it is simply not claimed. Some accountants prefer to
   claim it in 4(A) and reverse it in 4(B)(1) so 4(A) equals GSTR-2B; if you want that, mark such bills "reversal (17(5))".
3. **Credit when the supplier has not filed** (bill missing in 2B): the 3B still claims it (the shop's choice, shown as
   "ITC at risk"). Alternative: move the claim month of such bills to the next month in the register.
4. **Rule 37.** Alerts only; the owner records the reversal.
5. **Composition start date** is chosen in settings (default today). Bills issued after it with tax already on them are
   counted and reported (they stay as issued).
6. **Zero-rated lines**: the shop default (nil rated) and HSN prefix rules decide 3.1(c) and Table 8; check with your CA
   which items are exempt and which are nil rated.
7. **Reverse-charge time of supply**: the document's month. Date the entry in the month the tax falls due.

## Limits

- No portal access: no pull of GSTR-2A/2B, no upload, no e-way integration changes, no filing status from the portal.
- Offline-billing numbers: voided numbers of closed blocks and bills cancelled at the counter are counted in Table 13 on
  the day they were released (`pos_number_blocks.voided`), not the day they were reserved.
- Large months are slow (tens of seconds for ~8,000 bills, same as the existing GSTR-1 download).
- Cess is not tracked on bills (always 0). ISD, TDS/TCS on the 3B side, GSTR-9/9C, ITC-04 are not built.
- The Tally/Busy/Marg comparison: they also fetch 2A/2B from the portal, file directly, and compute rules 42/43; this
  module is file based and keeps the owner's decisions explicit.
