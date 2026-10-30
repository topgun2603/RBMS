/**
 * Home page words in another language (`HomeDoc.translations`, e.g. `{ ta: { "<section id>": { heading: "…" } } }`).
 * A translation is a sparse copy of a section with only its words: objects are matched by key, arrays (slides, items,
 * FAQ entries …) by position. Only text replaces text: links, pictures, ids, product / collection references, icons,
 * layouts and every other non-word key always come from the section itself, so a translation can never change what a
 * section shows or where it links. Sections without an id, or without a translation, stay as they are.
 *
 * Pure and dependency-free: the storefront imports it as `@rbms/cms/localize`.
 */

/** Languages a home page can carry translations for (English is the page itself). */
export const HOME_TRANSLATION_LOCALES = ["ta"] as const;
export type HomeTranslationLocale = (typeof HOME_TRANSLATION_LOCALES)[number];

/** locale → section id → the section's words in that language. */
export type HomeTranslations = Partial<Record<string, Record<string, unknown>>>;

/**
 * Keys whose values are never words (references, links, pictures, settings) or come from the catalogue once resolved
 * (products, categories, the collection): a translation can't touch them.
 */
const NOT_WORDS = new Set([
  "products",
  "product",
  "categories",
  "collection",
  "hotspots",
  "id",
  "type",
  "hidden",
  "style",
  "layout",
  "columns",
  "href",
  "url",
  "imageUrl",
  "mobileImageUrl",
  "videoUrl",
  "posterUrl",
  "photoUrl",
  "beforeUrl",
  "afterUrl",
  "productId",
  "productIds",
  "categoryIds",
  "collectionSlug",
  "source",
  "icon",
  "code",
  "endsAt",
  "coords",
  "mapLink",
  "phone",
  "whatsapp",
  "handle",
  "tag",
  "imageSide",
  "diet",
  "instagram",
  "facebook",
  "linkedin",
  "website",
  // flash sale, finder, comparison: dates, filters and references
  "startsAt",
  "categoryId",
  "filterName",
  "filterValue",
  "keywords",
  "highlightId",
  // size finder: the option name and the size values match the catalogue
  "optionName",
  "sizes",
  // shade finder: shade values and the second option's name match the catalogue's options
  "shades",
  "alsoOption",
  // flash sale: its daily window (times)
  "daily",
]);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** `base` with the words from `patch` (same shape, only strings replace strings). */
export function overlayWords<T>(base: T, patch: unknown): T {
  if (typeof base === "string") return (typeof patch === "string" && patch.trim() ? patch : base) as T;
  if (Array.isArray(base)) {
    if (!Array.isArray(patch)) return base;
    return base.map((item, i) => overlayWords(item, patch[i])) as T;
  }
  if (isObject(base)) {
    if (!isObject(patch)) return base;
    let out: Record<string, unknown> | null = null;
    for (const [k, v] of Object.entries(patch)) {
      if (NOT_WORDS.has(k) || !(k in base)) continue;
      const next = overlayWords(base[k], v);
      if (next !== base[k]) (out ??= { ...base })[k] = next;
    }
    return (out ?? base) as T;
  }
  return base;
}

/** The sections in `locale` (English, a locale without translations or a section without one: unchanged). */
export function localizeSections<S extends { id?: string }>(sections: readonly S[], translations: HomeTranslations | null | undefined, locale: string | null | undefined): S[] {
  const words = locale && locale !== "en" ? translations?.[locale] : undefined;
  if (!isObject(words)) return [...sections];
  return sections.map((s) => (s.id && isObject(words[s.id]) ? overlayWords(s, words[s.id]) : s));
}
