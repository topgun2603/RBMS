import { DEFAULT_LAYOUT_THEME, themePreset } from "@rbms/branding";
import { packFor } from "@rbms/verticals";
import type { Logger } from "pino";
import type { Kit } from "../kit";
import { ensureShop } from "../seed-fixtures";
import { seedProductImages } from "../seed-images";
import type { DemoProduct, DemoStore, HomeContext, PhotoSize } from "./types";

/**
 * Seeds one demo store (types.ts) idempotently: every step only creates what is missing, so a re-run adds nothing
 * twice and owners' edits survive.
 *
 * - shop, app, plan and trade: `ensureShop` (+ the trade's starter when the shop is new);
 * - look: the store's preset, when the shop is new or still on its trade's recommended look;
 * - store settings (only while no contact phone is set), delivery zones (only when there are none);
 * - categories (matched by name; a picture and description only where missing), products (matched by name; opening
 *   stock on create), rule collections (by slug), coupons (by code); the shop's billing items stay off the store;
 * - home page: written when the shop has none or still shows the untouched starter home (`starter-*` sections);
 * - pages (by slug, published), header / footer menus (only when empty).
 *
 * Pictures are Pexels photos (free licence, credited on the store's photo-credits page) downloaded from the Pexels CDN
 * at a reduced size and stored as public files of the shop (named `<slug>-pexels-<id>-<size>`, so a later run reuses
 * them); only those still needed are fetched. Offline, products get
 * the generated placeholder, categories their icon tile and the home its brand-colour blocks.
 */
export interface SeedDemoStoreOptions {
  /**
   * Rewrite the home page even when it exists, as long as it is still the store's own seeded home (every section id
   * is one of the store's): for iterating on a store's home while building it (`pnpm seed:stores <slug> --refresh-home`).
   */
  refreshHome?: boolean;
  /**
   * Re-apply the store's preset (colours, fonts, radius, mode and every theme option including `pageLayout` /
   * `mobileNav`) even though the shop is already on it: after changing the preset file (`pnpm seed:stores <slug>
   * --refresh-look`). A shop whose owner picked another look still keeps it.
   */
  refreshLook?: boolean;
  /**
   * Swap the pictures of products that already exist when their photo in the store file changed (`--refresh-photos`):
   * the first picture is replaced by the file's photo, any others are kept.
   */
  refreshPhotos?: boolean;
  /**
   * Re-apply the store's delivery / pickup switches and minimum order (`--refresh-settings`) on a shop whose store
   * settings already exist; everything else the owner edited (contact, policies, COD) is kept.
   */
  refreshSettings?: boolean;
}

