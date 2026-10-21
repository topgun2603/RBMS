import type { NavCategory } from "../client/header";
import type { Category, HomeSection, StoreThemeView } from "../types";

/** Store chrome (header / footer) helpers that only need data. */

/**
 * Whether the home page opens with a full-width banner the transparent header can sit on: a slide hero (any look but
 * "split") or a video hero, without its own band or spacing around it.
 */
export function opensWithFullBleedHero(sections: HomeSection[], theme: StoreThemeView): boolean {
  const first = sections[0];
  if (!first) return false;
  const full = (first.type === "hero" && theme.hero !== "split" && first.slides.length > 0) || first.type === "hero-video";
  const st = first.style;
  return full && !(st?.background && st.background !== "none") && !(st?.padding && st.padding !== "normal") && !st?.hideOnMobile && !st?.hideOnDesktop;
}

/** Top-level categories for the menu, each with its sub-categories. */
export function navCategories(all: Category[]): NavCategory[] {
  return all
    .filter((c) => !c.parentId)
    .map((c) => {
      const children = all.filter((x) => x.parentId === c.id).map((x) => ({ id: x.id, name: x.name, slug: x.slug }));
      return { id: c.id, name: c.name, slug: c.slug, imageUrl: c.imageUrl, ...(children.length ? { children } : {}) };
    });
}
