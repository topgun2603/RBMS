import { tradesB, type AiService } from "@srirealtime/ai";
import { AppError } from "@srirealtime/core";
import { sql, type Db } from "@srirealtime/db";
import type { JobsService } from "@srirealtime/jobs";
import { shrinkForVision } from "@srirealtime/uploads";
import { packFor } from "@srirealtime/verticals";

/** The slice of the catalogue service Phase 3 part B reads and writes (tags and attributes only; item creation goes through the normal routes). */
export interface TradesBCatalogue {
  getProduct(tenantId: string, id: string): Promise<{ id: string; name: string; categoryId: string | null; tags: string[]; attributes: Record<string, string>; images: { url: string }[] }>;
  getCategory(tenantId: string, id: string): Promise<{ name: string }>;
  listCategories(tenantId: string): Promise<{ items: { id: string; name: string; active?: boolean }[] }>;
  updateProduct(tenantId: string, id: string, patch: { tags?: string[]; attributes?: Record<string, string> }): Promise<unknown>;
  lookupCode(tenantId: string, code: string): Promise<{ id: string; name: string }>;
  searchVariants(tenantId: string, q: { q?: string; limit?: number }): Promise<{ items: { id: string; name: string; productName: string }[] }>;
}

/** The slice of the jewellery service used for the breakup and the HUID duplicate check. */
export interface TradesBJewellery {
  piecePrice(
    tenantId: string,
    id: string,
  ): Promise<{
    piece: { id: string; name: string; metal: string; purity: string; grossWeight: number; stoneWeight: number; netWeight: number; wastagePct: number; makingType: "per_gram" | "percent" | "flat"; makingValue: number; huid: string | null };
    rate: { date: string | null; ratePerGram: number } | null;
    breakdown: tradesB.BreakupFacts["breakdown"] | null;
  }>;
  listPieces(tenantId: string, q: { q?: string; limit?: number }): Promise<{ items: { id: string; name: string; huid: string | null }[] }>;
}

export interface TradesBKitDeps {
  db: Db;
  ai: AiService;
  catalogue: TradesBCatalogue;
  jewellery: TradesBJewellery;
  jobs: JobsService;
  /** The `store` settings namespace (business type). */
  storeSettings: { get(scope: { tenantId: string }): Promise<unknown> };
  shopName: (tenantId: string) => Promise<string | null>;
  /** Hosts the shop's own uploads are served from (public upload base, API origin). Product photos from elsewhere are not fetched. */
  uploadHosts: string[];
  production: boolean;
  fetchImpl?: typeof fetch;
  log: { warn(o: object, m?: string): void };
}

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/** Is this an address we may fetch a product photo from? Only http(s) on the shop's upload hosts, under the shop's own folder. */
export function allowedImageUrl(raw: string, tenantId: string, hosts: readonly string[], production: boolean): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  const local = ["localhost", "127.0.0.1"].includes(u.hostname);
  const known = hosts.some((h) => h && h.toLowerCase() === u.hostname.toLowerCase());
  if (!(known || (!production && local))) return null;
  if (!u.pathname.includes(`/t/${tenantId}/`)) return null;
  return u;
}

