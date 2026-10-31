import { indianPhone, planAddDays, stem, type ReviewForReply, type SegCustomer, type SegmentSpec, type ThemeReview } from "@rbms/ai";
import { sql, type Db } from "@rbms/db";

/**
 * Customer segments for the campaign writer, the shop's busiest billing hour, and store reviews: SQL over the shop's own
 * tables. The AI never sees these rows; only the owner's browser does (the segment becomes the campaign audience).
 */

type Rows = Record<string, unknown>[];
const rowsOf = (r: unknown) => r as Rows;
const num = (v: unknown) => Number(v ?? 0);
const LIVE = sql`('issued','partially_paid','paid')`;

/** Billing customers with a phone, their visits and purchase match in the window, opt-outs and the last campaign message. */
export async function gatherSegment(db: Db, tenantId: string, spec: SegmentSpec, today: string): Promise<SegCustomer[]> {
  const since = planAddDays(today, -Math.round(spec.sinceMonths * 30.4));
  const patterns = [...new Set(spec.keywords.flatMap((k) => [k, stem(k)]))].map((k) => `%${k.replace(/[%_\\]/g, "")}%`);
  const match = patterns.length
    ? sql`bool_or(exists (select 1 from jsonb_array_elements(i.lines) l where ${sql.join(patterns.map((p) => sql`lower(l->>'description') like ${p}`), sql` or `)}))`
    : sql`false`;
  const rows = rowsOf(
    await db.execute(sql`
      select c.id::text as id, c.name, c.phone, count(distinct i.date)::int as visits, coalesce(${match}, false) as matched, max(i.date)::text as last_visit
      from billing_customers c
      left join invoices i on i.tenant_id = c.tenant_id and i.customer_id = c.id and i.status in ${LIVE} and i.date >= ${since}::date and i.date <= ${today}::date
      where c.tenant_id = ${tenantId}::uuid and c.deleted_at is null and c.phone is not null and c.phone <> ''
      group by c.id, c.name, c.phone
      limit 20000`),
  );
  const optedOut = new Set<string>();
  for (const r of rowsOf(await db.execute(sql`select phone from wa_contacts where tenant_id = ${tenantId}::uuid and opted_out_at is not null`))) {
    const p = indianPhone(String(r.phone)) ?? String(r.phone);
    optedOut.add(p);
  }
  const messaged = new Map<string, string>();
  for (const r of rowsOf(
    await db.execute(sql`
      select phone, max(sent_at)::text as at from wa_campaign_recipients
      where tenant_id = ${tenantId}::uuid and sent_at is not null and sent_at >= now() - interval '60 days' group by phone`),
  )) {
    messaged.set(indianPhone(String(r.phone)) ?? String(r.phone), String(r.at));
  }
  return rows.map((r) => {
    const phone = indianPhone(r.phone as string | null);
    return {
      id: String(r.id),
      name: String(r.name),
      phone: (r.phone as string | null) ?? null,
      visits: num(r.visits),
      matched: r.matched === true,
      lastVisit: (r.last_visit as string | null) ?? null,
      lastMessagedAt: phone ? (messaged.get(phone) ?? null) : null,
      optedOut: phone ? optedOut.has(phone) : false,
    };
  });
}

/** The IST hour with the most bills over the last 90 days; null when there are none. */
export async function peakHour(db: Db, tenantId: string): Promise<number | null> {
  const [r] = rowsOf(
    await db.execute(sql`
      select extract(hour from (issued_at at time zone 'Asia/Kolkata'))::int as h, count(*)::int as n
      from invoices
      where tenant_id = ${tenantId}::uuid and issued_at >= now() - interval '90 days' and status in ${LIVE}
      group by 1 order by n desc, h limit 1`),
  );
  return r ? num(r.h) : null;
}

export async function loadReview(db: Db, tenantId: string, id: string): Promise<(ReviewForReply & { id: string }) | null> {
  const [r] = rowsOf(
    await db.execute(sql`
      select r.id::text as id, r.rating, r.title, r.body, r.author_name, p.name as product_name
      from product_reviews r left join catalog_products p on p.id = r.product_id
      where r.tenant_id = ${tenantId}::uuid and r.id = ${id}::uuid`),
  );
  if (!r) return null;
  return { id: String(r.id), rating: num(r.rating), title: (r.title as string | null) ?? null, body: (r.body as string | null) ?? null, authorName: (r.author_name as string | null) ?? null, productName: (r.product_name as string | null) ?? null };
}

/** Reviews (not rejected) of the last `days` days as rating and text. */
export async function loadReviewTexts(db: Db, tenantId: string, days: number, productId?: string): Promise<ThemeReview[]> {
  const rows = rowsOf(
    await db.execute(sql`
      select rating, concat_ws(' ', title, body) as text
      from product_reviews
      where tenant_id = ${tenantId}::uuid and status <> 'rejected' and created_at >= now() - (${days}::int * interval '1 day')
        ${productId ? sql`and product_id = ${productId}::uuid` : sql``}
      order by created_at desc limit 5000`),
  );
  return rows.map((r) => ({ rating: num(r.rating), text: String(r.text ?? "") }));
}
