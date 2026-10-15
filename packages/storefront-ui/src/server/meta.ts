import type { Metadata } from "next";
import { defaultMeta, type MetaEntity, type PageMeta } from "@srirealtime/cms/seo";
import { getConfig, getRequestInfo } from "./api";

/** cms `PageMeta` → Next `Metadata`. */
export function toMetadata(m: PageMeta): Metadata {
  return {
    title: { absolute: m.title },
    description: m.description,
    alternates: { canonical: m.canonical },
    ...(m.robots ? { robots: { index: false, follow: false } } : {}),
    openGraph: {
      title: m.openGraph.title,
      description: m.openGraph.description,
      url: m.openGraph.url,
      // Next's OG types don't include "product"; products are described by their JSON-LD instead.
      type: m.openGraph.type === "article" ? "article" : "website",
      siteName: m.openGraph.siteName,
      locale: m.openGraph.locale,
      images: m.openGraph.images,
      ...(m.openGraph.publishedTime ? { publishedTime: m.openGraph.publishedTime } : {}),
      ...(m.openGraph.modifiedTime ? { modifiedTime: m.openGraph.modifiedTime } : {}),
    },
    twitter: { card: m.twitter.card, title: m.twitter.title, description: m.twitter.description, ...(m.twitter.images ? { images: m.twitter.images } : {}) },
  };
}

/** Metadata for an entity of the current shop (title/description/canonical/OG via cms `defaultMeta`). */
export async function storeMetadata(entity: MetaEntity, extra?: { tagline?: string | null }): Promise<Metadata> {
  const [info, config] = await Promise.all([getRequestInfo(), getConfig()]);
  if (!config) return { title: "Store not found", robots: { index: false } };
  const meta = defaultMeta(
    { name: config.shop.name, baseUrl: info.baseUrl, logoUrl: config.shop.logoUrl, tagline: extra?.tagline ?? null, locale: info.locale === "ta" ? "ta_IN" : "en_IN" },
    entity,
  );
  return toMetadata(meta);
}
