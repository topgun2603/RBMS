import { aiStore, type AiService, type AiSettings } from "@rbms/ai";
import { AppError, type TenantRef } from "@rbms/core";
import { sql, type Db } from "@rbms/db";
import type { JobsService } from "@rbms/jobs";
import { composeSocialImage } from "@rbms/uploads";
import { allowedImageUrl } from "./kit-ai-trades-b";
import { policyLines } from "./kit-ai-assist";

/**
 * AI Phase 4 part B wiring (docs/ai.md "Phase 4 part B"): the ports of the shopper chat (catalogue, storefront, delivery, orders),
 * the SQL behind bought-together and pricing hints (bills and store orders, read-only), the alias generator hooked to product
 * saves, the daily jobs, and the module. Kept out of kit.ts so the composition root stays readable.
 */

type Catalogue = {
  search(tenantId: string, raw: Record<string, unknown>): Promise<{ items: { id: string; name: string; slug: string; categoryName: string | null; image: string | null; priceMin: number; priceMax: number; mrp: number | null; variantIds: string[]; kind?: "product" | "service" }[] }>;
  publicLookup(tenantId: string, ids: string[]): Promise<{ items: { id: string; slug: string }[] }>;
  publicProduct(tenantId: string, slug: string): Promise<{
    id: string;
    name: string;
    slug: string;
    description: string | null;
    brand: string | null;
    categoryName: string | null;
    priceMin: number;
    priceMax: number;
    attributes: Record<string, string>;
    images: { url: string }[];
    variants: { id: string; title: string; price: number; mrp: number | null }[];
    kind?: "product" | "service";
  }>;
  getProduct(tenantId: string, id: string): Promise<{
    id: string;
    name: string;
    description: string | null;
    brand: string | null;
    categoryId: string | null;
    unit: string;
    tags: string[];
    attributes: Record<string, string>;
    images: { url: string }[];
    createdAt: Date;
    variants: { price: number; mrp: number | null; isDefault: boolean }[];
  }>;
  getCategory(tenantId: string, id: string): Promise<{ name: string }>;
};
type StoreOrderLike = {
  number: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  total: number;
  placedAt: Date | string;
  lines: { name: string; qty: number }[];
  shippingAddress: { city: string; pincode: string } | null;
  fulfillment: { carrier?: string | null; trackingNumber?: string | null; trackingUrl?: string | null };
  events: { type: string; toStatus: string | null; message: string | null; createdAt: Date | string }[];
  cancelReason: string | null;
};
type TrackingLike = {
  number: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  placedAt: Date | string;
  timeline: { type: string; status: string | null; message: string | null; at: Date | string }[];
  lines: { name: string; qty: number }[];
  totals: { total: number };
  fulfillment: { carrier: string | null; trackingNumber: string | null; trackingUrl: string | null };
  shipTo: { city: string; pincode: string } | null;
  cancelReason: string | null;
};

