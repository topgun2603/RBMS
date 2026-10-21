import * as React from "react";
import Link from "next/link";
import {
  ArrowRightIcon,
  BadgeCheckIcon,
  BanknoteIcon,
  CheckIcon,
  ClockIcon,
  FacebookIcon,
  GiftIcon,
  GlobeIcon,
  HeartIcon,
  InstagramIcon,
  LeafIcon,
  LinkedinIcon,
  PhoneIcon,
  ShieldCheckIcon,
  SparklesIcon,
  StarIcon,
  TagIcon,
  TruckIcon,
  Undo2Icon,
} from "lucide-react";
import { STORE_PATHS } from "@srirealtime/cms/seo";
import { cn } from "@srirealtime/ui/lib/utils";
import { Reveal, RevealGroup, RevealItem } from "@srirealtime/ui/motion";
import { Carousel, NewsletterForm } from "../client/carousel";
import { CountUp, DealAdd, DealCountdown, LookHotspots, ProductTabs } from "../client/home-shelves";
import { RecentlyViewedStrip } from "../client/recently-viewed";
import { RecommendedShelf } from "../client/recommend";
import { Container, Price, SectionTitle, Stars, StoreImage } from "../components/bits";
import { ProductCard, ProductGrid } from "../components/product-card";
import { ReviewSource, VerifiedBadge } from "../components/review-source";
import { freshIds } from "../lib/cards";
import { formatDate, imageUrl, money, percentOff } from "../lib/format";
import { safeHref } from "../lib/markdown";
import type { Translator } from "../lib/messages";
import type { HomeSection, HomeSectionOf, PostSummary, ProductSummary, Rating, ShelfLayout, ShopReviewSummary } from "../types";
import { CtaLink, onBand } from "./home-sections";

/*
 * Shelf, proof and story sections (product tabs, deal of the day, shop the look, best sellers, recommended, recently
 * viewed, stats, timeline, team, pricing, blog, reviews) and the layouts of the categories, USP and newsletter
 * sections. Server components; interactive parts in client/home-shelves.tsx. Data the sections need (products per
 * tab, posts, reviews, category counts) is loaded once per page by pages/home.tsx (`ShelfData`).
 */

/** What a section loaded for this request (pages/home.tsx `loadShelves`). */
export interface ShelfData {
  /** product-tabs: one entry per tab, label resolved; empty tabs are dropped. */
  tabs?: { label: string; href?: string; items: ProductSummary[] }[];
  /** bestsellers, recommended. */
  products?: ProductSummary[];
  posts?: PostSummary[];
  reviews?: { summary: ShopReviewSummary; products: ReadonlyMap<string, ProductSummary> };
}

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

/** A row or grid of product cards. */
function Shelf({ products, layout, ratings, label, eager }: { products: ProductSummary[]; layout: ShelfLayout; ratings: Ratings; label: string; eager?: boolean }) {
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

// ------------------------------------------------------------------ categories (all layouts): pages/home-categories.tsx

export { CategoriesSectionView } from "./home-categories";

// ------------------------------------------------------------------ USP / why us (all layouts)

export const USP_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  truck: TruckIcon,
  "free-shipping": TruckIcon,
  shipping: TruckIcon,
  cash: BanknoteIcon,
  cod: BanknoteIcon,
  return: Undo2Icon,
  returns: Undo2Icon,
  shield: ShieldCheckIcon,
  secure: ShieldCheckIcon,
  star: StarIcon,
  gift: GiftIcon,
  phone: PhoneIcon,
  support: PhoneIcon,
  leaf: LeafIcon,
  clock: ClockIcon,
  tag: TagIcon,
  heart: HeartIcon,
  check: BadgeCheckIcon,
};

