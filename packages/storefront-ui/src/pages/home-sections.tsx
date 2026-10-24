import * as React from "react";
import Link from "next/link";
import { ArrowRightIcon, ChevronDownIcon, ClockIcon, InstagramIcon, MapPinIcon, MessageCircleIcon, NavigationIcon, PhoneIcon, QuoteIcon, StarIcon } from "lucide-react";
import { STORE_PATHS } from "@srirealtime/cms/seo";
import { osmEmbedUrl } from "../lib/map";
import { cn } from "@srirealtime/ui/lib/utils";
import { Reveal } from "@srirealtime/ui/motion";
import { Carousel } from "../client/carousel";
import { BeforeAfter, CopyCode, Countdown, HeroVideo, QuoteRotator } from "../client/home-sections";
import { Container, SectionTitle, StoreImage } from "../components/bits";
import { CategoryBento } from "./home-categories";
import { formatDate, imageUrl, money } from "../lib/format";
import { Markdown, safeHref } from "../lib/markdown";
import type { Translator } from "../lib/messages";
import type { Diet, HomeSection, HomeSectionOf, PublicMetalRates, SectionStyle, StoreConfig } from "../types";

/*
 * The richer home sections (split / video hero, offer, gallery, logos, category mosaic, FAQ, location, menu board,
 * appointment, before/after, gold rates, Instagram, testimonial layouts) and the per-section style frame. Server
 * components; the interactive bits are in client/home-sections.tsx. Everything follows the shop theme: brand colours
 * through --primary / --sf-gradient, the heading font through font-display / .sf-heading, card radius and buttons.
 */

// ------------------------------------------------------------------ style frame

const hasStyle = (st: SectionStyle | undefined): st is SectionStyle => !!st && Object.values(st).some((v) => v !== undefined && v !== false);

/** Tone classes per background; the `sf-on-tone` ones re-colour text and buttons that sit directly on the colour. */
const TONE: Record<Exclude<NonNullable<SectionStyle["background"]>, "none">, string> = {
  brand: "sf-brand-hero sf-on-tone sf-tone-brand text-primary-foreground",
  gradient: "bg-[image:var(--sf-gradient)] sf-on-tone sf-tone-brand text-primary-foreground",
  dark: "bg-neutral-950 sf-on-tone text-white",
  image: "bg-neutral-900 sf-on-tone text-white",
  muted: "bg-tint-2",
};
const PAD_TONED = { compact: "py-[calc(var(--sf-section)*0.55)]", normal: "py-[calc(var(--sf-section)*0.9)]", spacious: "py-[calc(var(--sf-section)*1.45)]" } as const;
const PAD_PLAIN = { compact: "-my-[calc(var(--sf-section)*0.3)]", normal: "", spacious: "py-[calc(var(--sf-section)*0.5)]" } as const;
/** Compact on the page's first section: no gap above it to tighten, so only the gap below shrinks (not pulled under the header). */
const PAD_PLAIN_FIRST = { ...PAD_PLAIN, compact: "-mb-[calc(var(--sf-section)*0.3)]" } as const;

/**
 * Wraps one section in its style: a background band (brand, muted, dark, gradient, or a photo under a dark overlay),
 * spacing, width (full-bleed or a rounded box), alignment, entrance animation and hide-on-phone/desktop. Without a
 * style the section renders exactly as before. The animation uses <Reveal>, which never ships `opacity: 0` in the
 * server HTML (only sections below the fold are hidden, after hydration) and does nothing with reduced motion.
 */
export function SectionFrame({ section, children, first = false }: { section: HomeSection; children: React.ReactNode; /** The page's first section (compact spacing then never pulls it up under the header). */ first?: boolean }) {
  const st = section.style;
  if (!hasStyle(st)) return <>{children}</>;
  const bg = st.background && st.background !== "none" && !(st.background === "image" && !st.imageUrl) ? st.background : null;
  const pad = st.padding ?? "normal";
  const boxed = bg !== null && st.width === "contained";
  const photo = bg === "image" ? imageUrl(st.imageUrl ?? null) : null;
  let body: React.ReactNode = children;
  if (bg) {
    const surface = (
      <div className={cn("relative isolate overflow-hidden", TONE[bg], PAD_TONED[pad], boxed && "rounded-[var(--sf-radius-card)] shadow-card")}>
        {photo && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo} alt="" aria-hidden className="absolute inset-0 -z-20 size-full object-cover" loading="lazy" decoding="async" />
            <span aria-hidden className="absolute inset-0 -z-10 bg-black" style={{ opacity: (st.overlay ?? 45) / 100 }} />
          </>
        )}
        <div className="relative z-[1]">{children}</div>
      </div>
    );
    body = boxed ? <Container>{surface}</Container> : surface;
  }
  const anim = st.animation && st.animation !== "none" ? st.animation : null;
  return (
    <div
      data-section={section.type}
      data-sf-align={st.align}
      data-sf-width={bg ? undefined : st.width}
      className={cn("sf-sec", bg && "sf-unboxed", !bg && (first ? PAD_PLAIN_FIRST : PAD_PLAIN)[pad], st.hideOnMobile && "max-md:hidden", st.hideOnDesktop && "md:hidden")}
    >
      {anim ? (
        <Reveal y={anim === "rise" ? 32 : 0} duration={anim === "rise" ? 0.7 : 0.6}>
          {body}
        </Reveal>
      ) : (
        body
      )}
    </div>
  );
}

