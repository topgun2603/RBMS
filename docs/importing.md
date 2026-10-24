# Moving to us from Vyapar, Tally, Busy, Marg or Excel

Settings > Import and export > Import. Do the steps in this order. Each step has a preview before anything is saved, a
download of the rows that had problems, and an **Undo this import** button.

1. **Items** (products with stock)
2. **Customers and suppliers (with balances)**
3. **Past sales bills** and **Past purchase bills** (history, optional)

Pick **Where are you switching from?** first (Vyapar, Tally, Busy, Marg, Excel/CSV, or "Detect automatically"). The
choice only changes which column names we recognise; you can always change any column in the mapping step.

## What each step does

| Step | You upload | We create | Safe to repeat? |
|---|---|---|---|
| Items | item list with stock | products, units, HSN, GST %, MRP/price/cost, barcode, category, opening stock; **batch no, expiry and mfg date become real batches** (rows of one item with different batch numbers are its batches, not variants; expiry may be `03/2027`, `Mar-27` or a full date) | yes: items are matched by name/SKU and updated, opening stock and each batch's quantity are "set", not added |
| Customers and suppliers | party list with balances | customers and suppliers with GSTIN, state, address, credit limit and **opening balance** (receivable for customers, payable for suppliers) | yes: the same file is skipped; a party that already exists is linked, only its blank fields are filled and its balance is set only when it has none |
| Past sales / purchase bills | sale or purchase report | bills as history with their **original numbers**, dates, parties, lines, tax, totals and payments | yes: a bill (financial year + number) imported before is skipped |

Past bills are marked **imported**. They never change stock, never send WhatsApp/SMS, are never e-invoiced, are left
out of GSTR-1/GSTR-3B and cannot be cancelled (use Undo). They do count in sales reports and in customer and supplier
statements. They do not use our invoice numbers.

### Opening balances and past bills: avoid counting dues twice

If you import party balances (what customers owe you and you owe suppliers **today**) and also import past bills with
unpaid amounts, the dues would be counted twice. So the history step asks:

* **Off (recommended):** the unpaid part of each imported bill is treated as already inside the balances you imported.
  The bill is recorded as settled with a payment marked `IMPORT-SETTLED` (method "other"), so the party balance stays
  exactly what you imported.
* **On:** the unpaid part stays outstanding on the bill. Use this only when the balances you imported are from **before** the
  first bill in the file.

Signs: customer balance positive = they owe you (negative = advance). Supplier balance positive = you owe them. With a
**Balance side** column (Dr/Cr, To Receive/To Pay) the amount can be written without a sign. With no type and no
side, a negative balance makes the party a supplier you owe.

## What to export from each software

"Verified" below means checked against the vendor's own documentation or a real file. We could not obtain real export
files for any of these products, and none of the vendors publishes the column list of its exports, so **all vendor
layouts are marked assumed**: we recognise the commonly seen column names (case, spaces and punctuation ignored, title
rows above the header skipped, report total rows dropped) and always offer a manual mapping. If a column is missed,
map it by hand once. Please send us one real export per software so we can lock the names in.