export async function seedDemoStore(kit: Kit, store: DemoStore, ownerUserId: string, log: Logger, opts: SeedDemoStoreOptions = {}) {
  const slug = store.shop.slug;
  const { tenant, created } = await ensureShop(kit, store.shop, ownerUserId);
  const tenantId = tenant.id;
  if (created && store.shop.businessType) {
    await kit.starter.apply({ id: tenant.id, name: tenant.name, appId: tenant.appId, slug: tenant.slug, planId: tenant.planId }, store.shop.businessType);
  }
  log.info({ slug, created }, created ? "demo store: shop created" : "demo store: shop exists");

  const photos = photoStore(kit, tenantId, slug, store, log);

  await applyLook(kit, tenantId, store, created, log, !!opts.refreshLook);
  await seedSettings(kit, tenantId, store, log, !!opts.refreshSettings);
  const categories = await seedCategories(kit, tenantId, store, photos, log);
  const products = await seedProducts(kit, tenantId, store, categories, photos, log, !!opts.refreshPhotos);
  await dropUnusedStarterCategories(kit, tenantId, store, log);
  await counterOnly(kit, tenantId, store, log);
  await seedCollections(kit, tenantId, store, categories, log);
  await seedCoupons(kit, tenantId, store, log);

  const ctx = (urls: Map<string, string>): HomeContext => ({
    photo: (id, size = "wide") => urls.get(`${id}-${size}`) ?? "",
    category: (name) => categories.get(name) ?? missing("category", name),
    product: (name) => products.get(name) ?? missing("product", name),
  });

  // Home: only for a shop without one, or one still showing the untouched starter home.
  const home = await kit.cms.service.getHome(tenantId);
  const current = (home.published ?? home.draft) as { sections?: { id?: string }[] } | null;
  const untouchedStarter = !!current?.sections?.length && current.sections.every((s) => s.id?.startsWith("starter-")) && !home.hasUnpublishedChanges;
  const ownIds = new Set(collectIds(store));
  const stillSeeded = !!opts.refreshHome && !!current?.sections?.length && current.sections.every((s) => !!s.id && ownIds.has(s.id));
  if (!current || untouchedStarter || stillSeeded) {
    const wanted = collectPhotos((c) => store.home(c));
    const urls = await photos.preload(wanted);
    // Without its photos (offline) the home would be half empty: keep the starter and try again on the next run.
    if (urls.size < new Set(wanted.map((w) => `${w.id}-${w.size}`)).size) log.warn({ slug }, "demo store: home photos missing, home left unchanged");
    else {
      await kit.cms.service.saveHomeDraft(tenantId, store.home(ctx(urls)));
      await kit.cms.service.publishHome(tenantId);
      log.info({ slug }, "demo store: home page published");
    }
  } else log.info({ slug }, "demo store: home page exists, left unchanged");

  for (const page of store.pages) {
    const found = (await kit.cms.service.listPages(tenantId, { q: page.slug, limit: 100 })).items.some((p) => p.slug === page.slug);
    if (found) continue;
    const wanted = collectPhotos((c) => page.blocks(c));
    const urls = await photos.preload(wanted);
    if (urls.size < new Set(wanted.map((w) => `${w.id}-${w.size}`)).size) continue;
    const p = await kit.cms.service.createPage(tenantId, { title: page.title, slug: page.slug, blocks: page.blocks(ctx(urls)) });
    await kit.cms.service.setPageStatus(tenantId, p.id, "published");
    log.info({ slug, page: page.slug }, "demo store: page published");
  }

  for (const post of store.posts ?? []) {
    const found = (await kit.cms.service.listPosts(tenantId, { q: post.title, limit: 100 })).items.some((p) => p.slug === post.slug);
    if (found) continue;
    const wanted = [...collectPhotos((c) => post.blocks(c)), { id: post.cover, size: "wide" as PhotoSize }];
    const urls = await photos.preload(wanted);
    if (urls.size < new Set(wanted.map((w) => `${w.id}-${w.size}`)).size) continue;
    const made = await kit.cms.service.createPost(tenantId, { title: post.title, slug: post.slug, excerpt: post.excerpt, coverUrl: ctx(urls).photo(post.cover, "wide"), tags: post.tags, authorName: post.authorName, blocks: post.blocks(ctx(urls)) });
    await kit.cms.service.setPostStatus(tenantId, made.id, "published");
    log.info({ slug, post: post.slug }, "demo store: post published");
  }

  for (const key of ["header", "footer"] as const) {
    if ((await kit.cms.service.getMenu(tenantId, key)).items.length > 0) continue;
    await kit.cms.service.saveMenu(tenantId, key, store.menus[key]);
    log.info({ slug, menu: key }, "demo store: menu saved");
  }

  // Products whose photo could not be fetched (offline) get the generated placeholder.
  await seedProductImages(kit, tenantId, log, slug, { names: store.products.map((p) => p.name), shopName: store.shop.name });
  await store.setup?.(kit, { id: tenantId, slug }, ownerUserId, log);
  log.info({ slug, products: products.size, categories: categories.size }, "demo store ready");
  return { tenant, created };
}

/** Section ids of the store's home. */
function collectIds(store: DemoStore): string[] {
  const doc = store.home({ photo: () => "", category: () => "", product: () => "" });
  return doc.sections.map((s) => s.id ?? "").filter(Boolean);
}

const missing = (what: string, name: string): never => {
  throw new Error(`demo store: unknown ${what} "${name}"`);
};

/** The photos a builder asks for (it is called once with a recording context). */
function collectPhotos(build: (ctx: HomeContext) => unknown): { id: number; size: PhotoSize }[] {
  const wanted: { id: number; size: PhotoSize }[] = [];
  build({
    photo: (id, size = "wide") => {
      wanted.push({ id, size });
      return "https://placeholder.invalid/x.jpg";
    },
    category: () => "00000000-0000-4000-8000-000000000000",
    product: () => "00000000-0000-4000-8000-000000000000",
  });
  return wanted;
}

