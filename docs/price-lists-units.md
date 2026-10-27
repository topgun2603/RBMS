# Price lists, wholesale slabs and alternate units

Gap item #31. Shops sell the same item by the piece and by the box, and charge wholesale customers, dealers and hotels
other prices than the counter. This adds both without changing anything for a shop that doesn't use them: an item's
catalogue price stays the retail price, and a bill without lists or units is priced exactly as before.

Migration **0050** (`apps/api/drizzle/0050_price_lists_units.sql`): `catalog_item_units`, `price_lists`,
`price_list_items`, `customer_groups`, `customer_pricing`.

## Alternate units

Every item keeps its base unit (`catalog_products.unit`, e.g. `pcs`, `kg`). **Stock is always kept in the base unit.**
An item (catalogue variant) can have up to 10 extra units in `catalog_item_units`:

| Field | Meaning |
|---|---|
| `unit` | `box`, `bag`, `dozen` ... (unique per item, any case; not the base unit) |
| `factor` | base units in one of this unit: 1 box = 12 pcs → 12; 1 bag = 25 kg → 25; 1 g of a kg item → 0.001 (6 decimals) |
| `barcode` | optional; unique in the shop across item and unit barcodes. Scanning it adds one box |
| `price`, `mrp` | optional, paise, on the item's price basis (incl. GST when the product is tax-inclusive). Null = `factor × the item price` |

API: `GET /v1/catalog/variants/:id/units`, `PUT /v1/catalog/variants/:id/units` (`{ units: [...] }` replaces them;
`catalogue.manage`). Items carry `units` wherever the catalogue hands them out: `/v1/invoices/items`, the variant
lookups (`/v1/catalog/variants/lookup` also answers a unit barcode, with `scannedUnit`), and the POS catalogue
(`/v1/pos/catalog`, `units` per item). A change touches the variant's `updated_at`, so POS deltas pick it up.

### On document lines

A bill / quotation / proforma / sale order / challan / purchase / purchase order line names its `unit` as before. For a
line of a saved item in one of its alternate units the line also stores

- `unitFactor`: base units in one `unit` (12), and
- `baseUnit`: the item's base unit (`pcs`).

The API host sets both from the catalogue on every document route (`apps/api/src/kit-pricing.ts`, the line guard runs
before the other guards); a factor sent by a client is dropped, so nobody can move stock by inventing one. Offline POS
bills get the same treatment when they sync. Lines in the base unit, free-text lines and old documents carry no factor
(= 1).

What uses the factor:

| Where | Effect |
|---|---|
| Stock (`StockPort.applySale`, credit-note restock, challan out / return, sale-order holds) | moves `qty × unitFactor` base units (`baseQtyOf` in `@srirealtime/gst`) |
| Purchases, goods receipts, debit notes (`packages/inventory`) | stock in / out `qty × unitFactor`; the unit cost is the line's taxable value over the base quantity (`baseMilliOf`) |
| Price-band GST (apparel / footwear) | banded on one piece: a box of 6 at ₹7,200 is ₹1,200 a piece |
| GSTR-1 HSN summary (`packages/einvoice` `gstr1.ts`) and the HSN report (`packages/invoices` `reports.ts`) | counted in the base unit (24 pcs → UQC NOS), so one HSN keeps one UQC however the goods were packed |
| GST amounts, HSN codes, rates | unchanged |
| Printed bill, e-invoice line | the chosen unit and quantity (2 box at ₹600) |

## Price lists

`packages/pricelists` (feature `catalogue.price-lists`, a shop switch on the catalogue tree: plans with `catalogue.*`
have it). Routes under `/v1/pricelists` for owners, admins and staff; writes need `catalogue.manage`, a customer's
group / list needs `customers.create`.