/** True when a section sits on a coloured band (it then drops its own card / tint). */
export const onBand = (s: HomeSection) => !!s.style?.background && s.style.background !== "none";
const centered = (s: HomeSection, fallback = false) => (s.style?.align ? s.style.align === "center" : fallback);

// ------------------------------------------------------------------ shared bits

/** Button-styled link for the section calls to action (theme button shape via .sf-btn). */
export function CtaLink({ href, label, variant = "primary", className }: { href: string; label: string; variant?: "primary" | "outline" | "light"; className?: string }) {
  const safe = safeHref(href) ?? "#";
  return (
    <Link
      href={safe}
      className={cn(
        "sf-btn group/cta inline-flex h-12 items-center gap-2 px-7 text-sm font-semibold transition-transform hover:scale-[1.02] focus-ring active:scale-[0.98] motion-reduce:transition-none",
        variant === "primary" && "bg-primary text-primary-foreground shadow-md shadow-primary/25",
        variant === "outline" && "border-2 border-current/30 hover:border-current/60",
        variant === "light" && "bg-white text-neutral-900 shadow-lg shadow-black/20",
        className,
      )}
    >
      {label}
      <ArrowRightIcon className="size-4 transition-transform group-hover/cta:translate-x-1 rtl:rotate-180" />
    </Link>
  );
}

function Heading({ title, eyebrow, center, className }: { title?: string; eyebrow?: string; center?: boolean; className?: string }) {
  if (!title) return null;
  return (
    <div className={cn("mb-8 sm:mb-10", center && "text-center", className)}>
      {eyebrow && <p className="mb-2 text-xs font-semibold tracking-[0.14em] text-primary uppercase">{eyebrow}</p>}
      <h2 className="sf-heading font-display text-h2 font-semibold text-balance">{title}</h2>
    </div>
  );
}

function StarsRow({ n, t, className }: { n: number; t: Translator; className?: string }) {
  return (
    <span className={cn("flex gap-0.5", className)} role="img" aria-label={t("sections.stars", { n })}>
      {[1, 2, 3, 4, 5].map((k) => (
        <StarIcon key={k} aria-hidden className={cn("size-4", k <= n ? "fill-gold text-gold" : "fill-muted text-muted-foreground/30")} />
      ))}
    </span>
  );
}

function Avatar({ name, photoUrl, size = "size-11" }: { name: string; photoUrl?: string; size?: string }) {
  const src = imageUrl(photoUrl ?? null);
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className={cn(size, "shrink-0 rounded-full object-cover ring-2 ring-background")} loading="lazy" />
  ) : (
    <span aria-hidden className={cn(size, "flex shrink-0 items-center justify-center rounded-full bg-[image:var(--sf-gradient)] text-sm font-bold text-primary-foreground")}>
      {name.charAt(0)}
    </span>
  );
}

// ------------------------------------------------------------------ heroes

export function HeroSplitSection({ s, index }: { s: HomeSectionOf<"hero-split">; index: number }) {
  const H = index === 0 ? "h1" : "h2";
  const img = imageUrl(s.imageUrl);
  const band = onBand(s);
  return (
    <section className={cn("relative", !band && "bg-tint-1")}>
      <div className={cn("mx-auto grid w-full max-w-7xl items-center gap-8 px-4 sm:px-6 md:grid-cols-2 lg:gap-16 lg:px-8", !band && "py-10 md:py-16 lg:py-20")}>
        <div className={cn("order-2", s.imageSide === "left" ? "md:order-2" : "md:order-1", centered(s) && "text-center md:text-start")}>
          {s.eyebrow && <p className="mb-4 inline-flex items-center gap-2 text-xs font-semibold tracking-[0.18em] text-primary uppercase before:h-px before:w-8 before:bg-current">{s.eyebrow}</p>}
          <H className="sf-hero-title text-display text-balance">{s.heading}</H>
          {s.text && <p className="mt-5 max-w-lg text-base text-muted-foreground sm:text-lg">{s.text}</p>}
          {(s.cta || s.cta2) && (
            <div className={cn("mt-8 flex flex-wrap gap-3", centered(s) && "justify-center md:justify-start")}>
              {s.cta && <CtaLink href={s.cta.href} label={s.cta.label} />}
              {s.cta2 && <CtaLink href={s.cta2.href} label={s.cta2.label} variant="outline" />}
            </div>
          )}
        </div>
        <div className={cn("relative order-1", s.imageSide === "left" ? "md:order-1" : "md:order-2")}>
          <div className="relative aspect-[4/3] overflow-hidden rounded-[var(--sf-radius-card)] bg-muted shadow-lift md:aspect-[4/5] lg:aspect-[5/6]">
            {img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={img} alt="" className="absolute inset-0 size-full object-cover" loading={index < 2 ? "eager" : "lazy"} {...(index === 0 ? { fetchPriority: "high" as const } : {})} />
            ) : (
              <div className="sf-brand-hero absolute inset-0" aria-hidden />
            )}
          </div>
          {/* A soft offset frame behind the picture: depth without another image. */}
          <span aria-hidden className={cn("absolute -bottom-4 -z-10 hidden h-2/3 w-2/3 rounded-[var(--sf-radius-card)] bg-primary/15 md:block", s.imageSide === "left" ? "-left-4" : "-right-4")} />
        </div>
      </div>
    </section>
  );
}

