"use client";

import * as React from "react";
import { ChevronLeftIcon, ChevronRightIcon, MinusIcon, PlusIcon, XIcon } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@rbms/ui/components/dialog";
import { cn } from "@rbms/ui/lib/utils";
import { AnimatePresence, motion, useReducedMotionSafe } from "@rbms/ui/motion";
import { useStore } from "./store-context";

/**
 * Full-screen image viewer: swipe / drag or arrow keys between photos (slide + fade), double-tap / click or +/− to
 * zoom 2.5×, drag to pan while zoomed, thumbnails at the bottom. Focus is trapped and returned by the Radix dialog.
 */
export function Lightbox({
  images,
  index,
  open,
  onIndexChange,
  onClose,
  title,
}: {
  images: { url: string; alt: string }[];
  index: number;
  open: boolean;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  title: string;
}) {
  const { t } = useStore();
  const reduced = useReducedMotionSafe();
  const n = images.length;
  const [dir, setDir] = React.useState(1);
  const [zoomed, setZoomed] = React.useState(false);
  const go = React.useCallback(
    (d: 1 | -1) => {
      if (n < 2) return;
      setDir(d);
      setZoomed(false);
      onIndexChange((index + d + n) % n);
    },
    [index, n, onIndexChange],
  );

  React.useEffect(() => {
    if (!open) setZoomed(false);
  }, [open]);

  const img = images[index];
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent
          showCloseButton={false}
          className="top-0 left-0 flex h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-black/95 p-0 text-white sm:max-w-none"
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") go(1);
            else if (e.key === "ArrowLeft") go(-1);
          }}
          data-testid="lightbox"
        >
          <DialogTitle className="sr-only">{title}</DialogTitle>
          <DialogDescription className="sr-only">{t("product.lightboxHint")}</DialogDescription>
          <div className="flex items-center justify-between gap-3 p-3 sm:p-4">
            <span className="rounded-full bg-white/10 px-3 py-1 text-sm font-medium tabular-nums">
              {index + 1} / {n}
            </span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setZoomed((z) => !z)} aria-label={zoomed ? t("product.zoomOut") : t("product.zoomIn")} className="flex size-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 focus-ring">
                {zoomed ? <MinusIcon className="size-5" /> : <PlusIcon className="size-5" />}
              </button>
              <DialogClose className="flex size-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 focus-ring" aria-label={t("common.close")}>
                <XIcon className="size-5" />
              </DialogClose>
            </div>
          </div>

          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
            <AnimatePresence initial={false} custom={dir} mode="popLayout">
              {img && (
                <motion.div
                  key={index}
                  custom={dir}
                  className="absolute inset-0 flex items-center justify-center px-2 sm:px-16"
                  variants={{
                    enter: (d: number) => ({ x: reduced ? 0 : `${d * 30}%`, opacity: 0 }),
                    center: { x: 0, opacity: 1 },
                    exit: (d: number) => ({ x: reduced ? 0 : `${d * -30}%`, opacity: 0 }),
                  }}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: reduced ? 0 : 0.35, ease: [0.16, 1, 0.3, 1] }}
                  drag={zoomed ? true : n > 1 ? "x" : false}
                  dragConstraints={zoomed ? { left: -300, right: 300, top: -300, bottom: 300 } : { left: 0, right: 0 }}
                  dragElastic={zoomed ? 0.15 : 0.6}
                  onDragEnd={(_, info) => {
                    if (zoomed) return;
                    if (info.offset.x < -80 || info.velocity.x < -500) go(1);
                    else if (info.offset.x > 80 || info.velocity.x > 500) go(-1);
                  }}
                  onDoubleClick={() => setZoomed((z) => !z)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <motion.img
                    src={img.url}
                    alt={img.alt}
                    draggable={false}
                    className={cn("max-h-full max-w-full select-none object-contain", zoomed ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in")}
                    animate={{ scale: zoomed ? 2.5 : 1 }}
                    transition={{ type: "spring", stiffness: 260, damping: 30 }}
                    onClick={() => !zoomed && setZoomed(true)}
                  />
                </motion.div>
              )}
            </AnimatePresence>
            {n > 1 && (
              <>
                <button type="button" onClick={() => go(-1)} aria-label={t("home.prevSlide")} className="absolute left-3 z-10 hidden size-12 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 focus-ring sm:flex">
                  <ChevronLeftIcon className="size-6" />
                </button>
                <button type="button" onClick={() => go(1)} aria-label={t("home.nextSlide")} className="absolute right-3 z-10 hidden size-12 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 focus-ring sm:flex">
                  <ChevronRightIcon className="size-6" />
                </button>
              </>
            )}
          </div>

          {n > 1 && (
            <ul className="flex justify-center gap-2 overflow-x-auto p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] scrollbar-none">
              {images.map((im, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => {
                      setDir(i > index ? 1 : -1);
                      setZoomed(false);
                      onIndexChange(i);
                    }}
                    aria-label={t("product.image", { n: i + 1, total: n })}
                    aria-current={i === index}
                    className="relative block size-14 overflow-hidden rounded-lg focus-ring"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={im.url} alt="" className={cn("size-full object-cover transition-opacity", i === index ? "opacity-100" : "opacity-45 hover:opacity-80")} />
                    {i === index && <motion.span layoutId="lightbox-thumb" className="absolute inset-0 rounded-lg ring-2 ring-white ring-inset" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
    </Dialog>
  );
}
