"use client";

import * as React from "react";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, MoveHorizontalIcon, PauseIcon, PlayIcon, StarIcon } from "lucide-react";
import { cn } from "@srirealtime/ui/lib/utils";
import { AnimatePresence, motion, useReducedMotionSafe } from "@srirealtime/ui/motion";
import { imageUrl } from "../lib/format";
import { useStore } from "./store-context";

/*
 * Interactive bits of the home sections (the sections themselves render on the server, pages/home-sections.tsx):
 * background video, offer countdown + coupon copy, before/after slider, the one-at-a-time testimonial.
 */

// ------------------------------------------------------------------ hero video

/**
 * Full-width video hero. The video starts from script (muted, looping, inline) and never with reduced motion; the
 * poster shows until then and for visitors without JavaScript. A pause button keeps moving content under control.
 */
export function HeroVideo({ videoUrl, posterUrl, overlay, children }: { videoUrl: string; posterUrl?: string; overlay: number; children: React.ReactNode }) {
  const { t } = useStore();
  const reduced = useReducedMotionSafe();
  const ref = React.useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = React.useState(false);
  React.useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true;
    if (reduced) {
      v.pause();
      return;
    }
    v.play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false));
  }, [reduced]);
  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) void v.play().then(() => setPlaying(true));
    else {
      v.pause();
      setPlaying(false);
    }
  };
  const poster = imageUrl(posterUrl ?? null) ?? undefined;
  return (
    <section className="relative isolate flex h-[72vh] max-h-[780px] min-h-[440px] items-center overflow-hidden bg-neutral-900 text-white">
      <video
        ref={ref}
        className="absolute inset-0 -z-20 size-full object-cover"
        src={imageUrl(videoUrl) ?? videoUrl}
        poster={poster}
        muted
        loop
        playsInline
        preload="metadata"
        aria-hidden
        tabIndex={-1}
      />
      <span aria-hidden className="absolute inset-0 -z-10 bg-black" style={{ opacity: overlay / 100 }} />
      <span aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-1/3 bg-gradient-to-t from-black/50 to-transparent" />
      {children}
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? t("sections.pauseVideo") : t("sections.playVideo")}
        className="absolute right-4 bottom-4 z-[2] flex size-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/30 focus-ring"
      >
        {playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
      </button>
    </section>
  );
}

// ------------------------------------------------------------------ offer

function remaining(endsAt: number, now: number) {
  const ms = Math.max(0, endsAt - now);
  const s = Math.floor(ms / 1000);
  return { ms, days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600), minutes: Math.floor((s % 3600) / 60), seconds: s % 60 };
}

function useNow(active: boolean) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/** Renders its children until `endsAt` passes (the server already drops offers that ended before the request). */
export function ExpiryGate({ endsAt, children }: { endsAt?: string; children: React.ReactNode }) {
  const end = endsAt ? Date.parse(endsAt) : NaN;
  const now = useNow(Number.isFinite(end));
  if (Number.isFinite(end) && now >= end) return null;
  return <>{children}</>;
}

/** Days / hours / minutes / seconds to `endsAt`, in tabular figures; the screen-reader text updates once a minute. */
export function Countdown({ endsAt, className }: { endsAt: string; className?: string }) {
  const { t } = useStore();
  const end = Date.parse(endsAt);
  const now = useNow(true);
  const r = remaining(end, now);
  const cells = [
    [r.days, t("sections.days")],
    [r.hours, t("sections.hours")],
    [r.minutes, t("sections.minutes")],
    [r.seconds, t("sections.seconds")],
  ] as const;
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="sr-only">
        {t("sections.endsIn")} {r.days > 0 ? `${r.days} ${t("sections.days")} ` : ""}
        {r.hours} {t("sections.hours")} {r.minutes} {t("sections.minutes")}
      </span>
      {cells.map(([n, label], i) => (
        <span key={i} aria-hidden className="flex min-w-14 flex-col items-center rounded-xl bg-black/15 px-2 py-1.5 ring-1 ring-white/20 backdrop-blur-sm">
          <span suppressHydrationWarning className="font-display text-2xl leading-none font-semibold tabular-nums sm:text-3xl">
            {String(n).padStart(2, "0")}
          </span>
          <span className="mt-1 text-[10px] font-semibold tracking-[0.14em] uppercase opacity-80">{label}</span>
        </span>
      ))}
    </div>
  );
}

/** The coupon code as a dashed ticket with a copy button (and a polite "copied" for screen readers). */
export function CopyCode({ code }: { code: string }) {
  const { t } = useStore();
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the code stays visible to copy by hand */
    }
  };
  return (
    <div className="inline-flex max-w-full items-center gap-1 rounded-xl border-2 border-dashed border-current/50 bg-white/10 py-1 ps-3 pe-1 backdrop-blur-sm sm:ps-4">
      <span className="hidden text-xs font-semibold tracking-wide whitespace-nowrap uppercase opacity-80 sm:inline">{t("sections.code")}</span>
      <span className="min-w-0 truncate px-1 font-mono text-lg font-bold tracking-[0.12em] select-all sm:px-2">{code}</span>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={t("sections.copy")}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 text-sm font-semibold whitespace-nowrap text-neutral-900 transition-transform hover:scale-[1.03] focus-ring active:scale-[0.97] motion-reduce:transition-none"
      >
        {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
        {copied ? t("sections.copied") : t("sections.copyShort")}
      </button>
      <span role="status" className="sr-only">
        {copied ? t("sections.copiedCode", { code }) : ""}
      </span>
    </div>
  );
}