export function HeroVideoSection({ s, index }: { s: HomeSectionOf<"hero-video">; index: number }) {
  const H = index === 0 ? "h1" : "h2";
  const center = centered(s, true);
  return (
    <HeroVideo videoUrl={s.videoUrl} posterUrl={s.posterUrl} overlay={s.overlay}>
      <div className={cn("relative z-[1] mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8", center && "text-center")}>
        <div className={cn("max-w-3xl", center && "mx-auto")}>
          <H className="sf-hero-title text-display text-balance drop-shadow-sm">{s.heading}</H>
          {s.text && <p className={cn("mt-5 max-w-xl text-base text-white/85 sm:text-lg", center && "mx-auto")}>{s.text}</p>}
          {s.cta && <CtaLink href={s.cta.href} label={s.cta.label} variant="light" className="mt-8" />}
        </div>
      </div>
    </HeroVideo>
  );
}

// ------------------------------------------------------------------ offer

export function OfferSection({ s, t }: { s: HomeSectionOf<"offer">; t: Translator }) {
  const band = onBand(s);
  const center = centered(s, true);
  const inner = (
    <div className={cn("relative z-[1] flex flex-col gap-6", center ? "items-center text-center" : "items-start lg:flex-row lg:items-center lg:justify-between")}>
      <div className={cn("max-w-2xl", center && "mx-auto")}>
        {s.eyebrow && <p className="mb-3 inline-block rounded-full bg-white/15 px-3 py-1 text-xs font-bold tracking-[0.14em] uppercase ring-1 ring-white/25">{s.eyebrow}</p>}
        <h2 className="sf-heading font-display text-h1 font-semibold text-balance">{s.heading}</h2>
        {s.text && <p className="mt-3 text-base opacity-85 sm:text-lg">{s.text}</p>}
      </div>
      <div className={cn("flex flex-col gap-4", center ? "items-center" : "items-start lg:items-end")}>
        {s.endsAt && (
          <div className={cn("flex flex-col gap-2", center ? "items-center" : "items-start lg:items-end")}>
            <span className="text-xs font-semibold tracking-[0.14em] uppercase opacity-80">{t("sections.endsIn")}</span>
            <Countdown endsAt={s.endsAt} />
          </div>
        )}
        <div className={cn("flex flex-wrap items-center gap-3", center && "justify-center")}>
          {s.code && <CopyCode code={s.code} />}
          {s.cta && <CtaLink href={s.cta.href} label={s.cta.label} variant="light" />}
        </div>
      </div>
    </div>
  );
  if (band) return <Container>{inner}</Container>;
  return (
    <Container>
      <Reveal className="relative isolate overflow-hidden rounded-[var(--sf-radius-card)] bg-[image:var(--sf-gradient)] px-6 py-10 text-primary-foreground shadow-lift sm:px-12 sm:py-14">
        <span aria-hidden className="absolute -top-24 -right-24 -z-10 size-72 rounded-full bg-white/10 blur-2xl" />
        <span aria-hidden className="absolute -bottom-32 -left-20 -z-10 size-80 rounded-full bg-black/10 blur-3xl" />
        <div className="sf-on-tone sf-tone-brand">{inner}</div>
      </Reveal>
    </Container>
  );
}

// ------------------------------------------------------------------ gallery, logos, instagram

/**
 * Masonry columns per breakpoint from the image count, so no column is left empty and the rows come out even:
 * 9 photos → 3 columns (3 × 3) rather than 4 with one hanging; 8 → 4; 2 → 2.
 */
export function masonryColumns(n: number): { ph: number; md: number; lg: number } {
  const lg = n <= 3 ? Math.max(1, n) : n % 4 === 0 ? 4 : n % 3 === 0 ? 3 : n >= 10 ? 4 : 3;
  return { ph: Math.min(lg, 2), md: Math.min(lg, 3), lg };
}