/** cards (the original) · inline (a slim strip with dividers) · centered (big icons in columns) · split (heading beside the points). */
export function UspSection({ s, t }: { s: HomeSectionOf<"usp">; t: Translator }) {
  const layout = s.layout ?? "cards";
  const n = s.items.length;
  const icon = (key: string) => USP_ICON[key] ?? SparklesIcon;
  if (layout === "inline") {
    return (
      <Container>
        <ul className={cn("grid divide-y rounded-[var(--sf-radius-card)] border bg-card text-card-foreground sm:divide-x sm:divide-y-0 rtl:divide-x-reverse", n >= 4 ? "sm:grid-cols-2 lg:grid-cols-4" : n === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")} data-layout="inline">
          {s.items.map((it, i) => {
            const Icon = icon(it.icon);
            return (
              <li key={i} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
                <Icon className="size-6 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{it.title}</span>
                  {it.text && <span className="block truncate text-xs text-muted-foreground">{it.text}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </Container>
    );
  }
  if (layout === "centered" || layout === "split") {
    const split = layout === "split";
    const list = (
      <RevealGroup as="ul" className={cn("grid gap-6 sm:gap-8", split ? "sm:grid-cols-2" : n >= 4 ? "grid-cols-2 lg:grid-cols-4" : n === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        {s.items.map((it, i) => {
          const Icon = icon(it.icon);
          return (
            <RevealItem as="li" key={i} className={cn("flex gap-4", split ? "items-start" : "flex-col items-center text-center")}>
              <span className={cn("icon-chip shrink-0 rounded-full text-primary", split ? "size-12" : "size-16")}>
                <Icon className={split ? "size-6" : "size-7"} />
              </span>
              <span>
                <span className="block font-display text-lg font-semibold">{it.title}</span>
                {it.text && <span className="mt-1 block text-sm text-muted-foreground">{it.text}</span>}
              </span>
            </RevealItem>
          );
        })}
      </RevealGroup>
    );
    return (
      <Container>
        {split ? (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16" data-layout="split">
            <div>
              <p className="mb-2 text-xs font-semibold tracking-[0.14em] text-primary uppercase">{t("sections.whyUs")}</p>
              <h2 className="sf-heading font-display text-h2 font-semibold text-balance">{s.title || t("sections.whyUs")}</h2>
              {s.text && <p className="mt-4 text-muted-foreground">{s.text}</p>}
            </div>
            {list}
          </div>
        ) : (
          <div data-layout="centered">
            <Heading title={s.title} text={s.text} center />
            {list}
          </div>
        )}
      </Container>
    );
  }
  return (
    <Container>
      {(s.title || s.text) && <Heading title={s.title} text={s.text} center={centered(s, true)} />}
      <RevealGroup as="ul" className={`grid gap-3 sm:gap-4 ${n >= 4 ? "grid-cols-2 lg:grid-cols-4" : n === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        {s.items.map((it, i) => {
          const Icon = icon(it.icon);
          return (
            <RevealItem as="li" key={i} className="group flex items-start gap-4 rounded-2xl bg-card p-5 ring-1 ring-border transition-shadow hover:shadow-card">
              <span className="icon-chip size-12 rounded-2xl text-primary transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110 motion-reduce:transition-none">
                <Icon className="size-6" />
              </span>
              <span>
                <span className="block font-semibold">{it.title}</span>
                {it.text && <span className="mt-0.5 block text-sm text-muted-foreground">{it.text}</span>}
              </span>
            </RevealItem>
          );
        })}
      </RevealGroup>
    </Container>
  );
}

// ------------------------------------------------------------------ newsletter (all layouts)

/** band (brand block, the original) · split (picture beside the form) · card (centred card) · inline (one slim row). */
export function NewsletterSection({ s, t }: { s: HomeSectionOf<"newsletter">; t: Translator }) {
  const layout = s.layout ?? "band";
  const band = onBand(s);
  if (layout === "inline") {
    return (
      <Container>
        <div className={cn("flex flex-col gap-4 rounded-[var(--sf-radius-card)] px-5 py-5 sm:px-8 md:flex-row md:items-center md:justify-between", !band && "border bg-card text-card-foreground")} data-layout="inline">
          <div className="min-w-0">
            <h2 className="sf-heading font-display text-xl font-semibold sm:text-2xl">{s.heading}</h2>
            {s.text && <p className="mt-1 text-sm opacity-75">{s.text}</p>}
          </div>
          <NewsletterForm tone={band ? "brand" : "plain"} />
        </div>
      </Container>
    );
  }
  if (layout === "card") {
    return (
      <Container>
        <Reveal className={cn("mx-auto max-w-2xl rounded-[var(--sf-radius-card)] px-6 py-10 text-center sm:px-12", !band && "border bg-card text-card-foreground shadow-card")} data-layout="card">
          <p className="mb-2 text-xs font-semibold tracking-[0.14em] text-primary uppercase">{t("sections.newsletterEyebrow")}</p>
          <h2 className="sf-heading font-display text-h2 font-semibold text-balance">{s.heading}</h2>
          {s.text && <p className="mx-auto mt-3 max-w-md opacity-75">{s.text}</p>}
          <div className="mt-6 flex justify-center">
            <NewsletterForm tone={band ? "brand" : "plain"} />
          </div>
        </Reveal>
      </Container>
    );
  }
  if (layout === "split") {
    const photo = imageUrl(s.imageUrl ?? null);
    return (
      <Container>
        <Reveal className={cn("grid overflow-hidden rounded-[var(--sf-radius-card)] md:grid-cols-2", !band && "border bg-card text-card-foreground shadow-card")} data-layout="split">
          <div className="relative min-h-56 bg-muted md:min-h-80">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" />
            ) : (
              <div className="sf-brand-hero absolute inset-0" aria-hidden />
            )}
          </div>
          <div className="flex flex-col justify-center gap-5 px-6 py-10 sm:px-10">
            <div>
              <p className="mb-2 text-xs font-semibold tracking-[0.14em] text-primary uppercase">{t("sections.newsletterEyebrow")}</p>
              <h2 className="sf-heading font-display text-h2 font-semibold text-balance">{s.heading}</h2>
              {s.text && <p className="mt-3 opacity-75">{s.text}</p>}
            </div>
            <NewsletterForm tone={band ? "brand" : "plain"} />
          </div>
        </Reveal>
      </Container>
    );
  }
  return (
    <Container>
      <Reveal className="sf-brand-hero relative overflow-hidden rounded-[var(--sf-radius-card)] px-6 py-12 text-primary-foreground sm:px-12 sm:py-14">
        <div className="relative z-[1] flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-lg">
            <h2 className="sf-heading font-display text-h2 font-semibold">{s.heading}</h2>
            {s.text && <p className="mt-2 text-primary-foreground/85">{s.text}</p>}
          </div>
          <NewsletterForm />
        </div>
      </Reveal>
    </Container>
  );
}

// ------------------------------------------------------------------ product shelves

/** Tabs over shelves; each tab's products were loaded on the server (`data.tabs`). Nothing when every tab is empty. */
export function ProductTabsSection({ s, t, data, ratings, index }: { s: HomeSectionOf<"product-tabs">; t: Translator; data?: ShelfData; ratings: Ratings; index: number }) {
  const tabs = data?.tabs ?? [];
  if (!tabs.length) return null;
  const id = `tabs-${s.id ?? index}`;
  return (
    <Container>
      {s.title && <SectionTitle title={s.title} eyebrow={t("home.curated")} href={tabs.length === 1 ? tabs[0]!.href : undefined} linkLabel={t("list.viewAll")} />}
      <ProductTabs
        id={id}
        tabs={tabs.map((tab, i) => ({
          label: tab.label,
          panel: (
            <>
              <Shelf products={tab.items} layout={s.layout} ratings={ratings} label={tab.label} eager={index < 2 && i === 0} />
              {tab.href && tabs.length > 1 && (
                <div className="mt-6 flex justify-center">
                  <Link href={tab.href} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary underline-offset-4 hover:underline focus-ring">
                    {t("list.viewAll")} <ArrowRightIcon className="size-4 rtl:rotate-180" aria-hidden />
                  </Link>
                </div>
              )}
            </>
          ),
        }))}
      />
    </Container>
  );
}

/** Best sellers / recommended (server list). */
export function ShelfSection({ title, eyebrow, products, layout, ratings, t, index }: { title: string; eyebrow: string; products: ProductSummary[]; layout: ShelfLayout; ratings: Ratings; t: Translator; index: number }) {
  if (!products.length) return null;
  return (
    <Container>
      <SectionTitle title={title} eyebrow={eyebrow} href={STORE_PATHS.products} linkLabel={t("list.viewAll")} />
      <Shelf products={products} layout={layout} ratings={ratings} label={title} eager={index < 2} />
    </Container>
  );
}

export function RecommendedSection({ s, t, data }: { s: HomeSectionOf<"recommended">; t: Translator; data?: ShelfData }) {
  return (
    <Container>
      <RecommendedShelf initial={data?.products ?? []} limit={s.limit} layout={s.layout} title={s.title || t("rec.forYou")} eyebrow={t("rec.forYouEyebrow")} />
    </Container>
  );
}

export function RecentlyViewedSection({ s }: { s: HomeSectionOf<"recently-viewed"> }) {
  return <RecentlyViewedStrip title={s.title} className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8" />;
}

/** One product, big: picture, price and saving, countdown (to `endsAt` or midnight) and the add button. */
export function DealSection({ s, t, rating }: { s: HomeSectionOf<"deal">; t: Translator; rating?: Rating }) {
  const p = s.product;
  const pct = percentOff(p.priceMin, p.mrp);
  const band = onBand(s);
  return (
    <Container>
      <div className={cn("grid items-center gap-8 overflow-hidden rounded-[var(--sf-radius-card)] md:grid-cols-2 md:gap-12", !band && "bg-tint-1 ring-1 ring-primary/10")} data-testid="deal">
        <Link href={STORE_PATHS.product(p.slug)} className="group relative block overflow-hidden bg-muted focus-ring md:h-full">
          <span className="block aspect-square md:aspect-auto md:h-full md:min-h-[420px]">
            <StoreImage src={p.image} alt={p.name} className="transition-transform duration-700 group-hover:scale-[1.03] motion-reduce:transition-none" />
          </span>
          {pct > 0 && <span className="absolute start-4 top-4 rounded-full bg-sale px-3 py-1.5 text-sm font-bold text-white shadow">{t("product.off", { pct })}</span>}
        </Link>
        <div className={cn("grid gap-5 px-6 pb-8 md:px-0 md:py-12 md:pe-12", band && "md:ps-0")}>
          <p className="inline-flex items-center gap-2 text-xs font-bold tracking-[0.16em] text-primary uppercase">
            <span aria-hidden className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60 motion-reduce:animate-none" />
              <span className="relative inline-flex size-2 rounded-full bg-primary" />
            </span>
            {s.title || t("sections.dealTitle")}
          </p>
          <h2 className="sf-heading font-display text-h1 font-semibold text-balance">
            <Link href={STORE_PATHS.product(p.slug)} className="hover:text-primary focus-ring">
              {p.name}
            </Link>
          </h2>
          {rating && rating.count > 0 && <Stars value={rating.average} count={rating.count} t={t} size="md" />}
          {s.text && <p className="text-base opacity-80">{s.text}</p>}
          <div>
            <Price price={p.priceMin} priceMax={p.priceMax} mrp={p.mrp} t={t} size="lg" />
            {p.mrp && pct > 0 && <p className="mt-1 text-sm font-semibold text-success-ink">{t("sections.save", { amount: money(p.mrp - p.priceMin) })}</p>}
          </div>
          <div className="grid gap-2">
            <span className="text-xs font-semibold tracking-[0.14em] uppercase opacity-70">{t("sections.dealEndsIn")}</span>
            <div className="w-fit rounded-2xl bg-[image:var(--sf-gradient)] p-2 text-primary-foreground">
              <DealCountdown endsAt={s.endsAt} />
            </div>
          </div>
          <DealAdd product={p} className="w-full sm:w-fit" />
        </div>
      </div>
    </Container>
  );
}

export function ShopTheLookSection({ s, t }: { s: HomeSectionOf<"shop-the-look">; t: Translator }) {
  return (
    <Container>
      <Heading title={s.title || t("sections.shopTheLook")} text={s.text} center={centered(s)} />
      <LookHotspots imageUrl={s.imageUrl} alt={s.alt} hotspots={s.hotspots} />
    </Container>
  );
}

// ------------------------------------------------------------------ stats, timeline, team, pricing

export function StatsSection({ s }: { s: HomeSectionOf<"stats"> }) {
  const n = s.items.length;
  const band = onBand(s);
  return (
    <Container>
      <Heading title={s.title} text={s.text} center={centered(s, true)} />
      <dl className={cn("grid gap-3 sm:gap-4", n === 1 ? "mx-auto max-w-xs" : n === 2 ? "grid-cols-2 lg:mx-auto lg:max-w-3xl" : n === 3 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2 lg:grid-cols-4", n > 4 && "lg:grid-cols-3 xl:grid-cols-6")}>
        {s.items.map((it, i) => (
          <div key={i} className={cn("flex flex-col-reverse items-center rounded-[var(--sf-radius-card)] px-4 py-6 text-center sm:py-8", band ? "bg-white/10 ring-1 ring-white/15" : "bg-card text-card-foreground shadow-card ring-1 ring-border")}>
            <dt className="mt-2 text-sm font-medium opacity-75">{it.label}</dt>
            <dd className="font-display text-[clamp(2rem,1.5rem+2vw,3.25rem)] leading-none font-semibold tabular-nums">
              <CountUp value={it.value} prefix={it.prefix} suffix={it.suffix} className={band ? undefined : "text-primary"} />
            </dd>
          </div>
        ))}
      </dl>
    </Container>
  );
}

export function TimelineSection({ s, t }: { s: HomeSectionOf<"timeline">; t: Translator }) {
  return (
    <Container className="max-w-5xl">
      <Heading title={s.title || t("sections.ourStory")} text={s.text} center={centered(s, true)} />
      <ol className="relative grid gap-8 before:absolute before:inset-y-2 before:start-[11px] before:w-0.5 before:bg-primary/20 md:gap-10 md:before:start-1/2 md:before:-translate-x-1/2">
        {s.items.map((it, i) => {
          const photo = imageUrl(it.imageUrl ?? null);
          const flip = i % 2 === 1;
          return (
            <li key={i} className="relative grid gap-3 ps-10 md:grid-cols-2 md:gap-12 md:ps-0">
              <span aria-hidden className="absolute start-0 top-1.5 flex size-6 items-center justify-center rounded-full bg-primary ring-4 ring-background md:start-1/2 md:-translate-x-1/2">
                <span className="size-2 rounded-full bg-primary-foreground" />
              </span>
              <div className={cn("md:text-end", flip && "md:order-2 md:text-start")}>
                <p className="font-display text-2xl font-semibold text-primary">{it.when}</p>
                <h3 className="mt-1 text-lg font-semibold">{it.title}</h3>
                {it.text && <p className="mt-1.5 text-muted-foreground">{it.text}</p>}
              </div>
              <div className={cn(flip && "md:order-1")}>
                {photo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo} alt="" loading="lazy" className="aspect-[16/10] w-full rounded-[var(--sf-radius-card)] object-cover shadow-card" />
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Container>
  );
}

const SOCIAL = [
  ["instagram", InstagramIcon, "Instagram"],
  ["facebook", FacebookIcon, "Facebook"],
  ["linkedin", LinkedinIcon, "LinkedIn"],
  ["website", GlobeIcon, ""],
] as const;

export function TeamSection({ s, t }: { s: HomeSectionOf<"team">; t: Translator }) {
  const n = s.members.length;
  return (
    <Container>
      <Heading title={s.title || t("sections.team")} text={s.text} center={centered(s, true)} />
      <ul className={cn("grid gap-4 sm:gap-6", n <= 2 ? "sm:grid-cols-2 lg:mx-auto lg:max-w-3xl" : n === 3 ? "sm:grid-cols-3" : "grid-cols-2 lg:grid-cols-4")}>
        {s.members.map((m, i) => {
          const photo = imageUrl(m.photoUrl ?? null);
          return (
            <li key={i} className="group overflow-hidden rounded-[var(--sf-radius-card)] bg-card text-card-foreground shadow-card ring-1 ring-border">
              <div className="aspect-[4/5] overflow-hidden bg-muted">
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo} alt={m.name} loading="lazy" className="size-full object-cover transition-transform duration-700 group-hover:scale-[1.04] motion-reduce:transition-none" />
                ) : (
                  <StoreImage src={null} alt={m.name} />
                )}
              </div>
              <div className="p-4 sm:p-5">
                <h3 className="font-display text-lg font-semibold">{m.name}</h3>
                {m.role && <p className="text-sm font-medium text-primary">{m.role}</p>}
                {m.bio && <p className="mt-2 text-sm text-muted-foreground">{m.bio}</p>}
                <div className="mt-3 flex gap-1.5">
                  {SOCIAL.map(([key, Icon, site]) => {
                    const href = m[key] ? safeHref(m[key]!) : null;
                    if (!href) return null;
                    return (
                      <a
                        key={key}
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={t("sections.onSocial", { name: m.name, site: site || t("sections.website") })}
                        className="flex size-9 items-center justify-center rounded-full border text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-ring"
                      >
                        <Icon className="size-4" aria-hidden />
                      </a>
                    );
                  })}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Container>
  );
}

export function PricingSection({ s, t }: { s: HomeSectionOf<"pricing-table">; t: Translator }) {
  const n = s.plans.length;
  return (
    <Container>
      <Heading title={s.title || t("sections.pricing")} text={s.text} center={centered(s, true)} />
      <ul className={cn("grid items-stretch gap-4 sm:gap-6", n === 1 ? "mx-auto max-w-md" : n === 2 ? "md:grid-cols-2 lg:mx-auto lg:max-w-4xl" : n === 3 ? "md:grid-cols-3" : "sm:grid-cols-2 xl:grid-cols-4")}>
        {s.plans.map((p, i) => (
          <li
            key={i}
            className={cn(
              "relative flex flex-col rounded-[var(--sf-radius-card)] p-6 sm:p-7",
              p.highlight ? "bg-[image:var(--sf-gradient)] text-primary-foreground shadow-lift ring-2 ring-primary md:-my-3 md:py-10" : "bg-card text-card-foreground shadow-card ring-1 ring-border",
            )}
            data-highlight={p.highlight || undefined}
          >
            {(p.badge || p.highlight) && (
              <span className={cn("absolute -top-3 start-6 rounded-full px-3 py-1 text-xs font-bold tracking-wide shadow-sm", p.highlight ? "bg-white text-neutral-900" : "bg-primary text-primary-foreground")}>{p.badge || t("sections.popular")}</span>
            )}
            <h3 className="font-display text-xl font-semibold">{p.name}</h3>
            {p.description && <p className={cn("mt-1 text-sm", p.highlight ? "opacity-85" : "text-muted-foreground")}>{p.description}</p>}
            <p className="mt-5 flex items-baseline gap-1.5">
              <span className="font-display text-4xl font-semibold tabular-nums">{p.price !== undefined ? money(p.price) : t("sections.askPrice")}</span>
              {p.period && p.price !== undefined && <span className={cn("text-sm", p.highlight ? "opacity-80" : "text-muted-foreground")}>{p.period}</span>}
            </p>
            {p.features.length > 0 && (
              <ul className="mt-6 grid gap-2.5 text-sm">
                {p.features.map((f, j) => (
                  <li key={j} className="flex gap-2.5">
                    <CheckIcon className={cn("mt-0.5 size-4 shrink-0", p.highlight ? "" : "text-primary")} aria-hidden />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-auto pt-7">
              {p.cta && <CtaLink href={p.cta.href} label={p.cta.label} variant={p.highlight ? "light" : "primary"} className="w-full justify-center" />}
            </div>
          </li>
        ))}
      </ul>
    </Container>
  );
}

// ------------------------------------------------------------------ blog and reviews

export function BlogPostsSection({ s, t, posts, locale }: { s: HomeSectionOf<"blog-posts">; t: Translator; posts: PostSummary[]; locale: string }) {
  if (!posts.length) return null;
  return (
    <Container>
      <SectionTitle title={s.title || t("sections.blog")} eyebrow={t("sections.readMore")} href={STORE_PATHS.blog} linkLabel={t("sections.allPosts")} />
      <ul className={cn("grid gap-5 sm:gap-6", posts.length === 1 ? "max-w-xl" : posts.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3")}>
        {posts.map((p) => (
          <li key={p.id}>
            <article className="group relative flex h-full flex-col overflow-hidden rounded-[var(--sf-radius-card)] bg-card text-card-foreground shadow-card ring-1 ring-border">
              <div className="aspect-[16/10] overflow-hidden bg-muted">
                <StoreImage src={p.coverUrl} alt="" name={p.title} className="transition-transform duration-700 group-hover:scale-[1.04] motion-reduce:transition-none" />
              </div>
              <div className="flex flex-1 flex-col gap-2 p-5">
                {p.publishedAt && <p className="text-xs font-medium text-muted-foreground">{formatDate(p.publishedAt, locale, { day: "numeric", month: "short", year: "numeric" })}</p>}
                <h3 className="font-display text-lg leading-snug font-semibold">
                  <Link href={STORE_PATHS.post(p.slug)} className="outline-none after:absolute after:inset-0 focus-visible:after:shadow-[var(--sf-focus)] group-hover:text-primary">
                    {p.title}
                  </Link>
                </h3>
                {p.excerpt && <p className="line-clamp-3 text-sm text-muted-foreground">{p.excerpt}</p>}
                <span className="mt-auto inline-flex items-center gap-1 pt-2 text-sm font-semibold text-primary">
                  {t("sections.readMore")} <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-1 rtl:rotate-180" aria-hidden />
                </span>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </Container>
  );
}

export function ReviewsSummarySection({ s, t, data, locale }: { s: HomeSectionOf<"reviews-summary">; t: Translator; data?: ShelfData["reviews"]; locale: string }) {
  const sum = data?.summary;
  if (!sum || sum.count === 0) return null;
  const max = Math.max(1, ...Object.values(sum.distribution ?? {}));
  return (
    <Container>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.6fr)] lg:gap-12">
        <div className="rounded-[var(--sf-radius-card)] bg-card p-6 text-card-foreground shadow-card ring-1 ring-border sm:p-8 lg:self-start">
          <h2 className="sf-heading font-display text-h3 font-semibold">{s.title || t("sections.reviewsTitle")}</h2>
          <p className="mt-4 font-display text-6xl leading-none font-semibold tabular-nums">{sum.average.toFixed(1)}</p>
          <Stars value={sum.average} t={t} size="lg" className="mt-3" />
          <p className="mt-2 text-sm text-muted-foreground">{t("sections.basedOn", { count: sum.count })}</p>
          <ul className="mt-5 grid gap-1.5" aria-label={t("sections.outOf", { avg: sum.average.toFixed(1) })}>
            {[5, 4, 3, 2, 1].map((r) => {
              const n = sum.distribution?.[String(r)] ?? 0;
              return (
                <li key={r} className="flex items-center gap-2 text-xs">
                  <span className="w-3 tabular-nums">{r}</span>
                  <StarIcon className="size-3 fill-gold text-gold" aria-hidden />
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full rounded-full bg-gold" style={{ width: `${(n / max) * 100}%` }} />
                  </span>
                  <span className="w-8 text-end text-muted-foreground tabular-nums">{n}</span>
                </li>
              );
            })}
          </ul>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2">
          {sum.items.map((r) => {
            const p = data?.products.get(r.productId);
            return (
              <li key={r.id} className="flex flex-col rounded-[var(--sf-radius-card)] bg-card p-5 text-card-foreground shadow-card ring-1 ring-border">
                <div className="flex items-center justify-between gap-2">
                  <Stars value={r.rating} t={t} />
                  <span className="text-xs text-muted-foreground">{formatDate(r.createdAt, locale, { day: "numeric", month: "short" })}</span>
                </div>
                {r.title && <p className="mt-3 font-semibold">{r.title}</p>}
                {r.body && <p className="mt-1.5 line-clamp-4 text-sm text-foreground/80">{r.body}</p>}
                {r.photos?.length > 0 && (
                  <ul className="mt-3 flex gap-2">
                    {r.photos.slice(0, 3).map((src, i) => (
                      <li key={i} className="size-14 overflow-hidden rounded-lg bg-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt={t("reviews.photo", { n: i + 1, name: r.authorName })} className="size-full object-cover" loading="lazy" />
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-4 text-xs">
                  <span className="font-semibold">{r.authorCity ? t("reviews.from", { name: r.authorName, city: r.authorCity }) : r.authorName}</span>
                  {r.verified && <VerifiedBadge t={t} label={t("sections.verified")} />}
                  <ReviewSource review={r} t={t} />
                </div>
                {p && (
                  <Link href={STORE_PATHS.product(p.slug)} className="mt-3 flex items-center gap-2 rounded-xl bg-muted/60 p-2 text-xs font-medium hover:bg-muted focus-ring">
                    <span className="block size-8 shrink-0 overflow-hidden rounded-md bg-muted">
                      <StoreImage src={p.image} alt="" name={p.name} />
                    </span>
                    <span className="line-clamp-1">{p.name}</span>
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Container>
  );
}
