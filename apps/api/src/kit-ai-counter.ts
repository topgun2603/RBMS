import { aiCounter, PLAN_FESTIVALS, type AiService, type AiSettings } from "@srirealtime/ai";
import { sql, type Db } from "@srirealtime/db";
import { posCatalogPort } from "./kit-pos";

/**
 * AI Phase 5 part A wiring (docs/ai.md "Phase 5 part A"): the SQL behind voice billing's item list, the unusual-activity alerts,
 * staff coaching and shift planning (all read-only over bills, till sessions, credit notes and counter events), and the module.
 *
 * Who a bill belongs to: bills carry no creator, so a bill is counted for the person who OPENED the till session it was rung on
 * (`till_sessions.opened_by`, else the name typed at opening). Bills with no till are left out of every per-person figure.
 */

type Row = Record<string, unknown>;
const rows = <T = Row>(r: unknown) => r as unknown as T[];
const IST = sql.raw("'Asia/Kolkata'");

export interface AiCounterKitDeps {
  db: Db;
  ai: AiService;
  aiSettings: { get(scope: { tenantId: string }): Promise<unknown>; setTenant(tenantId: string, patch: never): Promise<unknown> };
  log: { warn(o: object, m?: string): void };
  now?: () => Date;
}

const istToday = (d: Date) => new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The person a till session belongs to, as SQL: the member id if there is one, else the typed name. */
const STAFF_KEY = sql.raw("coalesce(ts.opened_by::text, 'n:' || lower(coalesce(nullif(ts.opened_by_name, ''), '?')))");
const STAFF_NAME = sql.raw("coalesce(nullif(nullif(ts.opened_by_name, ''), '—'), 'Staff')");

