"use client";

import * as React from "react";
import { EyeOffIcon, ImageIcon, MonitorIcon, SmartphoneIcon } from "lucide-react";
import { cn, Skeleton } from "@srirealtime/ui";
import { absoluteUrl, useI18n } from "@srirealtime/web";
import { money } from "../../lib/format";
import type { PublicProductSummary, ResolvedHomeSection } from "../../lib/types";
import { Markdown } from "../markdown";
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
        {note && <p className="min-w-0 truncate text-[0.6875rem] text-muted-foreground">{note}</p>}
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
            <div className="grid gap-6 pb-6">
              {sections.map((s, i) => {
                const hidden = "hidden" in s && s.hidden === true;
                return (
                  <div
                    key={s.id ?? `${s.type}-${i}`}
                    data-hidden={hidden || undefined}
                    className={cn(
                      "relative transition-shadow",
                      hidden && "rounded-lg outline-1 outline-offset-2 outline-muted-foreground/40 outline-dashed",
                      selectedId && s.id === selectedId && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                    )}
                  >
                    {hidden && (
                      <span className="absolute -top-2.5 right-3 z-10 inline-flex items-center gap-1 rounded-full bg-foreground/85 px-2 py-0.5 text-[0.6875rem] font-medium text-background shadow-sm">
                        <EyeOffIcon className="size-3" aria-hidden /> {t("site.preview.hiddenBadge")}
                      </span>
                    )}
                    <div className={cn(hidden && "opacity-40 grayscale-[60%]")}>
                      <PreviewSection s={s} />
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
          {s.categories.length === 0 ? (
            <Placeholder>{t("site.preview.noCategories")}</Placeholder>
          ) : (
            <div className="flex gap-4 overflow-x-auto px-4 [scrollbar-width:none]">
              {s.categories.map((c) => (
                <div key={c.id} className="grid w-20 shrink-0 justify-items-center gap-1.5 text-center">
                  <Img src={c.image} className="size-16 rounded-full ring-1 ring-border" />
                  <span className="line-clamp-2 text-xs">{c.name}</span>
                </div>
              ))}
            </div>
          )}
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
    case "testimonials":
      return (
        <div className="grid gap-3">
          <Title>{s.title}</Title>
          <div className="flex snap-x gap-3 overflow-x-auto px-4 [scrollbar-width:none]">
            {s.items.map((it, i) => (
              <figure key={i} className="w-[80%] shrink-0 snap-start rounded-xl border bg-card p-4 @lg:w-[32%]">
                <blockquote className="text-sm leading-relaxed">“{it.quote}”</blockquote>
                <figcaption className="mt-2 text-xs font-medium text-primary">— {it.name}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      );
    case "usp":
      return (
        <div className="mx-4 grid grid-cols-2 gap-3 rounded-xl bg-muted/50 p-4 @lg:grid-cols-4">
          {s.items.map((it, i) => {
            const Icon = uspIcon(it.icon);
            return (
              <div key={i} className="grid justify-items-center gap-1 text-center">
                <span className="icon-chip size-10 rounded-full text-primary">
                  <Icon className="size-5" />
                </span>
                <p className="text-xs font-semibold">{it.title}</p>
                {it.text && <p className="text-[0.6875rem] text-muted-foreground">{it.text}</p>}
              </div>
            );
          })}
        </div>
      );
    case "newsletter":
      return (
        <div className="mx-4 grid gap-2 rounded-xl bg-primary/10 p-5 text-center">
          <p className="font-heading text-lg font-semibold">{s.heading}</p>
          {s.text && <p className="text-sm text-muted-foreground">{s.text}</p>}
          <div className="mx-auto mt-1 flex w-full max-w-sm gap-2">
            <span className="h-10 flex-1 rounded-lg border bg-card px-3 text-left text-sm leading-10 text-muted-foreground">{t("site.preview.email")}</span>
            <span className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">{t("site.preview.subscribe")}</span>
          </div>
        </div>
      );
  }
}
