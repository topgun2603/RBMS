import type { Db } from "@srirealtime/db";
import { sql } from "drizzle-orm";

/**
 * Purchase signals over paid orders (payment `paid` / `partially_refunded`, not cancelled or returned), for the store's
 * recommendations: the catalogue's `PurchaseStatsPort` (same shape; packages never import each other). Order lines
 * live in the `lines` jsonb, so both queries unnest it; `orders_tenant_placed_idx` bounds the scan to the window.
 */
export function orderPurchaseStats(db: Db) {
  const paid = sql`o.status not in ('cancelled', 'returned') and o.payment_status in ('paid', 'partially_refunded')`;
  const rows = (r: Iterable<{ product_id: string | null; orders: number | string }>) =>
    [...r].filter((x) => x.product_id).map((x) => ({ productId: x.product_id!, orders: Number(x.orders) }));
  return {
    /** Paid orders per product since `since`, most first. */
    async topProducts(tenantId: string, since: Date, limit: number) {
      const r = await db.execute<{ product_id: string | null; orders: number }>(sql`
        select l.value->>'productId' as product_id, count(distinct o.id)::int as orders
        from orders o cross join lateral jsonb_array_elements(o.lines) l
        where o.tenant_id = ${tenantId} and o.placed_at >= ${since.toISOString()}::timestamptz and ${paid}
        group by 1 order by 2 desc, 1 limit ${limit}`);
      return rows(r);
    },
    /** Products in the same paid orders as any of `productIds` (not those), by how many orders, most first. */
    async boughtWith(tenantId: string, productIds: string[], since: Date, limit: number) {
      if (!productIds.length) return [];
      const ids = sql.join(
        productIds.map((id) => sql`${id}`),
        sql`, `,
      );
      const r = await db.execute<{ product_id: string | null; orders: number }>(sql`
        select l.value->>'productId' as product_id, count(distinct o.id)::int as orders
        from orders o cross join lateral jsonb_array_elements(o.lines) l
        where o.tenant_id = ${tenantId} and o.placed_at >= ${since.toISOString()}::timestamptz and ${paid}
          and exists (select 1 from jsonb_array_elements(o.lines) a where a.value->>'productId' in (${ids}))
          and coalesce(l.value->>'productId', '') not in (${ids})
        group by 1 order by 2 desc, 1 limit ${limit}`);
      return rows(r);
    },
  };
}
