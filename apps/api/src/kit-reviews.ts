import { catalogProducts, catalogVariants } from "@rbms/catalogue";
import { and, eq, inArray, isNull, sql, type Db } from "@rbms/db";
import { orders } from "@rbms/orders";
import type { LinkedOrder, ReviewRequestResult, ReviewRequestsPort } from "@rbms/reviews";
import { CUSTOMER_TEXT, type CustomerMessages } from "@rbms/notify";

/**
 * Review ports that read other modules' tables (kept out of kit.ts): SKU / slug lookup for CSV imports, the order a
 * staff member links to a review, and "Ask for a review" messages.
 */

/** Lowercased SKU or slug → product id (non-deleted products and variants of this shop). */
export async function resolveReviewProducts(db: Db, tenantId: string, keys: string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(keys.map((k) => k.trim().toLowerCase()).filter(Boolean))];
  const out = new Map<string, string>();
  for (let i = 0; i < wanted.length; i += 500) {
    const chunk = wanted.slice(i, i + 500);
    const [bySlug, bySku] = await Promise.all([
      db
        .select({ id: catalogProducts.id, key: sql<string>`lower(${catalogProducts.slug})` })
        .from(catalogProducts)
        .where(and(eq(catalogProducts.tenantId, tenantId), isNull(catalogProducts.deletedAt), inArray(sql`lower(${catalogProducts.slug})`, chunk))),
      db
        .select({ id: catalogVariants.productId, key: sql<string>`lower(${catalogVariants.sku})` })
        .from(catalogVariants)
        .innerJoin(catalogProducts, and(eq(catalogProducts.id, catalogVariants.productId), isNull(catalogProducts.deletedAt)))
        .where(and(eq(catalogVariants.tenantId, tenantId), isNull(catalogVariants.deletedAt), inArray(sql`lower(${catalogVariants.sku})`, chunk))),
    ]);
    // A SKU names one variant of one product; slugs win when a key is both.
    for (const r of bySku) out.set(r.key, r.id);
    for (const r of bySlug) out.set(r.key, r.id);
  }
  return out;
}

/** The order with this number (case and spaces ignored), whether it is delivered and has the product. */
export async function findOrderForReview(db: Db, tenantId: string, orderNumber: string, productId: string): Promise<LinkedOrder | null> {
  const n = orderNumber.trim().toLowerCase().replace(/\s+/g, "");
  if (!n) return null;
  const [row] = await db
    .select({ id: orders.id, status: orders.status, lines: orders.lines })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), sql`lower(replace(${orders.number}, ' ', '')) = ${n}`))
    .limit(1);
  if (!row) return null;
  return { orderId: row.id, delivered: row.status === "delivered", hasProduct: (row.lines ?? []).some((l) => l.productId === productId) };
}

/**
 * "Ask for a review": the `review.request` customer message (WhatsApp / SMS / email per the shop's messages
 * settings, once per order) with a link to the product's review form (one product) or the customer's order page.
 */
export function reviewRequestsPort(d: {
  db: Db;
  messages: CustomerMessages;
  storeUrl: (tenantId: string) => Promise<string>;
  productSlugs: (tenantId: string, ids: string[]) => Promise<Map<string, string>>;
}): ReviewRequestsPort {
  return {
    async send(tenantId, orderId): Promise<ReviewRequestResult> {
      const [o] = await d.db
        .select({ number: orders.number, status: orders.status, customer: orders.customer, lines: orders.lines, accessToken: orders.accessToken })
        .from(orders)
        .where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId)))
        .limit(1);
      if (!o) return { status: "skipped", reason: "not_found", channels: [] };
      if (o.status !== "delivered") return { status: "skipped", reason: "not_delivered", channels: [] };
      const base = (await d.storeUrl(tenantId).catch(() => "")).replace(/\/+$/, "");
      const productIds = [...new Set((o.lines ?? []).map((l) => l.productId).filter(Boolean))];
      const slugs = productIds.length === 1 ? await d.productSlugs(tenantId, productIds) : new Map<string, string>();
      const slug = productIds.length === 1 ? slugs.get(productIds[0]!) : undefined;
      const link = slug ? `${base}/p/${encodeURIComponent(slug)}?review=1#reviews` : `${base}/order/${o.accessToken}`;
      const results = await d.messages.send({
        tenantId,
        event: "review.request",
        ref: o.number,
        to: { phone: o.customer?.phone ?? null, email: o.customer?.email ?? null },
        locale: o.customer?.locale ?? null,
        vars: ({ locale }) => ({ customer: o.customer?.name?.trim() || CUSTOMER_TEXT[locale].customer, number: o.number, link }),
      });
      const sent = results.filter((r) => r.status === "sent" || r.status === "queued");
      if (sent.length) return { status: "sent", channels: sent.map((r) => r.channel) };
      const reason = results.find((r) => r.reason)?.reason ?? (results.some((r) => r.status === "failed") ? "error" : "no_contact");
      return { status: "skipped", reason, channels: [] };
    },
  };
}