A **price list** has a name, an optional **% rule** (`adjustPct`: −10 = 10% off the item price, 5 = 5% markup, with
optional rounding to the rupee), optional **validity dates** (inclusive), an on / off switch, and at most one list per
shop can be the **default** ("for everyone": quantity slabs for walk-in customers too). Its **prices** are rows of
item + unit (null = base unit) + `minQty` (slab: from this quantity up, 0 = any) + price (paise, item basis).

**Customer groups** (Dealers, Hotels ...) have a list; a customer has an optional group and an optional own list
(`customer_pricing`, keyed by `billing_customers.id`). The customer's own list wins over the group's.

### Resolution (one pure function)

`resolvePrice` in `packages/pricelists/src/resolve.ts` (also exported as `@srirealtime/pricelists/resolve` for the
browser). For an item, unit, quantity and date, the lists are tried in order — the list picked on the document (or else
the customer's own list, else their group's), then the shop's default list — and the first that prices the line wins:

1. an entry in the chosen unit: the highest slab at or under the quantity;
2. an entry in the base unit (slab on `qty × factor`), scaled to the unit;
3. the list's % rule on the item's own price for the unit.

Nothing matched: the item's own price for the unit (the unit's price, else `factor × price`). Lists that are off or
outside their dates are skipped. "Item price" (`priceListId: "none"`) on a document uses no list at all. The answer
carries the GST-exclusive `rate` a line takes, where the price came from (`list` / `slab` / `rule` / `unit` / `item`)
and the item's own price.

- `POST /v1/pricelists/resolve` `{ customerId?, priceListId?, date?, lines: [{ itemId, unit?, qty }] }` — the forms ask
  it when the customer, the list, a unit or a quantity changes.
- On the server: document lines **sent without a `rate`** are priced the same way from the body's `customerId`,
  `priceListId` and `date` (missing description, HSN, unit and GST are filled from the item, and tax-inclusive prices get
  `inclusiveTotal` so ₹45 stays ₹45). Lines with a rate are left alone. Shops without the feature get the item / unit
  price.
- **Discount limits** (`discount-guard.ts`) run after the line guard, on the resolved rate, exactly as before: a list
  price is the price, not a discount; a discount on top of it is capped as today.

## Where it is in the app

- **Price lists** (billing, Stock group): lists with their settings and prices (add items by name / SKU / barcode, a
  unit and a "From quantity" per row), and the Customer groups tab.
- **Items** > edit an item > **Other units**: units, conversion, optional price and barcode.
- **Customer** page > **Prices**: group and own list.
- **New bill / quotation / proforma / sale order / challan**: a price-list picker under the customer (Customer's /
  Item price / a list) and a unit picker on lines of items with units; automatic prices show where they came from
  ("Wholesale · 10+"). A rate typed by hand is never changed again, and editing a saved document doesn't re-price it.
- **Purchases / purchase orders**: unit picker (stock comes in in the base unit).
- **POS**: unit picker in the line editor, box barcodes add a box, a price-list picker under the customer. Lists,
  groups and customer links are cached on the device (`GET /v1/pricelists/cache`, IndexedDB `sr_pos_pricing:<shop>`)
  with the catalogue, so wholesale prices and slabs work offline; lines whose price was changed by hand keep it.

## Import / export

- Products: a **Units** column, `box=12; carton=144@6,400; bag=25@1,200#8901234567890` (`unit=factor[@price][#barcode]`;
  `-` removes the units; empty leaves them as they are). The products export writes the same.
- **Price list prices** (`pricelists.prices`): Price list, Item (SKU, barcode or exact name), Unit, From quantity, Price.
  Lists are matched by name and created when missing; the same list + item + unit + slab replaces the price.

## Not done / decisions

- The online store stays on the retail price; B2B prices for signed-in business customers are not built.
- No category-level list rules (the % rule applies to every item without its own price).
- The Flutter business app does not offer units or lists yet (its lines bill in the base unit, as before).
- Item-wise sales reports group lines by item and unit (boxes and pieces are separate rows); valuation / profit code
  should use `baseQtyOf(line)` for quantities.
