import type { CartProduct } from "./cart";
import { itemName } from "./products";
import type { CatalogPage, PosItem } from "./terminal-types";

/**
 * The POS catalogue cache (GET /v1/pos/catalog): full sync, delta sync with `since` (changed items + removed ids),
 * paging with `next`. Pure: the fetch and the store are passed in, so the rules are unit tested. A sync is applied
 * only after its last page arrived, so a failure half-way leaves the previous cache as it was.
 */

export interface CatalogSnapshot {
  items: Map<string, PosItem>;
  /** Cursor for the next delta sync (null = never synced: full). */
  cursor: string | null;
  /** ms of the last successful sync. */
  syncedAt: number | null;
}

export const emptySnapshot = (): CatalogSnapshot => ({ items: new Map(), cursor: null, syncedAt: null });

/** What a sync changed, as the store needs it. `replace` = drop everything first (a full sync). */
export interface CatalogChange {
  replace: boolean;
  upserts: PosItem[];
  removes: string[];
  cursor: string;
  syncedAt: number;
}

export interface CatalogStore {
  read(): Promise<{ items: PosItem[]; cursor: string | null; syncedAt: number | null } | null>;
  write(change: CatalogChange): Promise<void>;
}

export type FetchCatalogPage = (q: { since?: string; after?: string; limit: number }) => Promise<CatalogPage>;

export const PAGE_LIMIT = 1000;
/** A guard against a server that never ends paging. */
const MAX_PAGES = 200;

/** Fetches every page of one sync and folds them into a change (not yet applied). */
export async function fetchCatalogChange(fetchPage: FetchCatalogPage, cursor: string | null, now = Date.now()): Promise<CatalogChange> {
  const since = cursor ?? undefined;
  let after: string | undefined;
  let replace = false;
  const upserts = new Map<string, PosItem>();
  const removes = new Set<string>();
  let last: CatalogPage | null = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    // `since` on the first page only; later pages carry `after` alone (never both).
    const page = await fetchPage(after ? { after, limit: PAGE_LIMIT } : { ...(since ? { since } : {}), limit: PAGE_LIMIT });
    if (i === 0 && (page.full || !since)) replace = true;
    for (const id of page.removed ?? []) {
      removes.add(id);
      upserts.delete(id);
    }
    for (const item of page.items) {
      // Archived / inactive items leave the cache like removed ones.
      if (!item.active) {
        upserts.delete(item.itemId);
        removes.add(item.itemId);
      } else {
        upserts.set(item.itemId, item);
        removes.delete(item.itemId);
      }
    }
    last = page;
    if (!page.next) break;
    after = page.next;
  }
  return { replace, upserts: [...upserts.values()], removes: replace ? [] : [...removes], cursor: last!.cursor, syncedAt: now };
}

/** The snapshot after a change. Returns a new snapshot (the old one is untouched). */
export function applyCatalogChange(snap: CatalogSnapshot, change: CatalogChange): CatalogSnapshot {
  const items = change.replace ? new Map<string, PosItem>() : new Map(snap.items);
  for (const id of change.removes) items.delete(id);
  for (const it of change.upserts) items.set(it.itemId, it);
  return { items, cursor: change.cursor, syncedAt: change.syncedAt };
}

/** One sync round: fetch all pages, persist, return the new snapshot and whether anything changed. */
export async function syncCatalog(
  snap: CatalogSnapshot,
  fetchPage: FetchCatalogPage,
  store?: CatalogStore | null,
  now = Date.now(),
): Promise<{ snapshot: CatalogSnapshot; changed: boolean; full: boolean }> {
  const change = await fetchCatalogChange(fetchPage, snap.cursor, now);
  const snapshot = applyCatalogChange(snap, change);
  const changed = change.replace || change.upserts.length > 0 || change.removes.length > 0;
  if (store) {
    try {
      await store.write(change);
    } catch {
      // No IndexedDB (private mode, quota): the cache lives in memory for this visit.
    }
  }
  return { snapshot, changed, full: change.replace };
}

export function snapshotFrom(saved: { items: PosItem[]; cursor: string | null; syncedAt: number | null } | null): CatalogSnapshot {
  if (!saved) return emptySnapshot();
  return { items: new Map(saved.items.map((i) => [i.itemId, i])), cursor: saved.cursor, syncedAt: saved.syncedAt };
}

