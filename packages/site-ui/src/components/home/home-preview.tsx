"use client";

import * as React from "react";
import { CheckIcon, ChevronDownIcon, ClockIcon, CopyIcon, EyeOffIcon, HistoryIcon, ImageIcon, InstagramIcon, MapPinIcon, MonitorIcon, PlayIcon, SmartphoneIcon, StarIcon, ZapIcon } from "lucide-react";
import { cn, Skeleton } from "@srirealtime/ui";
import { absoluteUrl, useI18n } from "@srirealtime/web";
import { money } from "../../lib/format";
import type { SectionStyle } from "../../lib/content";
import type { PublicProductSummary, ResolvedHomeSection } from "../../lib/types";
import { Markdown } from "../markdown";
import { CategoriesSketch } from "./categories-sketch";
import { uspIcon } from "./section-meta";

/**
 * A simple approximation of the storefront's look (brand colours from the admin's own theme), rendered from resolved
 * sections. Container queries switch between the phone and desktop layouts, so the "Phone" frame shows the mobile
 * layout even on a wide screen. Links are inert.
 */
export function HomePreview({
  sections,
  shopName,
  loading,
  device,
  onDevice,
  note,
  selectedId,
}: {
  sections: ResolvedHomeSection[];
  shopName: string;
  loading?: boolean;
  device: "phone" | "desktop";
  onDevice: (d: "phone" | "desktop") => void;
  note?: React.ReactNode;
  /** Highlights the section being edited. */
  selectedId?: string | null;
}) {
  const { t } = useI18n();
  const paired = pairedHalves(sections);
  const seg = (on: boolean) =>
    cn("inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring", on ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground");
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex rounded-lg bg-muted p-0.5" role="radiogroup" aria-label={t("site.preview.device")}>
          <button type="button" role="radio" aria-checked={device === "phone"} className={seg(device === "phone")} onClick={() => onDevice("phone")}>
            <SmartphoneIcon className="size-3.5" /> {t("site.preview.phone")}
          </button>
          <button type="button" role="radio" aria-checked={device === "desktop"} className={seg(device === "desktop")} onClick={() => onDevice("desktop")}>
            <MonitorIcon className="size-3.5" /> {t("site.preview.desktop")}
          </button>
        </div>
        {note && <p className="min-w-0 truncate text-xs text-muted-foreground">{note}</p>}
      </div>
      <div
        className={cn(
          "mx-auto w-full overflow-hidden border bg-background shadow-elevated transition-[max-width] duration-300",
          device === "phone" ? "max-w-[24rem] rounded-[1.75rem] border-[6px] border-foreground/80" : "rounded-xl",
        )}
      >
        <div className="flex items-center gap-2 border-b bg-card px-3 py-2">
          <span className="size-6 shrink-0 rounded-md bg-primary" aria-hidden />
          <span className="truncate font-heading text-sm font-semibold">{shopName}</span>
          <span className="ml-auto h-6 w-16 rounded-full bg-muted" aria-hidden />
        </div>
        <div className="@container max-h-[70vh] overflow-y-auto overscroll-contain" inert aria-label={t("site.preview.label")}>
          {loading ? (
            <div className="grid gap-3 p-3">
              <Skeleton className="aspect-[16/7] w-full rounded-xl" />
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-40 w-full rounded-xl" />
            </div>
          ) : sections.length === 0 ? (
            <p className="px-6 py-16 text-center text-sm text-muted-foreground">{t("site.preview.empty")}</p>
          ) : (
            <div className="grid gap-6 pb-6 @lg:grid-cols-2">
              {sections.map((s, i) => {
                const hidden = "hidden" in s && s.hidden === true;
                return (
                  <div
                    key={s.id ?? `${s.type}-${i}`}
                    data-hidden={hidden || undefined}
                    className={cn(
                      "relative transition-shadow min-w-0",
                      // Two neighbouring half sections share a row on wide screens, as on the storefront.
                      !paired.has(i) && "@lg:col-span-2",
                      hidden && "rounded-lg outline-1 outline-offset-2 outline-muted-foreground/40 outline-dashed",
                      selectedId && s.id === selectedId && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                    )}
                  >
                    {hidden && (
                      <span className="absolute -top-2.5 right-3 z-10 inline-flex items-center gap-1 rounded-full bg-foreground/85 px-2 py-0.5 text-xs font-medium text-background shadow-sm">
                        <EyeOffIcon className="size-3" aria-hidden /> {t("site.preview.hiddenBadge")}
                      </span>
                    )}
                    <div className={cn(hidden && "opacity-40 grayscale-[60%]")}>
                      <StyleBand style={s.style} device={device}>
                        <PreviewSection s={s} />
                      </StyleBand>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Indexes of sections that sit beside a neighbour (`style.span: "half"` pairs, like the storefront's pages/home.tsx). */
export function pairedHalves(sections: readonly { style?: { span?: string } }[]): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < sections.length - 1; i++) {
    if (sections[i]?.style?.span === "half" && sections[i + 1]?.style?.span === "half") {
      out.add(i);
      out.add(i + 1);
      i++;
    }
  }
  return out;
}

function Img({ src, className, alt = "" }: { src: string | null | undefined; className?: string; alt?: string }) {
  const url = absoluteUrl(src ?? null);
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- preview
    <img src={url} alt={alt} className={cn("object-cover", className)} />
  ) : (
    <span className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)}>
      <ImageIcon className="size-6 opacity-50" />
    </span>
  );
}

/** Same lattice as the storefront's `.sf-brand-hero` (white at low opacity over the brand colour). */
const LATTICE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 48 48'%3E%3Cg fill='none' stroke='%23fff' stroke-opacity='.13' stroke-width='1'%3E%3Cpath d='M24 8 40 24 24 40 8 24Z'/%3E%3Cpath d='M24 16 32 24 24 32 16 24Z'/%3E%3C/g%3E%3Cg fill='%23fff' fill-opacity='.2'%3E%3Ccircle cx='24' cy='24' r='1.4'/%3E%3Ccircle cx='0' cy='0' r='1.4'/%3E%3Ccircle cx='48' cy='0' r='1.4'/%3E%3Ccircle cx='0' cy='48' r='1.4'/%3E%3Ccircle cx='48' cy='48' r='1.4'/%3E%3C/g%3E%3C/svg%3E\")";

/** A hero slide without a photo: the shop's brand colour as a gradient with a subtle pattern (as on the storefront). */
export function BrandBackdrop() {
  return (
    <span
      data-brand-hero
      aria-hidden
      className="absolute inset-0 overflow-hidden"
      style={{
        backgroundColor: "var(--primary)",
        backgroundImage: [
          LATTICE,
          "radial-gradient(60% 80% at 85% 20%, color-mix(in oklch, var(--primary) 55%, white) 0%, transparent 70%)",
          "radial-gradient(50% 70% at 10% 100%, color-mix(in oklch, var(--primary) 60%, black) 0%, transparent 70%)",
          "linear-gradient(120deg, color-mix(in oklch, var(--primary) 72%, black) 0%, var(--primary) 55%, color-mix(in oklch, var(--primary) 80%, white) 100%)",
        ].join(", "),
        backgroundSize: "48px 48px, auto, auto, auto",
      }}
    >
      <span
        className="absolute -right-[10%] -bottom-[35%] aspect-square w-[70%] rounded-full"
        style={{
          background: "repeating-radial-gradient(circle, transparent 0 14px, rgb(255 255 255 / 0.08) 14px 16px)",
          maskImage: "radial-gradient(circle, black 30%, transparent 70%)",
        }}
      />
    </span>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return children ? <h3 className="px-4 font-heading text-lg font-semibold tracking-tight @lg:text-xl">{children}</h3> : null;
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return <p className="mx-4 rounded-xl border-2 border-dashed px-4 py-6 text-center text-meta text-muted-foreground">{children}</p>;
}

function ProductCard({ p }: { p: PublicProductSummary }) {
  return (
    <div className="grid gap-1.5">
      <Img src={p.image} alt={p.name} className="aspect-[4/5] w-full rounded-lg" />
      <p className="line-clamp-2 text-xs font-medium">{p.name}</p>
      <p className="text-xs font-semibold tabular-nums">
        {money(p.priceMin)}
        {p.mrp && p.mrp > p.priceMin ? <span className="ml-1 font-normal text-muted-foreground line-through">{money(p.mrp)}</span> : null}
      </p>
    </div>
  );
}

/** Product tiles the preview can't know yet (best sellers, recommended, recently viewed: filled on the storefront). */
function ShelfSketch({ n, row, faded }: { n: number; row?: boolean; faded?: boolean }) {
  return (
    <div className={cn("gap-3 px-4", row ? "flex overflow-hidden" : "grid grid-cols-2 @lg:grid-cols-4")}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className={cn("grid gap-1.5", row && "w-[42%] shrink-0 @lg:w-[22%]")} style={faded ? { opacity: 1 - i * 0.15 } : undefined}>
          <span className="aspect-[4/5] rounded-lg bg-primary/8 ring-1 ring-border" />
          <span className="h-2.5 w-4/5 rounded-full bg-muted" />
          <span className="h-2.5 w-2/5 rounded-full bg-primary/25" />
        </div>
      ))}
    </div>
  );
}

function ProductRow({ products, layout }: { products: PublicProductSummary[]; layout: "carousel" | "grid" }) {
  return layout === "carousel" ? (
    <div className="flex snap-x gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
      {products.map((p) => (
        <div key={p.id} className="w-[42%] shrink-0 snap-start @lg:w-[22%]">
          <ProductCard p={p} />
        </div>
      ))}
    </div>
  ) : (
    <div className="grid grid-cols-2 gap-3 px-4 @lg:grid-cols-4">
      {products.map((p) => (
        <ProductCard key={p.id} p={p} />
      ))}
    </div>
  );
}

const BAND: Record<string, string> = {
  brand: "bg-primary text-primary-foreground",
  gradient: "bg-gradient-to-br from-primary to-primary/70 text-primary-foreground",
  dark: "bg-neutral-900 text-white",
  image: "bg-neutral-800 text-white",
  muted: "bg-primary/8",
};

/**
 * The section's style, roughly: its background band, spacing and alignment. "Hidden on phones / larger screens" shows
 * as a badge (and dims the section in that device frame), so the owner sees the rule without losing the section.
 */
function StyleBand({ style: st, device, children }: { style?: SectionStyle; device: "phone" | "desktop"; children: React.ReactNode }) {
  const { t } = useI18n();
  if (!st) return <>{children}</>;
  const bg = st.background && st.background !== "none" ? st.background : null;
  const off = (device === "phone" && st.hideOnMobile) || (device === "desktop" && st.hideOnDesktop);
  const photo = bg === "image" ? absoluteUrl(st.imageUrl ?? null) : null;
  return (
    <div
      data-style-band={bg ?? undefined}
      className={cn(
        "relative isolate overflow-hidden",
        bg && BAND[bg],
        bg && (st.padding === "compact" ? "py-3" : st.padding === "spacious" ? "py-10" : "py-6"),
        bg && st.width === "contained" && "mx-3 rounded-xl",
        st.align === "center" && "text-center",
        off && "opacity-40",
      )}
    >
      {photo && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- preview */}
          <img src={photo} alt="" className="absolute inset-0 -z-20 size-full object-cover" />
          <span className="absolute inset-0 -z-10 bg-black" style={{ opacity: (st.overlay ?? 45) / 100 }} />
        </>
      )}
      {(st.hideOnMobile || st.hideOnDesktop) && (
        <span className="absolute top-1 left-3 z-10 inline-flex items-center gap-1 rounded-full bg-foreground/85 px-2 py-0.5 text-[10px] font-medium text-background">
          <EyeOffIcon className="size-3" aria-hidden /> {st.hideOnMobile ? t("site.style.hideOnMobile") : t("site.style.hideOnDesktop")}
        </span>
      )}
      {children}
    </div>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <span className="flex gap-0.5" aria-hidden>
      {[1, 2, 3, 4, 5].map((k) => (
        <StarIcon key={k} className={cn("size-3", k <= n ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30")} />
      ))}
    </span>
  );
}

function Btn({ children, outline }: { children: React.ReactNode; outline?: boolean }) {
  return <span className={cn("inline-flex h-9 w-fit items-center rounded-full px-4 text-xs font-semibold", outline ? "border-2 border-current/30" : "bg-primary text-primary-foreground")}>{children}</span>;
}

function DietDot({ diet }: { diet?: string }) {
  if (!diet) return null;
  const color = diet === "veg" ? "#15803d" : diet === "nonveg" ? "#9a3412" : "#d97706";
  return (
    <span className="inline-flex size-3 shrink-0 items-center justify-center rounded-[2px] border bg-white" style={{ borderColor: color }} aria-hidden>
      <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
    </span>
  );
}

function PreviewSection({ s }: { s: ResolvedHomeSection }) {
  const { t } = useI18n();
  const [slide, setSlide] = React.useState(0);
  switch (s.type) {
    case "hero": {
      const sl = s.slides[Math.min(slide, s.slides.length - 1)];
      if (!sl) return null;
      return (
        <div className="relative">
          <div className="relative aspect-[4/5] overflow-hidden @lg:aspect-[16/7]">
            {sl.imageUrl ? (
              <>
                <Img src={sl.mobileImageUrl || sl.imageUrl} className="absolute inset-0 size-full @lg:hidden" />
                <Img src={sl.imageUrl} className="absolute inset-0 hidden size-full @lg:block" />
              </>
            ) : (
              <BrandBackdrop />
            )}
            <span className={cn("absolute inset-0 bg-gradient-to-t to-transparent @lg:bg-gradient-to-r", sl.imageUrl ? "from-black/60 via-black/20" : "from-black/30")} />
            <div className="absolute inset-x-0 bottom-0 grid gap-2 p-5 text-white @lg:inset-y-0 @lg:right-auto @lg:max-w-[60%] @lg:content-center @lg:p-8">
              {sl.heading && <p className="font-heading text-2xl leading-tight font-bold @lg:text-3xl">{sl.heading}</p>}
              {sl.subheading && <p className="text-sm opacity-90">{sl.subheading}</p>}
              {sl.cta?.label && <span className="mt-1 inline-flex h-10 w-fit items-center rounded-full bg-white px-5 text-sm font-semibold text-neutral-900 shadow-sm">{sl.cta.label}</span>}
            </div>
          </div>
          {s.slides.length > 1 && (
            <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
              {s.slides.map((_, i) => (
                <button key={i} type="button" onClick={() => setSlide(i)} className={cn("size-2 rounded-full", i === slide ? "bg-white" : "bg-white/50")} aria-label={t("site.home.slideN", { n: i + 1 })} />
              ))}
            </div>
          )}
        </div>
      );
    }
    case "categories":
      return (
        <div className="grid gap-3">
          <Title>{s.title}</Title>
          {s.categories.length === 0 ? <Placeholder>{t("site.preview.noCategories")}</Placeholder> : <CategoriesSketch s={s} />}
        </div>
      );
    case "collection":
      return (
        <div className="grid gap-3">
          <Title>{s.title || s.collection.name}</Title>
          {s.products.length === 0 ? <Placeholder>{s.collection.slug ? t("site.preview.noProducts") : t("site.preview.pickCollection")}</Placeholder> : <ProductRow products={s.products} layout={s.layout} />}
        </div>
      );
    case "products":
      return (
        <div className="grid gap-3">
          <Title>{s.title}</Title>
          {s.products.length === 0 ? <Placeholder>{t("site.preview.pickProducts")}</Placeholder> : <ProductRow products={s.products} layout="grid" />}
        </div>
      );
    case "banner":
      return (
        <div className="px-4">
          {s.imageUrl ? (
            <>
              <Img src={s.mobileImageUrl || s.imageUrl} alt={s.alt} className="aspect-[4/3] w-full rounded-xl @lg:hidden" />
              <Img src={s.imageUrl} alt={s.alt} className="hidden aspect-[16/5] w-full rounded-xl @lg:block" />
            </>
          ) : (
            <Img src={null} className="aspect-[16/5] w-full rounded-xl" />
          )}
        </div>
      );
    case "text":
      return (
        <div className="mx-auto grid max-w-2xl gap-2 px-4">
          {s.heading && <h3 className="font-heading text-lg font-semibold">{s.heading}</h3>}
          <Markdown source={s.markdown} />
        </div>
      );
    case "image-text":
      return (
        <div className={cn("grid items-center gap-4 px-4 @lg:grid-cols-2", s.imageSide === "right" && "@lg:[&>*:first-child]:order-2")}>
          <Img src={s.imageUrl || null} className="aspect-[4/3] w-full rounded-xl" />
          <div className="grid gap-2">
            <h3 className="font-heading text-lg font-semibold">{s.heading}</h3>
            {s.markdown && <Markdown source={s.markdown} />}
            {s.cta?.label && <span className="inline-flex h-10 w-fit items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground">{s.cta.label}</span>}
          </div>
        </div>
      );
    case "testimonials": {
      const card = (it: (typeof s.items)[number], i: number, cls?: string) => (
        <figure key={i} className={cn("rounded-xl border bg-card p-4 text-card-foreground", cls)}>
          {it.rating ? <Stars n={it.rating} /> : null}
          <blockquote className="mt-1 text-sm leading-relaxed">“{it.quote}”</blockquote>
          <figcaption className="mt-2 text-xs font-medium text-primary">
            — {it.name}
            {it.role && <span className="font-normal text-muted-foreground"> · {it.role}</span>}
          </figcaption>
        </figure>
      );
      const layout = s.layout ?? "carousel";
      const first = s.items[0];
      return (
        <div className="grid gap-3">
          <Title>{s.title}</Title>
          {layout === "single" && first ? (
            <div className="mx-auto grid max-w-md justify-items-center gap-2 px-4 text-center">
              {first.rating ? <Stars n={first.rating} /> : null}
              <p className="font-heading text-lg leading-snug">“{first.quote}”</p>
              <p className="text-xs font-medium">{first.name}</p>
            </div>
          ) : layout === "cards" ? (
            <div className="grid gap-3 px-4 @lg:grid-cols-3">{s.items.map((it, i) => card(it, i))}</div>
          ) : (
            <div className="flex snap-x gap-3 overflow-x-auto px-4 [scrollbar-width:none]">{s.items.map((it, i) => card(it, i, "w-[80%] shrink-0 snap-start @lg:w-[32%]"))}</div>
          )}
        </div>
      );
    }
    case "usp":
      return (
        <div className="grid gap-2">
          {(s.title || s.text) && (s.layout === "centered" || s.layout === "split") && (
            <div className="px-4">
              <Title>{s.title}</Title>
              {s.text && <p className="text-sm text-muted-foreground">{s.text}</p>}
            </div>
          )}
        <div className={cn("mx-4 grid grid-cols-2 gap-3 p-4 @lg:grid-cols-4", s.layout === "inline" ? "rounded-xl border bg-card py-2" : s.layout === "centered" || s.layout === "split" ? "" : "rounded-xl bg-muted/50")}>
          {s.items.map((it, i) => {
            const Icon = uspIcon(it.icon);
            return (
              <div key={i} className="grid justify-items-center gap-1 text-center">
                <span className="icon-chip size-10 rounded-full text-primary">
                  <Icon className="size-5" />
                </span>
                <p className="text-xs font-semibold">{it.title}</p>
                {it.text && <p className="text-xs text-muted-foreground">{it.text}</p>}
              </div>
            );
          })}
        </div>
        </div>
      );
    case "newsletter":
      return (
        <div className={cn("mx-4 grid gap-2 rounded-xl p-5 text-center", s.layout === "card" || s.layout === "inline" ? "border bg-card" : s.layout === "split" ? "border bg-card @lg:grid-cols-2 @lg:text-left" : "bg-primary/10")}>
          {s.layout === "split" && <Img src={s.imageUrl ?? null} className="aspect-[4/3] w-full rounded-lg @lg:row-span-3" />}
          <p className="font-heading text-lg font-semibold">{s.heading}</p>
          {s.text && <p className="text-sm text-muted-foreground">{s.text}</p>}
          <div className="mx-auto mt-1 flex w-full max-w-sm gap-2">
            <span className="h-10 flex-1 rounded-lg border bg-card px-3 text-left text-sm leading-10 text-muted-foreground">{t("site.preview.email")}</span>
            <span className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">{t("site.preview.subscribe")}</span>
          </div>
        </div>
      );
    case "hero-split":
      return (
        <div className={cn("grid items-center gap-4 px-4 py-4 @lg:grid-cols-2", s.imageSide === "left" && "@lg:[&>*:first-child]:order-2")}>
          <div className="grid gap-2">
            {s.eyebrow && <p className="text-[10px] font-semibold tracking-widest text-primary uppercase">{s.eyebrow}</p>}
            <p className="font-heading text-2xl leading-tight font-bold">{s.heading}</p>
            {s.text && <p className="text-sm opacity-80">{s.text}</p>}
            <div className="mt-1 flex flex-wrap gap-2">
              {s.cta?.label && <Btn>{s.cta.label}</Btn>}
              {s.cta2?.label && <Btn outline>{s.cta2.label}</Btn>}
            </div>
          </div>
          <div className="relative aspect-[4/3] overflow-hidden rounded-xl @lg:aspect-[4/5]">{s.imageUrl ? <Img src={s.imageUrl} className="absolute inset-0 size-full" /> : <BrandBackdrop />}</div>
        </div>
      );
    case "hero-video":
      return (
        <div className="relative aspect-[4/5] overflow-hidden bg-neutral-900 text-white @lg:aspect-[16/7]">
          {s.posterUrl && <Img src={s.posterUrl} className="absolute inset-0 size-full" />}
          <span className="absolute inset-0 bg-black" style={{ opacity: (s.overlay ?? 45) / 100 }} />
          <div className="absolute inset-0 grid content-center justify-items-center gap-2 p-5 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-white/20">
              <PlayIcon className="size-4" />
            </span>
            <p className="font-heading text-2xl leading-tight font-bold">{s.heading}</p>
            {s.text && <p className="text-sm opacity-85">{s.text}</p>}
            {s.cta?.label && <span className="inline-flex h-9 items-center rounded-full bg-white px-4 text-xs font-semibold text-neutral-900">{s.cta.label}</span>}
          </div>
        </div>
      );
    case "offer":
      return (
        <div className={cn("mx-4 grid gap-2 rounded-xl p-5", !s.style?.background && "bg-gradient-to-br from-primary to-primary/70 text-primary-foreground")}>
          {s.eyebrow && <p className="text-[10px] font-bold tracking-widest uppercase opacity-90">{s.eyebrow}</p>}
          <p className="font-heading text-xl font-bold">{s.heading}</p>
          {s.text && <p className="text-sm opacity-85">{s.text}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {s.code && (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-current/60 px-2.5 py-1 font-mono text-sm font-bold">
                {s.code} <CopyIcon className="size-3" />
              </span>
            )}
            {s.endsAt && <span className="text-xs opacity-85">{t("site.preview.endsAt", { date: new Date(s.endsAt).toLocaleString() })}</span>}
          </div>
        </div>
      );
    case "gallery": {
      const imgs = s.images ?? [];
      if (!imgs.length) return <Placeholder>{t("site.preview.addImages")}</Placeholder>;
      return (
        <div className="grid gap-3">
          <Title>{s.title}</Title>
          <div className={cn("px-4", s.layout === "carousel" ? "flex gap-2 overflow-x-auto [scrollbar-width:none]" : s.layout === "masonry" ? "columns-2 gap-2 @lg:columns-3 [&>*]:mb-2" : "grid grid-cols-2 gap-2 @lg:grid-cols-4")}>
            {imgs.map((im, i) => (
              <Img
                key={i}
                src={im.url}
                alt={im.alt}
                className={cn("w-full rounded-lg", s.layout === "carousel" ? "aspect-[4/5] w-[60%] shrink-0 @lg:w-[30%]" : s.layout === "masonry" ? (i % 2 ? "aspect-square" : "aspect-[3/4]") : "aspect-square")}
              />
            ))}
          </div>
        </div>
      );
    }
    case "logos":
      return (
        <div className="grid gap-3 px-4">
          {s.title && <p className="text-center text-[10px] font-semibold tracking-widest uppercase opacity-70">{s.title}</p>}
          <div className="flex flex-wrap items-center justify-center gap-5">
            {(s.items ?? []).map((l, i) =>
              l.imageUrl ? (
                <Img key={i} src={l.imageUrl} alt={l.name} className={cn("h-7 w-auto max-w-24 object-contain", s.grayscale && "opacity-60 grayscale")} />
              ) : (
                <span key={i} className="font-display text-base font-semibold tracking-[0.02em] whitespace-nowrap opacity-75">
                  {l.name}
                </span>
              ),
            )}
          </div>
        </div>
      );
    case "category-mosaic":
      return (
        <div className="grid gap-3">
          <Title>{s.title}</Title>
          {s.categories.length === 0 ? (
            <Placeholder>{t("site.preview.noCategories")}</Placeholder>
          ) : (
            <div className="grid auto-rows-[80px] grid-cols-2 gap-2 px-4 @lg:auto-rows-[100px] @lg:grid-cols-4">
              {s.categories.map((c, i) => (
                <div key={c.id} className={cn("relative overflow-hidden rounded-lg bg-muted", i === 0 && s.categories.length > 2 && "col-span-2 row-span-2")}>
                  <Img src={c.image} className="absolute inset-0 size-full" />
                  <span className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  <span className="absolute bottom-2 left-2 text-xs font-semibold text-white">{c.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    case "faq":
      return (
        <div className="mx-auto grid max-w-2xl gap-2 px-4">
          <Title>{s.title}</Title>
          <div className="divide-y rounded-xl border bg-card text-card-foreground">
            {(s.items ?? []).map((it, i) => (
              <div key={i} className="px-3 py-2.5">
                <p className="flex items-center justify-between gap-2 text-sm font-medium">
                  {it.q} <ChevronDownIcon className={cn("size-4 shrink-0 text-primary", i === 0 && "rotate-180")} />
                </p>
                {i === 0 && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    <Markdown source={it.a} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      );
    case "location":
      return (
        <div className="grid gap-3">
          <Title>{s.title}</Title>
          <div className="mx-4 grid overflow-hidden rounded-xl border bg-card text-card-foreground @lg:grid-cols-2">
            <div className="grid content-start gap-2 p-4 text-sm">
              {s.address ? (
                <p className="flex gap-2">
                  <MapPinIcon className="mt-0.5 size-4 shrink-0 text-primary" /> <span className="whitespace-pre-line">{s.address}</span>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">{t("site.preview.shopContact")}</p>
              )}
              {(s.hours ?? []).map((h, i) => (
                <p key={i} className="flex gap-2 text-xs">
                  <ClockIcon className="size-3.5 text-primary" /> <span className="text-muted-foreground">{h.label}</span> <span className="font-medium">{h.value}</span>
                </p>
              ))}
            </div>
            <div className="relative min-h-28 bg-primary/10">
              <MapPinIcon className="absolute top-1/2 left-1/2 size-8 -translate-x-1/2 -translate-y-1/2 text-primary" />
              {s.coords && <span className="absolute right-2 bottom-2 rounded bg-background/80 px-1.5 text-[10px] text-muted-foreground">{s.coords}</span>}
            </div>
          </div>
        </div>
      );
    case "menu-board":
      return (
        <div className="grid gap-3">
          <Title>{s.title}</Title>
          <div className="grid gap-3 px-4 @lg:grid-cols-2">
            {(s.groups ?? []).map((g, gi) => (
              <div key={gi} className="rounded-xl border bg-card p-3 text-card-foreground">
                <p className="mb-2 border-b pb-1.5 font-heading text-sm font-semibold">{g.name}</p>
                {(g.items ?? []).map((d, di) => (
                  <p key={di} className="flex items-center gap-1.5 py-0.5 text-xs">
                    <DietDot diet={d.diet} />
                    <span className="font-medium">{d.name}</span>
                    <span className="flex-1 border-b border-dotted border-muted-foreground/40" />
                    {d.price !== undefined && <span className="font-semibold text-primary tabular-nums">{money(d.price)}</span>}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </div>
      );
    case "appointment":
      return (
        <div className={cn("mx-4 grid gap-3 rounded-xl p-4 @lg:grid-cols-2", !s.style?.background && "bg-primary/8")}>
          <div className="grid content-start gap-2">
            <p className="font-heading text-lg leading-tight font-bold">{s.heading}</p>
            {s.text && <p className="text-sm opacity-80">{s.text}</p>}
            <span className={cn("inline-flex h-9 w-fit items-center rounded-full px-4 text-xs font-semibold", s.style?.background ? "bg-white text-neutral-900" : "bg-primary text-primary-foreground")}>
              {s.cta?.label || t("site.samples.book")}
            </span>
          </div>
          <div className="grid gap-1.5">
            {(s.services ?? []).map((v, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg border bg-card px-3 py-2 text-xs text-card-foreground">
                <span className="font-medium">{v.name}</span>
                <span className="text-muted-foreground">{[v.duration, v.price !== undefined ? money(v.price) : ""].filter(Boolean).join(" · ")}</span>
              </div>
            ))}
          </div>
        </div>
      );
    case "before-after":
      return (
        <div className="grid gap-3">
          <Title>{s.title}</Title>
          <div className="relative mx-4 grid aspect-[16/9] grid-cols-2 overflow-hidden rounded-xl">
            <Img src={s.beforeUrl || null} className="size-full" />
            <Img src={s.afterUrl || null} className="size-full" />
            <span className="absolute inset-y-0 left-1/2 w-0.5 bg-white" />
          </div>
        </div>
      );
    case "gold-rates":
      return (
        <div className="grid gap-3">
          <Title>{s.title}</Title>
          <div className={cn("grid gap-2 px-4", s.showSilver ? "grid-cols-3" : "grid-cols-2")}>
            {["22K", "24K", ...(s.showSilver ? [t("site.preview.silver")] : [])].map((k, i) => (
              <div key={k} className={cn("rounded-xl p-3", i === 0 ? "bg-primary text-primary-foreground" : "border bg-card text-card-foreground")}>
                <p className="text-[10px] font-semibold opacity-80">{k}</p>
                <p className="font-heading text-base font-bold">₹ ••••</p>
              </div>
            ))}
          </div>
          <p className="px-4 text-[11px] text-muted-foreground">{t("site.preview.goldNote")}</p>
        </div>
      );
    case "product-tabs":
      return (
        <div className="grid gap-3">
          <Title>{s.title}</Title>
          <div className="flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
            {s.tabs.map((tab, i) => (
              <span key={i} className={cn("rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap", i === 0 ? "bg-primary text-primary-foreground" : "border text-muted-foreground")}>
                {tab.label || t(`site.home.tabSource.${tab.source}`)}
              </span>
            ))}
          </div>
          <ShelfSketch n={s.layout === "grid" ? 4 : 5} row={s.layout !== "grid"} />
        </div>
      );
    case "bestsellers":
    case "recommended":
      return (
        <div className="grid gap-3">
          <Title>{s.title || t(`site.home.type.${s.type}`)}</Title>
          <ShelfSketch n={s.layout === "grid" ? 4 : 5} row={s.layout !== "grid"} />
          <p className="px-4 text-[11px] text-muted-foreground">{t(s.type === "bestsellers" ? "site.home.bestsellersHint" : "site.home.recommendedHint")}</p>
        </div>
      );
    case "recently-viewed":
      return (
        <div className="grid gap-3">
          <Title>
            <span className="inline-flex items-center gap-2">
              {s.title || t("site.home.type.recently-viewed")} <HistoryIcon className="size-4 text-muted-foreground" />
            </span>
          </Title>
          <ShelfSketch n={5} row faded />
          <p className="px-4 text-[11px] text-muted-foreground">{t("site.home.recentHint")}</p>
        </div>
      );
    case "deal":
      return (
        <div className="mx-4 grid gap-3 overflow-hidden rounded-xl bg-primary/8 @lg:grid-cols-2">
          <Img src={s.product.image} alt={s.product.name} className="aspect-square w-full" />
          <div className="grid content-center gap-2 p-4">
            <p className="text-[11px] font-bold tracking-wider text-primary uppercase">{s.title || t("site.home.type.deal")}</p>
            {s.product.id ? <p className="font-heading text-lg font-semibold">{s.product.name}</p> : <Placeholder>{t("site.home.dealPick")}</Placeholder>}
            {s.product.id && <p className="text-sm font-semibold tabular-nums">{money(s.product.priceMin)}</p>}
            <div className="flex gap-1.5">
              {["00", "12", "34", "56"].map((n, i) => (
                <span key={i} className="rounded-md bg-primary px-2 py-1 font-heading text-sm font-bold text-primary-foreground tabular-nums">
                  {n}
                </span>
              ))}
            </div>
            <Btn>{t("site.preview.addToCart")}</Btn>
          </div>
        </div>
      );
    case "shop-the-look":
      return (
        <div className="grid gap-3">
          <Title>{s.title || t("site.home.type.shop-the-look")}</Title>
          <div className="relative mx-4 overflow-hidden rounded-xl">
            <Img src={s.imageUrl || null} alt={s.alt} className="aspect-[4/3] w-full" />
            {s.hotspots.map((h, i) => (
              <span key={i} className="absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[11px] font-bold text-neutral-900 shadow ring-2 ring-white/50" style={{ left: `${h.x}%`, top: `${h.y}%` }}>
                {i + 1}
              </span>
            ))}
          </div>
          {s.hotspots.length === 0 && <Placeholder>{t("site.home.placeDotsHint")}</Placeholder>}
        </div>
      );
    case "stats":
      return (
        <div className="grid gap-3">
          <Title>{s.title}</Title>
          <div className="grid grid-cols-2 gap-2 px-4 @lg:grid-cols-4">
            {s.items.map((it, i) => (
              <div key={i} className="rounded-xl border bg-card p-3 text-center">
                <p className="font-heading text-xl font-bold text-primary tabular-nums">
                  {it.prefix}
                  {Number(it.value).toLocaleString("en-IN")}
                  {it.suffix}
                </p>
                <p className="text-[11px] text-muted-foreground">{it.label}</p>
              </div>
            ))}
          </div>
        </div>
      );
    case "timeline":
      return (
        <div className="grid gap-3">
          <Title>{s.title || t("site.home.type.timeline")}</Title>
          <ol className="mx-4 grid gap-3 border-s-2 border-primary/25 ps-4">
            {s.items.map((it, i) => (
              <li key={i} className="relative">
                <span className="absolute -start-[1.4rem] top-1 size-3 rounded-full bg-primary ring-2 ring-background" />
                <p className="font-heading text-sm font-bold text-primary">{it.when}</p>
                <p className="text-sm font-semibold">{it.title}</p>
                {it.text && <p className="line-clamp-2 text-xs text-muted-foreground">{it.text}</p>}
              </li>
            ))}
          </ol>
        </div>
      );
    case "team":
      return (
        <div className="grid gap-3">
          <Title>{s.title || t("site.home.type.team")}</Title>
          <div className="grid grid-cols-2 gap-3 px-4 @lg:grid-cols-4">
            {s.members.map((m, i) => (
              <div key={i} className="overflow-hidden rounded-xl border bg-card">
                <Img src={m.photoUrl ?? null} alt={m.name} className="aspect-[4/5] w-full" />
                <div className="p-2">
                  <p className="truncate text-xs font-semibold">{m.name}</p>
                  {m.role && <p className="truncate text-[11px] text-primary">{m.role}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    case "pricing-table":
      return (
        <div className="grid gap-3">
          <Title>{s.title || t("site.home.type.pricing-table")}</Title>
          <div className="grid gap-3 px-4 @lg:grid-cols-3">
            {s.plans.map((p, i) => (
              <div key={i} className={cn("grid gap-1.5 rounded-xl p-4", p.highlight ? "bg-primary text-primary-foreground" : "border bg-card")}>
                <p className="text-sm font-semibold">{p.name}</p>
                <p className="font-heading text-xl font-bold tabular-nums">
                  {p.price !== undefined ? money(p.price) : t("site.home.askPrice")}
                  {p.period && <span className="ms-1 text-xs font-normal opacity-75">{p.period}</span>}
                </p>
                {(p.features ?? []).slice(0, 4).map((f, j) => (
                  <p key={j} className="flex items-center gap-1.5 text-xs">
                    <CheckIcon className="size-3" /> {f}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </div>
      );
    case "blog-posts":
      return (
        <div className="grid gap-3">
          <Title>{s.title || t("site.home.type.blog-posts")}</Title>
          <div className="grid gap-3 px-4 @lg:grid-cols-3">
            {Array.from({ length: Math.min(3, s.limit || 3) }, (_, i) => (
              <div key={i} className="grid gap-1.5 rounded-xl border bg-card p-2">
                <span className="aspect-[16/10] rounded-lg bg-primary/10" />
                <span className="h-2.5 w-4/5 rounded-full bg-muted" />
                <span className="h-2 w-3/5 rounded-full bg-muted" />
              </div>
            ))}
          </div>
          <p className="px-4 text-[11px] text-muted-foreground">{t("site.home.blogHint")}</p>
        </div>
      );
    case "reviews-summary":
      return (
        <div className="grid gap-3">
          <Title>{s.title || t("site.home.type.reviews-summary")}</Title>
          <div className="mx-4 grid gap-3 @lg:grid-cols-[1fr_2fr]">
            <div className="rounded-xl border bg-card p-4">
              <p className="font-heading text-3xl font-bold">4.8</p>
              <Stars n={5} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[0, 1].map((i) => (
                <div key={i} className="grid gap-1.5 rounded-xl border bg-card p-3">
                  <Stars n={5} />
                  <span className="h-2 w-4/5 rounded-full bg-muted" />
                  <span className="h-2 w-3/5 rounded-full bg-muted" />
                </div>
              ))}
            </div>
          </div>
          <p className="px-4 text-[11px] text-muted-foreground">{t("site.home.reviewsHint")}</p>
        </div>
      );
    case "instagram": {
      const imgs = s.images ?? [];
      return (
        <div className="grid gap-3 px-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
            <InstagramIcon className="size-4" /> @{s.handle || "…"}
          </p>
          {s.title && <p className="font-heading text-lg font-semibold">{s.title}</p>}
          {imgs.length ? (
            <div className="grid grid-cols-3 gap-1 @lg:grid-cols-6">
              {imgs.map((im, i) => (
                <Img key={i} src={im.url} alt={im.alt} className="aspect-square w-full rounded" />
              ))}
            </div>
          ) : (
            <Placeholder>{t("site.preview.addImages")}</Placeholder>
          )}
        </div>
      );
    }
    case "flash-sale":
      return (
        <div className="mx-4 overflow-hidden rounded-xl bg-primary/8 ring-1 ring-primary/15">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-primary px-4 py-3 text-primary-foreground">
            <p className="flex items-center gap-1.5 font-heading text-lg font-semibold">
              <ZapIcon className="size-4 fill-current" aria-hidden /> {s.title || t("site.layouts.flashTitlePlaceholder")}
            </p>
            <div className="flex gap-1">
              {["01", "12", "34", "56"].map((n, i) => (
                <span key={i} className="rounded-md bg-black/15 px-1.5 py-0.5 font-heading text-sm font-bold tabular-nums ring-1 ring-white/20">
                  {n}
                </span>
              ))}
            </div>
          </div>
          <div className="py-3">
            {s.products.length ? <ProductRow products={s.products} layout={s.layout} /> : s.source === "sale" ? <ShelfSketch n={s.layout === "grid" ? 4 : 5} row={s.layout !== "grid"} /> : <Placeholder>{t("site.preview.noProducts")}</Placeholder>}
          </div>
          {s.source === "sale" && <p className="px-4 pb-3 text-[11px] text-muted-foreground">{t("site.layouts.flashSaleHint")}</p>}
        </div>
      );
    case "finder":
      return (
        <div className="grid gap-3">
          <Title>{s.title || t("site.layouts.finderTitlePlaceholder")}</Title>
          <div className="mx-4 grid gap-3 rounded-xl border bg-card p-4">
            {s.layout === "wizard" && (
              <div className="flex gap-1" aria-hidden>
                {s.questions.map((_, i) => (
                  <span key={i} className={cn("h-1 flex-1 rounded-full", i === 0 ? "bg-primary" : "bg-muted")} />
                ))}
              </div>
            )}
            {(s.layout === "wizard" ? s.questions.slice(0, 1) : s.questions).map((q, qi) => (
              <div key={qi} className="grid gap-2">
                <p className="text-sm font-semibold">{q.label || "…"}</p>
                <div className="flex flex-wrap gap-1.5">
                  {q.options.map((o, oi) => (
                    <span key={oi} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium", oi === 0 && "border-primary bg-primary/10 text-primary")}>
                      {o.imageUrl && <Img src={o.imageUrl} className="size-4 rounded-full" />}
                      {o.label}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <ShelfSketch n={4} />
        </div>
      );
    case "stories":
      return (
        <div className="grid gap-3">
          <Title>{s.title}</Title>
          {s.items.length ? (
            <div className="flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
              {s.items.map((it, i) =>
                s.layout === "reels" ? (
                  <div key={i} className="relative w-24 shrink-0 overflow-hidden rounded-xl @lg:w-28">
                    <Img src={it.imageUrl} className="aspect-[9/16] w-full" />
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 text-[11px] leading-tight font-semibold text-white">{it.title}</span>
                    {it.videoUrl && <PlayIcon className="absolute end-1.5 top-1.5 size-3.5 fill-white text-white" aria-hidden />}
                  </div>
                ) : (
                  <div key={i} className="grid w-16 shrink-0 justify-items-center gap-1 text-center">
                    <span className="rounded-full bg-primary p-[2px]">
                      <Img src={it.imageUrl} className="size-14 rounded-full border-2 border-background" />
                    </span>
                    <span className="line-clamp-2 text-[11px] leading-tight">{it.title}</span>
                  </div>
                ),
              )}
            </div>
          ) : (
            <Placeholder>{t("site.layouts.addStoriesHint")}</Placeholder>
          )}
        </div>
      );
    case "category-shelf":
      return (
        <div className="grid gap-3">
          <Title>{s.title}</Title>
          {s.categories.length ? (
            <div className="grid gap-3 px-4 @lg:grid-cols-[9rem_1fr]">
              <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] @lg:flex-col @lg:rounded-xl @lg:border @lg:p-1.5">
                {s.categories.map((c, i) => (
                  <span key={c.id} className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap @lg:rounded-lg @lg:border-0", i === 0 && "bg-primary text-primary-foreground")}>
                    {s.showImages && <Img src={c.image} className="size-5 rounded-full" />}
                    {c.name}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2 @lg:grid-cols-3">
                {Array.from({ length: 6 }, (_, i) => (
                  <span key={i} className="aspect-[4/5] rounded-lg bg-primary/8 ring-1 ring-border" />
                ))}
              </div>
            </div>
          ) : (
            <Placeholder>{t("site.preview.noCategories")}</Placeholder>
          )}
        </div>
      );
    case "sticky-story":
      return (
        <div className="grid gap-3">
          <Title>{s.title}</Title>
          <div className={cn("grid gap-4 px-4 @lg:grid-cols-2", s.imageSide === "right" && "@lg:[&>*:first-child]:order-2")}>
            <Img src={s.chapters[0]?.imageUrl || null} alt={s.chapters[0]?.alt} className="hidden aspect-[4/5] w-full rounded-xl @lg:flex" />
            <div className="grid content-start gap-5">
              {s.chapters.map((c, i) => (
                <div key={i} className="grid gap-1.5">
                  <Img src={c.imageUrl || null} className="aspect-[4/3] w-full rounded-xl @lg:hidden" />
                  <p className="text-[11px] font-bold tracking-wider text-primary uppercase">
                    {String(i + 1).padStart(2, "0")} {c.eyebrow}
                  </p>
                  <p className="font-heading text-base font-semibold">{c.heading}</p>
                  {c.markdown && <Markdown source={c.markdown} className="line-clamp-3 text-xs text-muted-foreground" />}
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    case "comparison":
      return (
        <div className="grid gap-3">
          <Title>{s.title || t("site.layouts.compareTitlePlaceholder")}</Title>
          {s.products.length >= 2 ? (
            <div className="mx-4 overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[22rem] text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="p-2" />
                    {s.products.map((p) => (
                      <th key={p.id} className={cn("p-2 text-start align-top font-medium", p.id === s.highlightId && "bg-primary/8")}>
                        {p.id === s.highlightId && <span className="mb-1 inline-block rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">{s.highlightLabel || t("site.layouts.compareBadgePlaceholder")}</span>}
                        <Img src={p.image} className="mb-1 aspect-square w-14 rounded" />
                        <span className="line-clamp-2">{p.name}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <tr>
                    <th className="p-2 text-start font-semibold">{t("site.layouts.comparePrice")}</th>
                    {s.products.map((p) => (
                      <td key={p.id} className={cn("p-2 tabular-nums", p.id === s.highlightId && "bg-primary/8")}>
                        {money(p.priceMin)}
                      </td>
                    ))}
                  </tr>
                  {s.rows.map((r, ri) => (
                    <tr key={ri}>
                      <th className="p-2 text-start font-semibold">{r.label}</th>
                      {s.products.map((p, pi) => (
                        <td key={p.id} className={cn("p-2", p.id === s.highlightId && "bg-primary/8")}>
                          {r.values[pi] || "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Placeholder>{t("site.layouts.comparePickHint")}</Placeholder>
          )}
        </div>
      );
    case "tiles":
      return (
        <div className="grid gap-3">
          <Title>{s.title || t("site.layouts.tilesTitlePlaceholder")}</Title>
          <div className={cn("gap-2 px-4", s.layout === "row" ? "flex overflow-x-auto [scrollbar-width:none]" : "grid grid-cols-2 @lg:grid-cols-4")}>
            {s.items.map((it, i) => (
              <div key={i} className={cn("grid content-start gap-1.5 rounded-lg border p-1.5", s.layout === "row" && "w-28 shrink-0")}>
                <Img src={it.imageUrl || null} className="aspect-square w-full rounded-md" />
                <p className="text-xs leading-tight font-semibold">{it.label}</p>
                {it.note && <p className="line-clamp-2 text-[10px] leading-tight text-muted-foreground">{it.note}</p>}
              </div>
            ))}
          </div>
        </div>
      );
    case "swatches":
      return (
        <div className="grid gap-3">
          <Title>{s.title || t("site.layouts.swatchesTitlePlaceholder")}</Title>
          {s.products.length ? (
            <div className="grid gap-2 px-4">
              <p className="text-xs font-semibold">{s.products.map((p) => p.name).join(" · ")}</p>
              <div className="flex flex-wrap gap-2">
                {s.shades.map((sh, i) => (
                  <span key={i} title={sh.value} className="size-8 rounded-full ring-1 ring-border" style={{ background: sh.hex }} />
                ))}
              </div>
            </div>
          ) : (
            <Placeholder>{t("site.layouts.comparePickHint")}</Placeholder>
          )}
        </div>
      );
    case "size-finder":
      return (
        <div className="mx-4 grid gap-3 rounded-xl bg-primary/8 p-4">
          <p className="font-heading text-lg font-semibold">{s.title || t("site.layouts.sizeTitlePlaceholder")}</p>
          <div className="flex flex-wrap gap-1">
            {s.groups.map((g, i) => (
              <span key={i} className={cn("rounded-full px-3 py-1 text-xs font-semibold", i === 0 ? "bg-primary text-primary-foreground" : "border text-muted-foreground")}>
                {g.label}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(s.groups[0]?.sizes ?? []).map((z) => (
              <span key={z} className="flex h-8 min-w-9 items-center justify-center rounded-md border-2 bg-background px-2 text-xs font-semibold tabular-nums">
                {z}
              </span>
            ))}
          </div>
          {s.footLength && <span className="h-8 w-28 rounded-md border bg-background" aria-hidden />}
        </div>
      );
  }
}
