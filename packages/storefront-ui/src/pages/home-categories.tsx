import * as React from "react";
import Link from "next/link";
import { ArrowRightIcon, ArrowUpRightIcon } from "lucide-react";
import { STORE_PATHS } from "@srirealtime/cms/seo";
import { cn } from "@srirealtime/ui/lib/utils";
import { Carousel } from "../client/carousel";
import { CategoryArt } from "../components/category-art";
import { Container, SectionTitle } from "../components/bits";
import type { Translator } from "../lib/messages";
import type { CategoryColumns, HomeSectionOf } from "../types";

/*
 * The categories section in all its layouts, plus the bento grid shared with the category-mosaic section. Server
 * components. Every tile goes through CategoryArt: the photo when there is one, else a brand-tinted icon picked from
 * the name. Rows of round tiles / chips are centred when they don't fill the row (section style align "start" keeps
 * them at the left); grid layouts with fewer tiles than columns shrink to fit instead of leaving a gap on the right.
 */

type CategoriesSection = HomeSectionOf<"categories">;
type Cat = CategoriesSection["categories"][number];

const COLS: Record<Exclude<CategoryColumns, "auto">, number> = { "3": 3, "4": 4, "5": 5, "6": 6 };
const zoom = "transition-transform duration-700 ease-out group-hover:scale-[1.07] motion-reduce:transition-none motion-reduce:group-hover:scale-100";
const lift = "transition-[translate,box-shadow,border-color] duration-300 ease-out hover:-translate-y-1 motion-reduce:transition-none motion-reduce:hover:translate-y-0";

/**
 * Columns for `n` tiles: tablets and desktops use at most `n` columns (so three tiles fill the row), auto prefers a
 * count without a half-empty last row, and a row narrower than the layout's own is capped at `tileMax` px per column.
 */
export function gridFit(n: number, auto: { sm: number; lg: number }, columns: CategoryColumns | undefined, tileMax: number) {
  const fixed = columns && columns !== "auto";
  const want = fixed ? COLS[columns] : auto.lg;
  let lg = Math.max(1, Math.min(n, want));
  // Auto: prefer a count that leaves no half-empty last row (6 tiles → 3 + 3 rather than 4 + 2).
  if (!fixed && n > lg && n % lg) lg = [lg - 1, lg - 2].find((c) => c >= 2 && n % c === 0) ?? lg;
  const sm = Math.max(1, Math.min(n, auto.sm, lg));
  const style = { "--c-sm": sm, "--c-lg": lg, ...(lg < want ? { maxWidth: `calc(${lg} * ${tileMax}px + ${lg - 1} * 1.25rem)` } : {}) } as React.CSSProperties;
  return { sm, lg, style };
}

/** A tile in a wrapping row of --c-ph / --c-sm / --c-lg columns (a short last row is centred, not left hanging). */
const FLEX_ITEM =
  "min-w-0 shrink-0 basis-[calc((100%_-_(var(--c-ph)_-_1)_*_0.75rem)_/_var(--c-ph))] sm:basis-[calc((100%_-_(var(--c-sm)_-_1)_*_1.25rem)_/_var(--c-sm))] lg:basis-[calc((100%_-_(var(--c-lg)_-_1)_*_1.25rem)_/_var(--c-lg))]";

/** Slider card widths per desktop column count. */
const SLIDER_WIDTH: Record<CategoryColumns, string> = {
  auto: "w-[64%] sm:w-[38%] lg:w-[24%] xl:w-[23%]",
  "3": "w-[64%] sm:w-[42%] lg:w-[32%]",
  "4": "w-[64%] sm:w-[38%] lg:w-[24%]",
  "5": "w-[58%] sm:w-[31%] lg:w-[19%]",
  "6": "w-[52%] sm:w-[28%] lg:w-[15.8%]",
};

/**
 * Category tiles (see CATEGORY_LAYOUTS in @srirealtime/cms for the list). `counts` (product counts, from the search
 * facets) show when the section asks for them.
 */
