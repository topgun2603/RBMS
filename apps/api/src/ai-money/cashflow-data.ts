import type { aiMoney } from "@rbms/ai";
import { sql, type Db } from "@rbms/db";

type CashflowRaw = aiMoney.CashflowRaw;
type CashflowSettings = aiMoney.CashflowSettings;

/**
 * The cash-flow forecast's inputs, read from the shop's own tables (docs/ai.md, Phase 5 part B). Nothing here calls a model.
 * Money is paise; dates are IST business dates.
 */

type Rows = Record<string, unknown>[];
const rowsOf = (r: unknown) => r as Rows;
const num = (v: unknown) => Number(v ?? 0);
const LIVE = sql`('issued','partially_paid','paid')`;

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** Days of counter history read (enough for last year's festival window plus its baseline). */
const HISTORY_DAYS = 520;
/** A bill with no due date is due this many days after it was made (the same rule as the credit risk score). */
const DEFAULT_TERMS_DAYS = 15;

/** Cash and bank the owner entered, plus the money that moved since; else the tills' last counted cash; else unknown. */
export async function openingBalance(db: Db, tenantId: string, today: string, s: CashflowSettings & { asOfAt?: string | null }): Promise<CashflowRaw["opening"]> {
  if (s.openingBalance !== null && s.asOf) {
    const since = s.asOfAt ?? `${s.asOf}T23:59:59+05:30`;
    const [inRow] = rowsOf(await db.execute(sql`select coalesce(sum(amount), 0)::bigint as v from invoice_payments where tenant_id = ${tenantId}::uuid and created_at > ${since}::timestamptz`));
    const [supRow] = rowsOf(
      await db.execute(sql`select coalesce(sum(case when kind = 'payment' then amount else -amount end), 0)::bigint as v from purchase_payments where tenant_id = ${tenantId}::uuid and reversed_at is null and created_at > ${since}::timestamptz`),
    );
    const [expRow] = rowsOf(await db.execute(sql`select coalesce(sum(amount), 0)::bigint as v from expenses where tenant_id = ${tenantId}::uuid and status = 'recorded' and created_at > ${since}::timestamptz`));
    return { amount: s.openingBalance + num(inRow?.v) - num(supRow?.v) - num(expRow?.v), source: "entered", asOf: s.asOf };
  }
  // The counted cash of each register's latest closed session this week.
  const tills = rowsOf(
    await db.execute(sql`
      select distinct on (lower(register), coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)) counted_cash::bigint as cash, date::text as date
      from till_sessions
      where tenant_id = ${tenantId}::uuid and status = 'closed' and counted_cash is not null and date >= ${addDays(today, -7)}::date
      order by lower(register), coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), closed_at desc`),
  );
  if (tills.length) return { amount: tills.reduce((a, r) => a + num(r.cash), 0), source: "till", asOf: tills.map((r) => String(r.date)).sort().at(-1)! };
  return { amount: null, source: "none", asOf: null };
}

export async function gatherCashflow(db: Db, tenantId: string, today: string, settings: CashflowSettings): Promise<CashflowRaw> {
  const from = addDays(today, -HISTORY_DAYS);

  // Money taken at the counter on the day of the bill (not collections of earlier dues: those are forecast bill by bill).
  const recRows = rowsOf(
    await db.execute(sql`
      select i.date::text as d, sum(p.amount)::bigint as amt
      from invoices i join invoice_payments p on p.invoice_id = i.id and p.tenant_id = i.tenant_id
      where i.tenant_id = ${tenantId}::uuid and i.status in ${LIVE} and i.imported = false and p.date = i.date and p.amount > 0 and p.source <> 'refund'
        and i.date >= ${from}::date and i.date < ${today}::date
      group by 1`),
  );
  const receipts: Record<string, number> = {};
  for (const r of recRows) receipts[String(r.d)] = num(r.amt);
  const [first] = rowsOf(await db.execute(sql`select min(date)::text as d from invoices where tenant_id = ${tenantId}::uuid and status in ${LIVE} and imported = false`));

  // Open customer bills.
  const dues = rowsOf(
    await db.execute(sql`
      select i.id::text as id, i.customer_id::text as customer_id, coalesce(i.customer_id::text, 'n:' || lower(coalesce(i.customer->>'name', ''))) as ckey,
             coalesce(i.customer->>'name', 'Customer') as name, i.number,
             (i.total - i.paid - i.credited)::bigint as bal,
             coalesce(i.due_date, i.date + ${DEFAULT_TERMS_DAYS}::int)::text as due
      from invoices i
      where i.tenant_id = ${tenantId}::uuid and i.status in ('issued', 'partially_paid') and i.imported = false
        and i.total - i.paid - i.credited > 0 and i.date <= ${today}::date
      order by bal desc
      limit 3000`),
  );

  // Supplier bills still to pay.
  const pays = rowsOf(
    await db.execute(sql`
      select id::text as id, coalesce(supplier->>'name', 'Supplier') as name, bill_number, (total - returned_amount - amount_paid)::bigint as bal, coalesce(due_date, date)::text as due
      from purchases
      where tenant_id = ${tenantId}::uuid and status = 'recorded' and imported = false and total - returned_amount - amount_paid > 0
      order by due
      limit 3000`),
  );

  // Expense history (for the monthly pattern).
  const exp = rowsOf(
    await db.execute(sql`
      select e.date::text as d, c.name as category, nullif(trim(e.vendor_name), '') as vendor, e.amount::bigint as amt
      from expenses e join expense_categories c on c.id = e.category_id
      where e.tenant_id = ${tenantId}::uuid and e.status = 'recorded' and e.date >= ${addDays(today, -200)}::date and e.date <= ${today}::date
      limit 5000`),
  );

  // Open purchase orders: the share not yet received, and how long the shop usually takes to pay a supplier.
  const [credit] = rowsOf(
    await db.execute(sql`
      select coalesce(percentile_cont(0.5) within group (order by (due_date - date)), 0)::int as days
      from purchases where tenant_id = ${tenantId}::uuid and status = 'recorded' and due_date is not null and date >= ${addDays(today, -180)}::date`),
  );
  const creditDays = Math.max(0, Math.min(90, num(credit?.days)));
  const pos = rowsOf(
    await db.execute(sql`
      select id::text as id, number, coalesce(supplier->>'name', 'Supplier') as name, date::text as date, expected_date::text as expected, total::bigint as total,
             (select coalesce(sum((l->>'qty')::numeric), 0) from jsonb_array_elements(lines) l) as qty,
             (select coalesce(sum(coalesce((l->>'received')::numeric, 0)), 0) from jsonb_array_elements(lines) l) as received
      from purchase_orders
      where tenant_id = ${tenantId}::uuid and status in ('sent', 'partially_received') and cancelled_at is null
      limit 500`),
  );

  return {
    today,
    receipts,
    firstSaleDate: first?.d ? String(first.d) : null,
    opening: await openingBalance(db, tenantId, today, settings),
    threshold: settings.minBalance,
    dues: dues.map((r) => ({ customerId: r.customer_id ? String(r.customer_id) : null, customerKey: String(r.ckey), customerName: String(r.name), billId: String(r.id), number: r.number ? String(r.number) : null, balance: num(r.bal), dueDate: String(r.due) })),
    payables: pays.map((r) => ({ billId: String(r.id), supplierName: String(r.name), number: r.bill_number ? String(r.bill_number) : null, balance: num(r.bal), dueDate: String(r.due) })),
    expenses: exp.map((r) => ({ date: String(r.d), category: String(r.category), vendor: r.vendor ? String(r.vendor) : null, amount: num(r.amt) })),
    pos: pos.map((r) => {
      const qty = num(r.qty);
      const left = qty > 0 ? Math.max(0, 1 - num(r.received) / qty) : 1;
      return { id: String(r.id), number: String(r.number), supplierName: String(r.name), remaining: Math.round(num(r.total) * left), expectedDate: r.expected ? String(r.expected) : null, orderDate: String(r.date), creditDays };
    }),
  };
}
