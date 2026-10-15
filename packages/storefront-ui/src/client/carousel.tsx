"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRightIcon, ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon } from "lucide-react";
import { cn } from "@srirealtime/ui/lib/utils";
import { AnimatePresence, motion, SuccessCheck, useReducedMotionSafe, useScroll, useTransform, type Variants } from "@srirealtime/ui/motion";
import { imageUrl } from "../lib/format";
import { useStore } from "./store-context";

/**
 * Horizontal scroll-snap rail. Phones swipe; desktop gets arrow buttons that fade/scale in when there's more to see
 * (and only while the rail is hovered or focused). Children are server-rendered.
 */
export function Carousel({ children, className, itemClassName, label }: { children: React.ReactNode; className?: string; itemClassName?: string; label?: string }) {
  const { t } = useStore();
  const rail = React.useRef<HTMLUListElement>(null);
  const [edges, setEdges] = React.useState({ start: true, end: false });
  const update = React.useCallback(() => {
    const el = rail.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);
  React.useEffect(() => {
    update();
    const el = rail.current;
    el?.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [update]);
  const scroll = (dir: 1 | -1) => rail.current?.scrollBy({ left: dir * rail.current.clientWidth * 0.85, behavior: "smooth" });
  const items = React.Children.toArray(children);
  const arrow = "absolute top-[38%] z-10 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full border bg-background/95 shadow-[var(--elevation-2)] backdrop-blur focus-ring hover:bg-background lg:flex";
  return (
    <div className={cn("group/rail relative", className)} role="region" aria-roledescription="carousel" aria-label={label}>
      <ul ref={rail} className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto overscroll-x-contain px-4 pt-2 pb-3 scrollbar-none sm:gap-5">
        {items.map((c, i) => (
          <li key={i} className={cn("w-[46%] shrink-0 snap-start sm:w-[31%] lg:w-[23%] xl:w-[18.6%]", itemClassName)}>
            {c}
          </li>
        ))}
      </ul>
      <AnimatePresence>
        {!edges.start && (
          <motion.button
            key="prev"
            type="button"
            onClick={() => scroll(-1)}
            aria-label={t("home.scrollLeft")}
            className={cn(arrow, "-left-4 opacity-0 transition-opacity group-hover/rail:opacity-100 focus-visible:opacity-100")}
            initial={{ scale: 0.6 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            whileHover={{ x: -2 }}
            whileTap={{ scale: 0.9 }}
          >
            <ChevronLeftIcon className="size-5" />
          </motion.button>
        )}
        {!edges.end && (
          <motion.button
            key="next"
            type="button"
            onClick={() => scroll(1)}
            aria-label={t("home.scrollRight")}
            className={cn(arrow, "-right-4 opacity-0 transition-opacity group-hover/rail:opacity-100 focus-visible:opacity-100")}
            initial={{ scale: 0.6 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            whileHover={{ x: 2 }}
            whileTap={{ scale: 0.9 }}
          >
            <ChevronRightIcon className="size-5" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

export interface HeroSlide {
  imageUrl: string | null;
  mobileImageUrl?: string;
  heading?: string;
  subheading?: string;
  cta?: { label: string; href: string };
}

const AUTOPLAY_MS = 6500;

const textParent: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.1, delayChildren: 0.15 } }, exit: { transition: { staggerChildren: 0.04, staggerDirection: -1 } } };
const textChild: Variants = {
  hidden: { opacity: 0, y: 24, filter: "blur(6px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] as const } },
  exit: { opacity: 0, y: -10, transition: { duration: 0.2 } },
};

/**
 * Full-bleed hero. Every slide stays in the server HTML (stacked); the active one cross-fades in with a slow
 * ken-burns settle, the image drifts with scroll (parallax), heading / sub / CTA stagger in, and the dots show an
 * animated pill (shared layout) that fills while autoplay runs. Autoplay pauses on hover, focus, touch, when the tab is
 * hidden, and is off with reduced motion. Swipe on phones.
 */
export function HeroSlider({ slides, shopName }: { slides: HeroSlide[]; shopName: string }) {
  const { t } = useStore();
  const reduced = useReducedMotionSafe();
  const [index, setIndex] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const [userPaused, setUserPaused] = React.useState(false);
  const touch = React.useRef<number | null>(null);
  const resume = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const section = React.useRef<HTMLElement>(null);
  const n = slides.length;
  const go = React.useCallback((i: number) => setIndex(((i % n) + n) % n), [n]);
  const running = n > 1 && !paused && !userPaused && !reduced;

  const { scrollYProgress } = useScroll({ target: section, offset: ["start start", "end start"] });
  const parallax = useTransform(scrollYProgress, [0, 1], ["0%", reduced ? "0%" : "18%"]);
  const fade = useTransform(scrollYProgress, [0, 0.8], [1, reduced ? 1 : 0.35]);

  React.useEffect(() => {
    if (!running) return;
    const id = setTimeout(() => setIndex((i) => (i + 1) % n), AUTOPLAY_MS);
    return () => clearTimeout(id);
  }, [running, index, n]);

  React.useEffect(() => {
    const onVis = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const s = slides[index]!;
  return (
    <section
      ref={section}
      aria-roledescription="carousel"
      aria-label={shopName}
      className="relative isolate overflow-hidden bg-neutral-900"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setPaused(false)}
      onTouchStart={(e) => {
        touch.current = e.touches[0]?.clientX ?? null;
        if (resume.current) clearTimeout(resume.current);
        setPaused(true);
      }}
      onTouchEnd={(e) => {
        const start = touch.current;
        const end = e.changedTouches[0]?.clientX;
        touch.current = null;
        resume.current = setTimeout(() => setPaused(false), 4000);
        if (start === null || end === undefined || Math.abs(end - start) < 40) return;
        go(index + (end < start ? 1 : -1));
      }}
    >
      <div className="relative h-[68vh] max-h-[680px] min-h-[440px] w-full sm:h-[74vh]">
        {slides.map((sl, i) => {
          const img = imageUrl(sl.imageUrl);
          const mob = imageUrl(sl.mobileImageUrl ?? null);
          const active = i === index;
          return (
            <motion.div
              key={i}
              className="absolute inset-0"
              initial={false}
              animate={{ opacity: active ? 1 : 0, zIndex: active ? 1 : 0 }}
              transition={{ duration: reduced ? 0 : 0.9, ease: [0.4, 0, 0.2, 1] }}
              aria-hidden={!active}
              aria-roledescription="slide"
              aria-label={`${i + 1} / ${n}`}
            >
              <motion.div className="absolute inset-0 will-change-transform" style={{ y: parallax }}>
                <motion.div
                  className="absolute -inset-y-[6%] inset-x-0"
                  initial={false}
                  animate={{ scale: active && !reduced ? 1 : 1.08 }}
                  transition={{ duration: active ? 7 : 0.9, ease: "easeOut" }}
                >
                  {img ? (
                    <picture>
                      {mob && <source media="(max-width: 640px)" srcSet={mob} />}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img} alt="" className="absolute inset-0 size-full object-cover" loading={i === 0 ? "eager" : "lazy"} {...(i === 0 ? { fetchPriority: "high" as const } : {})} />
                    </picture>
                  ) : (
                    <div className="sf-brand-hero absolute inset-0 overflow-hidden" aria-hidden />
                  )}
                </motion.div>
              </motion.div>
              <div
                className={cn(
                  "absolute inset-0",
                  img
                    ? "bg-gradient-to-t from-black/70 via-black/25 to-black/5 sm:bg-gradient-to-r sm:from-black/65 sm:via-black/25 sm:to-transparent"
                    : "bg-gradient-to-t from-black/35 to-transparent sm:bg-gradient-to-r sm:from-black/30 sm:via-transparent",
                )}
              />
            </motion.div>
          );
        })}

        <motion.div style={{ opacity: fade }} className="absolute inset-0 z-[2] mx-auto flex w-full max-w-7xl items-end px-4 pb-16 sm:items-center sm:px-6 sm:pb-0 lg:px-8">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={index} className="max-w-2xl text-white" variants={reduced ? undefined : textParent} initial="hidden" animate="show" exit="exit">
              {s.heading &&
                React.createElement(
                  index === 0 ? motion.h1 : motion.h2,
                  { variants: reduced ? undefined : textChild, className: "text-display text-balance drop-shadow-sm" },
                  s.heading,
                )}
              {s.subheading && (
                <motion.p variants={reduced ? undefined : textChild} className="mt-4 max-w-md text-base text-white/85 sm:text-lg">
                  {s.subheading}
                </motion.p>
              )}
              {s.cta && (
                <motion.div variants={reduced ? undefined : textChild}>
                  <Link
                    href={s.cta.href}
                    className="group mt-8 inline-flex h-12 items-center gap-2 rounded-full bg-white px-7 text-sm font-semibold text-neutral-900 shadow-lg shadow-black/20 transition-transform hover:scale-[1.03] focus-visible:ring-4 focus-visible:ring-white/50 focus-visible:outline-none active:scale-[0.98] motion-reduce:transition-none"
                  >
                    {s.cta.label}
                    <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-1" />
                  </Link>
                </motion.div>
              )}
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </div>

      {n > 1 && (
        <>
          <div className="absolute inset-x-0 bottom-5 z-[3] flex items-center justify-center gap-2">
            {slides.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => go(i)}
                aria-label={t("home.goToSlide", { n: i + 1 })}
                aria-current={i === index}
                className="relative flex h-6 items-center focus-ring rounded-full"
              >
                <span className={cn("block h-2 rounded-full bg-white/45 transition-[width] duration-300 hover:bg-white/70", i === index ? "w-10" : "w-2")} />
                {i === index && (
                  <motion.span layoutId="hero-dot" className="absolute inset-y-2 left-0 w-10 overflow-hidden rounded-full bg-white/45" transition={{ type: "spring", stiffness: 380, damping: 32 }}>
                    <motion.span
                      key={`${index}-${running}`}
                      className="block h-full origin-left rounded-full bg-white"
                      initial={{ scaleX: running ? 0 : 1 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: running ? AUTOPLAY_MS / 1000 : 0, ease: "linear" }}
                    />
                  </motion.span>
                )}
              </button>
            ))}
            {!reduced && (
              <button type="button" onClick={() => setUserPaused((p) => !p)} aria-label={userPaused ? t("home.play") : t("home.pause")} className="ms-1 flex size-7 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur focus-ring hover:bg-white/30">
                {userPaused ? <PlayIcon className="size-3.5" /> : <PauseIcon className="size-3.5" />}
              </button>
            )}
          </div>
          <button type="button" onClick={() => go(index - 1)} aria-label={t("home.prevSlide")} className="absolute top-1/2 left-4 z-[3] hidden size-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/30 focus-ring md:flex">
            <ChevronLeftIcon className="size-5" />
          </button>
          <button type="button" onClick={() => go(index + 1)} aria-label={t("home.nextSlide")} className="absolute top-1/2 right-4 z-[3] hidden size-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/30 focus-ring md:flex">
            <ChevronRightIcon className="size-5" />
          </button>
        </>
      )}
    </section>
  );
}

/** Newsletter capture (no subscribe API yet: thanks the shopper and keeps the address locally). */
export function NewsletterForm({ tone = "brand" }: { tone?: "brand" | "plain" }) {
  const { t } = useStore();
  const [done, setDone] = React.useState(false);
  const id = React.useId();
  const brand = tone === "brand";
  return (
    <div className="w-full max-w-md">
      <AnimatePresence mode="wait" initial={false}>
        {done ? (
          <motion.p
            key="done"
            role="status"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className={cn("flex items-center gap-3 rounded-full px-2 py-1.5 text-sm font-semibold", brand ? "bg-white/15 text-white" : "bg-success/10 text-success-ink")}
          >
            <SuccessCheck size={32} className={brand ? "text-white [&_path]:stroke-[var(--primary)]" : undefined} />
            {t("home.subscribed")}
          </motion.p>
        ) : (
          <motion.form
            key="form"
            exit={{ opacity: 0, y: -8, transition: { duration: 0.15 } }}
            className="flex w-full flex-col gap-2 sm:flex-row sm:items-start"
            onSubmit={(e) => {
              e.preventDefault();
              const v = new FormData(e.currentTarget).get("contact");
              try {
                localStorage.setItem("sr_newsletter", String(v ?? ""));
              } catch {
                /* ignore */
              }
              setDone(true);
            }}
          >
            <label htmlFor={id} className="sr-only">
              {t("home.newsletterPlaceholder")}
            </label>
            <input
              id={id}
              name="contact"
              required
              minLength={5}
              placeholder={t("home.newsletterPlaceholder")}
              className={cn(
                "h-11 flex-1 rounded-full px-5 text-sm outline-none",
                brand ? "border border-white/30 bg-white/95 text-neutral-900 placeholder:text-neutral-500 focus:ring-4 focus:ring-white/40" : "border border-input bg-card focus:ring-[3px] focus:ring-ring/30",
              )}
            />
            <motion.button
              type="submit"
              whileTap={{ scale: 0.96 }}
              className={cn("h-11 rounded-full px-6 text-sm font-semibold focus-ring", brand ? "bg-neutral-900 text-white hover:bg-neutral-800" : "bg-primary text-primary-foreground hover:bg-primary/90")}
            >
              {t("home.subscribe")}
            </motion.button>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