| Software | Items | Parties | Sales / purchase history | Format | Status |
|---|---|---|---|---|---|
| Vyapar | Items > export to Excel | Parties > export to Excel | Reports > Sale report / Purchase report > Export to Excel (the item-wise / GST report gives lines; the plain report gives one summary line per bill) | xlsx, csv | assumed |
| Tally (Prime / ERP 9) | Export > Masters > Stock Items (XML), or Stock Summary > Excel | Export > Masters > Ledgers (XML): Sundry Debtors become customers, Sundry Creditors suppliers | Export > Vouchers > Sales or Purchase (XML) with inventory entries; or Sales/Purchase Register > Excel (summary bills) | xml (UTF-8 or UTF-16), xlsx, csv | assumed (tags follow Tally's documented XML) |
| Busy | Masters > Item list > Excel | Masters > Account list > Excel | Sales/Purchase Register (item-wise) > Excel | xlsx, csv | assumed |
| Marg ERP | Product list > Excel (Batch and Exp are read) | Party/Account list > Excel | Sales/Purchase register > Excel | xlsx, csv | assumed |
| Any other | download our template | download our template | download our template | xlsx, csv | documented |

Each import step offers a template download (`Download template`). The template is our own layout plus a Help sheet that
repeats these instructions for the chosen software.

### Tally XML notes

* Debtors/creditors are taken from the ledger's parent group. Tally writes debit balances as negative numbers; we turn
  that into Dr = receivable for debtors and Cr = payable for creditors.
* Vouchers: only voucher types containing "Sales" or "Purchase" are read; cancelled and optional vouchers, orders,
  returns, credit and debit notes are skipped. GST is read from ledgers named like CGST/SGST/IGST/Cess; the rate is the
  nearest standard slab of tax/taxable, and the tax is split over items by value. Other ledgers (freight, packing) become an
  "Other charges" line so the bill total matches.
* Payments are not on a voucher. Bills come in as unpaid (then settled or carried as chosen above). Receipt and payment
  vouchers are not imported.

## The wizard, step by step

1. **Choose** the source and the kind of data.
2. **Upload** the file (CSV, Excel, or Tally XML). Up to 10 MB; 20,000 rows for items/parties, 60,000 rows for bills (split
   bigger files by year).
3. **Check the preview.** The columns we matched are shown; change any with the drop-down. Rows with problems are
   listed with the reason. A note tells you how many rows were left out (receipts, journals, returns, totals) and how many
   were imported before. The preview never saves anything.
4. **Import.** A progress bar runs. Rows with problems are skipped, never half-saved. For bills, all lines of one bill are saved
   together.
5. **Result.** Download the **error report** (CSV: row, problem and the original cells of that row) and fix the rows in
   your file, then upload only those, or the whole file again; rows already imported are skipped.
6. **Undo** (owner/admin): removes what that import created: its bills, the customers/suppliers/items it added. Anything
   that is in use now stays, and the result lists it (for example a customer who has newer bills). After an undo the same file
   can be imported again. Customers/suppliers and items that already existed and were only linked are not removed, but
   an opening balance the import set on them is cleared.

Row numbers in the report: row 2 is the first data row under the header.

## Export all my data (owner only)

Settings > Import and export > Export. **Prepare my export** builds a zip in the background (items, customers,
suppliers, invoices, invoice lines, payments received, customer receipts, purchases and lines, payments to suppliers,
expenses, stock movements as CSV, plus Excel for every dataset up to 50,000 rows). Download it when ready; it is kept for 7
days. Every request and download is recorded in the audit log.

**Sales and purchases for Tally** gives the same bills as Tally voucher XML (or Excel). In Tally: Gateway of Tally >
Import Data > Vouchers. Create the party ledgers, the Sales/Purchase ledger, Output/Input CGST, SGST, IGST and Round
Off ledgers and the stock items first; the file only refers to them by name (ledger names can be changed in the XML).

## API

`GET /v1/import/sources`, `POST /v1/import/:key/preview?source=vyapar|tally|busy|marg|generic|auto`,
`POST /v1/import/:jobId/commit` (`{ mapping?, options?: { carryDues } }`), `POST /v1/import/:jobId/rollback`,
`GET /v1/import/:jobId/errors.csv`, `GET /v1/import/:key/template.xlsx?source=`; keys `catalog.products`,
`migrate.parties`, `history.sales`, `history.purchases` (plus the older `invoices.customers`, `inventory.suppliers`,
`inventory.stock`). Export: `POST /v1/export/all`, `GET /v1/export/all[/:id[/file]]`,
`GET /v1/export/tally/vouchers.xml|xlsx?kind=sale|purchase&from=&to=`.

## Limits (known)

* Returns, credit/debit notes, receipt and payment vouchers, cheques, bank entries, expenses and bill-wise Tally
  allocations are not imported. Item prices from Tally masters fall back to the cost when no selling price is present.
* Batch rows from Vyapar / Marg / Busy / Excel become batches (Stock > Batches & expiry) and switch the item to batch tracking; shops with the pharmacy feature get medicine batches in Pharmacy instead (needs an expiry). Undo removes batches that nothing was sold from. See `docs/stock-depth.md`.
* Imported bills cannot be edited or cancelled; undo the batch instead. A credit note against an imported sale is allowed.
* GST rates outside 0/0.25/3/5/12/18/28 are kept as written on imported bills.
* The all-data zip is built in memory: very large shops (millions of rows) should export per dataset.
