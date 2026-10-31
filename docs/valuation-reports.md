# Stock valuation, landed cost, item-wise profit and packaged reports

Gap items #18, #19 and #39 (docs/gap-analysis.md). Migration **0051** (`apps/api/drizzle/0051_valuation_reports.sql`).
Inventory side in `packages/inventory/src/costing.ts` (service), `costing-logic.ts` (pure rules) and
`schema-costing.ts` (tables); the cross-module reports in `apps/api/src/kit-valuation.ts`; UI in billing-ui (Reports
tabs, purchase form, purchase page). Money is paise, quantities are base units (alternate units such as boxes are
converted to the base unit before stock moves, so nothing here depends on them).

## Valuation method

Each shop values stock by **weighted average** (the default and the existing behaviour) or **FIFO**.

- The weighted average is computed exactly as before (`stock_items.avg_cost`, moving average on purchases, opening
  stock and transfers in; nothing else moves it). Existing shops' numbers do not change.
- **FIFO cost layers** (`stock_cost_layers`) are kept for every shop, whatever its method: each incoming movement opens a
  layer (qty and value), each outgoing movement draws from the open layers (`stock_cost_draws`), oldest first. Order of
  draws: layers of the same document first (a cancelled purchase or a debit note takes back its own goods), then the
  batches the stock left from (the batch the cashier picked or first-expiry-first-out), then unbatched layers, then any.
  Goods going into a batch tag the layer just made for them. Stock that goes below zero draws "short" (no layer) at the
  average; the next receipt first covers the deficit.
- **Every stock movement records its cost under both methods**: `stock_movements.cost_avg` (qty x average before the
  move) and `cost_fifo` (the drawn layers). A sale's movement is its cost of goods sold; it never changes when later
  purchases move the average. Returns (credit notes, cancelled bills, challan returns, transfers in, cancelled debit
  notes) come back at the cost they went out with, so a credit note reverses the cost of goods of its bill.
- **Existing shops**: the layers, draws and both cost columns are built once from the stock history
  (`CostingService.build`, replaying movements with the same rules; idempotent: `stock_valuation_settings.layers_built_at`).
  The API builds every shop with stock history in the background shortly after start; reports build on demand. A
  shop with no stock history starts built. While a build runs, that shop's stock changes wait (advisory lock).
- **Switching** (`PUT /v1/valuation/settings {method, from}`, owner or admin): only from 1 April of a financial year
  that is not locked in the books (`from` after the accounting lock), this year or the next, not before an earlier
  switch. The history is kept (`stock_valuation_settings.history`); the method on a date is the last switch on or before
  it. Nothing is rewritten: both costs already exist for every movement. The UI shows the warning that closing stock,
  cost of goods and profit change from that date in the reports and the books.

### Books (docs/accounting.md)

The books stay periodic (cost of goods = opening stock + purchases - closing stock); postings are unchanged:

- Closing stock (balance sheet, P&L, year-end close) = the accounting stock port. For dates on which the shop uses FIFO it
  is the FIFO layers left at the end of that day; otherwise the existing estimate (quantity of the date x today's
  average cost). A switch therefore shows in the switch year's cost of goods (opening at average, closing at FIFO). Since
  a switch can only start in an unlocked year, locked and closed years are untouched.
- Stock adjustments (opening, adjustment, audit) dated on FIFO days are valued at their FIFO cost (`cost_fifo`); average
  days as before. Only unlocked periods can be affected (same lock rules as any posting).
- Purchases with landed charges post like any bill: claimable GST on a charge is in the bill's GST totals (input credit,
  GST ledger and GST filing see it); the charge and any GST that can't be claimed are in the bill total, so they land in
  *Purchases* (Dr Purchases = total - claimable GST - round-off).

## Landed cost

**On the bill / goods receipt.** `purchases.charges` / `goods_receipts.charges`: freight, customs duty, insurance,
loading and other charges, each with an amount before GST, a GST rate, "GST can be claimed" and a basis: by value
(taxable value), by quantity (base units) or by weight (grams per unit of the variant; offered in the UI only when an
item has a weight, falls back to value when none has). The cost spread per stock line = the charge plus GST that can't
be claimed; it is added to the unit cost of the goods (average and FIFO layers). The old `freight` / `other_charges`
fields still work (no GST, by value). A goods receipt passes its charges to the bill made from it.

**Later (landed-cost voucher).** `POST /v1/valuation/landed-costs` against a purchase: either records the transporter's
bill now (a purchase bill with one non-stock line, claimable GST as input credit, else GST inside the amount; optionally
paid in cash) or uses one already recorded (`chargePurchaseId`, a bill with no stock lines). The cost is spread over the
purchase's items by the basis, then split per item: what is still in stock of that purchase (its open FIFO layers) gets
`toStock` (the layers are re-opened at the higher value, and the average at that location goes up by the same amount);
what was already sold is `toSold`, which item-wise profit counts as cost of goods on the voucher date. The books need no
extra entry: the bill is in Purchases and the higher closing stock leaves exactly the sold part in cost of goods.
Numbered `LC/26-27/0001`. Cancel is allowed while none of the re-costed goods has moved since (it also cancels the bill
the voucher made).

