import * as React from "react";
import Link from "next/link";
import { ArrowRightIcon, CheckIcon, ClockIcon, ZapIcon } from "lucide-react";
import { STORE_PATHS } from "@rbms/cms/seo";
import { cn } from "@rbms/ui/lib/utils";
import { Carousel } from "../client/carousel";
import { Countdown } from "../client/home-sections";
import { DealAdd } from "../client/home-shelves";
import { CategoryShelfTabs, Finder, SizeFinder, Stories, StickyStoryWatch, Swatches, type SwatchProduct } from "../client/home-layouts";
import { CategoryArt } from "../components/category-art";
import { safeHref } from "../lib/markdown";
import { Container, Price, SectionTitle, Stars, StoreImage } from "../components/bits";
import { ProductCard, ProductGrid } from "../components/product-card";
import { freshIds } from "../lib/cards";
import { flashState, formatShopTime } from "../lib/flash-window";
import { percentOff } from "../lib/format";
import { Markdown } from "../lib/markdown";
import type { Translator } from "../lib/messages";
import type { HomeSection, HomeSectionOf, Product, ProductSummary, Rating, TileItem } from "../types";
import { CtaLink, onBand } from "./home-sections";

/*
 * Layout sections: flash sale (countdown band over a shelf), finder (questions → matching products), stories / reels
 * strip, category shelf (category list beside a product grid), sticky story (a picture that stays while chapters
 * scroll) and comparison table. Server components; interactive parts in client/home-layouts.tsx. Their data comes
 * resolved from the cms (products, categories) or from pages/home.tsx `loadShelves` (sale products, products per
 * category).
 */

type Ratings = ReadonlyMap<string, Rating>;
const centered = (s: HomeSection, fallback = false) => (s.style?.align ? s.style.align === "center" : fallback);

function Heading({ title, text, eyebrow, center }: { title?: string; text?: string; eyebrow?: string; center?: boolean }) {
  if (!title && !text) return null;
  return (
    <div className={cn("mb-8 sm:mb-10", center && "mx-auto max-w-2xl text-center")}>
      {eyebrow && <p className="mb-2 text-xs font-semibold tracking-[0.14em] text-primary uppercase">{eyebrow}</p>}
      {title && <h2 className="sf-heading font-display text-h2 font-semibold text-balance">{title}</h2>}
      {text && <p className={cn("mt-3 max-w-2xl text-muted-foreground", center && "mx-auto")}>{text}</p>}
    </div>
  );
}

function Shelf({ products, layout, ratings, label, eager }: { products: ProductSummary[]; layout: "grid" | "carousel"; ratings: Ratings; label: string; eager?: boolean }) {
  const fresh = freshIds(products);
  if (layout === "grid") return <ProductGrid products={products} ratings={new Map(ratings)} eagerCount={eager ? 4 : 0} />;
  return (
    <Carousel label={label}>
      {products.map((p, i) => (
        <ProductCard key={p.id} product={p} rating={ratings.get(p.id)} eager={eager && i < 4} fresh={fresh.has(p.id)} />
      ))}
    </Carousel>
  );
}

// ------------------------------------------------------------------ flash sale

/** Hidden before `startsAt`, from `endsAt` on and outside its daily window (the client gate keeps it right while the page stays open). */
export const flashSaleOutside = (s: HomeSection, now = Date.now()) => s.type === "flash-sale" && !flashState(s, now).live;

