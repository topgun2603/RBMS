/** Price lists and alternate units (docs/price-lists-units.md). Money in paise, dates YYYY-MM-DD. */

/** An alternate unit of an item: `factor` base units in one; `price` as sold, `rate` GST-exclusive. */
export interface ItemUnit {
  unit: string;
  factor: number;
  barcode: string | null;
  /** The unit's own price (null = factor × the item price). */
  ownPrice: number | null;
  price: number;
  rate: number;
  mrp: number | null;
}

export interface ItemUnits {
  variantId: string;
  baseUnit: string;
  units: ItemUnit[];
}

export interface PriceList {
  id: string;
  name: string;
  adjustPct: number | null;
  roundRupee: boolean;
  validFrom: string | null;
  validTo: string | null;
  active: boolean;
  isDefault: boolean;
  note: string | null;
  current: boolean;
}

export interface PriceListSummary extends PriceList {
  entryCount: number;
  groupCount: number;
  customerCount: number;
}

export interface PriceEntry {
  id: string;
  itemId: string;
  itemName: string | null;
  sku: string | null;
  baseUnit: string | null;
  unit: string | null;
  minQty: number;
  price: number;
  itemPrice: number | null;
}

export interface PriceListDetail extends PriceList {
  entries: PriceEntry[];
}

export interface PriceListInput {
  name: string;
  adjustPct?: number | null;
  roundRupee?: boolean;
  validFrom?: string | null;
  validTo?: string | null;
  active?: boolean;
  isDefault?: boolean;
  note?: string | null;
}

export interface CustomerGroup {
  id: string;
  name: string;
  priceListId: string | null;
  priceListName: string | null;
  note: string | null;
  customerCount: number;
}

export interface CustomerPricing {
  customerId: string;
  groupId: string | null;
  groupName: string | null;
  priceListId: string | null;
  effectiveListId: string | null;
  effectiveListName: string | null;
}

export type PriceSource = "list" | "slab" | "rule" | "unit" | "item";

export interface ResolvedLine {
  itemId: string;
  unit: string;
  unitFactor: number;
  price: number;
  rate: number;
  gstRate: number;
  basePrice: number;
  source: PriceSource;
  listId: string | null;
  listName: string | null;
  minQty: number | null;
  qty: number;
}

export interface ResolveResult {
  list: { id: string; name: string } | null;
  defaultList: { id: string; name: string } | null;
  lines: ResolvedLine[];
}