// ---------------------------------------------------------------- lookup and search

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

export interface CatalogIndex {
  /** Barcode (exact) and SKU (upper case) → item. */
  byCode: Map<string, PosItem>;
  /** Scales PLU → item. */
  byPlu: Map<string, PosItem>;
  /** Sorted by name; each with its search text. */
  list: { item: PosItem; text: string }[];
}

export function buildCatalogIndex(items: Iterable<PosItem>): CatalogIndex {
  const byCode = new Map<string, PosItem>();
  const byPlu = new Map<string, PosItem>();
  const list: { item: PosItem; text: string }[] = [];
  for (const item of items) {
    if (!item.active) continue;
    for (const b of item.barcodes) if (b) byCode.set(b.trim(), item);
    if (item.sku && !byCode.has(item.sku.trim().toUpperCase())) byCode.set(item.sku.trim().toUpperCase(), item);
    if (item.plu) byPlu.set(String(Number(item.plu)), item);
    list.push({ item, text: norm([item.name, item.variantTitle, item.sku ?? "", ...item.barcodes, item.plu ?? ""].join(" ")) });
  }
  list.sort((a, b) => a.item.name.localeCompare(b.item.name) || a.item.variantTitle.localeCompare(b.item.variantTitle));
  return { byCode, byPlu, list };
}

/** A scanned / typed code in the cache: barcode exactly, else SKU (any case). */
export function findByCode(index: CatalogIndex, code: string): PosItem | null {
  const c = code.trim();
  if (!c) return null;
  return index.byCode.get(c) ?? index.byCode.get(c.toUpperCase()) ?? null;
}

/** By scales PLU ("42", "00042"). */
export const findByPlu = (index: CatalogIndex, plu: string) => (/^\d+$/.test(plu.trim()) ? (index.byPlu.get(String(Number(plu.trim()))) ?? null) : null);

/**
 * Search over the cache: every word must appear in the name / variant / SKU / barcode / PLU. Ranked: exact code, then
 * names starting with the query, then the rest (name order). `categoryId` narrows; `weightFirst` puts by-weight
 * items first (the weighing station).
 */
export function searchCatalog(
  index: CatalogIndex,
  q: string,
  opts: { categoryId?: string | null; limit?: number; weightFirst?: boolean } = {},
): PosItem[] {
  const limit = opts.limit ?? 60;
  const needle = norm(q.trim());
  const words = needle.split(/\s+/).filter(Boolean);
  const exact = needle ? findByCode(index, q) : null;
  const scored: { item: PosItem; rank: number; i: number }[] = [];
  index.list.forEach(({ item, text }, i) => {
    if (opts.categoryId && item.categoryId !== opts.categoryId) return;
    if (words.length && !words.every((w) => text.includes(w))) return;
    let rank = 2;
    if (exact && exact.itemId === item.itemId) rank = 0;
    else if (needle && norm(item.name).startsWith(needle)) rank = 1;
    if (opts.weightFirst && item.soldBy !== "weight") rank += 10;
    scored.push({ item, rank, i });
  });
  scored.sort((a, b) => a.rank - b.rank || a.i - b.i);
  return scored.slice(0, limit).map((s) => s.item);
}

/** The cart's product for a cached item. */
export function fromPosItem(i: PosItem): CartProduct & { soldBy: PosItem["soldBy"] } {
  return {
    itemId: i.itemId,
    productId: i.productId,
    // The API already sends "Product – Variant"; older answers sent the parts.
    name: i.variantTitle && !i.name.includes(i.variantTitle) ? itemName(i.name, i.variantTitle) : i.name,
    sku: i.sku,
    barcode: i.barcodes[0] ?? null,
    hsn: i.hsn,
    unit: i.unit || (i.soldBy === "weight" ? "kg" : "pcs"),
    price: i.price,
    taxInclusive: i.taxInclusive,
    gstRate: i.gstRate,
    ...(i.gstRule ? { gstRule: i.gstRule } : {}),
    image: i.image,
    soldBy: i.soldBy,
  };
}