// ------------------------------------------------------------------ before / after

/** Two pictures stacked; a range input (keyboard + touch friendly) moves the divide. */
export function BeforeAfter({ beforeUrl, afterUrl, beforeLabel, afterLabel }: { beforeUrl: string; afterUrl: string; beforeLabel?: string; afterLabel?: string }) {
  const { t } = useStore();
  const [pos, setPos] = React.useState(50);
  const before = imageUrl(beforeUrl);
  const after = imageUrl(afterUrl);
  const bl = beforeLabel || t("sections.before");
  const al = afterLabel || t("sections.after");
  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[var(--sf-radius-card)] bg-muted shadow-card select-none sm:aspect-[16/9]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {after && <img src={after} alt={al} className="absolute inset-0 size-full object-cover" loading="lazy" />}
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {before && <img src={before} alt={bl} className="absolute inset-0 size-full object-cover" loading="lazy" />}
      </div>
      <span className="absolute top-3 left-3 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white">{bl}</span>
      <span className="absolute top-3 right-3 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white">{al}</span>
      <span aria-hidden className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.15)]" style={{ left: `${pos}%` }}>
        <span className="absolute top-1/2 left-1/2 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-neutral-900 shadow-lg">
          <MoveHorizontalIcon className="size-5" />
        </span>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label={t("sections.compare")}
        className="absolute inset-0 size-full cursor-ew-resize opacity-0 focus-visible:opacity-0"
      />
    </div>
  );
}

// ------------------------------------------------------------------ testimonials: one at a time

export interface Quote {
  quote: string;
  name: string;
  role?: string;
  rating?: number;
  photoUrl?: string;
}

/** One big quote with previous / next buttons; every quote is in the HTML (inactive ones visually hidden). */
export function QuoteRotator({ items }: { items: Quote[] }) {
  const { t } = useStore();
  const reduced = useReducedMotionSafe();
  const [i, setI] = React.useState(0);
  const n = items.length;
  const go = (d: number) => setI((x) => (((x + d) % n) + n) % n);
  const q = items[i]!;
  const photo = imageUrl(q.photoUrl ?? null);
  return (
    <div className="mx-auto max-w-3xl text-center" aria-roledescription="carousel">
      <AnimatePresence mode="wait" initial={false}>
        <motion.figure
          key={i}
          initial={reduced ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? undefined : { opacity: 0, y: -8 }}
          transition={{ duration: 0.35 }}
          aria-roledescription="slide"
          aria-label={t("sections.quoteN", { n: i + 1, count: n })}
        >
          {q.rating ? (
            <div className="mb-5 flex justify-center gap-1" role="img" aria-label={t("sections.stars", { n: q.rating })}>
              {[1, 2, 3, 4, 5].map((k) => (
                <StarIcon key={k} aria-hidden className={cn("size-5", k <= q.rating! ? "fill-gold text-gold" : "fill-muted text-muted-foreground/30")} />
              ))}
            </div>
          ) : null}
          <blockquote className="font-display text-2xl leading-snug text-balance sm:text-3xl">“{q.quote}”</blockquote>
          <figcaption className="mt-7 flex items-center justify-center gap-3">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt="" className="size-12 rounded-full object-cover ring-2 ring-background" />
            ) : (
              <span aria-hidden className="flex size-12 items-center justify-center rounded-full bg-[image:var(--sf-gradient)] font-bold text-primary-foreground">
                {q.name.charAt(0)}
              </span>
            )}
            <span className="text-start">
              <span className="block font-semibold">{q.name}</span>
              {q.role && <span className="block text-sm text-muted-foreground">{q.role}</span>}
            </span>
          </figcaption>
        </motion.figure>
      </AnimatePresence>
      {n > 1 && (
        <div className="mt-8 flex items-center justify-center gap-3">
          <button type="button" onClick={() => go(-1)} aria-label={t("sections.prevQuote")} className="flex size-11 items-center justify-center rounded-full border bg-background/80 text-foreground focus-ring hover:bg-background">
            <ChevronLeftIcon className="size-5" />
          </button>
          <span className="text-sm tabular-nums opacity-70" aria-hidden>
            {i + 1} / {n}
          </span>
          <button type="button" onClick={() => go(1)} aria-label={t("sections.nextQuote")} className="flex size-11 items-center justify-center rounded-full border bg-background/80 text-foreground focus-ring hover:bg-background">
            <ChevronRightIcon className="size-5" />
          </button>
        </div>
      )}
    </div>
  );
}
