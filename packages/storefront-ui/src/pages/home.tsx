import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRightIcon,
  BadgeCheckIcon,
  BanknoteIcon,
  ClockIcon,
  GiftIcon,
  HeartIcon,
  LeafIcon,
  PhoneIcon,
  QuoteIcon,
  ShieldCheckIcon,
  SparklesIcon,
  StarIcon,
  TagIcon,
  TruckIcon,
  Undo2Icon,
} from "lucide-react";
import { organizationJsonLd, STORE_PATHS, websiteSearchJsonLd } from "@srirealtime/cms/seo";
import { apiGetSafe, getRequestInfo, requireStore } from "../server/api";
import { getRatings } from "../server/data";
import { storeMetadata } from "../server/meta";
import { Markdown, safeHref } from "../lib/markdown";
import type { Translator } from "../lib/messages";
import type { HomeSection, PublicHome, Rating, StoreConfig } from "../types";
import { Reveal, RevealGroup, RevealItem } from "@srirealtime/ui/motion";
import { percentOff } from "../lib/format";
import { Container, JsonLd, SectionTitle, StoreImage } from "../components/bits";
import { ProductCard, ProductGrid } from "../components/product-card";
import { TrustBadges } from "../components/trust";
import { Carousel, HeroSlider, NewsletterForm } from "../client/carousel";
import { RecentlyViewedStrip } from "../client/recently-viewed";

export const getHome = () => apiGetSafe<PublicHome>("/cms/public/home", { sections: [], seo: null, isDefault: true, publishedAt: null }, { revalidate: 60 });

export async function homeMetadata(): Promise<Metadata> {
  const home = await getHome();
  return storeMetadata({ kind: "home", seo: home.seo });
}

const USP_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
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

export async function HomePage() {
  const [info, config, home] = await Promise.all([getRequestInfo(), requireStore(), getHome()]);
  const ids = home.sections.flatMap((s) => (s.type === "collection" || s.type === "products" ? s.products.map((p) => p.id) : []));
  const ratings = await getRatings(ids);
  const t = info.t;
  const social = Object.values(config.shop.social ?? {}).filter((s): s is string => typeof s === "string");
  return (
    <>
      <JsonLd
        data={[
          organizationJsonLd({ name: config.shop.name, url: info.baseUrl, logo: config.shop.logoUrl, sameAs: social, phone: config.shop.contactPhone, email: config.shop.contactEmail }),
          websiteSearchJsonLd({ name: config.shop.name, url: info.baseUrl }),
        ]}
      />
      {!(home.sections[0]?.type === "hero" && home.sections[0].slides[0]?.heading) && <h1 className="sr-only">{config.shop.name}</h1>}
      <div className="flex flex-col gap-[var(--sf-section)] pb-4">
        {home.sections.map((s, i) => (
          <React.Fragment key={s.id ?? i}>
            <HomeSectionView section={s} index={i} t={t} ratings={ratings} config={config} />
            {/* Trust row right under the hero. */}
            {i === 0 && s.type === "hero" && (
              <Container className="-mt-[calc(var(--sf-section)*0.55)]">
                <Reveal>
                  <TrustBadges t={t} cod={config.codEnabled} returns={!!config.policies.returns?.trim()} compact />
                </Reveal>
              </Container>
            )}
          </React.Fragment>
        ))}
        {/* Renders nothing (no gap) until the shopper has history. */}
        <RecentlyViewedStrip className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8" />
      </div>
    </>
  );
}

