/* COPY of packages/cms/src/slug.ts (pure). */
import { SLUG_MAX, SLUG_RE } from "./content";

/**
 * Storefront path segments a page slug may not take (pages live at `/<slug>`). Applied to post slugs too so the
 * two can move between `/` and `/blog/` freely.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "cart",
  "checkout",
  "account",
  "search",
  "products",
  "p",
  "c",
  "collections",
  "blog",
  "track",
  "i",
  "s",
  "api",
]);

export const isReservedSlug = (slug: string) => RESERVED_SLUGS.has(slug);
export const isValidSlug = (slug: string) => slug.length > 0 && slug.length <= SLUG_MAX && SLUG_RE.test(slug);

const shortId = () => Math.random().toString(36).slice(2, 8).padEnd(6, "0");

/** "About Us!" → "about-us"; names without Latin letters/digits fall back to `<prefix>-<shortid>`. */
export function slugify(title: string, prefix = "page", id: () => string = shortId): string {
  const ascii = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const cut = ascii.slice(0, SLUG_MAX).replace(/-+$/, "");
  return cut || `${prefix}-${id()}`;
}

/** `base`, else `base-2`, `base-3`, … — the first that is neither taken nor reserved. */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  const free = (s: string) => !taken.has(s) && !isReservedSlug(s);
  if (free(base)) return base;
  const stem = base.slice(0, SLUG_MAX - 4).replace(/-+$/, "");
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}`;
    if (free(candidate)) return candidate;
  }
}

export type SlugProblem = "invalid" | "reserved" | "taken";

/** Why an owner-chosen slug can't be used, or null when it can. */
export function slugProblem(slug: string, taken: ReadonlySet<string>): SlugProblem | null {
  if (!isValidSlug(slug)) return "invalid";
  if (isReservedSlug(slug)) return "reserved";
  if (taken.has(slug)) return "taken";
  return null;
}
