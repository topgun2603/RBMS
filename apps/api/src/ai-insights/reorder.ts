import { DEFAULT_COVER_DAYS, DEFAULT_LEAD_DAYS, festivalsAhead, lastYearOf, planAddDays, planDaysBetween, type FestivalSignal, type ReorderData, type ReorderInput } from "@srirealtime/ai";
import { sql, type Db } from "@srirealtime/db";

/**
 * Reads what the reorder maths needs from the shop's own tables: sales per item per day (from the stock ledger), stock,
 * open purchase orders, the supplier and rate of the last purchase, and last year's sales in the window before the next
 * festival. The maths itself is `suggestItem` in packages/ai (pure, tested).
 */

export interface ReorderItems {
  getItems(tenantId: string, ids: string[]): Promise<{ id: string; name: string; unit: string; hsn: string | null; gstRate: number }[]>;
}

type Rows = Record<string, unknown>[];
const rowsOf = (r: unknown) => r as Rows;
const num = (v: unknown) => Number(v ?? 0);
const SALE = sql`('sale','sale_cancel','sale_return','sale_return_cancel')`;

export async function gatherReorder(db: Db, items: ReorderItems, tenantId: string, today: string, opts: { leadDays?: number }): Promise<ReorderData> {
  const T = tenantId;
  const [first] = rowsOf(
    await db.execute(sql`select min((created_at at time zone 'Asia/Kolkata')::date)::text as d from stock_movements where tenant_id = ${T}::uuid and reason = 'sale'`),
  );
  const firstSale = (first?.d as string | null) ?? null;
  const historyDays = firstSale ? Math.max(0, Math.min(90, planDaysBetween(firstSale, today))) : 0;

  const stock = rowsOf(
    await db.execute(sql`
      select item_id, sum(qty - reserved)::float8 as avail, max(reorder_level)::float8 as rl
      from stock_items where tenant_id = ${T}::uuid and track group by item_id`),
  );
  const sold = rowsOf(
    await db.execute(sql`
      with m as (
        select item_id, delta, (created_at at time zone 'Asia/Kolkata')::date as d
        from stock_movements
        where tenant_id = ${T}::uuid and reason in ${SALE}
          and created_at >= ((${today}::date - 90)::timestamp at time zone 'Asia/Kolkata')
          and created_at < (${today}::date::timestamp at time zone 'Asia/Kolkata'))
      select item_id, (-sum(delta))::float8 as s90,
             (-coalesce(sum(delta) filter (where d >= ${today}::date - 28), 0))::float8 as s28
      from m group by item_id`),
  );
  const soldBy = new Map(sold.map((r) => [String(r.item_id), { s90: num(r.s90), s28: num(r.s28) }]));
  const stockBy = new Map(stock.map((r) => [String(r.item_id), { avail: num(r.avail), rl: num(r.rl) }]));
  // Candidates: anything that sold in the last 90 days, or sits under the level the owner set.
  const ids = new Set<string>();
  for (const [id, s] of soldBy) if (s.s90 > 0) ids.add(id);
  for (const [id, s] of stockBy) if (s.rl > 0 && s.avail <= s.rl) ids.add(id);

  const daily = rowsOf(
    await db.execute(sql`
      select item_id, (created_at at time zone 'Asia/Kolkata')::date::text as d, (-sum(delta))::float8 as q
      from stock_movements
      where tenant_id = ${T}::uuid and reason in ${SALE}
        and created_at >= ((${today}::date - 28)::timestamp at time zone 'Asia/Kolkata')
        and created_at < (${today}::date::timestamp at time zone 'Asia/Kolkata')
      group by 1, 2`),
  );
  const dailyBy = new Map<string, Map<string, number>>();
  for (const r of daily) {
    const id = String(r.item_id);
    if (!dailyBy.has(id)) dailyBy.set(id, new Map());
    dailyBy.get(id)!.set(String(r.d), num(r.q));
  }

  const firstMove = rowsOf(
    await db.execute(sql`select item_id, min((created_at at time zone 'Asia/Kolkata')::date)::text as d from stock_movements where tenant_id = ${T}::uuid group by item_id`),
  );
  const firstBy = new Map(firstMove.map((r) => [String(r.item_id), String(r.d)]));

  const onOrderRows = rowsOf(
    await db.execute(sql`
      select l->>'itemId' as item_id, sum((l->>'qty')::numeric - coalesce((l->>'received')::numeric, 0))::float8 as q
      from purchase_orders po, jsonb_array_elements(po.lines) l
      where po.tenant_id = ${T}::uuid and po.status in ('sent', 'partially_received') and l->>'itemId' is not null
      group by 1`),
  );
  const onOrder = new Map(onOrderRows.map((r) => [String(r.item_id), Math.max(0, num(r.q))]));

  const lastBuy = rowsOf(
    await db.execute(sql`
      select distinct on (l->>'itemId') l->>'itemId' as item_id, p.supplier_id, (l->>'rate')::numeric as rate, l->>'gstRate' as gst, l->>'hsn' as hsn
      from purchases p, jsonb_array_elements(p.lines) l
      where p.tenant_id = ${T}::uuid and p.status = 'recorded' and p.date >= ${today}::date - 400 and l->>'itemId' is not null
      order by l->>'itemId', p.date desc, p.created_at desc`),
  );
  const buyBy = new Map(lastBuy.map((r) => [String(r.item_id), r]));
  const sup = rowsOf(await db.execute(sql`select id::text as id, name from suppliers where tenant_id = ${T}::uuid and deleted_at is null`));
  const supName = new Map(sup.map((r) => [String(r.id), String(r.name)]));

  // The festival whose shopping window starts within this purchase's reach (or has started): the nearest one ahead.
  const reach = DEFAULT_LEAD_DAYS + DEFAULT_COVER_DAYS + (opts.leadDays ?? 0);
  const ahead = festivalsAhead(today, 60).filter((f) => f.daysAway > 0);
  const relevant = ahead.find((f) => planDaysBetween(today, f.windowStart) <= reach) ?? null;
  const ly = relevant ? lastYearOf(relevant.festival) : null;
  const lyWindow = ly ? { from: planAddDays(ly.date, -ly.leadDays), to: planAddDays(ly.date, -1) } : null;
  const baseline = lyWindow ? { from: planAddDays(lyWindow.from, -56), to: planAddDays(lyWindow.from, -1) } : null;
  const festBy = new Map<string, { w: number; b: number }>();
  if (lyWindow && baseline && firstSale && firstSale <= baseline.to) {
    const fr = rowsOf(
      await db.execute(sql`
        select item_id,
               (-coalesce(sum(delta) filter (where d between ${lyWindow.from}::date and ${lyWindow.to}::date), 0))::float8 as w,
               (-coalesce(sum(delta) filter (where d between ${baseline.from}::date and ${baseline.to}::date), 0))::float8 as b
        from (select item_id, delta, (created_at at time zone 'Asia/Kolkata')::date as d from stock_movements
              where tenant_id = ${T}::uuid and reason in ${SALE}
                and created_at >= (${baseline.from}::date::timestamp at time zone 'Asia/Kolkata')
                and created_at < ((${lyWindow.to}::date + 1)::timestamp at time zone 'Asia/Kolkata')) m
        group by item_id`),
    );
    for (const r of fr) festBy.set(String(r.item_id), { w: num(r.w), b: num(r.b) });
  }

  const idList = [...ids];
  const meta = new Map<string, { name: string; unit: string; hsn: string | null; gstRate: number }>();
  for (let i = 0; i < idList.length; i += 300) for (const it of await items.getItems(T, idList.slice(i, i + 300))) meta.set(it.id, it);

  const inputs: ReorderInput[] = [];
  for (const id of idList) {
    const m = meta.get(id);
    const st = stockBy.get(id);
    if (!m || !st) continue; // deleted, or not a tracked item
    const s = soldBy.get(id) ?? { s90: 0, s28: 0 };
    const fm = firstBy.get(id);
    const itemHist = fm ? Math.min(historyDays, Math.max(0, planDaysBetween(fm, today))) : historyDays;
    const series = Array.from({ length: 28 }, (_, k) => dailyBy.get(id)?.get(planAddDays(today, k - 28)) ?? 0);
    const buy = buyBy.get(id);
    let festival: FestivalSignal | null = null;
    const fb = festBy.get(id);
    if (relevant && lyWindow && baseline && fb && firstSale) {
      const baseDays = Math.max(0, planDaysBetween(firstSale > baseline.from ? firstSale : baseline.from, baseline.to) + 1);
      festival = {
        id: relevant.festival.id,
        name: relevant.festival.name,
        nameTa: relevant.festival.nameTa,
        daysAway: relevant.daysAway,
        windowFromDay: planDaysBetween(today, relevant.windowStart),
        windowToDay: planDaysBetween(today, relevant.windowEnd),
        lastYearQty: fb.w,
        lastYearDays: planDaysBetween(lyWindow.from, lyWindow.to) + 1,
        baselineQty: fb.b,
        baselineDays: baseDays,
      };
    }
    inputs.push({
      itemId: id,
      name: m.name,
      unit: m.unit,
      stock: st.avail,
      reorderLevel: st.rl,
      onOrder: onOrder.get(id) ?? 0,
      sold28: s.s28,
      sold90: s.s90,
      historyDays: itemHist,
      daily28: series,
      leadDays: opts.leadDays,
      supplierId: buy?.supplier_id ? String(buy.supplier_id) : null,
      supplierName: buy?.supplier_id ? (supName.get(String(buy.supplier_id)) ?? null) : null,
      lastRate: buy?.rate !== undefined && buy?.rate !== null ? Math.round(num(buy.rate)) : null,
      gstRate: buy?.gst !== undefined && buy?.gst !== null ? num(buy.gst) : m.gstRate,
      hsn: (buy?.hsn as string | null | undefined) ?? m.hsn ?? null,
      festival,
    });
  }

  const festivals = ahead.slice(0, 3).map((f) => {
    const l = lastYearOf(f.festival);
    const hasData = !!(l && firstSale && firstSale <= planAddDays(l.date, -l.leadDays - 14));
    return { id: f.festival.id, name: f.festival.name, nameTa: f.festival.nameTa, date: f.festival.date, daysAway: f.daysAway, hasLastYearData: hasData };
  });
  return { today, historyDays, inputs, festivals };
}