## Item-wise profit

`GET /v1/valuation/item-profit?from&to&groupBy=item|category|brand|staff|branch|month[&branchId][&lowMargin=10]`
(+ `format=csv`; PDF `GET /v1/documents/profit-report/item-profit.pdf?...`), report-builder dataset
`inventory.item-profit`. Per bill line: net sales = taxable value; cost of goods = the cost recorded on the bill's sale
movements of that item (shared by quantity between lines of the same item) by the method in force on the bill date.
Credit-note lines are negative rows: sales back and, when the goods were put back in stock, their cost back. Lines with
no stock movement (untracked or service items, bills whose goods left on a delivery challan) use the item's cost
(`catalog_variants.cost`, counted as "item cost lines"); with no cost at all they are flagged "No cost". Cancelled and
imported bills are left out (like the books). Rows below the margin threshold are "Low margin", below zero "Loss".

## Packaged reports

Reports > Sales analysis (`GET /v1/valuation/sales?from&to&view=...`, CSV, PDF
`/v1/documents/sales-analysis/sales-<view>.pdf`): by **cashier** (who opened the till the bill was made at; bills made
outside a till are "Not recorded"; there is no separate salesperson on bills), **day and hour** heatmap (weekday x
hour of the bill's issue time, IST), **hour**, **day of week**, **category**, **brand**, **payment mode** (money received
dated in the period, refunds off), **branch**. Sales are taxable values; credit notes count as returns. Permissions: the
sales views need `reports.view`; anything with cost prices (stock valuation PDF, item profit, branch view) needs
`reports.view` + `inventory.purchases` (PDFs of cost reports: `inventory.purchases`).

## Branch view

Reports > Branches (feature `multi-branch`): `GET /v1/valuation/branches?from&to` (CSV, PDF
`/v1/documents/profit-report/branches.pdf`), labelled **"By branch (from bills and purchases)"**. Per branch side by
side with the total: net sales and cost of goods (bills and credit notes carry the branch), gross profit, purchases
(by the branch whose stock location received the goods; bills with no stock lines stay "Not by branch"), stock value
(by location, method of the date) and expenses (net of input credit) under their branch; expenses without a branch, or
of a deleted branch, are in the "Shop-wide / not by branch" column (docs/expenses-debit-notes.md). Not the books:
journal lines have no branch dimension (out of scope).

## Reconciliation (dev DB, 2026-10-27, FY 2026-27 to date)

`pnpm --filter @rbms/api exec tsx --env-file-if-exists=.env src/scripts/valuation-check.ts <slug> [from] [to]`
builds the layers if needed and compares with the books (posting them for the check and removing them again when the
shop had none).

| Shop | Layers vs stock | Valuation (avg) = books stock | Item-profit net sales = P&L net sales | Cost of goods: bills vs P&L periodic |
|---|---|---|---|---|
| ByteFix | 0 differences | 2,357,279.30 = 2,357,279.30 | 217,742.37 = 217,742.37 | 208,059.80 vs 290,092.60 (stock adjustments and opening stock in the period, which bills do not carry) |
| Raja | 0 | 1,521,483.33 = 1,521,483.33 | 8,835,905.19 = 8,835,905.19 | 6,545,836.23 vs 6,529,545.05 (0.25 %) |
| Kumar | 0 | 130,429.24 = 130,429.24 | 2,577,875.98 = 2,577,875.98 | 2,288,599.52 vs 2,279,166.22 (0.4 %) |
| Theneer | 0 | stock valuation off in the books (restaurant) | 1,923,915.21 = 1,923,915.21 | item costs (no stock tracking) |

Sales agree to the paisa. Cost of goods on the bills (perpetual) differs from the books' periodic figure by stock
adjustments, audits and the books' historic-stock estimate at today's average cost; that is expected and is why the
P&L keeps the periodic method. The report-builder dataset totals equal the item-profit report (Raja: 8,835,905.19 /
6,545,836.23).

## For the CA to confirm

1. A change of method mid-life is a change in accounting policy (AS 2 / Ind AS 8): the switch year's P&L absorbs the
   difference (opening at average, closing at FIFO); no restatement of earlier years is made.
2. GST on a landed charge that "can't be claimed" is added to inventory cost; claimable GST goes to input credit with
   the bill. Customs: basic customs duty is a non-GST charge (cost); IGST on imports is entered as a claimable charge
   on the bill (no bill of entry handling). Freight by a GTA under reverse charge is not handled here (GST filing has
   RCM categories).
3. A landed cost added later is split by what of that purchase is still in stock; goods moved to another location by
   transfer count as sold for this split (their cost does not follow the transfer).
4. Historic weighted-average costs for movements before this release were re-computed from the stock history with the
   same rule; a cost "set" by hand without a quantity change before this release is not in the history.

## Not done

Salesperson per bill line (only the cashier via the till), branch dimension in the books, landed
costs on goods already transferred, voucher cancel after the goods moved, GRN charges editing after receipt.