export function CategoriesSectionView({ s, t, counts }: { s: CategoriesSection; t: Translator; counts?: ReadonlyMap<string, number> }) {
  const layout = s.layout ?? "circles";
  const start = s.style?.align === "start";
  const cats = s.categories;
  const n = cats.length;
  // The facet list only names categories that have products: a missing id means 0 (when the counts loaded at all).
  const countOf = (id: string) => (s.showCounts && counts ? (counts.get(id) ?? 0) : undefined);
  const countText = (id: string) => {
    const c = countOf(id);
    if (c === undefined) return undefined;
    return c > 0 ? t("sections.productsCount", { count: c }) : t("sections.comingSoon");
  };
  const countLine = (id: string, cls = "text-xs text-muted-foreground") => {
    const text = countText(id);
    return text ? <span className={cn("block", cls)}>{text}</span> : null;
  };
  const title = s.title ? <SectionTitle title={s.title} eyebrow={t("home.explore")} href={STORE_PATHS.products} linkLabel={t("list.viewAll")} /> : null;
  const label = s.title || t("nav.categories");
  const href = (c: Cat) => STORE_PATHS.category(c.slug);
  const frame = (body: React.ReactNode) => (
    <Container>
      {title}
      {body}
    </Container>
  );

  // ---------------------------------------------------------------- round / app-icon / story rows
  if (layout === "circles" || layout === "rounded-squares" || layout === "story-rings") {
    const item = {
      circles: "w-[5.75rem] sm:w-28 lg:w-[8.5rem]",
      "rounded-squares": "w-[5.25rem] sm:w-[6.5rem] lg:w-[7.75rem]",
      "story-rings": "w-[5rem] sm:w-24 lg:w-28",
    }[layout];
    return frame(
      <ul
        aria-label={label}
        data-layout={layout}
        className={cn(
          "-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto overscroll-x-contain px-4 pt-2 pb-3 scrollbar-none sm:mx-0 sm:flex-wrap sm:gap-x-6 sm:gap-y-7 sm:overflow-visible sm:px-0 lg:gap-x-9",
          start ? "" : "max-sm:[&>li:first-child]:ms-auto max-sm:[&>li:last-child]:me-auto sm:justify-center",
        )}
      >
        {cats.map((c, i) => (
          <li key={c.id} className={cn("shrink-0 snap-start", item)}>
            <Link href={href(c)} className="group flex flex-col items-center gap-2.5 rounded-2xl p-1 text-center focus-ring sm:gap-3">
              {layout === "story-rings" ? (
                <span className="sf-story-ring block aspect-square w-full rounded-full p-[3px] transition-transform duration-300 group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100">
                  <span className="block size-full rounded-full bg-background p-[3px]">
                    <span className="block size-full overflow-hidden rounded-full">
                      <CategoryArt name={c.name} slug={c.slug} image={c.image} tone={i} imageClassName={zoom} />
                    </span>
                  </span>
                </span>
              ) : (
                <span
                  className={cn(
                    "relative block aspect-square w-full overflow-hidden shadow-card ring-1 ring-border/70 transition-[translate,box-shadow] duration-300 ease-out group-hover:-translate-y-1 group-hover:shadow-lift group-hover:ring-2 group-hover:ring-primary/70 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0",
                    layout === "circles" ? "rounded-full" : "rounded-[28%]",
                  )}
                >
                  <CategoryArt name={c.name} slug={c.slug} image={c.image} tone={i} imageClassName={zoom} />
                </span>
              )}
              <span className="block w-full">
                <span className={cn("sf-keep-center line-clamp-2 block font-semibold leading-snug transition-colors group-hover:text-primary", layout === "story-rings" ? "text-xs sm:text-sm" : "text-sm sm:text-[0.95rem]")}>{c.name}</span>
                {countLine(c.id, "mt-0.5 text-[11px] text-muted-foreground sm:text-xs")}
              </span>
            </Link>
          </li>
        ))}
      </ul>,
    );
  }

  // ---------------------------------------------------------------- chips
  if (layout === "pills") {
    return frame(
      <ul
        aria-label={label}
        data-layout="pills"
        className={cn("-mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto overscroll-x-contain px-4 py-1.5 scrollbar-none sm:gap-2.5", !start && "[&>li:first-child]:ms-auto [&>li:last-child]:me-auto")}
      >
        {cats.map((c, i) => {
          const count = countOf(c.id);
          return (
            <li key={c.id} className="shrink-0 snap-start">
              <Link
                href={href(c)}
                className="group flex items-center gap-2.5 rounded-full border bg-card py-1.5 ps-1.5 pe-4 text-card-foreground shadow-xs transition-[translate,border-color,background-color,box-shadow] duration-300 hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-card focus-ring motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                <span className="block size-9 shrink-0 overflow-hidden rounded-full sm:size-10">
                  <CategoryArt name={c.name} slug={c.slug} image={c.image} tone={i} compact />
                </span>
                <span className="text-sm font-semibold whitespace-nowrap transition-colors group-hover:text-primary">{c.name}</span>
                {count !== undefined && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-muted-foreground tabular-nums" title={countText(c.id)} data-count={count}>
                    {count > 0 ? count : t("sections.comingSoon")}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>,
    );
  }

  if (layout === "icon-list") {
    return frame(
      <ul data-layout="icon-list" className={cn("flex flex-wrap gap-2 sm:gap-3", !start && "justify-center")}>
        {cats.map((c, i) => (
          <li key={c.id}>
            <Link href={href(c)} className="group flex items-center gap-3 rounded-full border bg-card py-1.5 ps-1.5 pe-5 text-card-foreground transition-[border-color,box-shadow] hover:border-primary/50 hover:shadow-card focus-ring">
              <span className="block size-11 shrink-0 overflow-hidden rounded-full">
                <CategoryArt name={c.name} slug={c.slug} image={c.image} tone={i} compact />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold group-hover:text-primary">{c.name}</span>
                {countLine(c.id, "text-[11px] text-muted-foreground")}
              </span>
            </Link>
          </li>
        ))}
      </ul>,
    );
  }

  // ---------------------------------------------------------------- grids
  if (layout === "cards" || layout === "tiles" || layout === "big-grid" || layout === "banner-row") {
    const spec = {
      cards: { phone: n % 2 === 1 && n % 3 === 0 ? 3 : 2, auto: { sm: 3, lg: 6 }, max: 220 },
      tiles: { phone: 2, auto: { sm: 3, lg: 4 }, max: 300 },
      "big-grid": { phone: 1, auto: { sm: 2, lg: 3 }, max: 440 },
      "banner-row": { phone: 1, auto: { sm: 2, lg: 3 }, max: 440 },
    }[layout];
    const fit = gridFit(n, spec.auto, s.columns, spec.max);
    return frame(
      <ul data-layout={layout} className={cn("flex flex-wrap gap-3 sm:gap-5", !start && "mx-auto justify-center")} style={{ ...fit.style, "--c-ph": spec.phone } as React.CSSProperties}>
        {cats.map((c, i) => (
          <li key={c.id} className={FLEX_ITEM}>
            {layout === "cards" ? (
              <Link href={href(c)} className={cn("group block overflow-hidden rounded-[var(--sf-radius-card)] border bg-card text-card-foreground shadow-xs hover:border-primary/40 hover:shadow-lift focus-ring", lift)}>
                <span className="relative block aspect-square overflow-hidden">
                  <CategoryArt name={c.name} slug={c.slug} image={c.image} tone={i} eager={i < 3} imageClassName={zoom} />
                </span>
                <span className="block px-3 py-3 text-center">
                  <span className="sf-keep-center block truncate text-sm font-semibold group-hover:text-primary sm:text-[0.95rem]">{c.name}</span>
                  {countLine(c.id, "sf-keep-center mt-0.5 text-xs text-muted-foreground")}
                </span>
              </Link>
            ) : layout === "banner-row" ? (
              <Link href={href(c)} className={cn("group flex items-center gap-4 rounded-[var(--sf-radius-card)] border bg-card p-2.5 pe-4 text-card-foreground shadow-xs hover:border-primary/40 hover:shadow-lift focus-ring sm:gap-5 sm:pe-5", lift)}>
                <span className="relative block size-20 shrink-0 overflow-hidden rounded-[calc(var(--sf-radius-card)-0.25rem)] sm:size-24">
                  <CategoryArt name={c.name} slug={c.slug} image={c.image} tone={i} eager={i < 3} imageClassName={zoom} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-lg leading-tight font-semibold sm:text-xl">{c.name}</span>
                  {countLine(c.id, "mt-1 text-sm text-muted-foreground")}
                  <span className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                    {t("sections.shopCategory")}
                    <ArrowRightIcon aria-hidden className="size-4 transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transition-none rtl:rotate-180" />
                  </span>
                </span>
              </Link>
            ) : (
              <Link href={href(c)} className={cn("group relative block overflow-hidden rounded-[var(--sf-radius-card)] bg-muted text-white shadow-card hover:shadow-lift focus-ring", lift)}>
                <span className={cn("relative block overflow-hidden", layout === "tiles" ? "aspect-square" : "aspect-[4/3]")}>
                  <CategoryArt name={c.name} slug={c.slug} image={c.image} tone={i} bold eager={i < 3} imageClassName={zoom} />
                  <span aria-hidden className={cn("absolute inset-0 bg-gradient-to-t to-transparent", c.image ? "from-black/75 via-black/15" : "from-black/35 via-transparent")} />
                </span>
                <span className={cn("absolute inset-x-0 bottom-0 flex items-end justify-between gap-3", layout === "tiles" ? "p-3.5 sm:p-4" : "p-5")}>
                  <span className="min-w-0">
                    <span className={cn("block font-display leading-tight font-semibold [text-shadow:0_1px_12px_rgb(0_0_0/0.3)]", layout === "tiles" ? "text-base sm:text-lg" : "text-xl sm:text-2xl")}>{c.name}</span>
                    {countLine(c.id, "mt-0.5 text-xs text-white/85 sm:text-sm")}
                  </span>
                  <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/20 backdrop-blur transition-colors group-hover:bg-white group-hover:text-neutral-900 sm:size-10">
                    {layout === "tiles" ? <ArrowUpRightIcon className="size-4 rtl:-scale-x-100" /> : <ArrowRightIcon className="size-4 rtl:rotate-180" />}
                  </span>
                </span>
              </Link>
            )}
          </li>
        ))}
      </ul>,
    );
  }

  if (layout === "bento") {
    return frame(<CategoryBento categories={cats} t={t} count={countText} />);
  }

  if (layout === "minimal-list") {
    const want = s.columns && s.columns !== "auto" ? Math.min(3, COLS[s.columns]) : n > 4 ? 2 : 1;
    const cols = Math.max(1, Math.min(want, n));
    return frame(
      <ul data-layout="minimal-list" className={cn("grid gap-x-12 border-t", cols === 1 ? "max-w-3xl" : cols === 2 ? "lg:grid-cols-2" : "md:grid-cols-2 lg:grid-cols-3", !start && "mx-auto")}>
        {cats.map((c, i) => (
          <li key={c.id} className="border-b">
            <Link href={href(c)} className="group flex items-center gap-4 rounded-md py-4 focus-ring sm:gap-5 sm:py-5">
              <span aria-hidden className="w-7 shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="min-w-0 flex-1 transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transition-none rtl:group-hover:-translate-x-1">
                <span className="block truncate font-display text-xl leading-tight font-semibold transition-colors group-hover:text-primary sm:text-2xl">{c.name}</span>
                {countLine(c.id, "mt-0.5 text-sm text-muted-foreground")}
              </span>
              <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full border transition-colors duration-300 group-hover:border-primary group-hover:bg-primary group-hover:text-primary-foreground">
                <ArrowRightIcon className="size-4 rtl:rotate-180" />
              </span>
            </Link>
          </li>
        ))}
      </ul>,
    );
  }

  // ---------------------------------------------------------------- slider (big portrait cards, arrows + snap)
  const cols = s.columns ?? "auto";
  const fitsDesktop = n <= (cols === "auto" ? 4 : COLS[cols]);
  return frame(
    <Carousel label={label} itemClassName={SLIDER_WIDTH[cols]} className={cn(fitsDesktop && !start && "lg:[&>ul]:justify-center")}>
      {cats.map((c, i) => (
        <Link key={c.id} href={href(c)} data-layout="slider" className="group relative block overflow-hidden rounded-[var(--sf-radius-card)] bg-muted text-white shadow-card focus-ring">
          <span className="relative block aspect-[3/4] overflow-hidden">
            <CategoryArt name={c.name} slug={c.slug} image={c.image} tone={i} bold eager={i < 2} imageClassName={zoom} />
          </span>
          <span aria-hidden className={cn("absolute inset-0 bg-gradient-to-t to-transparent", c.image ? "from-black/70 via-black/5" : "from-black/35 via-transparent")} />
          <span className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
            <span className="block font-display text-lg leading-tight font-semibold [text-shadow:0_1px_12px_rgb(0_0_0/0.3)] sm:text-xl">{c.name}</span>
            {countLine(c.id, "mt-0.5 text-xs text-white/85")}
            <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold text-neutral-900 shadow-sm transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transition-none">
              {t("sections.shopCategory")} <ArrowRightIcon aria-hidden className="size-3.5 rtl:rotate-180" />
            </span>
          </span>
        </Link>
      ))}
    </Carousel>,
  );
}

/**
 * Grid spans for tile `i` of `n` in the bento grid (2 columns on phones, 4 from md): the first tile is 2×2; the rest
 * are 1×1, and the last row's tiles stretch so the grid never ends with a hole.
 */
export function bentoSpan(i: number, n: number): string {
  if (n === 1) return "col-span-2 md:col-span-4";
  if (n === 2) return "col-span-2";
  // Six: the big tile runs three rows tall so the fifth small tile closes the right column.
  if (i === 0) return n === 6 ? "col-span-2 row-span-2 md:row-span-3" : "col-span-2 row-span-2";
  const phone = (n - 1) % 2 === 1 && i === n - 1 ? 2 : 1;
  let md = 1;
  if (n === 3) md = 2;
  else if (n === 6) md = i === 5 ? 2 : 1;
  else if (n === 4) md = i === 3 ? 2 : 1;
  else if (i >= 5) {
    // Rows below the big tile hold 4 each; stretch a short last row.
    const k = (n - 5) % 4;
    if (k && i >= n - k) md = k === 1 ? 4 : k === 2 ? 2 : i === n - 1 ? 2 : 1;
  }
  return cn(phone === 2 ? "col-span-2" : "col-span-1", md === 4 ? "md:col-span-4" : md === 2 ? "md:col-span-2" : "md:col-span-1");
}

/**
 * Bento grid of category tiles, the first one large (categories layout "bento" and the category-mosaic section).
 * `count` adds a product-count line under the name.
 */
export function CategoryBento({ categories, t, count }: { categories: readonly Cat[]; t: Translator; count?: (id: string) => string | undefined }) {
  const n = categories.length;
  const spans = (i: number) => bentoSpan(i, n);
  return (
    <ul data-layout="bento" className="grid auto-rows-[150px] grid-cols-2 gap-3 sm:auto-rows-[200px] sm:gap-4 md:grid-cols-4 lg:auto-rows-[230px]">
      {categories.map((c, i) => {
        const line = count?.(c.id);
        return (
          <li key={c.id} className={spans(i)}>
            <Link href={STORE_PATHS.category(c.slug)} className="group relative block size-full overflow-hidden rounded-[var(--sf-radius-card)] bg-muted text-white shadow-card focus-ring">
              <CategoryArt name={c.name} slug={c.slug} image={c.image} tone={i} bold eager={i === 0} className="absolute inset-0" imageClassName={zoom} />
              <span aria-hidden className={cn("absolute inset-0 bg-gradient-to-t to-transparent", c.image ? "from-black/70 via-black/15" : "from-black/35 via-transparent")} />
              <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-4 sm:p-5">
                <span className="min-w-0">
                  <span className={cn("block font-display leading-tight font-semibold [text-shadow:0_1px_12px_rgb(0_0_0/0.3)]", i === 0 && n > 2 ? "text-2xl sm:text-3xl" : "text-lg sm:text-xl")}>{c.name}</span>
                  {line && <span className="mt-0.5 block text-xs text-white/85 sm:text-sm">{line}</span>}
                  <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold opacity-90 sm:text-sm">
                    {t("sections.shopCategory")} <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-1 rtl:rotate-180" aria-hidden />
                  </span>
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
