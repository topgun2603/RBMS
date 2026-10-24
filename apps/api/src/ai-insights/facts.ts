import { planAddDays as addDays, maskPhone, pctChange, type SummaryFacts } from "@srirealtime/ai";
import { sql, type Db } from "@srirealtime/db";

/**
 * The daily summary's numbers, computed from the shop's own tables (docs/ai.md "Daily summary"). Nothing here calls a model.
 * Dates are IST business dates; money is paise.
 */

export interface FactsItems {
  getItems(tenantId: string, ids: string[]): Promise<{ id: string; name: string }[]>;
}
export interface ExpiryPort {
  /** Batches expiring within the alert window (generic batches plus pharmacy medicines); null when the shop does not track expiry. */
  expiring(tenantId: string): Promise<{ batches: number; qty: number; value: number; days: number } | null>;
}

const num = (v: unknown) => Number(v ?? 0);
type Rows = Record<string, unknown>[];
const rowsOf = (r: unknown) => r as Rows;

const LIVE = sql`('issued','partially_paid','paid')`;

async function dayTotals(db: Db, tenantId: string, date: string) {
  const [r] = rowsOf(
    await db.execute(sql`
      select count(*)::int as bills, coalesce(sum(total), 0)::bigint as amt
      from invoices
      where tenant_id = ${tenantId}::uuid and date = ${date}::date and status in ${LIVE} and imported = false`),
  );
  return { bills: num(r?.bills), amount: num(r?.amt) };
}