/** A countdown band (brand gradient) over the sale's products; "Up to n% off" from the real discounts. */
export function FlashSaleSection({ s, t, products, ratings, index, locale = "en" }: { s: HomeSectionOf<"flash-sale">; t: Translator; products: ProductSummary[]; ratings: Ratings; index: number; locale?: string }) {
  if (!products.length) return null;
  // The countdown runs to the end of today's window when the sale has one ("every day 6–9 pm"), else to `endsAt`.
  const until = flashState(s, Date.now()).endsAt;
  const endsAt = until ? new Date(until).toISOString() : s.endsAt;
  const best = Math.max(0, ...products.map((p) => percentOff(p.priceMin, p.mrp)));
  const title = s.title || t("layouts.flashTitle");
  const band = onBand(s);
  return (
    <Container>
      <div className={cn("sf-flash overflow-hidden rounded-[var(--sf-radius-card)]", !band && "bg-tint-1 ring-1 ring-primary/15")} data-testid="flash-sale">
        <div className="sf-on-tone flex flex-wrap items-center justify-between gap-x-8 gap-y-4 bg-[image:var(--sf-gradient)] px-5 py-5 text-primary-foreground sm:px-8 sm:py-6">
          <div className="grid min-w-0 gap-1.5">
            <p className="inline-flex items-center gap-2 text-xs font-bold tracking-[0.16em] uppercase">
              <span aria-hidden className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60 motion-reduce:animate-none" />
                <span className="relative inline-flex size-2 rounded-full bg-current" />
              </span>
              {t("layouts.flashLive")}
              {best >= 5 && <span className="rounded-full bg-white/20 px-2.5 py-0.5 tracking-normal normal-case">{t("layouts.flashUpTo", { pct: best })}</span>}
            </p>
            <h2 className="sf-heading flex items-center gap-2 font-display text-h2 leading-tight font-semibold text-balance">
              <ZapIcon className="size-7 shrink-0 fill-current" aria-hidden />
              {title}
            </h2>
            {s.text && <p className="max-w-xl text-sm opacity-90 sm:text-base">{s.text}</p>}
            {s.daily && (
              <p className="inline-flex items-center gap-1.5 text-sm font-semibold opacity-90" data-testid="flash-daily">
                <ClockIcon className="size-4" aria-hidden />
                {t("layouts.flashDaily", { from: formatShopTime(s.daily.from, locale), to: formatShopTime(s.daily.to, locale) })}
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <span className="text-xs font-semibold tracking-[0.14em] uppercase opacity-85">{t("layouts.flashEndsIn")}</span>
            <Countdown endsAt={endsAt} className="gap-1.5 sm:gap-2 [&>span]:min-w-[3.25rem]" />
          </div>
        </div>
        <div className="p-4 sm:p-6">
          <Shelf products={products} layout={s.layout} ratings={ratings} label={title} eager={index < 2} />
          {s.cta && (
            <div className="mt-6 flex justify-center">
              <CtaLink href={s.cta.href} label={s.cta.label} />
            </div>
          )}
        </div>
      </div>
    </Container>
  );
}

// ------------------------------------------------------------------ finder

export function FinderSection({ s, t, index }: { s: HomeSectionOf<"finder">; t: Translator; index: number }) {
  const questions = s.questions.filter((q) => q.options.length > 0);
  if (!questions.length) return null;
  return (
    <Container>
      <Heading title={s.title || t("layouts.finderTitle")} text={s.text} center={centered(s, s.layout === "wizard")} />
      <div className={cn(s.layout === "wizard" && !s.imageUrl && "mx-auto max-w-5xl")}>
        <Finder id={`finder-${s.id ?? index}`} questions={questions} layout={s.layout} limit={s.limit} results={s.results} buttonLabel={s.buttonLabel} imageUrl={s.imageUrl} cta={s.cta} />
      </div>
    </Container>
  );
}

// ------------------------------------------------------------------ stories

export function StoriesSection({ s, t }: { s: HomeSectionOf<"stories">; t: Translator }) {
  return (
    <Container>
      {s.title && <Heading title={s.title} center={centered(s)} />}
      <Stories items={s.items} layout={s.layout} label={s.title || t("layouts.stories")} />
    </Container>
  );
}

// ------------------------------------------------------------------ category shelf

export function CategoryShelfSection({
  s,
  t,
  shelves,
  ratings,
  index,
}: {
  s: HomeSectionOf<"category-shelf">;
  t: Translator;
  shelves: { categoryId: string; items: ProductSummary[] }[];
  ratings: Ratings;
  index: number;
}) {
  const byId = new Map(shelves.map((x) => [x.categoryId, x.items]));
  const tabs = s.categories.map((c) => ({ c, items: byId.get(c.id) ?? [] })).filter((x) => x.items.length > 0);
  if (!tabs.length) return null;
  const id = `cshelf-${s.id ?? index}`;
  return (
    <Container>
      {s.title && <SectionTitle title={s.title} eyebrow={t("home.curated")} />}
      <CategoryShelfTabs
        id={id}
        tabs={tabs.map(({ c, items }, i) => ({
          label: c.name,
          image: s.showImages ? c.image : null,
          panel: (
            <>
              <ProductGrid products={items} ratings={new Map(ratings)} layout="sidebar" eagerCount={index < 2 && i === 0 ? 4 : 0} />
              <div className="mt-6 flex justify-center lg:justify-start">
                <Link href={STORE_PATHS.category(c.slug)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary underline-offset-4 hover:underline focus-ring">
                  {t("layouts.shelfViewAll", { name: c.name })} <ArrowRightIcon className="size-4 rtl:rotate-180" aria-hidden />
                </Link>
              </div>
            </>
          ),
        }))}
      />
    </Container>
  );
}

// ------------------------------------------------------------------ sticky story

/**
 * Desktop: the chapter pictures stack in a sticky column and crossfade as each chapter reaches the middle of the
 * screen (StickyStoryWatch sets `data-active`). Phones: every chapter shows its own picture above its text.
 */
export function StickyStorySection({ s, index }: { s: HomeSectionOf<"sticky-story">; index: number }) {
  const id = `story-${s.id ?? index}`;
  const right = s.imageSide === "right";
  return (
    <Container>
      {s.title && <Heading title={s.title} center={centered(s)} />}
      <div id={id} data-active="0" className="sf-sticky-story grid gap-10 md:grid-cols-2 md:gap-14" data-testid="sticky-story">
        <div className={cn("relative max-md:hidden", right && "md:order-2")}>
          <div className="sticky top-24 aspect-[4/5] max-h-[calc(100dvh-8rem)] w-full overflow-hidden rounded-[var(--sf-radius-card)] bg-muted shadow-card">
            {s.chapters.map((c, i) => (
              <div key={i} data-story-img={i} className="absolute inset-0 transition-opacity duration-700 motion-reduce:transition-none">
                <StoreImage src={c.imageUrl} alt={c.alt || c.heading} />
              </div>
            ))}
          </div>
        </div>
        <ol className="grid gap-12 md:gap-0">
          {s.chapters.map((c, i) => (
            <li key={i} data-story-chapter={i} className="grid content-center gap-4 md:min-h-[75dvh] md:py-12">
              <div className="aspect-[4/3] overflow-hidden rounded-[var(--sf-radius-card)] bg-muted md:hidden">
                <StoreImage src={c.imageUrl} alt={c.alt || c.heading} />
              </div>
              <p className="flex items-center gap-3 text-xs font-semibold tracking-[0.14em] text-primary uppercase">
                <span className="font-display text-2xl tracking-normal tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                {c.eyebrow && <span>{c.eyebrow}</span>}
              </p>
              <h3 className="sf-heading font-display text-h2 leading-tight font-semibold text-balance">{c.heading}</h3>
              {c.markdown && <Markdown source={c.markdown} className="text-base text-foreground/80" />}
              {c.cta && (
                <div>
                  <CtaLink href={c.cta.href} label={c.cta.label} variant="outline" />
                </div>
              )}
            </li>
          ))}
        </ol>
        <StickyStoryWatch id={id} />
      </div>
    </Container>
  );
}

// ------------------------------------------------------------------ comparison

/**
 * A real table (header row of products, one row per feature). On phones it scrolls sideways with the feature column
 * kept in view; the highlighted product's column is tinted and badged.
 */
export function ComparisonSection({ s, t, ratings }: { s: HomeSectionOf<"comparison">; t: Translator; ratings: Ratings }) {
  const ps = s.products;
  if (ps.length < 2) return null;
  const hi = (p: ProductSummary) => p.id === s.highlightId;
  const cell = (p: ProductSummary) => cn("px-3 py-3.5 align-top sm:px-5", hi(p) && "bg-primary/[0.06]");
  const rowHead = "sticky start-0 z-[1] bg-card px-3 py-3.5 text-start align-top text-sm font-semibold sm:px-5";
  return (
    <Container>
      <Heading title={s.title || t("layouts.compareTitle")} text={s.text} center={centered(s, true)} />
      <div className="relative overflow-hidden rounded-[var(--sf-radius-card)] border bg-card shadow-card" data-testid="comparison">
        <div className="overflow-x-auto overscroll-x-contain">
          <table className="w-full min-w-[34rem] border-collapse text-sm">
            <caption className="sr-only">{s.title || t("layouts.compareTitle")}</caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className={cn(rowHead, "w-32 align-bottom text-xs tracking-[0.12em] text-muted-foreground uppercase sm:w-44")}>
                  {t("layouts.compareFeature")}
                </th>
                {ps.map((p) => (
                  <th key={p.id} scope="col" className={cn(cell(p), "relative min-w-[9.5rem] text-start font-normal")}>
                    {hi(p) && (
                      <span className="mb-2 inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11px] font-bold tracking-wide text-primary-foreground uppercase">
                        <CheckIcon className="size-3" aria-hidden /> {s.highlightLabel || t("layouts.compareBest")}
                      </span>
                    )}
                    <Link href={STORE_PATHS.product(p.slug)} className="group grid gap-2.5 focus-ring">
                      <span className="block aspect-square w-full max-w-40 overflow-hidden rounded-[calc(var(--sf-radius-card)*0.6)] bg-muted">
                        <StoreImage src={p.image} alt={p.name} className="transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none" />
                      </span>
                      <span className="line-clamp-3 font-semibold leading-snug group-hover:text-primary">{p.name}</span>
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr>
                <th scope="row" className={rowHead}>
                  {t("compare.price")}
                </th>
                {ps.map((p) => (
                  <td key={p.id} className={cell(p)}>
                    <Price price={p.priceMin} priceMax={p.priceMax} mrp={p.mrp} t={t} size="sm" />
                  </td>
                ))}
              </tr>
              {s.showRating && (
                <tr>
                  <th scope="row" className={rowHead}>
                    {t("compare.rating")}
                  </th>
                  {ps.map((p) => {
                    const r = ratings.get(p.id);
                    return (
                      <td key={p.id} className={cell(p)}>
                        {r && r.count > 0 ? <Stars value={r.average} count={r.count} t={t} /> : <span className="text-muted-foreground">{t("compare.noRating")}</span>}
                      </td>
                    );
                  })}
                </tr>
              )}
              {s.rows.map((row, ri) => (
                <tr key={ri}>
                  <th scope="row" className={rowHead}>
                    {row.label}
                  </th>
                  {ps.map((p, pi) => (
                    <td key={p.id} className={cn(cell(p), "leading-snug")}>
                      {row.values[pi]?.trim() || <span className="text-muted-foreground">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td className={rowHead} />
                {ps.map((p) => (
                  <td key={p.id} className={cell(p)}>
                    <DealAdd product={p} className="h-10 w-full px-3 text-xs sm:text-sm" />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      {ps.length > 2 && <p className="mt-2 text-center text-xs text-muted-foreground sm:hidden">{t("compare.scrollHint")}</p>}
    </Container>
  );
}

// ------------------------------------------------------------------ tiles ("shop by need")

/** Where a tile goes: its own link, else its collection, else its tag's listing (null: not a link). */
export function tileHref(it: TileItem): string | null {
  if (it.href) return safeHref(it.href);
  if (it.collectionSlug) return STORE_PATHS.collection(it.collectionSlug);
  if (it.tag) return `${STORE_PATHS.search}?tag=${encodeURIComponent(it.tag)}`;
  return null;
}

/** Concern / occasion / project tiles: picture or icon, name, a "what helps" note and the product count. */
export function TilesSection({ s, t, counts }: { s: HomeSectionOf<"tiles">; t: Translator; counts?: (number | null)[] }) {
  const row = s.layout === "row";
  return (
    <Container>
      <Heading title={s.title || t("layouts.tilesTitle")} text={s.text} center={centered(s)} />
      <ul
        className={cn(
          row ? "-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 scrollbar-none sm:mx-0 sm:px-0 lg:grid lg:auto-cols-fr lg:grid-flow-col lg:overflow-visible" : "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6",
        )}
        data-testid="tiles"
      >
        {s.items.map((it, i) => {
          const href = tileHref(it);
          const n = s.showCounts ? (counts?.[i] ?? null) : null;
          const body = (
            <>
              <span className="relative block aspect-square overflow-hidden rounded-[calc(var(--sf-radius-card)*0.7)] bg-muted">
                <CategoryArt name={it.label} slug={it.tag ?? it.collectionSlug} image={it.imageUrl ?? null} tone={i} className="size-full transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none" />
              </span>
              <span className="grid gap-1 px-1">
                <span className="text-sm leading-snug font-semibold group-hover:text-primary">{it.label}</span>
                {it.note && <span className="text-xs leading-snug text-muted-foreground">{it.note}</span>}
                {n !== null && n > 0 && <span className="text-xs font-medium text-primary tabular-nums">{t("layouts.tileCount", { count: n })}</span>}
              </span>
            </>
          );
          return (
            <li key={i} className={cn(row && "w-40 shrink-0 snap-start sm:w-44 lg:w-auto")}>
              {href ? (
                <Link href={href} className="group grid h-full content-start gap-2.5 rounded-[var(--sf-radius-card)] border bg-card p-2 shadow-card transition-[transform,box-shadow] focus-ring hover:-translate-y-0.5 motion-reduce:hover:translate-y-0">
                  {body}
                </Link>
              ) : (
                <div className="grid h-full content-start gap-2.5 rounded-[var(--sf-radius-card)] border bg-card p-2">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Container>
  );
}

// ------------------------------------------------------------------ size finder

export function SizeFinderSection({ s, t, index }: { s: HomeSectionOf<"size-finder">; t: Translator; index: number }) {
  const groups = s.groups.filter((g) => g.sizes.length > 0);
  if (!groups.length) return null;
  const finder = <SizeFinder id={`size-${s.id ?? index}`} optionName={s.optionName || "Size"} footLength={s.footLength} groups={groups} />;
  return (
    <Container>
      <div className={cn("grid items-center gap-8 overflow-hidden rounded-[var(--sf-radius-card)] p-5 sm:p-8", !onBand(s) && "bg-tint-1 ring-1 ring-primary/10", s.imageUrl && "lg:grid-cols-[minmax(0,1fr)_minmax(16rem,24rem)]")}>
        <div className="grid min-w-0 gap-5">
          <div>
            <h2 className="sf-heading font-display text-h2 font-semibold text-balance">{s.title || t("layouts.sizeTitle")}</h2>
            {s.text && <p className="mt-2 max-w-xl text-muted-foreground">{s.text}</p>}
          </div>
          {finder}
        </div>
        {s.imageUrl && (
          <div className="hidden aspect-[4/3] overflow-hidden rounded-[calc(var(--sf-radius-card)*0.8)] lg:block">
            <StoreImage src={s.imageUrl} alt="" />
          </div>
        )}
      </div>
    </Container>
  );
}

// ------------------------------------------------------------------ shade finder

/** Each product's shades: its variants by the shade option, coloured from the section's shade list. */
/**
 * The swatches per product: one per value of the shade option, with the variant to add. With `alsoOption` (a case's
 * "Phone model") and a product that has it, each shade also lists its variant per value of that option (`byAlso`),
 * and the product carries the option's values in its own order: the shopper picks one first, so Add adds that exact
 * variant instead of the first phone model's case in that colour.
 */
export function swatchProducts(s: HomeSectionOf<"swatches">, details: ReadonlyMap<string, Product> | undefined, alsoLabel?: string): SwatchProduct[] {
  const colour = new Map(s.shades.map((x) => [x.value.trim().toLowerCase(), x]));
  const alsoName = s.alsoOption?.trim();
  return s.products.flatMap((p) => {
    const d = details?.get(p.id);
    if (!d) return [];
    const alsoValues = alsoName ? (d.options.find((o) => o.name === alsoName)?.values ?? []) : [];
    const byValue = new Map<string, SwatchProduct["shades"][number]>();
    for (const v of [...d.variants].sort((a, b) => a.position - b.position)) {
      const value = v.optionValues[s.optionName];
      if (!value) continue;
      let shade = byValue.get(value);
      if (!shade) {
        const c = colour.get(value.trim().toLowerCase());
        shade = { value, variantId: v.id, price: v.price, mrp: v.mrp, hex: c?.hex ?? null, depth: c?.depth ?? null };
        byValue.set(value, shade);
      }
      const other = alsoValues.length ? v.optionValues[alsoName!] : undefined;
      if (other && !shade.byAlso?.[other]) shade.byAlso = { ...shade.byAlso, [other]: { variantId: v.id, price: v.price, mrp: v.mrp } };
    }
    const shades = [...byValue.values()];
    if (!shades.length) return [];
    const also = alsoValues.length ? { name: alsoName!, label: alsoLabel ?? alsoName!, values: alsoValues.filter((x) => shades.some((sh) => sh.byAlso?.[x])) } : undefined;
    return [{ id: p.id, name: p.name, slug: p.slug, image: p.image, shades, ...(also ? { also } : {}) }];
  });
}

export function SwatchesSection({ s, t, details, index }: { s: HomeSectionOf<"swatches">; t: Translator; details?: ReadonlyMap<string, Product>; index: number }) {
  const products = swatchProducts(s, details, s.alsoLabel?.trim() || (s.alsoOption ? t("layouts.swatchAlso", { name: s.alsoOption }) : undefined));
  if (!products.length) return null;
  return (
    <Container>
      <Heading title={s.title || t("layouts.swatchesTitle")} text={s.text} center={centered(s)} />
      <Swatches id={`shades-${s.id ?? index}`} products={products} />
    </Container>
  );
}