// ---------------------------------------------------------------- photos

/** Pexels CDN size per use (imgix parameters; `fit=crop` cuts to the exact box). */
const PHOTO_PARAMS: Record<PhotoSize, string> = {
  square: "w=1000&h=1000&fit=crop",
  tile: "w=1200&h=900&fit=crop",
  wide: "w=1800&fit=max",
};

export const pexelsUrl = (id: number, size: PhotoSize) => `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&${PHOTO_PARAMS[size]}`;

/** JPEG / PNG / WebP by their first bytes (the CDN answers with an image or an error page). */
export function imageType(b: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

function photoStore(kit: Kit, tenantId: string, slug: string, store: DemoStore, log: Logger) {
  const done = new Map<string, string>();
  async function get(id: number, size: PhotoSize): Promise<string | null> {
    const key = `${id}-${size}`;
    const hit = done.get(key);
    if (hit) return hit;
    const credit = store.photos[id];
    if (!credit) throw new Error(`demo store ${slug}: photo ${id} has no credit entry`);
    // Stored by an earlier run: reuse it (no second download, no duplicate file).
    const name = `${slug}-pexels-${id}-${size}`;
    const stored = (await kit.uploads.service.list({ tenantId, purpose: "storefront", q: name, limit: 5 })).find((f) => f.originalName.startsWith(name));
    if (stored) {
      done.set(key, stored.url);
      return stored.url;
    }
    try {
      const res = await fetch(pexelsUrl(id, size), { headers: { "user-agent": "srikit-demo-seed" }, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = Buffer.from(await res.arrayBuffer());
      const type = imageType(body);
      if (!type) throw new Error("not an image");
      const file = await kit.uploads.service.storeGenerated({
        tenantId,
        filename: `${slug}-pexels-${id}-${size}.jpg`,
        contentType: type,
        body,
        visibility: "public",
        purpose: "storefront",
      });
      done.set(key, file.url);
      return file.url;
    } catch (err) {
      log.warn({ slug, photo: id, err: String(err) }, "demo store: photo not fetched (offline?)");
      return null;
    }
  }
  return {
    get,
    /** Fetches every wanted photo; the map holds the ones that arrived. */
    async preload(wanted: { id: number; size: PhotoSize }[]) {
      const urls = new Map<string, string>();
      for (const w of wanted) {
        const url = await get(w.id, w.size);
        if (url) urls.set(`${w.id}-${w.size}`, url);
      }
      return urls;
    },
  };
}

type Photos = ReturnType<typeof photoStore>;

// ---------------------------------------------------------------- look and settings

async function applyLook(kit: Kit, tenantId: string, store: DemoStore, created: boolean, log: Logger, refresh = false) {
  const preset = themePreset(store.preset);
  if (!preset) throw new Error(`demo store: unknown preset ${store.preset}`);
  const branding = await kit.branding.service.get(tenantId);
  const current = (branding?.tokens as { preset?: string } | undefined)?.preset;
  if (current === preset.id && !refresh) return;
  // A shop whose owner picked another look keeps it; a new one (or one on its trade's starter look) gets the store's.
  const packPreset = store.shop.businessType ? packFor(store.shop.businessType)?.preset : undefined;
  if (!created && current && current !== packPreset && current !== preset.id) return;
  await kit.branding.service.update(tenantId, {
    appName: store.shop.name,
    tokens: {
      colors: { primary: preset.colors.primary, accent: preset.colors.accent ?? null, background: preset.colors.background ?? null, foreground: preset.colors.foreground ?? null },
      fontSans: preset.fontSans,
      fontHeading: preset.fontHeading,
      radius: preset.radius,
      mode: preset.mode,
      // The page layout and phone navigation too (the default when the preset leaves them out), so a refreshed look
      // drops a layout the preset no longer has (theme tokens are merged, not replaced).
      theme: { ...DEFAULT_LAYOUT_THEME, ...preset.theme },
      preset: preset.id,
    },
  });
  log.info({ slug: store.shop.slug, preset: preset.id, refreshed: current === preset.id }, current === preset.id ? "demo store: look re-applied" : "demo store: look applied");
}

async function seedSettings(kit: Kit, tenantId: string, store: DemoStore, log: Logger, refresh = false) {
  const settings = kit.settings.service.handle("store");
  const current = await settings.get({ tenantId });
  if (!current.contactPhone) {
    await settings.setTenant(tenantId, store.store);
    log.info({ slug: store.shop.slug }, "demo store: store settings saved");
  } else if (refresh) {
    const { deliveryEnabled, pickupEnabled, pickupNote, minOrderValue } = store.store as Record<string, unknown>;
    await settings.setTenant(tenantId, { ...current, ...(deliveryEnabled !== undefined && { deliveryEnabled }), ...(pickupEnabled !== undefined && { pickupEnabled }), ...(pickupNote !== undefined && { pickupNote }), ...(minOrderValue !== undefined && { minOrderValue }) } as never);
    log.info({ slug: store.shop.slug }, "demo store: delivery and pickup settings refreshed");
  }
  if ((await kit.delivery.service.listZones(tenantId)).total === 0) {
    for (const [i, z] of store.zones.entries()) {
      const zone = await kit.delivery.service.createZone(tenantId, { name: z.name, states: z.states ?? [], pincodePrefixes: z.pincodePrefixes ?? [], sort: i * 10 });
      await kit.delivery.service.createRate(tenantId, { ...z.rate, zoneId: zone.id } as never);
    }
    log.info({ slug: store.shop.slug }, "demo store: delivery zones created");
  }
}

// ---------------------------------------------------------------- catalogue

async function seedCategories(kit: Kit, tenantId: string, store: DemoStore, photos: Photos, log: Logger) {
  const svc = kit.catalogue.service;
  const existing = new Map((await svc.listCategories(tenantId)).items.map((c) => [c.name, c]));
  const ids = new Map<string, string>();
  for (const [i, c] of store.categories.entries()) {
    const found = existing.get(c.name);
    if (!found) {
      const url = await photos.get(c.photo, "tile");
      const parentId = c.parent ? (ids.get(c.parent) ?? missing("category", c.parent)) : undefined;
      const made = await svc.createCategory(tenantId, { name: c.name, description: c.description, sort: (i + 1) * 10, ...(parentId ? { parentId } : {}), ...(url ? { imageUrl: url } : {}) });
      ids.set(c.name, made.id);
      log.info({ category: c.name }, "demo store: category created");
      continue;
    }
    ids.set(c.name, found.id);
    if (!found.imageUrl || !found.description) {
      const url = found.imageUrl ? null : await photos.get(c.photo, "tile");
      await svc.updateCategory(tenantId, found.id, { ...(found.description ? {} : { description: c.description }), ...(url ? { imageUrl: url } : {}) });
    }
  }
  return ids;
}

/**
 * The trade's starter categories the store doesn't use (a menswear shop on the `fashion` pack gets "Sarees" and
 * "Kurtis") would show empty in the menu: delete them while they are still empty (no products, no sub-categories), so
 * an owner who filled one keeps it.
 */
async function dropUnusedStarterCategories(kit: Kit, tenantId: string, store: DemoStore, log: Logger) {
  const starter = store.shop.businessType ? (packFor(store.shop.businessType)?.categories ?? []) : [];
  const own = new Set(store.categories.map((c) => c.name));
  const all = (await kit.catalogue.service.listCategories(tenantId)).items;
  for (const c of all) {
    if (!starter.includes(c.name) || own.has(c.name) || c.productCount > 0 || all.some((x) => x.parentId === c.id)) continue;
    await kit.catalogue.service.deleteCategory(tenantId, c.id);
    log.info({ category: c.name }, "demo store: unused starter category removed");
  }
}

/** Variant inputs for a product: one per option combination, SKUs `<prefix>-1…n`. */
export function variantInputs(p: DemoProduct) {
  const share = p.costShare ?? 0.8;
  return p.variants.map((v, i) => ({
    sku: `${p.sku}-${i + 1}`,
    optionValues: v.values ?? {},
    price: v.price,
    mrp: v.mrp,
    cost: Math.round(v.price * share),
  }));
}

async function seedProducts(kit: Kit, tenantId: string, store: DemoStore, categories: Map<string, string>, photos: Photos, log: Logger, refreshPhotos = false) {
  const svc = kit.catalogue.service;
  const ids = new Map<string, string>();
  for (const p of store.products) {
    const existing = (await svc.listProducts(tenantId, { q: p.name, limit: 20 })).items.find((x) => x.name === p.name);
    if (existing) {
      // A store seeded before price-band GST: switch the product to its rule (nothing else is touched).
      if (p.gstRule && !(await svc.getProduct(tenantId, existing.id)).gstRule) await svc.updateProduct(tenantId, existing.id, { gstRule: p.gstRule });
      if (refreshPhotos) {
        const want = await photos.get(p.photo, "square");
        const have = (await svc.getProduct(tenantId, existing.id)).images ?? [];
        if (want && have[0]?.url !== want) {
          await svc.updateProduct(tenantId, existing.id, { images: [{ url: want, alt: p.name }, ...have.slice(1)] });
          log.info({ product: p.name }, "demo store: product picture replaced");
        }
      }
      ids.set(p.name, existing.id);
      continue;
    }
    const url = await photos.get(p.photo, "square");
    const variants = variantInputs(p);
    const product = await svc.createProduct(tenantId, {
      name: p.name,
      categoryId: categories.get(p.category) ?? missing("category", p.category),
      description: p.description,
      hsn: p.hsn,
      gstRate: p.gstRate,
      gstRule: p.gstRule ?? null,
      unit: p.unit,
      taxInclusive: true,
      channels: ["store", "billing"],
      tags: ["demo", ...(p.tags ?? [])],
      attributes: p.attributes ?? {},
      images: url ? [{ url, alt: p.name }] : [],
      ...(p.options?.length ? { options: p.options, variants } : { price: variants[0]!.price, mrp: variants[0]!.mrp, cost: variants[0]!.cost, sku: variants[0]!.sku }),
    });
    for (const [i, v] of product.variants.entries()) {
      const stock = p.variants[i]?.stock ?? 0;
      await kit.inventory.service.adjust(tenantId, v.id, { mode: "set", qty: stock, unitCost: Math.round((v.cost ?? 0) / (1 + p.gstRate / 100)), note: "Opening stock (seed)" });
    }
    ids.set(p.name, product.id);
    log.info({ product: p.name, variants: product.variants.length }, "demo store: product created");
  }
  return ids;
}

/** The shop's billing items (counter charges such as cutting and threading) stay off the online store. */
async function counterOnly(kit: Kit, tenantId: string, store: DemoStore, log: Logger) {
  const svc = kit.catalogue.service;
  for (const item of store.shop.items) {
    const found = (await svc.listProducts(tenantId, { q: item.name, limit: 20 })).items.find((x) => x.name === item.name);
    if (!found) continue;
    const product = await svc.getProduct(tenantId, found.id);
    if (!product.channels.includes("store")) continue;
    await svc.updateProduct(tenantId, found.id, { channels: product.channels.filter((c) => c !== "store") });
    log.info({ item: item.name }, "demo store: billing item kept off the online store");
  }
}

async function seedCollections(kit: Kit, tenantId: string, store: DemoStore, categories: Map<string, string>, log: Logger) {
  const svc = kit.catalogue.service;
  for (const c of store.collections) {
    const found = (await svc.listCollections(tenantId, { q: c.name })).items.some((x) => x.slug === c.slug);
    if (found) continue;
    const rule = {
      sort: c.rule.sort,
      ...(c.rule.category ? { categoryId: categories.get(c.rule.category) ?? missing("category", c.rule.category) } : {}),
      ...(c.rule.tag ? { tag: c.rule.tag } : {}),
      ...(c.rule.onSale ? { onSale: true } : {}),
    };
    await svc.createCollection(tenantId, { name: c.name, slug: c.slug, description: c.description, type: "rule", rule });
    log.info({ collection: c.slug }, "demo store: collection created");
  }
}

async function seedCoupons(kit: Kit, tenantId: string, store: DemoStore, log: Logger) {
  for (const c of store.coupons) {
    const code = String(c.code);
    if ((await kit.coupons.service.list(tenantId, { q: code })).items.some((x) => x.code === code)) continue;
    await kit.coupons.service.create(tenantId, c as never);
    log.info({ code }, "demo store: coupon created");
  }
}
