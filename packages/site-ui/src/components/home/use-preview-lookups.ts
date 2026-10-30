"use client";

import * as React from "react";
import { useQueries } from "@tanstack/react-query";
import { api, ApiError } from "@rbms/web";
import { referencedIds, type PreviewLookups, type SectionForm } from "../../lib/sections";
import { sk, useCategories, useProductsByIds } from "../../lib/queries";
import type { CategoryRef, PublicCollectionPage, PublicProductSummary } from "../../lib/types";

const COLLECTION_PREVIEW_LIMIT = 24;

/** Catalogue data the live preview needs for the sections being edited (cached; loads only what is referenced). */
export function usePreviewLookups(forms: readonly SectionForm[]): { lookups: PreviewLookups; loading: boolean } {
  const refs = referencedIds(forms);
  const cats = useCategories(refs.categories);
  const products = useProductsByIds(refs.products);
  const cols = useQueries({
    queries: refs.collections.map((slug) => ({
      queryKey: sk.publicCollection(slug, COLLECTION_PREVIEW_LIMIT),
      retry: 0,
      staleTime: 60_000,
      queryFn: () =>
        api
          .get<PublicCollectionPage>(`/catalog/public/collections/${encodeURIComponent(slug)}`, { limit: COLLECTION_PREVIEW_LIMIT }, { anonymous: true })
          .catch((err: unknown) => {
            if (err instanceof ApiError && err.status === 404) return null;
            throw err;
          }),
    })),
  });

  const catRefs = React.useMemo<CategoryRef[] | undefined>(
    () =>
      cats.data
        ?.filter((c) => c.active)
        .sort((a, b) => a.sort - b.sort)
        .map((c) => ({ id: c.id, name: c.name, slug: c.slug, image: c.imageUrl })),
    [cats.data],
  );
  const productMap = React.useMemo(() => {
    const m = new Map<string, PublicProductSummary>();
    for (const [id, p] of products.data ?? []) {
      m.set(id, { id: p.id, name: p.name, slug: p.slug, categoryId: p.categoryId, categoryName: p.categoryName, image: p.image, priceMin: p.priceMin, priceMax: p.priceMax, mrp: null });
    }
    return m;
  }, [products.data]);
  // Small (a few collections): rebuilt each render.
  const collectionMap = new Map<string, { name: string; slug: string; products: PublicProductSummary[] }>();
  cols.forEach((c, i) => {
    const d = c.data;
    if (d) collectionMap.set(refs.collections[i] ?? d.collection.slug, { name: d.collection.name, slug: d.collection.slug, products: d.items });
  });

  const loading = (refs.categories && cats.isPending) || (refs.products.length > 0 && products.isPending) || cols.some((c) => c.isPending);
  return { lookups: { categories: catRefs, products: productMap, collections: collectionMap }, loading };
}