/** Masonry tile heights in grid rows (20 rows = one column width): portrait, square, 4:5, repeating. */
const MASONRY_ROWS = [27, 20, 25] as const;

export function GallerySection({ s }: { s: HomeSectionOf<"gallery"> }) {
  const tile = (img: (typeof s.images)[number], i: number, ratio: string) => {
    const src = imageUrl(img.url);
    const fill = ratio === "h-full";
    const fig = (
      <figure className={cn("group relative overflow-hidden rounded-[var(--sf-radius-card)] bg-muted", fill && "h-full")}>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={img.alt} loading="lazy" decoding="async" className={cn("w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04] motion-reduce:transition-none", ratio)} />
        ) : (
          <StoreImage src={null} alt={img.alt || String(i + 1)} className={ratio} />
        )}
        {img.caption && (
          <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent px-4 pt-10 pb-3 text-sm font-medium text-white">{img.caption}</figcaption>
        )}
      </figure>
    );
    const href = img.href ? safeHref(img.href) : null;
    return href ? (
      <Link href={href} className={cn("block rounded-[var(--sf-radius-card)] focus-ring", fill && "h-full")}>
        {fig}
      </Link>
    ) : (
      fig
    );
  };
  return (
    <Container>
      <Heading title={s.title} center={centered(s, true)} />
      {s.layout === "carousel" ? (
        <Carousel label={s.title} itemClassName="w-[78%] sm:w-[46%] lg:w-[31%] xl:w-[31%]">
          {s.images.map((img, i) => (
            <React.Fragment key={i}>{tile(img, i, "aspect-[4/5]")}</React.Fragment>
          ))}
        </Carousel>
      ) : s.layout === "masonry" ? (
        // A grid of 1/20-column-width rows (container units) with tiles spanning 20–27 of them, packed densely: every
        // column gets photos (CSS columns could leave the last one empty) at any width.
        <div className="sf-masonry" data-gallery="masonry">
          <div
            className="sf-masonry-grid"
            style={{ "--c-ph": masonryColumns(s.images.length).ph, "--c-md": masonryColumns(s.images.length).md, "--c-lg": masonryColumns(s.images.length).lg } as React.CSSProperties}
          >
            {s.images.map((img, i) => (
              <div key={i} className="min-h-0" style={{ "--rows": MASONRY_ROWS[i % 3] } as React.CSSProperties}>
                {tile(img, i, "h-full")}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
          {s.images.map((img, i) => (
            <React.Fragment key={i}>{tile(img, i, "aspect-square")}</React.Fragment>
          ))}
        </div>
      )}
    </Container>
  );
}

export function LogosSection({ s }: { s: HomeSectionOf<"logos"> }) {
  return (
    <Container>
      {s.title && <p className="mb-6 text-center text-xs font-semibold tracking-[0.18em] uppercase opacity-70 sm:mb-8">{s.title}</p>}
      <ul className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6 sm:gap-x-14">
        {s.items.map((it, i) => {
          const src = imageUrl(it.imageUrl);
          const logo = src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={it.name}
              loading="lazy"
              className={cn("h-9 w-auto max-w-[140px] object-contain sm:h-11", s.grayscale && "opacity-60 grayscale transition-[filter,opacity] duration-300 group-hover:opacity-100 group-hover:grayscale-0 motion-reduce:transition-none")}
            />
          ) : (
            // No picture: the name as a typeset wordmark (display font, the logo strip's height).
            <span
              className={cn(
                "sf-wordmark flex h-9 items-center font-display text-xl leading-none font-semibold tracking-[0.02em] whitespace-nowrap text-foreground/75 transition-[color,opacity] duration-300 group-hover:text-foreground sm:h-11 sm:text-2xl motion-reduce:transition-none",
                s.grayscale && "opacity-60 group-hover:opacity-100",
              )}
              data-logo="wordmark"
            >
              {it.name}
            </span>
          );
          const href = it.href ? safeHref(it.href) : null;
          return (
            <li key={i} className="group">
              {href ? (
                <a href={href} className="block rounded-md focus-ring" {...(/^https?:/i.test(href) ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                  {logo}
                </a>
              ) : (
                logo
              )}
            </li>
          );
        })}
      </ul>
    </Container>
  );
}

export function InstagramSection({ s, t }: { s: HomeSectionOf<"instagram">; t: Translator }) {
  const profile = `https://www.instagram.com/${encodeURIComponent(s.handle)}/`;
  return (
    <Container>
      <div className={cn("mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-8", centered(s) && "flex-col items-center text-center")}>
        <div>
          <p className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-semibold tracking-[0.14em] text-primary uppercase">
            <InstagramIcon className="size-4" aria-hidden /> @{s.handle}
          </p>
          {s.title && <h2 className="sf-heading font-display text-h2 font-semibold">{s.title}</h2>}
        </div>
        <a href={profile} target="_blank" rel="noopener noreferrer" className="sf-btn inline-flex h-11 items-center gap-2 border-2 border-current/25 px-5 text-sm font-semibold focus-ring hover:border-current/50">
          <InstagramIcon className="size-4" aria-hidden /> {t("sections.follow")}
          <span className="sr-only">{t("sections.onInstagram", { handle: s.handle })}</span>
        </a>
      </div>
      <ul className="grid grid-cols-3 gap-1.5 sm:gap-3 lg:grid-cols-6">
        {s.images.map((img, i) => {
          const src = imageUrl(img.url);
          const href = (img.href && safeHref(img.href)) || profile;
          return (
            <li key={i}>
              <a href={href} target="_blank" rel="noopener noreferrer" className="group relative block aspect-square overflow-hidden rounded-lg bg-muted focus-ring">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {src && <img src={src} alt={img.alt} loading="lazy" className="size-full object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none" />}
                <span aria-hidden className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition-[opacity,background-color] group-hover:bg-black/35 group-hover:opacity-100">
                  <InstagramIcon className="size-6" />
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </Container>
  );
}

// ------------------------------------------------------------------ testimonials (all layouts)

export function TestimonialsSection({ s, t }: { s: HomeSectionOf<"testimonials">; t: Translator }) {
  const layout = s.layout ?? "carousel";
  const band = onBand(s);
  const card = (it: (typeof s.items)[number], i: number) => (
    <figure key={i} className="flex h-full flex-col rounded-[var(--sf-radius-card)] bg-card p-6 text-card-foreground shadow-card ring-1 ring-border transition-transform duration-300 hover:-translate-y-1 motion-reduce:transition-none sm:p-7">
      <div className="flex items-center justify-between">
        <QuoteIcon className="size-8 text-primary/35" aria-hidden />
        {it.rating ? <StarsRow n={it.rating} t={t} /> : null}
      </div>
      {/* Quotes in the body font: display faces (Cinzel and other all-caps faces) turn long quotes into shouting. */}
      <blockquote className="mt-4 flex-1 font-sans text-lg leading-relaxed text-card-foreground/90">“{it.quote}”</blockquote>
      <figcaption className="mt-6 flex items-center gap-3 border-t pt-4">
        <Avatar name={it.name} photoUrl={it.photoUrl} size="size-10" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{it.name}</span>
          {it.role && <span className="block truncate text-xs text-muted-foreground">{it.role}</span>}
        </span>
      </figcaption>
    </figure>
  );
  const body = (
    <Container>
      {s.title && (
        <Reveal className="mb-10 text-center">
          <p className="mb-2 text-xs font-semibold tracking-[0.14em] text-primary uppercase">{t("home.loved")}</p>
          <h2 className="sf-heading font-display text-h2 font-semibold">{s.title}</h2>
        </Reveal>
      )}
      {layout === "single" ? (
        <QuoteRotator items={s.items} />
      ) : layout === "cards" ? (
        <div className={cn("grid gap-4 sm:gap-5", s.items.length === 1 ? "mx-auto max-w-xl" : s.items.length === 2 ? "sm:grid-cols-2 lg:mx-auto lg:max-w-4xl" : "sm:grid-cols-2 lg:grid-cols-3")}>{s.items.map(card)}</div>
      ) : (
        <Carousel label={s.title || t("home.loved")} itemClassName="w-[84%] sm:w-[46%] lg:w-[32%] xl:w-[32%]">
          {s.items.map(card)}
        </Carousel>
      )}
    </Container>
  );
  return band ? body : <section className="kolam relative bg-tint-1 py-[var(--sf-section)]">{body}</section>;
}

// ------------------------------------------------------------------ categories

export function CategoryMosaicSection({ s, t }: { s: HomeSectionOf<"category-mosaic">; t: Translator }) {
  return (
    <Container>
      {s.title && <SectionTitle title={s.title} eyebrow={t("home.explore")} href={STORE_PATHS.products} linkLabel={t("list.viewAll")} />}
      <CategoryBento categories={s.categories} t={t} />
    </Container>
  );
}

// ------------------------------------------------------------------ FAQ

export function FaqSection({ s, t }: { s: HomeSectionOf<"faq">; t: Translator }) {
  return (
    <Container className="max-w-3xl">
      <Heading title={s.title || t("sections.faq")} center={centered(s, true)} />
      <div className="divide-y overflow-hidden rounded-[var(--sf-radius-card)] bg-card text-card-foreground shadow-card ring-1 ring-border">
        {s.items.map((it, i) => (
          <details key={i} className="group" {...(i === 0 ? { open: true } : {})}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-start font-semibold outline-none focus-visible:bg-muted/60 sm:px-6 sm:py-5 [&::-webkit-details-marker]:hidden">
              <span>{it.q}</span>
              <ChevronDownIcon aria-hidden className="size-5 shrink-0 text-primary transition-transform duration-300 group-open:rotate-180 motion-reduce:transition-none" />
            </summary>
            <div className="px-5 pb-5 text-start text-muted-foreground sm:px-6">
              <Markdown source={it.a} />
            </div>
          </details>
        ))}
      </div>
    </Container>
  );
}

// ------------------------------------------------------------------ location

const digits = (p: string) => p.replace(/[^\d+]/g, "");
/** "9.9252, 78.1198" → { lat, lng } (same rule as the cms schema). */
function coordsOf(v: string | undefined): { lat: number; lng: number } | null {
  if (!v || !/^-?\d{1,2}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?$/.test(v.trim())) return null;
  const [lat, lng] = v.split(",").map((x) => Number(x.trim())) as [number, number];
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

export function LocationSection({ s, t, config }: { s: HomeSectionOf<"location">; t: Translator; config: StoreConfig }) {
  // Without its own details the section uses the shop's contact settings; with nothing to show it renders nothing.
  const phone = s.phone || config.shop.contactPhone || "";
  const whatsapp = s.whatsapp || config.shop.social?.whatsapp || "";
  const pin = coordsOf(s.coords);
  if (!s.address && !phone && !whatsapp && !pin) return null;
  const query = pin ? `${pin.lat},${pin.lng}` : `${config.shop.name} ${s.address ?? ""}`.trim();
  const directions = (s.mapLink && safeHref(s.mapLink)) || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

  const map = osmEmbedUrl(pin);
  const wa = whatsapp.replace(/\D/g, "");
  return (
    <Container>
      <Heading title={s.title} center={centered(s)} />
      {/* In a half-width row (.sf-pair, styles.css) the map stacks under the details. */}
      <div className="sf-location grid overflow-hidden rounded-[var(--sf-radius-card)] bg-card text-card-foreground shadow-card ring-1 ring-border md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="flex flex-col gap-6 p-6 sm:p-8">
          {s.address && (
            <div className="flex gap-3">
              <span className="icon-chip size-10 shrink-0 rounded-xl text-primary">
                <MapPinIcon className="size-5" aria-hidden />
              </span>
              <div>
                <p className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">{t("sections.address")}</p>
                <p className="mt-1 font-medium whitespace-pre-line">{s.address}</p>
              </div>
            </div>
          )}
          {s.hours.length > 0 && (
            <div className="flex gap-3">
              <span className="icon-chip size-10 shrink-0 rounded-xl text-primary">
                <ClockIcon className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">{t("sections.openingHours")}</p>
                <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  {s.hours.map((h, i) => (
                    <React.Fragment key={i}>
                      <dt className="text-muted-foreground">{h.label}</dt>
                      <dd className="font-medium tabular-nums">{h.value}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              </div>
            </div>
          )}
          <div className="mt-auto flex flex-wrap gap-2">
            {phone && (
              <a href={`tel:${digits(phone)}`} className="sf-btn inline-flex h-11 items-center gap-2 bg-primary px-5 text-sm font-semibold text-primary-foreground focus-ring">
                <PhoneIcon className="size-4" aria-hidden /> {t("sections.call")}
              </a>
            )}
            {wa && (
              <a href={`https://wa.me/${wa.length === 10 ? `91${wa}` : wa}`} target="_blank" rel="noopener noreferrer" className="sf-btn inline-flex h-11 items-center gap-2 bg-[#25D366] px-5 text-sm font-semibold text-white focus-ring">
                <MessageCircleIcon className="size-4" aria-hidden /> {t("sections.whatsapp")}
              </a>
            )}
            <a href={directions} target="_blank" rel="noopener noreferrer" className="sf-btn inline-flex h-11 items-center gap-2 border-2 border-border px-5 text-sm font-semibold focus-ring hover:border-primary/50">
              <NavigationIcon className="size-4" aria-hidden /> {t("sections.directions")}
            </a>
          </div>
        </div>
        <div className="relative min-h-[260px] bg-muted md:min-h-[360px]">
          {map ? (
            <>
              {/* Shows while the map loads (or if it can't). */}
              <span aria-hidden className="absolute inset-0 flex items-center justify-center bg-tint-2 text-primary">
                <MapPinIcon className="size-10 animate-bounce motion-reduce:animate-none" />
              </span>
              <iframe title={t("sections.mapTitle", { name: config.shop.name })} src={map} loading="eager" referrerPolicy="strict-origin-when-cross-origin" className="absolute inset-0 size-full border-0" />
              {/* Always a way out to a full map app (and the fallback when the embed is blocked). */}
              <a
                href={directions}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute start-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-background/95 px-3.5 py-2 text-xs font-semibold text-foreground shadow-[var(--elevation-2)] backdrop-blur focus-ring hover:text-primary"
                data-testid="map-open"
              >
                <NavigationIcon className="size-3.5" aria-hidden /> {t("sections.openInMaps")}
              </a>
            </>
          ) : (
            // No map pin set: a clear "Open in Google Maps" tile (searching the shop's name and address) instead of a map.
            <a
              href={directions}
              target="_blank"
              rel="noopener noreferrer"
              className="sf-brand-hero absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center text-primary-foreground focus-ring"
              data-testid="map-placeholder"
            >
              <span className="relative z-[1] flex size-20 items-center justify-center rounded-full bg-white/15 ring-8 ring-white/10 backdrop-blur">
                <MapPinIcon className="size-9" aria-hidden />
              </span>
              <span className="relative z-[1] inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-neutral-900 shadow-sm">
                <NavigationIcon className="size-4" aria-hidden /> {t("sections.openInMaps")}
              </span>
            </a>
          )}
        </div>
      </div>
    </Container>
  );
}

// ------------------------------------------------------------------ restaurant menu board

/** The Indian food mark: a square with a dot (veg, green) or a triangle (non-veg, brown); egg in amber. */
export function DietMark({ diet, t }: { diet: Diet; t: Translator }) {
  const color = diet === "veg" ? "#15803d" : diet === "nonveg" ? "#9a3412" : "#d97706";
  return (
    <span role="img" aria-label={t(`sections.${diet}`)} title={t(`sections.${diet}`)} className="inline-flex size-4 shrink-0 items-center justify-center rounded-[3px] border-[1.5px] bg-white" style={{ borderColor: color }}>
      {diet === "nonveg" ? (
        <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
          <path d="M5 1.2 9 8.6H1z" fill={color} />
        </svg>
      ) : (
        <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
      )}
    </span>
  );
}

export function MenuBoardSection({ s, t }: { s: HomeSectionOf<"menu-board">; t: Translator }) {
  return (
    <Container>
      <Heading title={s.title} center={centered(s, true)} />
      <div className={cn("grid gap-6 sm:gap-8", s.groups.length > 1 && "md:grid-cols-2", s.groups.length > 2 && "xl:grid-cols-3")}>
        {s.groups.map((g, gi) => (
          <section key={gi} aria-labelledby={`${s.id ?? "menu"}-g${gi}`} className="rounded-[var(--sf-radius-card)] bg-card p-6 text-card-foreground shadow-card ring-1 ring-border sm:p-7">
            <h3 id={`${s.id ?? "menu"}-g${gi}`} className="sf-heading mb-4 border-b-2 border-primary/25 pb-3 font-display text-h3 font-semibold">
              {g.name}
            </h3>
            <ul className="grid gap-4">
              {g.items.map((d, di) => (
                <li key={di} className="grid gap-0.5">
                  <div className="flex items-baseline gap-2">
                    {d.diet && <DietMark diet={d.diet} t={t} />}
                    <span className="font-semibold">{d.name}</span>
                    <span aria-hidden className="mx-1 min-w-6 flex-1 translate-y-[-3px] border-b border-dotted border-muted-foreground/40" />
                    {d.price !== undefined && <span className="font-semibold text-primary tabular-nums">{money(d.price)}</span>}
                  </div>
                  {d.description && <p className={cn("text-sm text-muted-foreground", d.diet && "ps-6")}>{d.description}</p>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {s.cta && (
        <div className="mt-8 flex justify-center">
          <CtaLink href={s.cta.href} label={s.cta.label} variant="outline" />
        </div>
      )}
    </Container>
  );
}

// ------------------------------------------------------------------ appointment

export function AppointmentSection({ s, t }: { s: HomeSectionOf<"appointment">; t: Translator }) {
  const cta = s.cta ?? { label: t("sections.book"), href: "/book" };
  const band = onBand(s);
  const hasList = s.services.length > 0;
  const words = (
    <div className={cn(!hasList && "mx-auto max-w-2xl text-center")}>
      <h2 className="sf-heading font-display text-h1 font-semibold text-balance">{s.heading}</h2>
      {s.text && <p className="mt-4 max-w-lg text-base opacity-85 sm:text-lg">{s.text}</p>}
      <CtaLink href={cta.href} label={cta.label} variant={band ? "light" : "primary"} className="mt-8" />
    </div>
  );
  const inner = (
    <div className={cn("grid items-center gap-8", hasList && "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-14")}>
      {words}
      {hasList && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {s.services.map((sv, i) => (
            <li key={i}>
              <Link href={safeHref(cta.href) ?? "/book"} className="group flex h-full items-center justify-between gap-3 rounded-2xl bg-card p-4 text-card-foreground shadow-card ring-1 ring-border transition-transform hover:-translate-y-0.5 focus-ring motion-reduce:transition-none sm:p-5">
                <span className="min-w-0">
                  <span className="block font-semibold">{sv.name}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                    {sv.duration && (
                      <span className="inline-flex items-center gap-1">
                        <ClockIcon className="size-3.5" aria-hidden /> {sv.duration}
                      </span>
                    )}
                    {sv.price !== undefined && <span className="font-semibold text-card-foreground tabular-nums">{money(sv.price)}</span>}
                  </span>
                </span>
                <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <ArrowRightIcon className="size-4 rtl:rotate-180" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return band ? <Container>{inner}</Container> : <Container><div className="rounded-[var(--sf-radius-card)] bg-tint-1 p-6 ring-1 ring-primary/10 sm:p-10 lg:p-12">{inner}</div></Container>;
}

// ------------------------------------------------------------------ before / after

export function BeforeAfterSection({ s }: { s: HomeSectionOf<"before-after"> }) {
  return (
    <Container className="max-w-5xl">
      {(s.title || s.text) && (
        <div className={cn("mb-8", centered(s, true) && "text-center")}>
          {s.title && <h2 className="sf-heading font-display text-h2 font-semibold">{s.title}</h2>}
          {s.text && <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">{s.text}</p>}
        </div>
      )}
      <BeforeAfter beforeUrl={s.beforeUrl} afterUrl={s.afterUrl} beforeLabel={s.beforeLabel} afterLabel={s.afterLabel} />
    </Container>
  );
}

// ------------------------------------------------------------------ gold rates

/** Today's board from the shop's jewellery rates; nothing when rates are off (no data) or none is set. */
export function GoldRatesSection({ s, t, rates, locale }: { s: HomeSectionOf<"gold-rates">; t: Translator; rates: PublicMetalRates | null; locale: string }) {
  if (!rates?.rates.length) return null;
  const find = (metal: string, purity: string) => rates.rates.find((r) => r.metal === metal && r.purity === purity);
  const tiles = [
    { r: find("gold", "22K"), label: t("sections.gold", { purity: "22K" }), pavun: true },
    { r: find("gold", "24K"), label: t("sections.gold", { purity: "24K" }), pavun: false },
    ...(s.showSilver ? [{ r: find("silver", "999") ?? find("silver", "925"), label: t("sections.silver"), pavun: false }] : []),
  ].filter((x) => x.r);
  if (!tiles.length) return null;
  const date = rates.date;
  return (
    <Container>
      <div className={cn("mb-8 flex flex-wrap items-end justify-between gap-3", centered(s) && "flex-col items-center text-center")}>
        <div>
          <p className="mb-1.5 inline-flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-primary uppercase">
            <span aria-hidden className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60 motion-reduce:animate-none" />
              <span className="relative inline-flex size-2 rounded-full bg-primary" />
            </span>
            {rates.setToday ? t("sections.ratesToday") : date ? t("sections.ratesOn", { date: formatDate(date, locale, { day: "numeric", month: "short" }) }) : ""}
          </p>
          <h2 className="sf-heading font-display text-h2 font-semibold">{s.title || t("sections.goldTitle")}</h2>
          {s.text && <p className="mt-2 max-w-xl text-muted-foreground">{s.text}</p>}
        </div>
      </div>
      <ul className={cn("grid grid-cols-2 gap-3 sm:gap-4", tiles.length === 3 && "sm:grid-cols-3")}>
        {tiles.map(({ r, label, pavun }, i) => (
          <li
            key={i}
            className={cn(
              "relative overflow-hidden rounded-[var(--sf-radius-card)] p-5 shadow-card ring-1 sm:p-7",
              // Phones: the headline rate full width, the others side by side.
              i === 0 && tiles.length !== 2 && "col-span-2 sm:col-span-1",
              i === 0 ? "bg-[image:var(--sf-gradient)] text-primary-foreground ring-primary/30" : "bg-card text-card-foreground ring-border",
            )}
          >
            <span aria-hidden className={cn("absolute -top-10 -right-10 size-32 rounded-full", i === 0 ? "bg-white/15" : "bg-gold/15")} />
            <p className={cn("text-sm font-semibold tracking-wide", i === 0 ? "opacity-90" : "text-muted-foreground")}>{label}</p>
            <p className="mt-2 font-display text-[clamp(1.9rem,1.4rem+1.6vw,2.6rem)] leading-none font-semibold tabular-nums">{money(r!.ratePerGram)}</p>
            <p className={cn("mt-1.5 text-sm", i === 0 ? "opacity-85" : "text-muted-foreground")}>{t("sections.perGram")}</p>
            {pavun && <p className={cn("mt-3 border-t pt-3 text-sm font-medium tabular-nums", i === 0 ? "border-white/25" : "")}>{t("sections.perPavun", { price: money(r!.ratePerGram * 8) })}</p>}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-muted-foreground">{t("sections.ratesNote")}</p>
    </Container>
  );
}

/** Ended offers are dropped at request time (the client gate hides them when they end on an open page). */
export const offerEnded = (s: HomeSection, now = Date.now()) => (s.type === "offer" || s.type === "deal") && !!s.endsAt && Date.parse(s.endsAt) <= now;

/** Section types that open the page as its big banner (the trust row goes under them; they carry the page's h1). */
export const HERO_TYPES = new Set<HomeSection["type"]>(["hero", "hero-split", "hero-video"]);
