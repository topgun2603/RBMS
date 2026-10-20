"use client";

import * as React from "react";
import { ExpandIcon } from "lucide-react";
import { cn } from "@srirealtime/ui/lib/utils";
import { AnimatePresence, motion, useReducedMotionSafe } from "@srirealtime/ui/motion";
import { imageUrl } from "../lib/format";
import { StoreImage } from "../components/bits";
import { useStore } from "./store-context";

const Lightbox = React.lazy(() => import("./lightbox").then((m) => ({ default: m.Lightbox })));

/**
 * Phone: swipeable scroll-snap strip with an animated dot pill. Desktop: main image that cross-fades between photos,
 * zooms under the cursor (a lens following the pointer), and thumbnails with a selection ring that glides between
 * them. Tap / click opens a full-screen lightbox (loaded on first use).
 */
export function ProductGallery({ images, name, badge, compact }: { images: { url: string; alt?: string }[]; name: string; badge?: string; compact?: boolean }) {
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

  const onScroll = () => {
    const el = strip.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== index) setIndex(i);
  };
  const goTo = (i: number) => {
    setIndex(i);
    const el = strip.current;
    if (el && el.offsetParent !== null) el.scrollTo({ left: i * el.clientWidth, behavior: reduced ? "auto" : "smooth" });
  };
  const open = (i: number) => {
    if (!hasImages) return;
    setLbLoaded(true);
    setLightbox(i);
  };
  const current = list[index]!;

  return (
    <div className={cn("flex flex-col gap-3 lg:flex-row-reverse lg:gap-4", compact && "lg:flex-col lg:gap-3")}>
      <div className="relative min-w-0 flex-1">
        {/* Phone / tablet: native swipe strip. */}
        <div
          ref={strip}
          onScroll={onScroll}
          className={cn("-mx-4 flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain scrollbar-none sm:mx-0 sm:rounded-3xl", !compact && "lg:hidden")}
          aria-roledescription="carousel"
          aria-label={name}
        >
          {list.map((img, i) => (
            <button
              type="button"
              key={i}
              onClick={() => open(i)}
              className="aspect-[var(--sf-image-ratio,4/5)] w-full shrink-0 snap-center overflow-hidden bg-muted sm:rounded-3xl"
              aria-label={hasImages ? `${t("product.zoom")}: ${t("product.image", { n: i + 1, total: list.length })}` : undefined}
              tabIndex={i === index ? 0 : -1}
              data-gallery-main={i === index ? "" : undefined}
            >
              <StoreImage src={img.url || null} alt={img.alt || name} name={name} eager={i === 0} />
            </button>
          ))}
        </div>

        {/* Desktop: cross-fading main image with a hover lens. */}
        {!compact && (
          <button
            type="button"
            onClick={() => open(index)}
            onPointerMove={(e) => {
              if (e.pointerType !== "mouse" || !hasImages || reduced) return;
              const r = e.currentTarget.getBoundingClientRect();
              setZoom({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
            }}
            onPointerLeave={() => setZoom(null)}
            className={cn("relative hidden aspect-[var(--sf-image-ratio,4/5)] w-full overflow-hidden rounded-3xl bg-muted focus-ring lg:block", hasImages && "cursor-zoom-in")}
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

      {list.length > 1 && !compact && (
        <ul className="hidden w-20 shrink-0 flex-col gap-3 lg:flex" aria-label={t("product.thumbnails")}>
          {list.map((img, i) => (
            <li key={i}>
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
