import { tradesC, indianPhone } from "@rbms/ai";
import { sql, type Db } from "@rbms/db";

/**
 * SQL behind Phase 3 part C (docs/ai.md): warranty lookups from the shop's own serial units and the people-with-history list
 * that "at risk" is computed from. Read-only, always scoped to one tenant. The AI never sees these rows.
 */

type Rows = Record<string, unknown>[];
const rowsOf = (r: unknown) => r as Rows;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

/** Units whose serial or IMEI 2 equals one of `serials` (already normalised: upper case, no spaces). */
export async function soldUnits(db: Db, tenantId: string, serials: string[]): Promise<tradesC.SoldUnit[]> {
  const list = [...new Set(serials.filter(Boolean))].slice(0, 6);
  if (list.length === 0) return [];
  const rows = rowsOf(
    await db.execute(sql`
      select serial, serial2, item_name, status, sold_on::text as sold_on, warranty_months
      from serial_units
      where tenant_id = ${tenantId}::uuid and (serial in (${sql.join(list.map((s) => sql`${s}`), sql`, `)}) or serial2 in (${sql.join(list.map((s) => sql`${s}`), sql`, `)}))
      limit 5`),
  );
  return rows.map((r) => ({ serial: String(r.serial), serial2: str(r.serial2), itemName: String(r.item_name), status: String(r.status), soldOn: str(r.sold_on), warrantyMonths: Number(r.warranty_months ?? 0) }));
}

const key = (phone: string | null | undefined) => indianPhone(phone) ?? (phone ? phone.replace(/\D/g, "") : null);

export interface PeopleFlags {
  memberships: boolean;
  bookings: boolean;
}

/** Members (with their newest plan and check-ins) and booking clients (completed appointments) with the opt-out flag. */
export async function peopleHistories(db: Db, tenantId: string, flags: PeopleFlags): Promise<tradesC.PersonHistory[]> {
  const people = new Map<string, tradesC.PersonHistory>();
  const byPhone = new Map<string, string>();
  const visitsOf = new Map<string, Set<string>>();
  const servicesOf = new Map<string, Map<string, number>>();
  const addVisit = (k: string, d: string) => {
    let s = visitsOf.get(k);
    if (!s) visitsOf.set(k, (s = new Set()));
    s.add(d);
  };
  const addService = (k: string, name: string) => {
    let m = servicesOf.get(k);
    if (!m) servicesOf.set(k, (m = new Map()));
    m.set(name, (m.get(name) ?? 0) + 1);
  };

  if (flags.memberships) {
    const members = rowsOf(
      await db.execute(sql`
        select m.id::text as id, m.name, m.phone, s.plan_name, s.start_date::text as start_date, s.end_date::text as end_date, s.status
        from membership_members m
        left join lateral (
          select plan_name, start_date, end_date, status from membership_subscriptions s
          where s.tenant_id = m.tenant_id and s.member_id = m.id and s.status <> 'cancelled'
          order by s.end_date desc limit 1
        ) s on true
        where m.tenant_id = ${tenantId}::uuid
        limit 20000`),
    );
    for (const r of members) {
      const k = `m:${r.id}`;
      const phone = str(r.phone);
      people.set(k, {
        key: k,
        name: String(r.name),
        phone,
        kind: "member",
        plan: r.plan_name ? { name: String(r.plan_name), start: String(r.start_date), end: String(r.end_date), status: String(r.status) as "active" | "frozen" | "cancelled" } : null,
        renewed: false,
        visits: [],
        services: [],
        optedOut: false,
      });
      const pk = key(phone);
      if (pk) byPhone.set(pk, k);
    }
    for (const r of rowsOf(
      await db.execute(sql`
        select member_id::text as member_id, (("at" at time zone 'Asia/Kolkata')::date)::text as d
        from membership_checkins
        where tenant_id = ${tenantId}::uuid and "at" >= now() - interval '400 days'
        limit 200000`),
    )) {
      addVisit(`m:${r.member_id}`, String(r.d));
    }
  }

  if (flags.bookings) {
    const appts = rowsOf(
      await db.execute(sql`
        select id::text as id, customer_name, customer_phone, business_date::text as d
        from booking_appointments
        where tenant_id = ${tenantId}::uuid and status = 'completed' and customer_phone is not null and customer_phone <> ''
          and business_date >= (now() at time zone 'Asia/Kolkata')::date - 400
        order by business_date
        limit 100000`),
    );
    const owner = new Map<string, string>();
    for (const a of appts) {
      const pk = key(str(a.customer_phone));
      if (!pk) continue;
      let k = byPhone.get(pk);
      if (!k) {
        k = `p:${pk}`;
        byPhone.set(pk, k);
      }
      if (!people.has(k)) people.set(k, { key: k, name: String(a.customer_name), phone: str(a.customer_phone), kind: "client", plan: null, renewed: false, visits: [], services: [], optedOut: false });
      else if (k.startsWith("p:")) people.get(k)!.name = String(a.customer_name);
      addVisit(k, String(a.d));
      owner.set(String(a.id), k);
    }
    const ids = [...owner.keys()];
    for (let i = 0; i < ids.length; i += 5000) {
      const chunk = ids.slice(i, i + 5000);
      for (const it of rowsOf(
        await db.execute(sql`select appointment_id::text as aid, name from booking_appointment_items where tenant_id = ${tenantId}::uuid and appointment_id in (${sql.join(chunk.map((x) => sql`${x}::uuid`), sql`, `)})`),
      )) {
        const k = owner.get(String(it.aid));
        if (k) addService(k, String(it.name));
      }
    }
  }

  const optedOut = new Set<string>();
  for (const r of rowsOf(await db.execute(sql`select phone from wa_contacts where tenant_id = ${tenantId}::uuid and opted_out_at is not null`).catch(() => []))) {
    const k = key(str(r.phone));
    if (k) optedOut.add(k);
  }
  const out: tradesC.PersonHistory[] = [];
  for (const [k, p] of people) {
    const pk = key(p.phone);
    out.push({
      ...p,
      visits: [...(visitsOf.get(k) ?? [])],
      services: [...(servicesOf.get(k) ?? new Map()).entries()].map(([name, count]) => ({ name, count })),
      optedOut: pk ? optedOut.has(pk) : false,
    });
  }
  return out;
}

/** Last campaign message time per phone key (for "messaged 3 days ago"), last 30 days. */
export async function recentlyMessaged(db: Db, tenantId: string): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  for (const r of rowsOf(
    await db
      .execute(sql`select phone, max(sent_at)::text as at from wa_campaign_recipients where tenant_id = ${tenantId}::uuid and sent_at is not null and sent_at >= now() - interval '30 days' group by phone`)
      .catch(() => []),
  )) {
    const k = key(str(r.phone));
    if (k) m.set(k, String(r.at));
  }
  return m;
}
export const phoneKey = key;
