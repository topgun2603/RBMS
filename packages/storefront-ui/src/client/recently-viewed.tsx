"use client";

import * as React from "react";
import { HistoryIcon } from "lucide-react";
import { Reveal } from "@rbms/ui/motion";
import type { ProductSummary } from "../types";
import { SectionTitle } from "../components/bits";
import { Carousel } from "./carousel";
import { ProductCardView } from "./product-card";
import { useStore } from "./store-context";

const KEY = "sr_recent";
const MAX = 12;
const EVENT = "sr:recent";

type Recent = Pick<ProductSummary, "id" | "name" | "slug" | "image" | "priceMin" | "priceMax" | "mrp" | "variantCount" | "categoryName" | "taxInclusive" | "kind" | "service"> & {
  /** Older entries have none (recommendations then skip them). */
  categoryId?: string | null;
  at: number;
};

/** This browser's recently viewed products, most recent first (empty when storage is blocked). */
export const readRecent = (): Recent[] => read();

function read(): Recent[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? (v as Recent[]).filter((x) => x && typeof x.slug === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

/** Product page: remembers this product (in this browser only). */
export function RecordRecentlyViewed({ product }: { product: Omit<Recent, "at"> }) {
  React.useEffect(() => {
    try {
      const next = [{ ...product, at: Date.now() }, ...read().filter((x) => x.id !== product.id)].slice(0, MAX);
      localStorage.setItem(KEY, JSON.stringify(next));
      window.dispatchEvent(new Event(EVENT));
    } catch {
      /* storage blocked */
    }
  }, [product]);
  return null;
}

/** "Recently viewed" rail (client-only; renders nothing until there is history, so it never shifts the page on load). */
export function RecentlyViewedStrip({ excludeId, className, title }: { excludeId?: string; className?: string; /** The home section's own title. */ title?: string }) {
  const { t } = useStore();
  const [items, setItems] = React.useState<Recent[]>([]);
  React.useEffect(() => {
    const load = () => setItems(read().filter((x) => x.id !== excludeId));
    load();
    window.addEventListener(EVENT, load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener(EVENT, load);
      window.removeEventListener("storage", load);
    };
  }, [excludeId]);
  if (items.length < 2) return null;
  return (
    <Reveal as="section" className={className} aria-label={title || t("recent.title")}>
      <SectionTitle title={title || t("recent.title")} eyebrow={t("recent.eyebrow")} badge={<HistoryIcon className="size-5 text-muted-foreground" aria-hidden />} />
      <Carousel label={title || t("recent.title")}>
        {items.map(({ at: _at, ...p }) => (
          <ProductCardView key={p.id} product={{ ...p, categoryId: p.categoryId ?? null }} />
        ))}
      </Carousel>
    </Reveal>
  );
}