export interface AiStoreKitDeps {
  db: Db;
  ai: AiService;
  catalogue: Catalogue;
  /** The storefront service (config, availability, the shopper's own orders, tracking by link token). */
  storefront: {
    config(tenant: TenantRef): Promise<{
      shop: { name: string; contactPhone: string; contactEmail: string };
      open: boolean;
      closedMessage: string;
      codEnabled: boolean;
      codMaxAmount: number;
      minOrderValue: number;
      onlinePayments: boolean;
      deliveryEnabled: boolean;
      pickupEnabled: boolean;
      pickupNote: string;
      policies: { shipping: string; returns: string };
      trust: { returns?: string };
    }>;
    publicAvailability(tenantId: string, query: unknown): Promise<{ items: { itemId: string; inStock: boolean; lowStock: boolean }[] }>;
    listOrders(tenantId: string, userId: string, query: unknown): Promise<{ items: { id: string }[] }>;
    getOrder(tenantId: string, userId: string, orderId: string): Promise<StoreOrderLike>;
    track(tenantId: string, accessToken: string): Promise<TrackingLike>;
  };
  delivery: {
    quote(tenantId: string, input: { pincode: string; weightGrams: number; subtotal: number; cod: boolean }): Promise<{ serviceable: boolean; options: { name: string; amount: number; etaDays: [number, number]; codAllowed: boolean }[] }>;
    freeShipping(tenantId: string, input: { pincode?: string | null }): Promise<{ threshold: number | null }>;
  };
  /** Approved Tamil product text (`ai_product_translations`). */
  translations: { approvedFor(tenantId: string, ids: string[], locale?: string): Promise<Record<string, { name: string; description: string | null }>> };
  branding: { get(tenantId: string): Promise<{ appName: string | null; logoUrl: string | null; tokens: { colors: { primary?: string; accent?: string } } }> };
  tenantRef: (tenantId: string) => Promise<TenantRef | null>;
  /** The `ai` settings namespace. */
  aiSettings: { get(scope: { tenantId: string }): Promise<unknown>; setTenant(tenantId: string, patch: never): Promise<unknown> };
  storeSettings: { get(scope: { tenantId: string }): Promise<unknown> };
  isEnabled: (tenantId: string, key: string) => Promise<boolean>;
  /** In-stock variant ids among these (inventory availability; untracked shops count as in stock). */
  inStockVariants: (tenantId: string, variantIds: string[]) => Promise<string[]>;
  jobs: JobsService;
  uploadHosts: string[];
  production: boolean;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  log: { warn(o: object, m?: string): void; info?(o: object, m?: string): void };
}

const rows = <T>(r: unknown) => r as unknown as T[];
const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const ALIAS_PRODUCT_JOB = "ai.alias-product";
export const TOGETHER_REFRESH_JOB = aiStore.TOGETHER_JOB;

const RETURNS_TRUST: Record<string, string> = { easy: "Easy returns are offered.", replace: "Replacement is offered for faulty items.", exchange: "Exchange is offered." };

