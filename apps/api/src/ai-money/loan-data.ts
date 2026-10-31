import type { aiMoney } from "@rbms/ai";
import { sql, type Db } from "@rbms/db";
import { AppError } from "@rbms/core";
import { openingBalance } from "./cashflow-data";

/**
 * The loan readiness pack's figures: the same reports the shop already has (ageing, payables, stock value), plus monthly
 * sales, GST and purchase totals from its bills. Computed in code only. Money is paise.
 */

type Rows = Record<string, unknown>[];
const rowsOf = (r: unknown) => r as Rows;
const num = (v: unknown) => Number(v ?? 0);
const LIVE = sql`('issued','partially_paid','paid')`;

type CashflowSettings = aiMoney.CashflowSettings;
type LoanMonthIn = aiMoney.LoanMonthIn;
type LoanPackInput = aiMoney.LoanPackInput;

export interface LoanReports {
  ageing(tenantId: string): Promise<{ buckets: { key: string; amount: number; count: number }[]; customers: { total: number }[] }>;
  payables(tenantId: string): Promise<{ payable: number; overdue: number } | null>;
  stockValue(tenantId: string): Promise<number | null>;
}

const addMonths = (month: string, n: number) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** The last 12 complete months (trimmed to the month the shop's first bill was made in). */
export async function gatherLoan(db: Db, reports: LoanReports, tenantId: string, today: string, settings: CashflowSettings, showNames: boolean): Promise<LoanPackInput> {
  const thisMonth = today.slice(0, 7);
  let first = addMonths(thisMonth, -12);
  const lastDay = `${thisMonth}-01`;
  const [fs] = rowsOf(await db.execute(sql`select min(date)::text as d from invoices where tenant_id = ${tenantId}::uuid and status in ${LIVE} and imported = false`));
  if (fs?.d && String(fs.d).slice(0, 7) > first) first = String(fs.d).slice(0, 7);
  if (first >= thisMonth) throw new AppError(409, "not_enough_history", "A loan pack needs at least one complete month of bills. Try again next month.");
  const from = `${first}-01`;

  const sales = rowsOf(
    await db.execute(sql`
      select to_char(date, 'YYYY-MM') as m, count(*)::int as bills, sum(total)::bigint as total,
             sum((totals->>'taxable')::bigint)::bigint as taxable, sum((totals->>'cgst')::bigint + (totals->>'sgst')::bigint + (totals->>'igst')::bigint)::bigint as tax
      from invoices where tenant_id = ${tenantId}::uuid and status in ${LIVE} and imported = false and date >= ${from}::date and date < ${lastDay}::date
      group by 1`),
  );
  const cns = rowsOf(
    await db.execute(sql`
      select to_char(date, 'YYYY-MM') as m, sum(total)::bigint as total, sum((totals->>'taxable')::bigint)::bigint as taxable,
             sum((totals->>'cgst')::bigint + (totals->>'sgst')::bigint + (totals->>'igst')::bigint)::bigint as tax
      from credit_notes where tenant_id = ${tenantId}::uuid and status = 'issued' and date >= ${from}::date and date < ${lastDay}::date
      group by 1`),
  );
  const purch = rowsOf(
    await db.execute(sql`
      select to_char(date, 'YYYY-MM') as m, sum((totals->>'taxable')::bigint)::bigint as taxable
      from purchases where tenant_id = ${tenantId}::uuid and status = 'recorded' and imported = false and date >= ${from}::date and date < ${lastDay}::date
      group by 1`),
  );
  const filed = new Set(
    rowsOf(await db.execute(sql`select period from gst_filings where tenant_id = ${tenantId}::uuid and return_type = 'gstr1' and period ~ '^[0-9]{4}-[0-9]{2}$'`)).map((r) => String(r.period)),
  );
  const by = <T extends Record<string, unknown>>(rows: T[]) => new Map(rows.map((r) => [String(r.m), r]));
  const S = by(sales);
  const C = by(cns);
  const P = by(purch);
  const months: LoanMonthIn[] = [];
  for (let m = first; m < thisMonth; m = addMonths(m, 1)) {
    const s = S.get(m);
    const c = C.get(m);
    months.push({
      month: m,
      sales: num(s?.total) - num(c?.total),
      taxable: num(s?.taxable) - num(c?.taxable),
      bills: num(s?.bills),
      gstOutput: num(s?.tax) - num(c?.tax),
      purchasesTaxable: num(P.get(m)?.taxable),
      gstr1Filed: filed.has(m),
    });
  }

  const top = rowsOf(
    await db.execute(sql`
      select coalesce(customer_id::text, 'n:' || lower(coalesce(customer->>'name', ''))) as k, max(customer->>'name') as name, sum(total - credited)::bigint as total, count(*)::int as bills
      from invoices where tenant_id = ${tenantId}::uuid and status in ${LIVE} and imported = false and date >= ${from}::date and date < ${lastDay}::date
      group by 1 order by total desc limit 10`),
  );

  const ageing = await reports.ageing(tenantId);
  const payables = await reports.payables(tenantId);
  const stockValue = await reports.stockValue(tenantId);

  // Average daily money collected over the same months.
  const [col] = rowsOf(
    await db.execute(sql`select coalesce(sum(amount), 0)::bigint as v from invoice_payments where tenant_id = ${tenantId}::uuid and amount > 0 and source <> 'refund' and date >= ${from}::date and date < ${lastDay}::date`),
  );
  const days = Math.max(1, daysBetween(from, lastDay));

  // Average daily balance: only when the owner entered a balance. Walk back from today's balance with each day's net movement.
  let averageBalance: number | null = null;
  const open = await openingBalance(db, tenantId, today, settings);
  if (open.source === "entered" && open.amount !== null) {
    const mov = rowsOf(
      await db.execute(sql`
        select d::text as d, sum(v)::bigint as v from (
          select date as d, amount as v from invoice_payments where tenant_id = ${tenantId}::uuid and date >= ${from}::date and date <= ${today}::date
          union all select date, -(case when kind = 'payment' then amount else -amount end) from purchase_payments where tenant_id = ${tenantId}::uuid and reversed_at is null and date >= ${from}::date and date <= ${today}::date
          union all select date, -amount from expenses where tenant_id = ${tenantId}::uuid and status = 'recorded' and date >= ${from}::date and date <= ${today}::date
        ) x group by d`),
    );
    const net = new Map(mov.map((r) => [String(r.d), num(r.v)]));
    let bal = open.amount;
    let sum = 0;
    let n = 0;
    for (let d = today; d >= from; d = addDays(d, -1)) {
      sum += bal;
      n += 1;
      bal -= net.get(d) ?? 0;
    }
    averageBalance = n ? Math.round(sum / n) : null;
  }

  return {
    today,
    months,
    customers: top.map((r) => ({ name: String(r.name ?? "Customer"), total: num(r.total), bills: num(r.bills) })),
    receivables: { buckets: ageing.buckets, total: ageing.buckets.reduce((a, b) => a + b.amount, 0), customers: ageing.customers.length },
    payables: payables ? { total: payables.payable, overdue: payables.overdue } : null,
    stockValue,
    averageBalance,
    averageDailyCollections: Math.round(num(col?.v) / days),
    showNames,
  };
}
