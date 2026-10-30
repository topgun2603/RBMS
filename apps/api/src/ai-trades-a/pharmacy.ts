import type { tradesA } from "@rbms/ai";
import { sql, type Db } from "@rbms/db";

type Rows = Record<string, unknown>[];
const rowsOf = (r: unknown) => r as Rows;
const num = (v: unknown) => Number(v ?? 0) || 0;
const ids = (list: string[]) => sql.join(list.map((id) => sql`${id}::uuid`), sql`, `);

/**
 * The pharmacy helpers' reads (docs/ai.md "Phase 3 part A"): medicines with usable stock and billing price, batches near
 * expiry, and recent sales per item. Read-only, one tenant, fixed parameterised queries; the model never sees SQL.
 */

/** Medicines of the shop with details, usable (unexpired) stock and the billing rate (GST-exclusive paise). */
export async function loadStock(db: Db, tenantId: string, today: string, opts: { q?: string; itemIds?: string[]; limit?: number } = {}): Promise<tradesA.StockMed[]> {
  const like = opts.q ? `%${opts.q.replace(/[%_\\]/g, " ").trim().slice(0, 60)}%` : null;
  const rows = rowsOf(
    await db.execute(sql`
      select m.item_id::text as item_id, m.name, m.composition, m.manufacturer, m.schedule, m.pack_size, m.pack_unit,
        coalesce((select sum(b.qty) from medicine_batches b where b.tenant_id = m.tenant_id and b.item_id = m.item_id and b.expiry >= ${today}::date), 0)::float8 as stock,
        v.price, p.gst_rate, p.hsn, p.unit, p.tax_inclusive
      from medicines m
      join catalog_variants v on v.id = m.item_id and v.tenant_id = m.tenant_id and v.deleted_at is null
      join catalog_products p on p.id = v.product_id and p.status = 'active'
      where m.tenant_id = ${tenantId}::uuid
        ${opts.itemIds?.length ? sql`and m.item_id in (${ids(opts.itemIds)})` : sql``}
        ${like ? sql`and (m.name ilike ${like} or m.composition ilike ${like})` : sql``}
      order by m.name
      limit ${opts.limit ?? 2000}`),
  );
  return rows.map((r) => {
    const gst = num(r.gst_rate);
    const price = num(r.price);
    return {
      itemId: String(r.item_id),
      name: String(r.name),
      composition: (r.composition as string | null) ?? null,
      manufacturer: (r.manufacturer as string | null) ?? null,
      schedule: String(r.schedule) as tradesA.Schedule,
      packSize: Math.max(1, num(r.pack_size)),
      packUnit: String(r.pack_unit ?? "strip"),
      stock: num(r.stock),
      rate: Math.round(r.tax_inclusive ? price / (1 + gst / 100) : price),
      gstRate: gst,
      hsn: (r.hsn as string | null) ?? null,
      unit: String(r.unit ?? "strip"),
    };
  });
}

/** Batches still on the shelf that expire on or before `horizon` (expired ones included). */
export async function loadBatches(db: Db, tenantId: string, horizon: string): Promise<tradesA.PlanBatch[]> {
  const rows = rowsOf(
    await db.execute(sql`
      select id::text as id, item_id::text as item_id, item_name, batch_no, expiry::text as expiry, qty::float8 as qty, mrp, purchase_rate, supplier
      from medicine_batches
      where tenant_id = ${tenantId}::uuid and qty > 0 and expiry <= ${horizon}::date
      order by expiry, item_name
      limit 2000`),
  );
  return rows.map((r) => ({
    batchId: String(r.id),
    itemId: String(r.item_id),
    itemName: String(r.item_name),
    batchNo: String(r.batch_no),
    expiry: String(r.expiry).slice(0, 10),
    qty: num(r.qty),
    mrp: r.mrp === null ? null : num(r.mrp),
    purchaseRate: r.purchase_rate === null ? null : num(r.purchase_rate),
    supplier: (r.supplier as string | null) ?? null,
  }));
}

/** Units sold per item over the last `days` days (from the bills), and how many days of history the shop actually has. */
export async function loadSales(db: Db, tenantId: string, today: string, itemIds: string[], days = 60): Promise<tradesA.ItemSales[]> {
  if (itemIds.length === 0) return [];
  const [first] = rowsOf(
    await db.execute(sql`select min(date)::text as d from invoices where tenant_id = ${tenantId}::uuid and status in ('issued','partially_paid','paid') and imported = false`),
  );
  const firstDate = (first?.d as string | null) ?? today;
  const history = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${String(firstDate).slice(0, 10)}T00:00:00Z`)) / 86_400_000);
  const windowDays = Math.max(7, Math.min(days, history));
  const rows = rowsOf(
    await db.execute(sql`
      select l->>'itemId' as item_id, sum((l->>'qty')::numeric)::float8 as sold
      from invoices i, jsonb_array_elements(i.lines) l
      where i.tenant_id = ${tenantId}::uuid and i.status in ('issued','partially_paid','paid') and i.imported = false
        and i.date > (${today}::date - ${windowDays}::int) and i.date <= ${today}::date
        and l->>'itemId' in (${sql.join(itemIds.map((id) => sql`${id}`), sql`, `)})
      group by 1`),
  );
  const sold = new Map(rows.map((r) => [String(r.item_id), num(r.sold)]));
  return itemIds.map((itemId) => ({ itemId, sold: sold.get(itemId) ?? 0, windowDays }));
}
