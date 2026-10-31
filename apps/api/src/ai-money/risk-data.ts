import type { aiMoney } from "@rbms/ai";
import { sql, type Db } from "@rbms/db";

type RiskBill = aiMoney.RiskBill;
type RiskSubject = aiMoney.RiskSubject;

/**
 * The bills and payments behind each credit customer's risk score: SQL over the shop's own invoices. Only money and dates
 * are read for scoring (the name goes to the screen, never into the score). Bills from imports are left out: they carry no
 * payment history. Money is paise.
 */

type Rows = Record<string, unknown>[];
const rowsOf = (r: unknown) => r as Rows;
const num = (v: unknown) => Number(v ?? 0);
const LIVE = sql`('issued','partially_paid','paid')`;

/** How far back bills are read (older bills only when still open). */
export const RISK_WINDOW_DAYS = 400;

export async function gatherRisk(db: Db, tenantId: string, today: string, customerId?: string): Promise<RiskSubject[]> {
  const only = customerId ? sql`and i.customer_id = ${customerId}::uuid` : sql``;
  const bills = rowsOf(
    await db.execute(sql`
      select i.customer_id::text as customer_id, i.id::text as id, i.date::text as date, i.due_date::text as due_date,
             i.total::bigint as total, i.credited::bigint as credited,
             coalesce((select jsonb_agg(jsonb_build_object('date', p.date::text, 'amount', p.amount) order by p.date)
                       from invoice_payments p where p.tenant_id = i.tenant_id and p.invoice_id = i.id and p.amount > 0 and p.source <> 'refund'), '[]'::jsonb) as payments
      from invoices i
      where i.tenant_id = ${tenantId}::uuid and i.customer_id is not null and i.status in ${LIVE} and i.imported = false
        and i.date <= ${today}::date ${only}
        and (i.date >= (${today}::date - ${RISK_WINDOW_DAYS}::int) or i.total - i.paid - i.credited > 0)`),
  );
  const byCustomer = new Map<string, RiskBill[]>();
  for (const b of bills) {
    const id = String(b.customer_id);
    const list = byCustomer.get(id) ?? [];
    list.push({
      id: String(b.id),
      date: String(b.date),
      dueDate: b.due_date ? String(b.due_date) : null,
      total: num(b.total),
      credited: num(b.credited),
      payments: ((b.payments as { date: string; amount: number }[]) ?? []).map((p) => ({ date: String(p.date), amount: num(p.amount) })),
    });
    byCustomer.set(id, list);
  }
  if (!byCustomer.size) return [];
  const ids = [...byCustomer.keys()];
  const customers = rowsOf(
    await db.execute(sql`
      select id::text as id, name, credit_limit::bigint as credit_limit
      from billing_customers
      where tenant_id = ${tenantId}::uuid and deleted_at is null and id in (${sql.join(ids.map((x) => sql`${x}::uuid`), sql`, `)})`),
  );
  return customers.map((c) => ({
    customerId: String(c.id),
    name: String(c.name),
    input: {
      today,
      bills: byCustomer.get(String(c.id)) ?? [],
      creditLimit: c.credit_limit === null || c.credit_limit === undefined ? null : num(c.credit_limit),
      // The opening balance (owed before the shop started on the app) is not counted: receipts may already have settled it.
      openingBalance: 0,
      // Cheque bounces: the accounting cheque register is not read here yet (see docs/ai.md, Phase 5 part B limits).
      chequeBounces: null,
    },
  }));
}
