import { tradesA } from "@rbms/ai";
import { sql, type Db } from "@rbms/db";

type Rows = Record<string, unknown>[];
const rowsOf = (r: unknown) => r as Rows;
const num = (v: unknown) => Number(v ?? 0) || 0;
const LIVE = sql`('issued','partially_paid','paid')`;

/** The restaurant helpers' reads (docs/ai.md "Phase 3 part A"). Read-only, one tenant, fixed parameterised queries. */

export interface DishPortion {
  itemId: string;
  productId: string;
  /** "Chettinad Chicken Curry", portion "Half" ("" for a single-portion dish). */
  name: string;
  portion: string;
  category: string | null;
  veg: boolean | null;
  /** GST-exclusive paise per portion, what the bill uses. */
  rate: number;
  gstRate: number;
  hsn: string | null;
}

export async function loadDishes(db: Db, tenantId: string): Promise<DishPortion[]> {
  const rows = rowsOf(
    await db.execute(sql`
      select v.id::text as item_id, p.id::text as product_id, p.name, v.title, v.price, v.is_default, p.gst_rate, p.tax_inclusive, p.hsn, c.name as category, dm.veg
      from catalog_variants v
      join catalog_products p on p.id = v.product_id and p.status = 'active'
      left join catalog_categories c on c.id = p.category_id
      left join dining_menu_items dm on dm.item_id = v.id and dm.tenant_id = v.tenant_id
      where v.tenant_id = ${tenantId}::uuid and v.deleted_at is null and 'billing' = any(p.channels)
      order by p.name, v.position, v.title
      limit 3000`),
  );
  return rows.map((r) => {
    const gst = num(r.gst_rate);
    const price = num(r.price);
    return {
      itemId: String(r.item_id),
      productId: String(r.product_id),
      name: String(r.name),
      portion: String(r.title ?? ""),
      category: (r.category as string | null) ?? null,
      veg: typeof r.veg === "boolean" ? r.veg : null,
      rate: Math.round(r.tax_inclusive ? price / (1 + gst / 100) : price),
      gstRate: gst,
      hsn: (r.hsn as string | null) ?? null,
    };
  });
}

export async function loadCategoryNames(db: Db, tenantId: string): Promise<{ id: string; name: string }[]> {
  const rows = rowsOf(await db.execute(sql`select id::text as id, name from catalog_categories where tenant_id = ${tenantId}::uuid and active order by name limit 500`));
  return rows.map((r) => ({ id: String(r.id), name: String(r.name) }));
}

/** Latest purchase rate (GST-exclusive paise per the item's unit), else the average stock cost, else the variant's cost, for linked inventory items. */
export async function loadItemRates(db: Db, tenantId: string, itemIds: string[]): Promise<Map<string, tradesA.IngredientPrice>> {
  const out = new Map<string, tradesA.IngredientPrice>();
  if (itemIds.length === 0) return out;
  const list = sql.join(itemIds.map((id) => sql`${id}`), sql`, `);
  const unitOf = new Map<string, string>(
    rowsOf(
      await db.execute(sql`select v.id::text as id, p.unit, v.cost from catalog_variants v join catalog_products p on p.id = v.product_id where v.tenant_id = ${tenantId}::uuid and v.id::text in (${list})`),
    ).map((r) => [String(r.id), String(r.unit)]),
  );
  const costs = new Map<string, number | null>(
    rowsOf(await db.execute(sql`select v.id::text as id, v.cost from catalog_variants v where v.tenant_id = ${tenantId}::uuid and v.id::text in (${list})`)).map((r) => [String(r.id), r.cost === null ? null : num(r.cost)]),
  );
  const purchases = await db
    .execute(
      sql`
      select distinct on (l->>'itemId') l->>'itemId' as item_id, (l->>'rate')::numeric as rate, l->>'unit' as unit
      from purchases pu, jsonb_array_elements(pu.lines) l
      where pu.tenant_id = ${tenantId}::uuid and pu.status = 'recorded' and pu.imported = false and l->>'itemId' in (${list})
      order by l->>'itemId', pu.date desc, pu.created_at desc`,
    )
    .then(rowsOf)
    .catch(() => [] as Rows); // the shop has no purchases module
  for (const r of purchases) {
    const unit = tradesA.normUnit(String(r.unit ?? unitOf.get(String(r.item_id)) ?? ""));
    if (tradesA.unitFamily(unit)) out.set(String(r.item_id), { price: Math.round(num(r.rate)), unit, source: "purchase" });
  }
  const avg = await db
    .execute(sql`select item_id::text as item_id, avg(avg_cost)::float8 as c from stock_items where tenant_id = ${tenantId}::uuid and avg_cost is not null and item_id::text in (${list}) group by 1`)
    .then(rowsOf)
    .catch(() => [] as Rows);
  for (const r of avg) {
    const unit = tradesA.normUnit(unitOf.get(String(r.item_id)) ?? "");
    if (!out.has(String(r.item_id)) && tradesA.unitFamily(unit)) out.set(String(r.item_id), { price: Math.round(num(r.c)), unit, source: "avg_cost" });
  }
  for (const id of itemIds) {
    const unit = tradesA.normUnit(unitOf.get(id) ?? "");
    const cost = costs.get(id);
    if (!out.has(id) && cost && tradesA.unitFamily(unit)) out.set(id, { price: cost, unit, source: "item_cost" });
  }
  return out;
}

/** Portions sold per dish per date (IST) for these dates, from issued bills. */
export async function loadDishSales(db: Db, tenantId: string, dates: string[]): Promise<{ byItem: Map<string, Record<string, number>>; openDates: Set<string>; dayTotals: Map<string, number> }> {
  const byItem = new Map<string, Record<string, number>>();
  const dayTotals = new Map<string, number>();
  if (dates.length === 0) return { byItem, openDates: new Set(), dayTotals };
  const list = sql.join(dates.map((d) => sql`${d}::date`), sql`, `);
  const rows = rowsOf(
    await db.execute(sql`
      select i.date::text as date, l->>'itemId' as item_id, sum((l->>'qty')::numeric)::float8 as qty
      from invoices i, jsonb_array_elements(i.lines) l
      where i.tenant_id = ${tenantId}::uuid and i.status in ${LIVE} and i.imported = false and i.date in (${list}) and l->>'itemId' is not null
      group by 1, 2`),
  );
  for (const r of rows) {
    const date = String(r.date).slice(0, 10);
    const m = byItem.get(String(r.item_id)) ?? {};
    m[date] = num(r.qty);
    byItem.set(String(r.item_id), m);
    dayTotals.set(date, (dayTotals.get(date) ?? 0) + num(r.qty));
  }
  const open = rowsOf(await db.execute(sql`select distinct date::text as date from invoices where tenant_id = ${tenantId}::uuid and status in ${LIVE} and imported = false and date in (${list})`));
  return { byItem, openDates: new Set(open.map((r) => String(r.date).slice(0, 10))), dayTotals };
}
