"use client";

import * as React from "react";
import { ChevronLeftIcon, ChevronRightIcon, ExpandIcon } from "lucide-react";
import { cn } from "@srirealtime/ui/lib/utils";
import { AnimatePresence, motion, useReducedMotionSafe } from "@srirealtime/ui/motion";
import { imageUrl } from "../lib/format";
import { StoreImage } from "../components/bits";
import { useStore } from "./store-context";

const Lightbox = React.lazy(() => import("./lightbox").then((m) => ({ default: m.Lightbox })));

export type GalleryLayout = "thumbs-side" | "thumbs-below" | "grid" | "slider";

/**
 * Phone: swipeable scroll-snap strip with an animated dot pill. Desktop (theme `productLayout`): thumbs-side / thumbs-below
 * = main image that cross-fades between photos, zooms under the cursor (a lens following the pointer), and thumbnails
 * (beside or under it) with a selection ring that glides between them · grid = every photo in two columns · slider =
 * a wide strip showing two and a half photos with arrows. Tap / click opens a full-screen lightbox (loaded on first use).
 */
export function ProductGallery({
  images,
  name,
  badge,
  compact,
  layout = "thumbs-side",
}: {
  images: { url: string; alt?: string }[];
  name: string;
  badge?: string;
  compact?: boolean;
  layout?: GalleryLayout;
}) {
  const { t } = useStore();
  const reduced = useReducedMotionSafe();
  const list = images.length ? images : [{ url: "", alt: name }];
  const [index, setIndex] = React.useState(0);
  const [lightbox, setLightbox] = React.useState<number | null>(null);
  const [lbLoaded, setLbLoaded] = React.useState(false);
  const [zoom, setZoom] = React.useState<{ x: number; y: number } | null>(null);
  const strip = React.useRef<HTMLDivElement>(null);
  const hasImages = images.length > 0;
  const id = React.useId();

  // Slides are a full strip wide, except in the desktop slider where several show at once.
  const step = (el: HTMLDivElement) => {
    const [a, b] = el.children as unknown as HTMLElement[];
    return a && b ? Math.abs(b.offsetLeft - a.offsetLeft) || el.clientWidth : el.clientWidth;
  };
  const onScroll = () => {
    const el = strip.current;
    if (!el) return;
    const i = Math.min(list.length - 1, Math.round(Math.abs(el.scrollLeft) / step(el)));
    if (i !== index) setIndex(i);
  };
  const goTo = (i: number) => {
    setIndex(i);
    const el = strip.current;
    const dir = el && getComputedStyle(el).direction === "rtl" ? -1 : 1;
    if (el && el.offsetParent !== null) el.scrollTo({ left: dir * i * step(el), behavior: reduced ? "auto" : "smooth" });
  };
  const open = (i: number) => {
    if (!hasImages) return;
    setLbLoaded(true);
    setLightbox(i);
  };
  const current = list[index]!;
  // Desktop look: the main image + thumbnails (side / below), all photos in a grid, or a wide slider.
  const desk = compact ? "compact" : layout;
  const withMain = desk === "thumbs-side" || desk === "thumbs-below";
  const slider = desk === "slider";

  return (
    <div className={cn("flex flex-col gap-3", desk === "thumbs-side" && "lg:flex-row-reverse lg:gap-4")} data-gallery={desk}>
      <div className="relative min-w-0 flex-1">
        {/* Phone / tablet: native swipe strip (the desktop slider too, with several photos in view). */}
        <div
          ref={strip}
          onScroll={onScroll}
          className={cn(
            "-mx-4 flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain scrollbar-none sm:mx-0 sm:rounded-[calc(var(--sf-radius-card)*4/3)]",
            !compact && !slider && "lg:hidden",
            slider && "lg:gap-3 lg:rounded-none",
          )}
          aria-roledescription="carousel"
          aria-label={name}
        >
          {list.map((img, i) => (
            <button
              type="button"
              key={i}
              onClick={() => open(i)}
              className={cn("aspect-[var(--sf-image-ratio,4/5)] w-full shrink-0 snap-center overflow-hidden bg-muted sm:rounded-[calc(var(--sf-radius-card)*4/3)]", slider && "lg:w-[calc((100%-1.5rem)/2.5)] lg:snap-start lg:rounded-[var(--sf-radius-card)]")}
              aria-label={hasImages ? `${t("product.zoom")}: ${t("product.image", { n: i + 1, total: list.length })}` : undefined}
              tabIndex={i === index ? 0 : -1}
              data-gallery-main={i === index ? "" : undefined}
            >
              <StoreImage src={img.url || null} alt={img.alt || name} name={name} eager={i === 0} />
            </button>
          ))}
        </div>
        {slider && list.length > 2 && (
          <>
            <button
              type="button"
              onClick={() => goTo(Math.max(0, index - 1))}
              disabled={index === 0}
              aria-label={t("product.prevImage")}
              className="absolute start-3 top-1/2 z-[2] hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground shadow-[var(--elevation-2)] backdrop-blur focus-ring disabled:opacity-0 lg:flex"
            >
              <ChevronLeftIcon className="size-5 rtl:rotate-180" />
            </button>
            <button
              type="button"
              onClick={() => goTo(Math.min(list.length - 1, index + 1))}
              disabled={index >= list.length - 2}
              aria-label={t("product.nextImage")}
              className="absolute end-3 top-1/2 z-[2] hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground shadow-[var(--elevation-2)] backdrop-blur focus-ring disabled:opacity-0 lg:flex"
            >
              <ChevronRightIcon className="size-5 rtl:rotate-180" />
            </button>
          </>
        )}

        {/* Desktop grid: every photo, two columns (an odd first photo spans both). */}
        {desk === "grid" && (
          <ul className="hidden grid-cols-2 gap-3 lg:grid" aria-label={name}>
            {list.map((img, i) => (
              <li key={i} className={cn(i === 0 && list.length % 2 === 1 && "col-span-2")}>
                <button
                  type="button"
                  onClick={() => open(i)}
                  className={cn("block aspect-[var(--sf-image-ratio,4/5)] w-full overflow-hidden rounded-[var(--sf-radius-card)] bg-muted focus-ring", hasImages && "cursor-zoom-in")}
                  aria-label={hasImages ? `${t("product.zoom")}: ${t("product.image", { n: i + 1, total: list.length })}` : name}
                >
                  <StoreImage src={img.url || null} alt={img.alt || name} name={name} eager={i < 2} className="transition-transform duration-700 hover:scale-[1.03] motion-reduce:transition-none" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Desktop: cross-fading main image with a hover lens. */}
        {withMain && (
          <button
            type="button"
            onClick={() => open(index)}
            onPointerMove={(e) => {
              if (e.pointerType !== "mouse" || !hasImages || reduced) return;
              const r = e.currentTarget.getBoundingClientRect();
              setZoom({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
            }}
            onPointerLeave={() => setZoom(null)}
            className={cn("relative hidden aspect-[var(--sf-image-ratio,4/5)] w-full overflow-hidden rounded-[calc(var(--sf-radius-card)*4/3)] bg-muted focus-ring lg:block", hasImages && "cursor-zoom-in")}
            aria-label={hasImages ? `${t("product.zoom")}: ${t("product.image", { n: index + 1, total: list.length })}` : name}
            data-gallery-main=""
          >
            <AnimatePresence initial={false} mode="popLayout">
              <motion.div
                key={index}
                className="absolute inset-0"
                initial={{ opacity: 0, scale: 1.04 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduced ? 0 : 0.45, ease: [0.16, 1, 0.3, 1] }}
              >
                <motion.div
                  className="size-full"
                  animate={{ scale: zoom ? 2 : 1 }}
                  transition={{ type: "spring", stiffness: 260, damping: 30 }}
                  style={{ transformOrigin: zoom ? `${zoom.x}% ${zoom.y}%` : "50% 50%" }}
                >
                  <StoreImage src={current.url || null} alt={current.alt || name} name={name} eager={index === 0} />
                </motion.div>
              </motion.div>
            </AnimatePresence>
            {hasImages && (
              <span className={cn("pointer-events-none absolute right-4 bottom-4 flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-1.5 text-xs font-semibold shadow-sm backdrop-blur transition-opacity", zoom && "opacity-0")}>
                <ExpandIcon className="size-3.5" />
                {t("product.zoomHint")}
              </span>
            )}
          </button>
        )}

        {badge && <span className="pointer-events-none absolute top-4 left-0 z-[1] rounded-r-full bg-sale py-1.5 ps-3 pe-4 text-xs font-bold tracking-wide text-white shadow-md">{badge}</span>}

        {list.length > 1 && (
          <div className={cn("mt-3 flex justify-center gap-1.5", !compact && "lg:hidden")}>
            {list.map((_, i) => (
              <button key={i} type="button" onClick={() => goTo(i)} aria-label={t("product.image", { n: i + 1, total: list.length })} aria-current={i === index} className="relative flex h-4 items-center">
                <span className={cn("block h-1.5 rounded-full bg-foreground/20 transition-[width] duration-300", i === index ? "w-6" : "w-1.5")} />
                {i === index && <motion.span layoutId={`${id}-dot`} className="absolute inset-y-[5px] left-0 w-6 rounded-full bg-primary" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              </button>
            ))}
          </div>
        )}
      </div>

      {list.length > 1 && withMain && (
        <ul
          className={cn("hidden gap-3 lg:flex", desk === "thumbs-side" ? "w-20 shrink-0 flex-col" : "-m-1 flex-row overflow-x-auto p-1 scrollbar-none")}
          aria-label={t("product.thumbnails")}
        >
          {list.map((img, i) => (
            <li key={i} className={desk === "thumbs-below" ? "w-20 shrink-0" : undefined}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                onPointerEnter={(e) => e.pointerType === "mouse" && setIndex(i)}
                aria-label={t("product.image", { n: i + 1, total: list.length })}
                aria-current={i === index}
                className="relative block aspect-[var(--sf-image-ratio,4/5)] w-full rounded-xl focus-ring"
              >
                <span className={cn("block size-full overflow-hidden rounded-xl bg-muted transition-opacity", i === index ? "opacity-100" : "opacity-60 hover:opacity-100")}>
                  <StoreImage src={img.url || null} alt="" name={name} />
                </span>
                {i === index && <motion.span layoutId={`${id}-ring`} className="pointer-events-none absolute -inset-1 rounded-[14px] ring-2 ring-primary" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              </button>
            </li>
          ))}
        </ul>
      )}

      {lbLoaded && (
        <React.Suspense fallback={null}>
          <Lightbox
            images={images.map((i) => ({ url: imageUrl(i.url) ?? "", alt: i.alt || name }))}
            index={lightbox ?? 0}
            open={lightbox !== null}
            onIndexChange={(i) => {
              setLightbox(i);
              goTo(i);
            }}
            onClose={() => setLightbox(null)}
            title={name}
          />
        </React.Suspense>
      )}
    </div>
  );
}