/** Phase 3 part B wiring (docs/ai.md): ports over the catalogue, jewellery and uploads, the two background jobs, and the module. */
export function createAiTradesBKit(d: TradesBKitDeps) {
  const businessType = async (tenantId: string) => (((await d.storeSettings.get({ tenantId })) as { businessType?: string }).businessType ?? "").trim() || null;
  const doFetch = d.fetchImpl ?? fetch;

  const existing: tradesB.ExistingFinder = {
    async find(tenantId, draft) {
      if (draft.barcode) {
        try {
          const hit = await d.catalogue.lookupCode(tenantId, draft.barcode);
          return { id: hit.id, name: hit.name, match: "barcode" };
        } catch {
          // not found: fall through to the name check
        }
      }
      const words = draft.name.split(/\s+/).filter((w) => w.length > 2).slice(0, 4).join(" ");
      if (!words) return null;
      const { items } = await d.catalogue.searchVariants(tenantId, { q: words, limit: 20 });
      let best: { id: string; name: string; score: number } | null = null;
      for (const it of items) {
        const score = Math.max(tradesB.nameSimilarity(draft.name, it.name), tradesB.nameSimilarity(draft.name, it.productName));
        if (!best || score > best.score) best = { id: it.id, name: it.name, score };
      }
      if (!best || best.score < 0.6) return null;
      return { id: best.id, name: best.name, match: best.score >= 0.85 ? "name" : "similar" };
    },
  };

  const tagPorts: tradesB.TagDeps["ports"] = {
    async products(tenantId, ids) {
      const out: tradesB.TagProduct[] = [];
      const cats = new Map<string, string>();
      for (const id of ids) {
        try {
          const p = await d.catalogue.getProduct(tenantId, id);
          let categoryName: string | null = null;
          if (p.categoryId) {
            if (!cats.has(p.categoryId)) cats.set(p.categoryId, await d.catalogue.getCategory(tenantId, p.categoryId).then((c) => c.name).catch(() => ""));
            categoryName = cats.get(p.categoryId) || null;
          }
          out.push({ id: p.id, name: p.name, categoryName, imageUrl: p.images[0]?.url ?? null, tags: p.tags, attributes: p.attributes });
        } catch {
          // not this shop's product: skipped
        }
      }
      return out;
    },
    async colourValues(tenantId) {
      const rows = (await d.db.execute(sql`
        select distinct v.value as v
        from catalog_products p, jsonb_array_elements(p.options) o, jsonb_array_elements_text(o -> 'values') v(value)
        where p.tenant_id = ${tenantId}::uuid and p.deleted_at is null and lower(o ->> 'name') in ('colour', 'color')
        limit 200`)) as unknown as { v: string }[];
      return rows.map((r) => r.v).filter(Boolean);
    },
    async loadImage(tenantId, url) {
      const u = allowedImageUrl(url, tenantId, d.uploadHosts, d.production);
      if (!u) throw new AppError(422, "image_unavailable", "The product photo is not stored in this shop's uploads.");
      const res = await doFetch(u, { redirect: "error", signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new AppError(422, "image_unavailable", "The product photo could not be loaded.");
      const type = res.headers.get("content-type") ?? "";
      if (!/^image\/(jpeg|png|webp|gif)/.test(type)) throw new AppError(422, "image_unavailable", "The product photo is not a supported image.");
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_IMAGE_BYTES) throw new AppError(422, "image_unavailable", "The product photo is too large.");
      return shrinkForVision(buf);
    },
    async update(tenantId, productId, patch) {
      await d.catalogue.updateProduct(tenantId, productId, patch);
    },
  };

  const ports: tradesB.TradesBPorts = {
    async categories(tenantId) {
      return (await d.catalogue.listCategories(tenantId)).items.filter((c) => c.active !== false).map((c) => ({ id: c.id, name: c.name }));
    },
    trade: businessType,
    async isFashion(tenantId) {
      return tradesB.isFashionTrade(await businessType(tenantId), packFor(await businessType(tenantId))?.id ?? null);
    },
    existing,
    shopName: d.shopName,
    jewellery: {
      async piece(tenantId, id) {
        let p;
        try {
          p = await d.jewellery.piecePrice(tenantId, id);
        } catch {
          return null;
        }
        const x = p.piece;
        const facts: tradesB.BreakupFacts | null =
          p.rate && p.breakdown
            ? {
                name: x.name,
                metal: x.metal,
                purity: x.purity,
                grossWeight: x.grossWeight,
                stoneWeight: x.stoneWeight,
                netWeight: x.netWeight,
                wastagePct: x.wastagePct,
                makingType: x.makingType,
                makingValue: x.makingValue,
                huid: x.huid,
                rate: { ratePerGram: p.rate.ratePerGram, date: p.rate.date },
                breakdown: p.breakdown,
              }
            : null;
        return { facts, piece: { id: x.id, name: x.name, metal: x.metal, purity: x.purity, huid: x.huid } };
      },
      async huidOwner(tenantId, huid) {
        const { items } = await d.jewellery.listPieces(tenantId, { q: huid, limit: 5 });
        const hit = items.find((i) => i.huid === huid);
        return hit ? { id: hit.id, name: hit.name } : null;
      },
    },
  };

  const trades = tradesB.createAiTradesB({
    db: d.db,
    ai: d.ai,
    ports,
    tagPorts,
    enqueuePhotos: (payload) => d.jobs.enqueue(tradesB.CATALOGUE_PHOTOS_JOB, payload),
    enqueueTags: (payload) => d.jobs.enqueue(tradesB.TAGS_JOB, payload),
    log: d.log,
  });
  d.jobs.define<tradesB.PhotoJobPayload>(
    tradesB.CATALOGUE_PHOTOS_JOB,
    async (data) => {
      const r = await trades.photos.process(data);
      d.log.warn({ ...r, tenantId: data.tenantId, batchId: data.batchId }, "ai: catalogue photos read");
    },
    // A retry would read (and pay for) the photos again.
    { attempts: 1, concurrency: 2 },
  );
  d.jobs.define<tradesB.TagJobPayload>(
    tradesB.TAGS_JOB,
    async (data) => {
      const r = await trades.tags.process(data);
      d.log.warn({ ...r, tenantId: data.tenantId, batchId: data.batchId }, "ai: product tags drafted");
    },
    { attempts: 1, concurrency: 2 },
  );
  return trades;
}