export async function gatherFacts(db: Db, items: FactsItems, expiry: ExpiryPort | null, tenantId: string, date: string): Promise<SummaryFacts> {
  const lastWeekDate = addDays(date, -7);
  const [today, lastWeek] = await Promise.all([dayTotals(db, tenantId, date), dayTotals(db, tenantId, lastWeekDate)]);

  const split = rowsOf(
    await db.execute(sql`
      select p.method, coalesce(sum(p.amount), 0)::bigint as amt
      from invoice_payments p join invoices i on i.id = p.invoice_id
      where p.tenant_id = ${tenantId}::uuid and p.date = ${date}::date and p.amount > 0 and i.status <> 'cancelled'
      group by p.method`),
  );
  const by = (m: string) => num(split.find((x) => x.method === m)?.amt);
  const cash = by("cash");
  const upi = by("upi");
  const card = by("card");
  const other = split.filter((x) => !["cash", "upi", "card"].includes(String(x.method))).reduce((a, x) => a + num(x.amt), 0);

  const top = rowsOf(
    await db.execute(sql`
      select l->>'description' as name, sum((l->>'qty')::numeric) as qty, sum((l->>'total')::numeric) as amt
      from invoices i, jsonb_array_elements(i.lines) l
      where i.tenant_id = ${tenantId}::uuid and i.date = ${date}::date and i.status in ${LIVE} and i.imported = false
      group by 1 order by amt desc limit 5`),
  );

  // Low stock: tracked items at or under the level the owner set (summed over locations).
  const lowRows = rowsOf(
    await db.execute(sql`
      select item_id, sum(qty - reserved)::float8 as avail, max(reorder_level)::float8 as rl
      from stock_items
      where tenant_id = ${tenantId}::uuid and track and reorder_level > 0
      group by item_id
      having sum(qty - reserved) <= max(reorder_level)
      order by sum(qty - reserved) / max(reorder_level) asc, item_id
      limit 300`),
  );
  const dead = rowsOf(
    await db.execute(sql`
      select s.item_id, sum(s.qty)::float8 as q
      from stock_items s
      where s.tenant_id = ${tenantId}::uuid and s.track
      group by s.item_id
      having sum(s.qty) > 0
        and not exists (select 1 from stock_movements m where m.tenant_id = ${tenantId}::uuid and m.item_id = s.item_id and m.reason = 'sale'
                        and m.created_at >= ((${date}::date - 30)::timestamp at time zone 'Asia/Kolkata'))
        and exists (select 1 from stock_movements m where m.tenant_id = ${tenantId}::uuid and m.item_id = s.item_id
                    and m.created_at < ((${date}::date - 30)::timestamp at time zone 'Asia/Kolkata'))
      order by sum(s.qty) desc, s.item_id
      limit 300`),
  );
  const ids = [...new Set([...lowRows.map((r) => String(r.item_id)), ...dead.map((r) => String(r.item_id))])];
  const names = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 300) for (const it of await items.getItems(tenantId, ids.slice(i, i + 300))) names.set(it.id, it.name);
  // Items deleted from the catalogue are not counted.
  const low = lowRows.filter((r) => names.has(String(r.item_id)));
  const deadKnown = dead.filter((r) => names.has(String(r.item_id)));

  const dues = rowsOf(
    await db.execute(sql`
      select coalesce(customer_id::text, 'n:' || coalesce(customer->>'name', '')) as k,
             max(customer->>'name') as name, max(customer->>'phone') as phone,
             sum(total - paid - credited)::bigint as bal,
             coalesce(sum(total - paid - credited) filter (where due_date < ${date}::date), 0)::bigint as overdue_bal,
             (${date}::date - min(due_date) filter (where due_date < ${date}::date))::int as days_late
      from invoices
      where tenant_id = ${tenantId}::uuid and status in ('issued', 'partially_paid') and imported = false
        and total - paid - credited > 0 and date <= ${date}::date
      group by 1`),
  );
  const overdue = dues
    .filter((r) => num(r.overdue_bal) > 0)
    .sort((a, b) => num(b.overdue_bal) - num(a.overdue_bal))
    .slice(0, 3)
    .map((r) => ({ name: String(r.name || "Customer"), phoneMasked: r.phone ? maskPhone(String(r.phone)) : null, amount: num(r.overdue_bal), days: Math.max(1, num(r.days_late)) }));

  const [pur] = rowsOf(
    await db.execute(sql`
      select count(*)::int as n, coalesce(sum(total), 0)::bigint as amt from purchases
      where tenant_id = ${tenantId}::uuid and date = ${date}::date and status = 'recorded' and imported = false`),
  );
  const [exp] = rowsOf(
    await db.execute(sql`
      select count(*)::int as n, coalesce(sum(amount), 0)::bigint as amt from expenses
      where tenant_id = ${tenantId}::uuid and date = ${date}::date and status = 'recorded'`),
  );
  const expiring = expiry ? await expiry.expiring(tenantId).catch(() => null) : null;

  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return {
    date,
    weekday,
    today: { bills: today.bills, amount: today.amount, cash, upi, card, other },
    lastWeek: { date: lastWeekDate, bills: lastWeek.bills, amount: lastWeek.amount },
    vsLastWeekPct: pctChange(today.amount, lastWeek.amount),
    topItems: top.map((r) => ({ name: String(r.name), qty: Math.round(num(r.qty) * 100) / 100, amount: Math.round(num(r.amt)) })),
    lowStock: {
      count: low.length,
      top: low.slice(0, 5).map((r) => ({ name: names.get(String(r.item_id))!, qty: Math.max(0, Math.round(num(r.avail) * 100) / 100), reorderLevel: Math.round(num(r.rl) * 100) / 100 })),
    },
    deadStock: { count: deadKnown.length, top: deadKnown.slice(0, 5).map((r) => ({ name: names.get(String(r.item_id))!, qty: Math.round(num(r.q) * 100) / 100 })) },
    dues: { count: dues.length, amount: dues.reduce((a, r) => a + num(r.bal), 0), overdue },
    expiring: expiring && expiring.batches > 0 ? expiring : null,
    purchases: { count: num(pur?.n), amount: num(pur?.amt) },
    expenses: { count: num(exp?.n), amount: num(exp?.amt) },
  };
}