export function createAiStoreKit(d: AiStoreKitDeps) {
  const now = () => d.now?.() ?? new Date();
  const doFetch = d.fetchImpl ?? fetch;
  const readAi = async (tenantId: string) => (await d.aiSettings.get({ tenantId })) as AiSettings;

  // ------------------------------------------------------------------ shopper chat ports
  const orderView = (o: StoreOrderLike): aiStore.OrderView => ({
    number: o.number,
    status: o.status,
    paymentStatus: o.paymentStatus,
    paymentMethod: o.paymentMethod,
    placedAt: iso(o.placedAt),
    total: o.total,
    itemCount: o.lines.reduce((n, l) => n + l.qty, 0),
    lines: o.lines.map((l) => ({ name: l.name, qty: l.qty })),
    shipTo: o.shippingAddress ? { city: o.shippingAddress.city, pincode: o.shippingAddress.pincode } : null,
    tracking: o.fulfillment ? { carrier: o.fulfillment.carrier ?? null, trackingNumber: o.fulfillment.trackingNumber ?? null, trackingUrl: o.fulfillment.trackingUrl ?? null } : null,
    timeline: o.events
      .filter((e) => e.type === "status" || e.type === "fulfillment")
      .map((e) => ({ status: e.toStatus ?? e.type, at: iso(e.createdAt), message: e.type === "fulfillment" ? e.message : null }))
      .sort((a, b) => b.at.localeCompare(a.at)),
    cancelReason: o.cancelReason,
  });

  const overlayTa = async (tenantId: string, ids: string[]) => (ids.length ? await d.translations.approvedFor(tenantId, ids, "ta").catch(() => ({})) : {}) as Record<string, { name: string; description: string | null }>;

  const chatPorts: aiStore.ChatPorts = {
    async shop(tenantId) {
      const ref = await d.tenantRef(tenantId);
      if (!ref) throw new AppError(404, "not_found", "Store not found");
      const c = await d.storefront.config(ref);
      const trust = RETURNS_TRUST[c.trust.returns ?? ""] ?? "";
      return {
        name: c.shop.name,
        open: c.open,
        closedMessage: c.closedMessage,
        codEnabled: c.codEnabled,
        codMaxAmount: c.codMaxAmount,
        minOrderValue: c.minOrderValue,
        deliveryEnabled: c.deliveryEnabled,
        pickupEnabled: c.pickupEnabled,
        pickupNote: c.pickupNote,
        shippingPolicy: c.policies.shipping,
        returnsPolicy: [c.policies.returns, trust].filter(Boolean).join(" "),
        contactPhone: c.shop.contactPhone,
        contactEmail: c.shop.contactEmail,
        onlinePayments: c.onlinePayments,
      };
    },
    async search(tenantId, q) {
      const page = await d.catalogue.search(tenantId, {
        q: q.query,
        limit: q.limit,
        ...(q.maxPrice ? { priceMax: q.maxPrice } : {}),
        ...(q.inStockOnly ? { inStock: true } : {}),
      });
      const ta = q.locale === "ta" ? await overlayTa(tenantId, page.items.map((p) => p.id)) : {};
      return page.items.map((p) => ({
        id: p.id,
        slug: p.slug,
        name: ta[p.id]?.name || p.name,
        category: p.categoryName,
        image: p.image,
        priceMin: p.priceMin,
        priceMax: p.priceMax,
        mrp: p.mrp,
        variantIds: p.variantIds,
        kind: p.kind ?? "product",
      }));
    },
    async product(tenantId, id, locale) {
      const found = await d.catalogue.publicLookup(tenantId, [id]).catch(() => ({ items: [] }));
      const slug = found.items[0]?.slug;
      if (!slug) return null;
      const p = await d.catalogue.publicProduct(tenantId, slug).catch(() => null);
      if (!p) return null;
      const ta = locale === "ta" ? (await overlayTa(tenantId, [p.id]))[p.id] : undefined;
      return {
        id: p.id,
        slug: p.slug,
        name: ta?.name || p.name,
        category: p.categoryName,
        image: p.images[0]?.url ?? null,
        priceMin: p.priceMin,
        priceMax: p.priceMax,
        mrp: p.variants[0]?.mrp ?? null,
        variantIds: p.variants.map((v) => v.id),
        kind: p.kind ?? "product",
        description: ta?.description ?? p.description,
        brand: p.brand,
        attributes: p.attributes ?? {},
        variants: p.variants.map((v) => ({ id: v.id, title: v.title, price: v.price, mrp: v.mrp, inStock: true, lowStock: false })),
      };
    },
    async availability(tenantId, ids) {
      if (!ids.length) return [];
      return (await d.storefront.publicAvailability(tenantId, { itemIds: ids.join(",") })).items;
    },
    async delivery(tenantId, input) {
      const q = await d.delivery.quote(tenantId, { pincode: input.pincode, weightGrams: 1000, subtotal: input.subtotal, cod: false });
      const free = await d.delivery.freeShipping(tenantId, { pincode: input.pincode }).catch(() => ({ threshold: null }));
      return { serviceable: q.serviceable, options: q.options.map((o) => ({ name: o.name, fee: o.amount, etaDays: o.etaDays, codAllowed: o.codAllowed })), freeAbove: free.threshold ?? null };
    },
    async myOrders(tenantId, userId, limit) {
      const list = await d.storefront.listOrders(tenantId, userId, { limit, offset: 0 });
      const out: aiStore.OrderView[] = [];
      for (const s of list.items.slice(0, limit)) out.push(orderView(await d.storefront.getOrder(tenantId, userId, s.id)));
      return out;
    },
    async orderByToken(tenantId, token) {
      try {
        const t = await d.storefront.track(tenantId, token);
        return {
          number: t.number,
          status: t.status,
          paymentStatus: t.paymentStatus,
          paymentMethod: t.paymentMethod,
          placedAt: iso(t.placedAt),
          total: t.totals.total,
          itemCount: t.lines.reduce((n, l) => n + l.qty, 0),
          lines: t.lines.map((l) => ({ name: l.name, qty: l.qty })),
          shipTo: t.shipTo,
          tracking: t.fulfillment,
          timeline: t.timeline.map((e) => ({ status: e.status ?? e.type, at: iso(e.at), message: e.type === "fulfillment" ? e.message : null })).sort((a, b) => b.at.localeCompare(a.at)),
          cancelReason: t.cancelReason,
        };
      } catch (e) {
        if (e instanceof AppError && e.status === 404) return null;
        throw e;
      }
    },
  };

  // ------------------------------------------------------------------ search words
  const aliasPorts: aiStore.AliasPorts = {
    async products(tenantId, ids) {
      const out: aiStore.AliasProduct[] = [];
      const cats = new Map<string, string>();
      for (const id of ids) {
        try {
          const p = await d.catalogue.getProduct(tenantId, id);
          let category: string | null = null;
          if (p.categoryId) {
            if (!cats.has(p.categoryId)) cats.set(p.categoryId, await d.catalogue.getCategory(tenantId, p.categoryId).then((c) => c.name).catch(() => ""));
            category = cats.get(p.categoryId) || null;
          }
          out.push({ id: p.id, name: p.name, category, brand: p.brand, tags: p.tags, attributes: p.attributes, description: p.description });
        } catch {
          // not this shop's product: skipped
        }
      }
      return out;
    },
    async withoutAliases(tenantId, limit) {
      const r = rows<{ id: string }>(
        await d.db.execute(sql`
          select p.id from catalog_products p
          where p.tenant_id = ${tenantId}::uuid and p.deleted_at is null and p.status = 'active' and 'store' = any(p.channels)
            and not exists (select 1 from ai_product_aliases a where a.tenant_id = p.tenant_id and a.product_id = p.id)
          order by p.created_at desc limit ${limit}`),
      );
      return r.map((x) => x.id);
    },
  };

  // ------------------------------------------------------------------ bought together
  const togetherPorts: aiStore.TogetherPorts = {
    async baskets(tenantId, days) {
      const bills = rows<{ basket: string; product_id: string }>(
        await d.db.execute(sql`
          select i.id::text as basket, v.product_id::text as product_id
          from invoices i
          cross join lateral jsonb_array_elements(i.lines) l
          join catalog_variants v on v.tenant_id = i.tenant_id and v.id = (l->>'itemId')::uuid
          where i.tenant_id = ${tenantId}::uuid and i.status in ('issued', 'partially_paid', 'paid') and i.cancelled_at is null and i.imported = false
            and i.date >= (current_date - ${days}::int) and (l->>'itemId') ~ '^[0-9a-fA-F-]{36}$'`),
      );
      // Store orders that never became a bill (the ones that did are already counted as that bill).
      const orders = rows<{ basket: string; product_id: string }>(
        await d.db.execute(sql`
          select o.id::text as basket, l->>'productId' as product_id
          from orders o cross join lateral jsonb_array_elements(o.lines) l
          where o.tenant_id = ${tenantId}::uuid and o.invoice_id is null and o.status not in ('cancelled', 'returned')
            and o.placed_at >= now() - (${days}::int * interval '1 day') and (l->>'productId') ~ '^[0-9a-fA-F-]{36}$'`),
      );
      return [...bills, ...orders].map((r) => ({ basket: r.basket, productId: r.product_id }));
    },
    async incidental(tenantId) {
      const r = rows<{ id: string; name: string }>(await d.db.execute(sql`select id::text as id, name from catalog_products where tenant_id = ${tenantId}::uuid and deleted_at is null`));
      return r.filter((x) => aiStore.isIncidental(x.name)).map((x) => x.id);
    },
    async tenants() {
      const r = rows<{ id: string }>(await d.db.execute(sql`select distinct tenant_id::text as id from catalog_products where deleted_at is null`));
      return r.map((x) => x.id);
    },
    async enabled(tenantId) {
      return (await readAi(tenantId)).features["bought-together"] !== false;
    },
  };

  // ------------------------------------------------------------------ pricing hints
  const pricing: aiStore.PricingPorts = {
    today: () => new Date(now().getTime() + 330 * 60_000).toISOString().slice(0, 10),
    async sales(tenantId, days) {
      const bills = rows<{ item_id: string; date: string; qty: string; unit: string }>(
        await d.db.execute(sql`
          select l->>'itemId' as item_id, i.date::text as date, (l->>'qty') as qty,
                 case when (l->>'qty')::numeric > 0 then ((l->>'taxable')::numeric / (l->>'qty')::numeric)::text else '0' end as unit
          from invoices i cross join lateral jsonb_array_elements(i.lines) l
          where i.tenant_id = ${tenantId}::uuid and i.status in ('issued', 'partially_paid', 'paid') and i.cancelled_at is null
            and i.date >= (current_date - ${days}::int) and (l->>'itemId') ~ '^[0-9a-fA-F-]{36}$' and (l->>'qty')::numeric > 0`),
      );
      const orders = rows<{ item_id: string; date: string; qty: string; unit: string }>(
        await d.db.execute(sql`
          select l->>'variantId' as item_id, ((o.placed_at at time zone 'Asia/Kolkata')::date)::text as date, (l->>'qty') as qty,
                 case when (l->>'qty')::numeric > 0 then ((l->>'taxable')::numeric / (l->>'qty')::numeric)::text else '0' end as unit
          from orders o cross join lateral jsonb_array_elements(o.lines) l
          where o.tenant_id = ${tenantId}::uuid and o.invoice_id is null and o.status not in ('cancelled', 'returned')
            and o.placed_at >= now() - (${days}::int * interval '1 day') and (l->>'variantId') ~ '^[0-9a-fA-F-]{36}$' and (l->>'qty')::numeric > 0`),
      );
      return [...bills, ...orders].map((r) => ({ itemId: r.item_id, date: r.date, qty: Number(r.qty), unitPrice: Math.round(Number(r.unit)) })).filter((r) => r.unitPrice > 0 && Number.isFinite(r.qty));
    },
    async costs(tenantId, days) {
      const r = rows<{ item_id: string; date: string; rate: string }>(
        await d.db.execute(sql`
          select l->>'itemId' as item_id, p.date::text as date, (l->>'rate') as rate
          from purchases p cross join lateral jsonb_array_elements(p.lines) l
          where p.tenant_id = ${tenantId}::uuid and p.status <> 'cancelled' and p.cancelled_at is null and p.imported = false
            and p.date >= (current_date - ${days}::int) and (l->>'itemId') ~ '^[0-9a-fA-F-]{36}$' and (l->>'rate')::numeric > 0`),
      );
      return r.map((x) => ({ itemId: x.item_id, date: x.date, rate: Math.round(Number(x.rate)) }));
    },
    async items(tenantId, ids) {
      if (!ids.length) return [];
      const list = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
      const r = rows<{ id: string; name: string; unit: string; cost: number | null }>(
        await d.db.execute(sql`
          select v.id::text as id, p.name || case when v.title <> '' then ' - ' || v.title else '' end as name, p.unit, v.cost
          from catalog_variants v join catalog_products p on p.id = v.product_id
          where v.tenant_id = ${tenantId}::uuid and v.id in (${list})`),
      );
      return r.map((x) => ({ itemId: x.id, name: x.name, unit: x.unit, cost: x.cost }));
    },
  };

  // ------------------------------------------------------------------ social posts
  const social: aiStore.SocialPorts = {
    async product(tenantId, id) {
      try {
        const p = await d.catalogue.getProduct(tenantId, id);
        const category = p.categoryId ? await d.catalogue.getCategory(tenantId, p.categoryId).then((c) => c.name).catch(() => null) : null;
        const prices = p.variants.map((v) => v.price);
        const def = p.variants.find((v) => v.isDefault) ?? p.variants[0];
        return {
          id: p.id,
          name: p.name,
          category,
          brand: p.brand,
          attributes: p.attributes,
          tags: p.tags,
          price: prices.length ? Math.min(...prices) : null,
          mrp: def?.mrp ?? null,
          priceFrom: new Set(prices).size > 1,
          description: p.description,
          imageUrl: p.images[0]?.url ?? null,
          createdAt: p.createdAt.toISOString(),
        };
      } catch {
        return null;
      }
    },
    async shop(tenantId) {
      const [b, s] = await Promise.all([d.branding.get(tenantId), d.storeSettings.get({ tenantId })]);
      const ref = await d.tenantRef(tenantId);
      return { name: b.appName ?? ref?.slug ?? "", policies: policyLines(s as never), primary: b.tokens.colors.primary ?? null, accent: b.tokens.colors.accent ?? null, logoUrl: b.logoUrl };
    },
    async image(tenantId, url) {
      const u = allowedImageUrl(url, tenantId, d.uploadHosts, d.production);
      if (!u) return null;
      try {
        const res = await doFetch(u, { redirect: "error", signal: AbortSignal.timeout(15_000) });
        if (!res.ok || !/^image\/(jpeg|png|webp|gif)/.test(res.headers.get("content-type") ?? "")) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        return buf.length > MAX_IMAGE_BYTES ? null : buf;
      } catch {
        return null;
      }
    },
    async newArrivals(tenantId, days, limit) {
      const r = rows<{ id: string; name: string; images: { url: string }[]; created_at: Date | string; price: number | null }>(
        await d.db.execute(sql`
          select p.id::text as id, p.name, p.images, p.created_at,
                 (select min(v.price) from catalog_variants v where v.product_id = p.id and v.deleted_at is null) as price
          from catalog_products p
          where p.tenant_id = ${tenantId}::uuid and p.deleted_at is null and p.status = 'active'
            and p.created_at >= now() - (${days}::int * interval '1 day')
          order by p.created_at desc limit ${limit}`),
      );
      return r.map((x) => ({ id: x.id, name: x.name, image: x.images?.[0]?.url ?? null, price: x.price, createdAt: iso(x.created_at) }));
    },
    compose: (i) => composeSocialImage({ ...i }),
  };

  // ------------------------------------------------------------------ POS chips
  const cart: aiStore.CartPartnersPort = {
    async forCart(tenantId, itemIds, limit) {
      const list = sql.join(itemIds.map((id) => sql`${id}::uuid`), sql`, `);
      const own = rows<{ product_id: string }>(await d.db.execute(sql`select distinct product_id::text as product_id from catalog_variants where tenant_id = ${tenantId}::uuid and id in (${list})`));
      const have = own.map((r) => r.product_id);
      const partners = await store.together.partners(tenantId, have, limit * 3, have);
      if (!partners.length) return [];
      const plist = sql.join(partners.map((p) => sql`${p.productId}::uuid`), sql`, `);
      const vs = rows<{ id: string; product_id: string; price: number; name: string; unit: string; hsn: string | null; tax_inclusive: boolean; gst_rate: number; gst_rule: unknown; images: { url: string }[] | null; sku: string | null; barcode: string | null }>(
        await d.db.execute(sql`
          select distinct on (v.product_id) v.id::text as id, v.product_id::text as product_id, v.price, p.name || case when v.title <> '' then ' - ' || v.title else '' end as name, p.unit,
                 p.hsn, p.tax_inclusive, p.gst_rate, p.gst_rule, p.images, v.sku, v.barcode
          from catalog_variants v join catalog_products p on p.id = v.product_id
          where v.tenant_id = ${tenantId}::uuid and v.product_id in (${plist}) and v.deleted_at is null and p.deleted_at is null and p.status = 'active' and 'billing' = any(p.channels)
          order by v.product_id, v.is_default desc, v.position asc`),
      );
      const ok = new Set(await d.inStockVariants(tenantId, vs.map((v) => v.id)));
      const byProduct = new Map(vs.filter((v) => ok.has(v.id)).map((v) => [v.product_id, v]));
      return partners
        .filter((p) => byProduct.has(p.productId))
        .slice(0, limit)
        .map((p) => {
          const v = byProduct.get(p.productId)!;
          return { itemId: v.id, productId: p.productId, name: v.name, price: v.price, unit: v.unit, hsn: v.hsn, taxInclusive: v.tax_inclusive, gstRate: Number(v.gst_rate), gstRule: v.gst_rule ?? null, image: v.images?.[0]?.url ?? null, sku: v.sku, barcode: v.barcode, confidence: p.confidence, lift: p.lift };
        });
    },
  };

  // ------------------------------------------------------------------ the module
  const store = aiStore.createAiStore({
    db: d.db,
    ai: d.ai,
    aliasPorts,
    togetherPorts,
    chatPorts,
    pricing,
    social,
    cart,
    settings: { get: readAi },
    saveSettings: async (tenantId, patch) => {
      const cur = await readAi(tenantId);
      const next: Record<string, unknown> = {};
      if (patch.features) next.features = { ...cur.features, ...patch.features };
      if (patch.shopperChat) next.shopperChat = patch.shopperChat;
      await d.aiSettings.setTenant(tenantId, next as never);
    },
    featureOn: (tenantId) => d.isEnabled(tenantId, "ai"),
    enqueueAliases: (p) => d.jobs.enqueue(aiStore.ALIAS_BACKFILL_JOB, p),
    now,
    log: d.log,
  });

  d.jobs.define<aiStore.AliasJobPayload>(
    aiStore.ALIAS_BACKFILL_JOB,
    async (data) => {
      const r = await store.aliases.process(data);
      d.log.warn({ ...r, tenantId: data.tenantId }, "ai: search words backfill");
    },
    // A retry would pay for the same products again.
    { attempts: 1, concurrency: 1 },
  );
  d.jobs.define<aiStore.AliasJobPayload>(
    ALIAS_PRODUCT_JOB,
    async (data) => {
      await store.aliases.process(data);
    },
    { attempts: 1, concurrency: 2 },
  );
  d.jobs.define(aiStore.TOGETHER_JOB, async () => {
    const r = await store.together.refreshAll();
    d.log.warn(r, "ai: bought-together refreshed");
  });

  /**
   * Domain-event hook (kit.ts `emit`): a product saved as active may get its search words. Cheap checks first (the shop's
   * opt-in, then whether words already exist for this name) so a price or stock edit queues nothing; the job asks the AI.
   */
  const queued = new Map<string, number>();
  async function onDomainEvent(tenantId: string, type: string, data: unknown): Promise<void> {
    if (type !== "product.created" && type !== "product.updated") return;
    const p = data as { id?: string; name?: string; status?: string };
    if (!p.id || !p.name || p.status !== "active") return;
    try {
      const s = await readAi(tenantId);
      if (!s.enabled || s.features["search-aliases"] === false) return;
      const key = `${tenantId}:${p.id}`;
      const t = Date.now();
      if (t - (queued.get(key) ?? 0) < 60_000) return;
      const existing = rows<{ source: string; source_name: string; n: number }>(
        await d.db.execute(sql`select source, source_name, jsonb_array_length(aliases) as n from ai_product_aliases where tenant_id = ${tenantId}::uuid and product_id = ${p.id}::uuid limit 1`),
      )[0];
      if (existing && (existing.source === "owner" || (existing.source_name.normalize("NFC").trim().toLowerCase() === p.name.normalize("NFC").trim().toLowerCase() && existing.n > 0))) return;
      queued.set(key, t);
      if (queued.size > 5000) for (const [k, v] of queued) if (t - v > 60_000) queued.delete(k);
      await d.jobs.enqueue(ALIAS_PRODUCT_JOB, { tenantId, productIds: [p.id] } satisfies aiStore.AliasJobPayload);
    } catch (err) {
      d.log.warn({ err: err instanceof Error ? err.message : String(err), tenantId }, "ai: alias hook failed");
    }
  }

  /**
   * Bought-together as the catalogue's purchase signal: when the shop has rows in `ai_item_pairs`, "Often bought together" on a
   * product page uses them (bills and store orders, lift-ranked, stock preferred by the catalogue); otherwise the paid-orders
   * counts of before. `orders` carries confidence x lift scaled to a whole number so the catalogue's own ranking keeps the order.
   */
  function purchaseSignals<T extends { boughtWith(tenantId: string, productIds: string[], since: Date, limit: number): Promise<{ productId: string; orders: number }[]> }>(base: T): T {
    return {
      ...base,
      async boughtWith(tenantId: string, productIds: string[], since: Date, limit: number) {
        try {
          if ((await store.togetherOn(tenantId)) && (await store.together.hasData(tenantId))) {
            const partners = await store.together.partners(tenantId, productIds, limit, productIds);
            if (partners.length) return partners.map((p) => ({ productId: p.productId, orders: Math.max(1, Math.round(p.score * 100)) }));
          }
        } catch (err) {
          d.log.warn({ err: err instanceof Error ? err.message : String(err), tenantId }, "ai: bought-together lookup failed, using order counts");
        }
        return base.boughtWith(tenantId, productIds, since, limit);
      },
    };
  }

  return { ...store, onDomainEvent, purchaseSignals, jobs: { together: aiStore.TOGETHER_JOB } };
}