export function HomeSectionView({ section: s, index, t, ratings, config }: { section: HomeSection; index: number; t: Translator; ratings: Map<string, Rating>; config: StoreConfig }) {
  switch (s.type) {
    case "hero":
      return <HeroSlider slides={s.slides} shopName={config.shop.name} />;

    case "categories":
      return (
        <Container>
          {s.title && <SectionTitle title={s.title} eyebrow={t("home.explore")} href={STORE_PATHS.products} linkLabel={t("list.viewAll")} />}
          <Carousel label={s.title || t("nav.categories")} itemClassName="w-[30%] sm:w-[20%] lg:w-[15%] xl:w-[13%]">
            {s.categories.map((c) => (
              <Link key={c.id} href={STORE_PATHS.category(c.slug)} className="group block rounded-2xl p-1 text-center focus-ring">
                <span className="relative block aspect-square rounded-full p-1 transition-[background-color] duration-300 group-hover:bg-[image:var(--sf-gradient)]">
                  <span className="block size-full overflow-hidden rounded-full bg-muted ring-2 ring-background">
                    <StoreImage src={c.image} alt={c.name} className="transition-transform duration-500 ease-out group-hover:scale-110 motion-reduce:transition-none" />
                  </span>
                </span>
                <span className="mt-3 block truncate text-sm font-semibold transition-colors group-hover:text-primary">{c.name}</span>
              </Link>
            ))}
          </Carousel>
        </Container>
      );

    case "collection": {
      // A sale ribbon only when the products really are discounted (no invented urgency / timers).
      const best = Math.max(0, ...s.products.map((p) => percentOff(p.priceMin, p.mrp)));
      return (
        <Container>
          <SectionTitle
            title={s.title || s.collection.name}
            eyebrow={best >= 10 ? t("home.onSale") : t("home.curated")}
            badge={best >= 10 ? <span className="rounded-full bg-sale px-3 py-1 font-sans text-xs font-bold tracking-wide text-white shadow-sm">{t("home.upTo", { pct: best })}</span> : undefined}
            href={STORE_PATHS.collection(s.collection.slug)}
            linkLabel={t("list.viewAll")}
          />
          {s.layout === "carousel" ? (
            <Carousel label={s.title || s.collection.name}>
              {s.products.map((p, i) => (
                <ProductCard key={p.id} product={p} rating={ratings.get(p.id)} t={t} eager={index < 2 && i < 4} />
              ))}
            </Carousel>
          ) : (
            <ProductGrid products={s.products} ratings={ratings} t={t} />
          )}
        </Container>
      );
    }

    case "products":
      return (
        <Container>
          {s.title && <SectionTitle title={s.title} eyebrow={t("home.curated")} href={s.href} linkLabel={t("list.viewAll")} />}
          <ProductGrid products={s.products} ratings={ratings} t={t} eagerCount={index < 2 ? 4 : 0} />
        </Container>
      );

    case "banner": {
      const href = s.href ? safeHref(s.href) : null;
      const img = (
        <span className="group block overflow-hidden rounded-[var(--sf-radius-card)] bg-muted shadow-card">
          <picture>
            {s.mobileImageUrl && <source media="(max-width: 640px)" srcSet={s.mobileImageUrl} />}
            <StoreImage src={s.imageUrl} alt={s.alt} className="aspect-[16/7] h-auto transition-transform duration-700 ease-out group-hover:scale-[1.03] motion-reduce:transition-none" />
          </picture>
        </span>
      );
      return (
        <Container>
          <Reveal>
            {href ? (
              <Link href={href} className="block rounded-[var(--sf-radius-card)] focus-ring">
                {img}
              </Link>
            ) : (
              img
            )}
          </Reveal>
        </Container>
      );
    }

    case "text":
      return (
        <Container className="max-w-3xl text-center">
          <Reveal>
            {s.heading && <h2 className="mb-4 font-display text-h2 font-semibold">{s.heading}</h2>}
            <Markdown source={s.markdown} className="text-base text-foreground/80" />
          </Reveal>
        </Container>
      );

    case "image-text":
      return (
        <Container>
          <Reveal className={`kolam grid items-center gap-8 overflow-hidden rounded-[var(--sf-radius-card)] bg-tint-1 ring-1 ring-primary/10 md:grid-cols-2 md:gap-12 ${s.imageSide === "right" ? "md:[&>*:first-child]:order-2" : ""}`}>
            <div className="group aspect-[4/3] overflow-hidden md:aspect-auto md:h-full md:min-h-[400px]">
              <StoreImage src={s.imageUrl} alt={s.heading} className="transition-transform duration-700 group-hover:scale-[1.03] motion-reduce:transition-none" />
            </div>
            <div className="px-6 pb-8 md:px-0 md:py-12 md:pe-12">
              <h2 className="font-display text-h2 font-semibold">{s.heading}</h2>
              <Markdown source={s.markdown} className="mt-4 text-foreground/80" />
              {s.cta && (
                <Link href={s.cta.href} className="group/cta mt-7 inline-flex h-12 items-center gap-2 rounded-full bg-primary px-7 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/30 transition-transform hover:scale-[1.02] focus-ring motion-reduce:transition-none">
                  {s.cta.label}
                  <ArrowRightIcon className="size-4 transition-transform group-hover/cta:translate-x-1" />
                </Link>
              )}
            </div>
          </Reveal>
        </Container>
      );

    case "testimonials":
      return (
        <section className="kolam relative bg-tint-1 py-[var(--sf-section)]">
          <Container>
            {s.title && (
              <Reveal className="mb-10 text-center">
                <p className="mb-2 text-xs font-semibold tracking-[0.14em] text-primary uppercase">{t("home.loved")}</p>
                <h2 className="font-display text-h2 font-semibold">{s.title}</h2>
              </Reveal>
            )}
            <Carousel label={s.title || t("home.loved")} itemClassName="w-[84%] sm:w-[46%] lg:w-[32%] xl:w-[32%]">
              {s.items.map((it, i) => (
                <figure key={i} className="flex h-full flex-col rounded-[var(--sf-radius-card)] bg-card p-6 shadow-card ring-1 ring-border transition-transform duration-300 hover:-translate-y-1 motion-reduce:transition-none sm:p-7">
                  <div className="flex items-center justify-between">
                    <QuoteIcon className="size-8 text-primary/35" aria-hidden />
                    <span className="flex gap-0.5" aria-hidden>
                      {[0, 1, 2, 3, 4].map((k) => (
                        <StarIcon key={k} className="size-3.5 fill-gold text-gold" />
                      ))}
                    </span>
                  </div>
                  <blockquote className="mt-4 flex-1 font-display text-lg leading-relaxed text-foreground/90">“{it.quote}”</blockquote>
                  <figcaption className="mt-6 flex items-center gap-3 border-t pt-4">
                    <span aria-hidden className="flex size-10 items-center justify-center rounded-full bg-[image:var(--sf-gradient)] text-sm font-bold text-primary-foreground">
                      {it.name.charAt(0)}
                    </span>
                    <span className="text-sm font-semibold">{it.name}</span>
                  </figcaption>
                </figure>
              ))}
            </Carousel>
          </Container>
        </section>
      );

    case "usp":
      return (
        <Container>
          <RevealGroup as="ul" className={`grid gap-3 sm:gap-4 ${s.items.length >= 4 ? "grid-cols-2 lg:grid-cols-4" : s.items.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
            {s.items.map((it, i) => {
              const Icon = USP_ICON[it.icon] ?? SparklesIcon;
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

    case "newsletter":
      return (
        <Container>
          <Reveal className="sf-brand-hero relative overflow-hidden rounded-[var(--sf-radius-card)] px-6 py-12 text-primary-foreground sm:px-12 sm:py-14">
            <div className="relative z-[1] flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
              <div className="max-w-lg">
                <h2 className="font-display text-h2 font-semibold">{s.heading}</h2>
                {s.text && <p className="mt-2 text-primary-foreground/85">{s.text}</p>}
              </div>
              <NewsletterForm />
            </div>
          </Reveal>
        </Container>
      );
  }
}