export function createAiCounterKit(deps: AiCounterKitDeps) {
  const db = deps.db;
  const now = deps.now ?? (() => new Date());
  const readAi = async (tenantId: string) => (await deps.aiSettings.get({ tenantId })) as AiSettings;

  // ------------------------------------------------------------------ the item list for voice billing (cached a minute)
  const catalog = posCatalogPort(db, async () => false);
  const cache = new Map<string, { at: number; index: aiCounter.CounterIndex }>();
  const popCache = new Map<string, { at: number; map: Map<string, number> }>();

  async function popularity(tenantId: string): Promise<Map<string, number>> {
    const hit = popCache.get(tenantId);
    if (hit && Date.now() - hit.at < 300_000) return hit.map;
    const from = addDays(istToday(now()), -90);
    const r = rows<{ id: string; q: string }>(
      await db.execute(sql`
        select l->>'itemId' as id, sum(coalesce((l->>'qty')::numeric, 0))::text as q
        from invoices i, jsonb_array_elements(i.lines) l
        where i.tenant_id = ${tenantId}::uuid and i.date >= ${from}::date and i.status not in ('draft', 'cancelled') and l->>'itemId' ~ '^[0-9a-f-]{36}$'
        group by 1`),
    );
    const map = new Map(r.map((x) => [x.id, Number(x.q)]));
    popCache.set(tenantId, { at: Date.now(), map });
    return map;
  }

  async function loadIndex(tenantId: string): Promise<aiCounter.CounterIndex> {
    const hit = cache.get(tenantId);
    if (hit && Date.now() - hit.at < 60_000) return hit.index;
    const items: aiCounter.CounterItem[] = [];
    let after: string | null = null;
    for (let page = 0; page < 20; page++) {
      const batch = await catalog.rows(tenantId, { since: null, afterId: after, limit: 1000 });
      for (const r of batch) {
        if (!r.item) continue;
        const i = r.item;
        items.push({
          itemId: i.itemId,
          productId: i.productId,
          name: i.name,
          sku: i.sku,
          barcodes: i.barcodes,
          unit: i.unit || (i.soldBy === "weight" ? "kg" : "pcs"),
          soldBy: i.soldBy,
          price: i.price,
          taxInclusive: i.taxInclusive,
          gstRate: i.gstRate,
          gstRule: i.gstRule,
          hsn: i.hsn,
          image: i.image,
        });
      }
      if (batch.length < 1000) break;
      after = batch[batch.length - 1]!.id;
    }
    const [aliasRows, taRows, pop] = await Promise.all([
      db.execute(sql`select product_id::text as pid, aliases from ai_product_aliases where tenant_id = ${tenantId}::uuid`).then((r) => rows<{ pid: string; aliases: string[] | null }>(r)),
      db.execute(sql`select product_id::text as pid, name from ai_product_translations where tenant_id = ${tenantId}::uuid and status = 'approved' and name is not null`).then((r) => rows<{ pid: string; name: string }>(r)).catch(() => [] as { pid: string; name: string }[]),
      popularity(tenantId).catch(() => new Map<string, number>()),
    ]);
    const aliases = new Map(aliasRows.map((a) => [a.pid, a.aliases ?? []]));
    const ta = new Map(taRows.map((t) => [t.pid, t.name]));
    for (const it of items) {
      if (it.productId) {
        it.aliases = aliases.get(it.productId);
        it.nameTa = ta.get(it.productId) ?? null;
      }
      it.popularity = pop.get(it.itemId) ?? 0;
    }
    const index = aiCounter.buildCounterIndex(items);
    cache.set(tenantId, { at: Date.now(), index });
    return index;
  }

  // ------------------------------------------------------------------ facts for the alerts
  // a minute of cache: the page, its drill-downs and the daily summary ask often and the answer moves slowly
  const factsCache = new Map<string, { at: number; today: string; v: Promise<aiCounter.CounterFacts> }>();
  function facts(tenantId: string, today: string): Promise<aiCounter.CounterFacts> {
    const hit = factsCache.get(tenantId);
    if (hit && hit.today === today && Date.now() - hit.at < 60_000) return hit.v;
    const v = computeFacts(tenantId, today);
    factsCache.set(tenantId, { at: Date.now(), today, v });
    v.catch(() => factsCache.delete(tenantId));
    return v;
  }
  async function computeFacts(tenantId: string, today: string): Promise<aiCounter.CounterFacts> {
    const from = addDays(today, -67);
    const T = sql`${tenantId}::uuid`;
    const [billRows, voidRows, returnRows, noSaleRows, editRows, tillRows] = await Promise.all([
      db
        .execute(sql`
          select ${STAFF_KEY} as staff, max(${STAFF_NAME}) as name, i.date::text as date,
                 count(*)::int as bills,
                 count(*) filter (where i.status <> 'cancelled' and coalesce((i.totals->>'discount')::bigint, 0) > 0)::int as discounted,
                 coalesce(sum(coalesce((i.totals->>'discount')::bigint, 0)) filter (where i.status <> 'cancelled'), 0)::bigint as discount_amount,
                 coalesce(sum(coalesce((i.totals->>'subtotal')::bigint, 0)) filter (where i.status <> 'cancelled'), 0)::bigint as gross,
                 count(*) filter (where i.status <> 'cancelled' and coalesce((i.totals->>'discount')::bigint, 0) > 0 and extract(hour from i.issued_at at time zone ${IST}) >= 21)::int as late
          from invoices i join till_sessions ts on ts.id = i.till_session_id and ts.tenant_id = i.tenant_id
          where i.tenant_id = ${T} and i.date >= ${from}::date and i.date <= ${today}::date and i.status <> 'draft'
          group by 1, 3`)
        .then(rows<{ staff: string; name: string; date: string; bills: number; discounted: number; discount_amount: string; gross: string; late: number }>),
      db
        .execute(sql`
          select ${STAFF_KEY} as staff, max(${STAFF_NAME}) as name, (i.cancelled_at at time zone ${IST})::date::text as date, count(*)::int as n
          from invoices i join till_sessions ts on ts.id = i.till_session_id and ts.tenant_id = i.tenant_id
          where i.tenant_id = ${T} and i.status = 'cancelled' and i.cancelled_at is not null and i.cancelled_at >= ${from}::date
          group by 1, 3`)
        .then(rows<{ staff: string; name: string; date: string; n: number }>),
      db
        .execute(sql`
          select ${STAFF_KEY} as staff, max(${STAFF_NAME}) as name, c.date::text as date, count(*)::int as n, coalesce(sum(c.total), 0)::bigint as amount
          from credit_notes c join till_sessions ts on ts.id = c.till_session_id and ts.tenant_id = c.tenant_id
          where c.tenant_id = ${T} and c.date >= ${from}::date and c.date <= ${today}::date and c.status = 'issued' and c.cancelled_at is null
          group by 1, 3`)
        .then(rows<{ staff: string; name: string; date: string; n: number; amount: string }>),
      db
        .execute(sql`
          select ${STAFF_KEY} as staff, max(${STAFF_NAME}) as name, (e.at at time zone ${IST})::date::text as date, count(*)::int as n
          from ai_counter_events e join till_sessions ts on ts.id::text = e.till_session_id and ts.tenant_id = e.tenant_id
          where e.tenant_id = ${T} and e.kind = 'no_sale' and e.at >= ${from}::date
          group by 1, 3`)
        .then(rows<{ staff: string; name: string; date: string; n: number }>)
        .catch(() => [] as { staff: string; name: string; date: string; n: number }[]),
      db
        .execute(sql`
          select ${STAFF_KEY} as staff, max(${STAFF_NAME}) as name, i.date::text as date, count(*)::int as n
          from invoices i
          join till_sessions ts on ts.id = i.till_session_id and ts.tenant_id = i.tenant_id
          cross join lateral jsonb_array_elements(i.lines) l
          join catalog_variants v on v.tenant_id = i.tenant_id and l->>'itemId' ~ '^[0-9a-f-]{36}$' and v.id = (l->>'itemId')::uuid
          join catalog_products p on p.id = v.product_id
          where i.tenant_id = ${T} and i.date >= ${addDays(today, -30)}::date and i.date <= ${today}::date and i.status not in ('draft', 'cancelled')
            and not p.tax_inclusive and v.price > 0 and abs(coalesce((l->>'rate')::numeric, v.price) - v.price) > v.price * 0.02
          group by 1, 3`)
        .then(rows<{ staff: string; name: string; date: string; n: number }>)
        .catch(() => [] as { staff: string; name: string; date: string; n: number }[]),
      db
        .execute(sql`
          select ts.id::text as id, ${STAFF_KEY} as staff, ${STAFF_NAME} as name, ts.register, ts.date::text as date, ts.difference
          from till_sessions ts
          where ts.tenant_id = ${T} and ts.status = 'closed' and ts.difference is not null and ts.date >= ${from}::date and ts.date <= ${today}::date`)
        .then(rows<{ id: string; staff: string; name: string; register: string; date: string; difference: number }>),
    ]);

    const map = new Map<string, aiCounter.StaffDay>();
    const at = (staff: string, name: string, date: string) => {
      const k = `${staff}|${date}`;
      let d = map.get(k);
      if (!d) {
        d = { staff, name, date, bills: 0, voids: 0, returns: 0, returnAmount: 0, discountedBills: 0, discountAmount: 0, grossAmount: 0, lateDiscounts: 0, noSales: 0, priceEdits: 0 };
        map.set(k, d);
      }
      return d;
    };
    for (const r of billRows) {
      const d = at(r.staff, r.name, r.date);
      d.bills = r.bills;
      d.discountedBills = r.discounted;
      d.discountAmount = Number(r.discount_amount);
      d.grossAmount = Number(r.gross);
      d.lateDiscounts = r.late;
    }
    for (const r of voidRows) at(r.staff, r.name, r.date).voids = r.n;
    for (const r of returnRows) {
      const d = at(r.staff, r.name, r.date);
      d.returns = r.n;
      d.returnAmount = Number(r.amount);
    }
    for (const r of noSaleRows) at(r.staff, r.name, r.date).noSales = r.n;
    for (const r of editRows) at(r.staff, r.name, r.date).priceEdits = r.n;
    return {
      today,
      days: [...map.values()],
      tills: tillRows.map((t) => ({ sessionId: t.id, staff: t.staff, name: t.name, register: t.register, date: t.date, difference: Number(t.difference) })),
    };
  }

  // ------------------------------------------------------------------ drill-down
  async function drill(tenantId: string, ref: aiCounter.DrillRef): Promise<aiCounter.DrillRow[]> {
    const T = sql`${tenantId}::uuid`;
    const from = ref.days ? addDays(ref.date, -(ref.days - 1)) : ref.date;
    const person = sql`${STAFF_KEY} = ${ref.staff}`;
    const toRow = (r: Row, reason: string | null = null): aiCounter.DrillRow => ({
      id: String(r.id),
      number: (r.number as string | null) ?? null,
      at: new Date(String(r.at)).toISOString(),
      total: Number(r.total ?? 0),
      discount: Number(r.discount ?? 0),
      reason: (r.reason as string | null) ?? reason,
      label: (r.label as string | null) ?? null,
    });
    const bills = (extra: ReturnType<typeof sql>) =>
      db
        .execute(sql`
          select i.id::text as id, i.number, coalesce(i.issued_at, i.created_at) as at, i.total, coalesce((i.totals->>'discount')::bigint, 0) as discount, i.cancel_reason as reason, i.customer->>'name' as label
          from invoices i join till_sessions ts on ts.id = i.till_session_id and ts.tenant_id = i.tenant_id
          where i.tenant_id = ${T} and ${person} and ${extra}
          order by 3 desc limit 100`)
        .then((r) => rows(r).map((x) => toRow(x)));
    switch (ref.kind) {
      case "voids":
        return bills(sql`i.status = 'cancelled' and (i.cancelled_at at time zone ${IST})::date between ${from}::date and ${ref.date}::date`);
      case "discounts":
        return bills(sql`i.status not in ('draft', 'cancelled') and i.date between ${from}::date and ${ref.date}::date and coalesce((i.totals->>'discount')::bigint, 0) > 0`);
      case "late_discounts":
        return bills(sql`i.status not in ('draft', 'cancelled') and i.date between ${from}::date and ${ref.date}::date and coalesce((i.totals->>'discount')::bigint, 0) > 0 and extract(hour from i.issued_at at time zone ${IST}) >= 21`);
      case "price_edits":
        return bills(sql`i.status not in ('draft', 'cancelled') and i.date = ${ref.date}::date and exists (
          select 1 from jsonb_array_elements(i.lines) l join catalog_variants v on v.tenant_id = i.tenant_id and l->>'itemId' ~ '^[0-9a-f-]{36}$' and v.id = (l->>'itemId')::uuid
          join catalog_products p on p.id = v.product_id where not p.tax_inclusive and v.price > 0 and abs(coalesce((l->>'rate')::numeric, v.price) - v.price) > v.price * 0.02)`);
      case "returns":
        return db
          .execute(sql`
            select c.id::text as id, c.number, c.issued_at as at, c.total, 0 as discount, c.reason, c.invoice_number as label
            from credit_notes c join till_sessions ts on ts.id = c.till_session_id and ts.tenant_id = c.tenant_id
            where c.tenant_id = ${T} and ${person} and c.date between ${from}::date and ${ref.date}::date and c.status = 'issued' and c.cancelled_at is null
            order by 3 desc limit 100`)
          .then((r) => rows(r).map((x) => toRow(x)));
      case "no_sale":
        return db
          .execute(sql`
            select e.id::text as id, null as number, e.at as at, 0 as total, 0 as discount, null as reason, e.user_name as label
            from ai_counter_events e join till_sessions ts on ts.id::text = e.till_session_id and ts.tenant_id = e.tenant_id
            where e.tenant_id = ${T} and ${person} and (e.at at time zone ${IST})::date = ${ref.date}::date and e.kind = 'no_sale'
            order by 3 desc limit 100`)
          .then((r) => rows(r).map((x) => toRow(x)));
      case "till":
        return db
          .execute(sql`
            select ts.id::text as id, ts.register as number, coalesce(ts.closed_at, ts.opened_at) as at, coalesce(ts.difference, 0) as total, 0 as discount, ts.note as reason,
                   'expected ' || coalesce(ts.expected_cash, 0)::text || ' counted ' || coalesce(ts.counted_cash, 0)::text as label
            from till_sessions ts
            where ts.tenant_id = ${T} and ${ref.sessionId ? sql`ts.id = ${ref.sessionId}::uuid` : sql`${person} and ts.date = ${ref.date}::date`}
            order by 3 desc limit 20`)
          .then((r) => rows(r).map((x) => toRow(x)));
    }
  }

  // ------------------------------------------------------------------ coaching weeks
  async function week(tenantId: string, weekStart: string) {
    const T = sql`${tenantId}::uuid`;
    const load = async (start: string): Promise<aiCounter.StaffWeek[]> => {
      const end = addDays(start, 6);
      const [base, hours, rets] = await Promise.all([
        db
          .execute(sql`
            select ${STAFF_KEY} as staff, max(${STAFF_NAME}) as name,
                   count(*)::int as bills,
                   coalesce(sum(i.total) filter (where i.status <> 'cancelled'), 0)::bigint as amount,
                   coalesce(sum(jsonb_array_length(i.lines)) filter (where i.status <> 'cancelled'), 0)::int as lines,
                   count(*) filter (where i.status = 'cancelled')::int as voids,
                   coalesce(sum(coalesce((i.totals->>'discount')::bigint, 0)) filter (where i.status <> 'cancelled'), 0)::bigint as discount,
                   coalesce(sum(coalesce((i.totals->>'subtotal')::bigint, 0)) filter (where i.status <> 'cancelled'), 0)::bigint as gross,
                   count(distinct i.date)::int as days
            from invoices i join till_sessions ts on ts.id = i.till_session_id and ts.tenant_id = i.tenant_id
            where i.tenant_id = ${T} and i.date between ${start}::date and ${end}::date and i.status <> 'draft'
            group by 1`)
          .then(rows<{ staff: string; name: string; bills: number; amount: string; lines: number; voids: number; discount: string; gross: string; days: number }>),
        db
          .execute(sql`
            select ${STAFF_KEY} as staff, extract(hour from i.issued_at at time zone ${IST})::int as h, count(*)::int as n
            from invoices i join till_sessions ts on ts.id = i.till_session_id and ts.tenant_id = i.tenant_id
            where i.tenant_id = ${T} and i.date between ${start}::date and ${end}::date and i.status <> 'draft'
            group by 1, 2`)
          .then(rows<{ staff: string; h: number; n: number }>),
        db
          .execute(sql`
            select ${STAFF_KEY} as staff, count(*)::int as n
            from credit_notes c join till_sessions ts on ts.id = c.till_session_id and ts.tenant_id = c.tenant_id
            where c.tenant_id = ${T} and c.date between ${start}::date and ${end}::date and c.status = 'issued' and c.cancelled_at is null
            group by 1`)
          .then(rows<{ staff: string; n: number }>),
      ]);
      const hb = new Map<string, number[]>();
      for (const h of hours) {
        const a = hb.get(h.staff) ?? Array<number>(24).fill(0);
        if (h.h >= 0 && h.h < 24) a[h.h] = h.n;
        hb.set(h.staff, a);
      }
      const rb = new Map(rets.map((r) => [r.staff, r.n]));
      return base.map((b) => ({
        staff: b.staff,
        name: b.name,
        bills: b.bills,
        amount: Number(b.amount),
        lines: b.lines,
        voids: b.voids,
        returns: rb.get(b.staff) ?? 0,
        discountAmount: Number(b.discount),
        grossAmount: Number(b.gross),
        hourBills: hb.get(b.staff) ?? Array<number>(24).fill(0),
        daysWorked: b.days,
      }));
    };
    const [people, previous] = await Promise.all([load(weekStart), load(addDays(weekStart, -7))]);
    return { people, previous };
  }

  // ------------------------------------------------------------------ hours for shift planning
  async function hours(tenantId: string, from: string, to: string): Promise<aiCounter.HourRow[]> {
    const r = rows<{ date: string; h: number; bills: number; staff: number }>(
      await db.execute(sql`
        select i.date::text as date, extract(hour from i.issued_at at time zone ${IST})::int as h, count(*)::int as bills,
               count(distinct coalesce(i.till_session_id::text, 'none'))::int as staff
        from invoices i
        where i.tenant_id = ${tenantId}::uuid and i.date between ${from}::date and ${to}::date and i.status <> 'draft' and i.issued_at is not null
        group by 1, 2`),
    );
    // "staff" here counts till sessions open in the hour (one person per till), the closest thing to people at the counter
    return r.map((x) => ({ date: x.date, hour: x.h, bills: x.bills, staff: Math.max(1, x.staff) }));
  }

  async function festivalRatio(tenantId: string, f: { id: string; date: string }): Promise<number | null> {
    const last = PLAN_FESTIVALS.find((x) => x.id === f.id && x.year === Number(f.date.slice(0, 4)) - 1);
    if (!last) return null;
    const winStart = addDays(last.date, -last.leadDays);
    const winEnd = addDays(last.date, -1);
    const baseStart = addDays(winStart, -28);
    const r = rows<{ date: string; n: number }>(
      await db.execute(sql`select date::text as date, count(*)::int as n from invoices where tenant_id = ${tenantId}::uuid and date between ${baseStart}::date and ${winEnd}::date and status <> 'draft' group by 1`),
    );
    const inWin = r.filter((x) => x.date >= winStart && x.date <= winEnd);
    const base = r.filter((x) => x.date < winStart);
    if (inWin.length < Math.max(3, Math.floor(last.leadDays / 2)) || base.length < 14) return null;
    const a = inWin.reduce((s, x) => s + x.n, 0) / inWin.length;
    const b = base.reduce((s, x) => s + x.n, 0) / base.length;
    return b > 0 ? a / b : null;
  }

  const ports: aiCounter.CounterPorts = {
    catalogue: loadIndex,
    facts,
    drill,
    week,
    hours,
    festivalRatio: (tenantId, f) => festivalRatio(tenantId, f),
    async currentTill(tenantId, userId) {
      const r = rows<{ id: string }>(
        await db.execute(sql`select id::text as id from till_sessions where tenant_id = ${tenantId}::uuid and status = 'open' order by (opened_by::text = ${userId ?? ''}) desc, opened_at desc limit 1`),
      );
      return r[0]?.id ?? null;
    },
    async userName(_tenantId, userId) {
      const r = rows<{ name: string | null; email: string | null }>(await db.execute(sql`select name, email from users where id = ${userId}::uuid`));
      return r[0]?.name || r[0]?.email || null;
    },
    async settings(tenantId) {
      const c = (await readAi(tenantId)).counter ?? {};
      return { billsPerStaffHour: c.billsPerStaffHour, alertsInSummary: c.alertsInSummary === true };
    },
    async saveSettings(tenantId, patch) {
      const cur = (await readAi(tenantId)).counter ?? {};
      const next: { billsPerStaffHour?: number; alertsInSummary?: boolean } = { ...cur };
      if (patch.billsPerStaffHour === null) delete next.billsPerStaffHour;
      else if (patch.billsPerStaffHour !== undefined) next.billsPerStaffHour = patch.billsPerStaffHour;
      if (patch.alertsInSummary !== undefined) next.alertsInSummary = patch.alertsInSummary;
      await deps.aiSettings.setTenant(tenantId, { counter: next } as never);
    },
  };

  const counter = aiCounter.createAiCounter({ db, ai: deps.ai, ports, now });
  return {
    ...counter,
    /** The top unusual-activity lines for the Phase 2 daily summary of `date`, when the owner switched that on. Never throws. */
    async summaryExtras(tenantId: string, date: string): Promise<{ en: string; ta: string }[]> {
      try {
        const st = await ports.settings(tenantId);
        if (!st.alertsInSummary) return [];
        if (!(await deps.ai.helperOn(tenantId, aiCounter.ALERTS_FEATURE))) return [];
        const alerts = await counter.service.alertsForDay(tenantId, date);
        return alerts.filter((a) => a.severity !== "info").slice(0, 3).map((a) => ({ en: a.title.en, ta: a.title.ta }));
      } catch (e) {
        deps.log.warn({ err: e instanceof Error ? e.message : String(e), tenantId }, "ai counter: summary extras failed");
        return [];
      }
    },
    /** Test hook: forget the cached item lists. */
    clearCache: () => {
      cache.clear();
      popCache.clear();
    },
  };
}
