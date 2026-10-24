"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeftIcon, ArrowRightIcon, ChevronLeftIcon, ChevronRightIcon, Loader2Icon, PauseIcon, PlayIcon, RotateCcwIcon, SearchXIcon, XIcon } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@srirealtime/ui/components/dialog";
import { cn } from "@srirealtime/ui/lib/utils";
import { useReducedMotionSafe } from "@srirealtime/ui/motion";
import { STORE_PATHS } from "@srirealtime/cms/seo";
import { finderQuery } from "../lib/finder";
import { flashState } from "../lib/flash-window";
import { sizeForFoot } from "../lib/shoe-size";
import { imageUrl } from "../lib/format";
import { safeHref } from "../lib/markdown";
import type { FinderOption, SearchResult, SkinDepth } from "../types";
import { Price } from "../components/bits";
import { call } from "./api";
import { ProductCardView } from "./product-card";
import { useStore } from "./store-context";

/*
 * Interactive parts of the layout sections (pages/home-layouts.tsx renders the rest on the server): the flash sale's
 * time window, the finder, the stories strip and viewer, the category shelf tabs and the sticky story's picture swap.
 */

// ------------------------------------------------------------------ flash sale window

/**
 * Shows its children only between `startsAt` and `endsAt` and inside the `daily` window (the server already drops
 * sales outside it; this hides a sale whose window closes while the page stays open).
 */
export function WindowGate({ startsAt, endsAt, daily, children }: { startsAt?: string; endsAt: string; daily?: { from: string; to: string }; children: React.ReactNode }) {
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  // Until mounted, trust the server's decision (no flash of nothing, no hydration mismatch).
  if (now !== null && !flashState({ startsAt, endsAt, daily }, now).live) return null;
  return <>{children}</>;
}

// ------------------------------------------------------------------ finder

interface FinderQuestion {
  label: string;
  options: FinderOption[];
}

/**
 * "Shop by finder": the shopper answers up to three questions (wizard: one at a time; chips: all at once) and the
 * matching products load below (`results: inline`), or a "Show" button with the match count opens the filtered list
 * (`results: button`; an answer with its own link, e.g. a class's collection, opens that instead). Answers are buttons
 * in a group (`aria-pressed`); the match count is announced politely. An optional picture sits beside the questions.
 */
export function Finder({
  id,
  questions,
  layout,
  limit,
  results: mode = "inline",
  buttonLabel,
  imageUrl: picture,
  cta,
}: {
  id: string;
  questions: FinderQuestion[];
  layout: "wizard" | "chips";
  limit: number;
  results?: "inline" | "button";
  buttonLabel?: string;
  imageUrl?: string;
  cta?: { label: string; href: string };
}) {
  const { t } = useStore();
  const [picks, setPicks] = React.useState<(number | null)[]>(() => questions.map(() => null));
  const [step, setStep] = React.useState(0);
  const [skipped, setSkipped] = React.useState<boolean[]>(() => questions.map(() => false));
  const [state, setState] = React.useState<{ status: "idle" | "loading" | "done" | "error"; items: SearchResult["items"]; total: number }>({ status: "idle", items: [], total: 0 });
  const [attempt, setAttempt] = React.useState(0);
  const chosen = picks.map((p, i) => (p === null ? null : (questions[i]?.options[p] ?? null)));
  const q = finderQuery(chosen);
  const answered = picks.some((p) => p !== null);
  const wizardDone = layout === "wizard" && step >= questions.length;
  // The last chosen answer with its own page wins over the filtered list.
  const own = [...chosen].reverse().find((o) => o?.href)?.href;
  const target = (own && safeHref(own)) || q.href;
  const button = mode === "button";

  React.useEffect(() => {
    if (!answered || (button && own)) {
      setState({ status: "idle", items: [], total: 0 });
      return;
    }
    const ctrl = new AbortController();
    setState((s) => ({ ...s, status: "loading" }));
    const timer = setTimeout(() => {
      call<SearchResult>(`/catalog/public/search?${q.api}${q.api ? "&" : ""}limit=${button ? 1 : limit}`, { auth: false, signal: ctrl.signal })
        .then((r) => setState({ status: "done", items: r.items, total: r.total }))
        .catch((err: unknown) => {
          if ((err as { name?: string })?.name !== "AbortError") setState({ status: "error", items: [], total: 0 });
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q.api, answered, limit, attempt, button, own]);

  const pick = (qi: number, oi: number | null) => {
    setPicks((p) => p.map((v, i) => (i === qi ? (v === oi ? null : oi) : v)));
    if (layout === "wizard") {
      setSkipped((s) => s.map((v, i) => (i === qi ? oi === null : v)));
      setStep(qi + 1);
    }
  };
  const reset = () => {
    setPicks(questions.map(() => null));
    setSkipped(questions.map(() => false));
    setStep(0);
  };

  const results = button ? null : (
    <FinderResults
      status={state.status}
      items={state.items}
      total={state.total}
      href={target}
      answered={answered}
      onRetry={() => setAttempt((a) => a + 1)}
    />
  );
  const actions = (button || cta) && (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      {button && (
        <FinderShow href={target} label={buttonLabel || t("layouts.finderShow")} ready={answered} count={own ? null : state.status === "done" ? state.total : null} loading={!own && state.status === "loading"} />
      )}
      {cta && safeHref(cta.href) && (
        <Link href={safeHref(cta.href)!} className="sf-btn inline-flex min-h-12 items-center justify-center gap-2 border-2 border-current/25 px-6 py-2 text-center text-sm leading-snug font-semibold focus-ring hover:border-current/50">
          {cta.label}
        </Link>
      )}
    </div>
  );
  const pic = imageUrl(picture ?? null);
  const withPicture = (card: React.ReactNode) =>
    pic ? (
      <div className="grid items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]">
        {card}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={pic} alt="" className="hidden size-full min-h-64 rounded-[var(--sf-radius-card)] object-cover shadow-card lg:block" loading="lazy" />
      </div>
    ) : (
      card
    );

  if (layout === "chips") {
    return (
      <div className="grid gap-6" data-testid="finder" data-layout="chips">
        {withPicture(<div className="grid content-start gap-5 rounded-[var(--sf-radius-card)] border bg-card p-4 shadow-card sm:p-6">
          {questions.map((question, qi) => (
            <div key={qi} className="grid gap-2.5 md:grid-cols-[minmax(10rem,14rem)_1fr] md:items-start md:gap-6">
              <p id={`${id}-q${qi}`} className="pt-2 text-sm font-semibold leading-snug">
                {question.label}
              </p>
              <div role="group" aria-labelledby={`${id}-q${qi}`} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
                {question.options.map((o, oi) => (
                  <AnswerChip key={oi} option={o} pressed={picks[qi] === oi} onClick={() => pick(qi, oi)} />
                ))}
              </div>
            </div>
          ))}
          {(answered || actions) && (
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">{actions}</div>
              {answered && (
                <button type="button" onClick={reset} className="inline-flex h-10 items-center gap-1.5 self-end rounded-full px-3 text-sm font-semibold text-muted-foreground hover:text-foreground focus-ring">
                  <RotateCcwIcon className="size-4" aria-hidden /> {t("layouts.finderReset")}
                </button>
              )}
            </div>
          )}
        </div>)}
        {results}
      </div>
    );
  }

  const current = questions[step];
  return (
    <div className="grid gap-6" data-testid="finder" data-layout="wizard">
      {withPicture(<div className="overflow-hidden rounded-[var(--sf-radius-card)] border bg-card shadow-card">
        <div className="flex gap-1.5 p-4 pb-0 sm:p-6 sm:pb-0" aria-hidden>
          {questions.map((_, i) => (
            <span key={i} className={cn("h-1.5 flex-1 rounded-full transition-colors", i < step || wizardDone ? "bg-primary" : i === step ? "bg-primary/45" : "bg-muted")} />
          ))}
        </div>
        <div className="grid gap-5 p-4 sm:p-6">
          {current ? (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">{t("layouts.finderStep", { n: step + 1, total: questions.length })}</p>
                {answered && <FinderCount status={state.status} total={state.total} />}
              </div>
              <h3 id={`${id}-q${step}`} className="sf-heading font-display text-h3 leading-snug font-semibold text-balance">
                {current.label}
              </h3>
              <div role="group" aria-labelledby={`${id}-q${step}`} className={cn("grid gap-3", current.options.some((o) => o.imageUrl) ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3")}>
                {current.options.map((o, oi) => (
                  <AnswerTile key={oi} option={o} pressed={picks[step] === oi} onClick={() => pick(step, oi)} />
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                  disabled={step === 0}
                  className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-muted-foreground hover:text-foreground focus-ring disabled:invisible"
                >
                  <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden /> {t("layouts.finderBack")}
                </button>
                <button type="button" onClick={() => pick(step, null)} className="inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-sm font-semibold text-primary hover:bg-primary/10 focus-ring">
                  {t("layouts.finderSkip")} <ArrowRightIcon className="size-4 rtl:rotate-180" aria-hidden />
                </button>
              </div>
            </>
          ) : (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">{t("layouts.finderPicks")}</p>
                <button type="button" onClick={reset} className="inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-muted-foreground hover:text-foreground focus-ring">
                  <RotateCcwIcon className="size-4" aria-hidden /> {t("layouts.finderReset")}
                </button>
              </div>
              <ul className="flex flex-wrap gap-2">
                {questions.map((question, qi) => (
                  <li key={qi}>
                    <button
                      type="button"
                      onClick={() => setStep(qi)}
                      className="inline-flex min-h-10 items-center gap-2 rounded-full border bg-background px-4 py-1.5 text-start text-sm leading-snug focus-ring hover:border-primary/50"
                    >
                      <span className="text-muted-foreground">{question.label}</span>
                      <span className="font-semibold">{chosen[qi]?.label ?? (skipped[qi] ? t("layouts.finderAny") : "—")}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {actions}
            </div>
          )}
          {current && cta && !button && <div className="border-t pt-4">{actions}</div>}
        </div>
      </div>)}
      {(wizardDone || answered) && results}
    </div>
  );
}

/** The "Show my list" button (button results): the match count once known; quiet until an answer is picked. */
function FinderShow({ href, label, ready, count, loading }: { href: string; label: string; ready: boolean; count: number | null; loading: boolean }) {
  const { t } = useStore();
  const cls = "sf-btn group/cta inline-flex min-h-12 items-center justify-center gap-2 px-7 py-2 text-center text-sm leading-snug font-semibold focus-ring";
  if (!ready)
    return (
      <span className={cn(cls, "cursor-default bg-muted text-muted-foreground")} aria-disabled="true">
        {label}
      </span>
    );
  return (
    <Link href={href} className={cn(cls, "bg-primary text-primary-foreground shadow-md shadow-primary/25")} data-testid="finder-show">
      {label}
      {loading ? <Loader2Icon className="size-4 animate-spin" aria-hidden /> : count !== null && <span className="rounded-full bg-primary-foreground/20 px-2 py-0.5 text-xs tabular-nums">{count}</span>}
      <ArrowRightIcon className="size-4 transition-transform group-hover/cta:translate-x-1 rtl:rotate-180" aria-hidden />
      {count !== null && <span className="sr-only">{t("layouts.finderCount", { count })}</span>}
    </Link>
  );
}

function FinderCount({ status, total }: { status: string; total: number }) {
  const { t } = useStore();
  return (
    <p className="text-sm font-medium text-muted-foreground tabular-nums" aria-live="polite">
      {status === "loading" ? t("layouts.finderLoading") : status === "done" ? t("layouts.finderCount", { count: total }) : ""}
    </p>
  );
}

function AnswerChip({ option, pressed, onClick }: { option: FinderOption; pressed: boolean; onClick: () => void }) {
  const img = imageUrl(option.imageUrl ?? null);
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-4 py-1.5 text-sm leading-snug font-semibold transition-colors focus-ring",
        pressed ? "border-primary bg-primary text-primary-foreground shadow-sm" : "bg-background hover:border-primary/50",
        img && "ps-1.5",
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {img && <img src={img} alt="" className="size-7 rounded-full object-cover" loading="lazy" />}
      {option.label}
    </button>
  );
}

function AnswerTile({ option, pressed, onClick }: { option: FinderOption; pressed: boolean; onClick: () => void }) {
  const img = imageUrl(option.imageUrl ?? null);
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "group grid overflow-hidden rounded-[calc(var(--sf-radius-card)*0.75)] border-2 bg-background text-start transition-[border-color,box-shadow,transform] focus-ring hover:-translate-y-0.5 hover:shadow-card motion-reduce:hover:translate-y-0",
        pressed ? "border-primary shadow-card" : "border-border hover:border-primary/50",
      )}
    >
      {img && (
        <span className="block aspect-[4/3] overflow-hidden bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img} alt="" className="size-full object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none" loading="lazy" />
        </span>
      )}
      <span className="flex min-h-12 items-center justify-between gap-2 px-4 py-3 text-sm leading-snug font-semibold">
        {option.label}
        <span aria-hidden className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border-2", pressed ? "border-primary bg-primary" : "border-border")}>
          {pressed && <span className="size-2 rounded-full bg-primary-foreground" />}
        </span>
      </span>
    </button>
  );
}

function FinderResults({ status, items, total, href, answered, onRetry }: { status: string; items: SearchResult["items"]; total: number; href: string; answered: boolean; onRetry: () => void }) {
  const { t } = useStore();
  if (!answered) return <p className="text-center text-sm text-muted-foreground">{t("layouts.finderStart")}</p>;
  if (status === "error")
    return (
      <div className="flex flex-col items-center gap-3 rounded-[var(--sf-radius-card)] border border-dashed p-8 text-center" role="alert">
        <p className="text-sm text-muted-foreground">{t("layouts.finderError")}</p>
        <button type="button" onClick={onRetry} className="sf-btn inline-flex h-10 items-center gap-2 border px-4 text-sm font-semibold focus-ring">
          <RotateCcwIcon className="size-4" aria-hidden /> {t("layouts.finderRetry")}
        </button>
      </div>
    );
  if (status === "done" && items.length === 0)
    return (
      <div className="flex flex-col items-center gap-3 rounded-[var(--sf-radius-card)] border border-dashed p-8 text-center">
        <SearchXIcon className="size-8 text-muted-foreground" aria-hidden />
        <p className="max-w-sm text-sm text-muted-foreground">{t("layouts.finderNone")}</p>
      </div>
    );
  return (
    <div className="grid gap-5" aria-busy={status === "loading"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-display text-h3 font-semibold tabular-nums" aria-live="polite">
          {status === "loading" && !items.length ? t("layouts.finderLoading") : t("layouts.finderCount", { count: total })}
        </p>
        {status === "loading" && <Loader2Icon className="size-5 animate-spin text-muted-foreground" aria-hidden />}
      </div>
      {items.length > 0 ? (
        <ul className={cn("grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 md:grid-cols-3 lg:grid-cols-4 transition-opacity", status === "loading" && "opacity-60")}>
          {items.map((p) => (
            <li key={p.id}>
              <ProductCardView product={p} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 md:grid-cols-3 lg:grid-cols-4" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="grid gap-3">
              <div className="sf-shimmer aspect-[var(--sf-image-ratio,4/5)] rounded-[var(--sf-radius-card)]" />
              <div className="sf-shimmer h-3.5 w-4/5 rounded-full" />
            </li>
          ))}
        </ul>
      )}
      {total > items.length && (
        <div className="flex justify-center">
          <Link href={href} className="sf-btn group/cta inline-flex h-12 items-center gap-2 bg-primary px-7 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/25 focus-ring" data-testid="finder-all">
            {t("layouts.finderSeeAll", { count: total })}
            <ArrowRightIcon className="size-4 transition-transform group-hover/cta:translate-x-1 rtl:rotate-180" aria-hidden />
          </Link>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ stories

export interface StoryItem {
  imageUrl: string;
  videoUrl?: string;
  title: string;
  text?: string;
  href?: string;
  ctaLabel?: string;
}

const STORY_MS = 5000;

/** The strip (rings or reels) and the full-screen viewer it opens. */
export function Stories({ items, layout, label }: { items: StoryItem[]; layout: "rings" | "reels"; label: string }) {
  const { t } = useStore();
  const [open, setOpen] = React.useState<number | null>(null);
  return (
    <>
      <ul className={cn("-mx-4 flex snap-x snap-mandatory overflow-x-auto px-4 pb-2 scrollbar-none sm:mx-0 sm:px-0", layout === "rings" ? "gap-4 sm:gap-6" : "gap-3 sm:gap-4")} aria-label={label}>
        {items.map((it, i) => (
          <li key={i} className="snap-start">
            <button
              type="button"
              onClick={() => setOpen(i)}
              aria-label={t("layouts.storyOpen", { title: it.title })}
              className={cn("group grid justify-items-center text-center focus-ring", layout === "rings" ? "w-[5.5rem] gap-2 rounded-2xl sm:w-24" : "w-36 rounded-[var(--sf-radius-card)] sm:w-44")}
              data-testid="story"
            >
              {layout === "rings" ? (
                <>
                  <span className="rounded-full bg-[image:var(--sf-gradient)] p-[3px] transition-transform group-hover:scale-105 motion-reduce:transition-none">
                    <span className="block size-[4.75rem] overflow-hidden rounded-full border-[3px] border-background bg-muted sm:size-[5.25rem]">
                      <StoryPicture src={it.imageUrl} />
                    </span>
                  </span>
                  <span className="line-clamp-2 text-xs leading-snug font-medium">{it.title}</span>
                </>
              ) : (
                <span className="relative block aspect-[9/16] w-full overflow-hidden rounded-[var(--sf-radius-card)] bg-muted shadow-card">
                  {it.videoUrl ? <ReelVideo src={it.videoUrl} poster={it.imageUrl} /> : <StoryPicture src={it.imageUrl} className="transition-transform duration-700 group-hover:scale-105 motion-reduce:transition-none" />}
                  <span aria-hidden className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/75 to-transparent" />
                  <span className="absolute inset-x-0 bottom-0 grid gap-0.5 p-3 text-start text-white">
                    <span className="line-clamp-2 text-sm leading-snug font-semibold">{it.title}</span>
                    {it.text && <span className="line-clamp-2 text-xs leading-snug opacity-85">{it.text}</span>}
                  </span>
                  {it.videoUrl && (
                    <span aria-hidden className="absolute end-2 top-2 flex size-7 items-center justify-center rounded-full bg-black/45 text-white">
                      <PlayIcon className="size-3.5 fill-current" />
                    </span>
                  )}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <StoryViewer items={items} index={open} onIndex={setOpen} label={label} />
    </>
  );
}

function StoryPicture({ src, className }: { src: string; className?: string }) {
  const url = imageUrl(src);
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="" className={cn("size-full object-cover", className)} loading="lazy" decoding="async" /> : null;
}

/** A muted clip that plays only while on screen (and never with reduced motion: the poster stays). */
function ReelVideo({ src, poster }: { src: string; poster: string }) {
  const ref = React.useRef<HTMLVideoElement>(null);
  const reduced = useReducedMotionSafe();
  React.useEffect(() => {
    const v = ref.current;
    if (!v || reduced || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) void v.play().catch(() => {});
      else v.pause();
    }, { threshold: 0.6 });
    io.observe(v);
    return () => io.disconnect();
  }, [reduced]);
  return <video ref={ref} src={imageUrl(src) ?? src} poster={imageUrl(poster) ?? undefined} muted loop playsInline preload="none" aria-hidden className="size-full object-cover" />;
}

/** Full-screen stories: progress bars, tap left / right (or arrow keys) to move, auto-advance, pause, Esc closes. */
function StoryViewer({ items, index, onIndex, label }: { items: StoryItem[]; index: number | null; onIndex: (i: number | null) => void; label: string }) {
  const { t } = useStore();
  const reduced = useReducedMotionSafe();
  const [paused, setPaused] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const n = items.length;
  const it = index === null ? null : items[index];
  const go = React.useCallback(
    (d: 1 | -1) => {
      if (index === null) return;
      const next = index + d;
      if (next >= n) onIndex(null);
      else onIndex(Math.max(0, next));
    },
    [index, n, onIndex],
  );

  React.useEffect(() => {
    setProgress(0);
  }, [index]);
  React.useEffect(() => {
    if (index === null || paused || it?.videoUrl) return;
    const started = performance.now() - progress * STORY_MS;
    let raf = 0;
    const tick = () => {
      const p = Math.min(1, (performance.now() - started) / STORY_MS);
      setProgress(p);
      if (p >= 1) go(1);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only when the story or pause changes
  }, [index, paused, it?.videoUrl, go]);

  const href = it?.href ? safeHref(it.href) : null;
  return (
    <Dialog open={index !== null} onOpenChange={(o) => !o && onIndex(null)}>
      <DialogContent
        showCloseButton={false}
        className="top-0 left-0 flex h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 items-center justify-center gap-0 overflow-hidden rounded-none border-0 bg-black/95 p-0 text-white sm:max-w-none"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") go(1);
          else if (e.key === "ArrowLeft") go(-1);
          else if (e.key === " ") {
            e.preventDefault();
            setPaused((p) => !p);
          }
        }}
        data-testid="story-viewer"
      >
        <DialogTitle className="sr-only">{it?.title ?? label}</DialogTitle>
        <DialogDescription className="sr-only">{index !== null ? t("layouts.storyOf", { n: index + 1, total: n }) : ""}</DialogDescription>
        {it && index !== null && (
          <div className="relative flex h-full max-h-[100dvh] w-full max-w-[min(100vw,calc(100dvh*9/16))] flex-col overflow-hidden bg-neutral-900 sm:h-[92dvh] sm:rounded-2xl">
            {it.videoUrl ? (
              <video
                key={index}
                src={imageUrl(it.videoUrl) ?? it.videoUrl}
                poster={imageUrl(it.imageUrl) ?? undefined}
                autoPlay={!reduced}
                muted
                playsInline
                controls={reduced}
                onTimeUpdate={(e) => {
                  const v = e.currentTarget;
                  if (v.duration) setProgress(v.currentTime / v.duration);
                }}
                onEnded={() => go(1)}
                className="absolute inset-0 size-full object-cover"
              />
            ) : (
              <StoryPicture key={index} src={it.imageUrl} className="absolute inset-0" />
            )}
            <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/60 to-transparent" />
            <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/80 to-transparent" />
            <div className="relative z-10 grid gap-3 p-3">
              <div className="flex gap-1" aria-hidden>
                {items.map((_, i) => (
                  <span key={i} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/35">
                    <span className="block h-full bg-white" style={{ width: `${i < index ? 100 : i === index ? Math.round(progress * 100) : 0}%` }} />
                  </span>
                ))}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold">{it.title}</span>
                <div className="flex shrink-0 items-center gap-1">
                  {!it.videoUrl && (
                    <button type="button" onClick={() => setPaused((p) => !p)} aria-label={paused ? t("layouts.storyPlay") : t("layouts.storyPause")} className="flex size-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 focus-ring">
                      {paused ? <PlayIcon className="size-4" /> : <PauseIcon className="size-4" />}
                    </button>
                  )}
                  <DialogClose className="flex size-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 focus-ring" aria-label={t("layouts.storyClose")}>
                    <XIcon className="size-5" />
                  </DialogClose>
                </div>
              </div>
            </div>
            {/* Tap zones: left third goes back, the rest forward (buttons for keyboard and screen readers). */}
            <button type="button" onClick={() => go(-1)} aria-label={t("layouts.storyPrev")} disabled={index === 0} className="absolute start-0 top-24 bottom-32 z-[5] w-1/3 focus-visible:outline-none">
              <ChevronLeftIcon className="ms-2 size-7 opacity-0 transition-opacity focus-visible:opacity-100 sm:opacity-60 rtl:rotate-180" aria-hidden />
            </button>
            <button type="button" onClick={() => go(1)} aria-label={t("layouts.storyNext")} className="absolute end-0 top-24 bottom-32 z-[5] flex w-2/3 items-center justify-end focus-visible:outline-none">
              <ChevronRightIcon className="me-2 size-7 opacity-0 sm:opacity-60 rtl:rotate-180" aria-hidden />
            </button>
            <div className="relative z-10 mt-auto grid gap-3 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
              {it.text && <p className="text-base leading-relaxed text-white/90">{it.text}</p>}
              {href && (
                <Link href={href} onClick={() => onIndex(null)} className="sf-btn inline-flex h-12 w-full items-center justify-center gap-2 bg-white px-6 text-sm font-semibold text-neutral-900 focus-ring">
                  {it.ctaLabel || t("layouts.storyShop")} <ArrowRightIcon className="size-4 rtl:rotate-180" aria-hidden />
                </Link>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ category shelf

/**
 * The category list beside its product grids (WAI-ARIA tabs; every panel stays in the HTML, inactive ones hidden).
 * A vertical list on desktop, a swipeable row of chips on phones.
 */
export function CategoryShelfTabs({ id, tabs }: { id: string; tabs: { label: string; image: string | null; panel: React.ReactNode }[] }) {
  const { t } = useStore();
  const [active, setActive] = React.useState(0);
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const go = (i: number) => {
    const n = (i + tabs.length) % tabs.length;
    setActive(n);
    refs.current[n]?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowRight") go(active + 1);
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") go(active - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(tabs.length - 1);
    else return;
    e.preventDefault();
  };
  return (
    <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8 xl:grid-cols-[17rem_minmax(0,1fr)]" data-testid="category-shelf">
      <div className="-mx-4 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0 lg:overflow-visible">
        <div
          role="tablist"
          aria-label={t("layouts.shelfCategories")}
          aria-orientation="vertical"
          onKeyDown={onKey}
          className="flex w-max gap-2 lg:sticky lg:top-24 lg:w-full lg:flex-col lg:gap-1 lg:rounded-[var(--sf-radius-card)] lg:border lg:bg-card lg:p-2 lg:shadow-card"
        >
          {tabs.map((tab, i) => {
            const img = imageUrl(tab.image);
            return (
              <button
                key={i}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${id}-tab-${i}`}
                aria-selected={i === active}
                aria-controls={`${id}-panel-${i}`}
                tabIndex={i === active ? 0 : -1}
                onClick={() => setActive(i)}
                className={cn(
                  "flex min-h-11 shrink-0 items-center gap-3 rounded-full border px-4 text-sm leading-snug font-semibold whitespace-nowrap transition-colors focus-ring lg:w-full lg:rounded-[calc(var(--sf-radius-card)*0.6)] lg:border-0 lg:px-3 lg:py-2 lg:text-start lg:whitespace-normal",
                  img && "ps-1.5 lg:ps-2",
                  i === active ? "border-primary bg-primary text-primary-foreground shadow-sm" : "bg-background text-foreground/80 hover:bg-accent hover:text-foreground lg:bg-transparent",
                )}
              >
                {img && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt="" className="size-8 shrink-0 rounded-full object-cover lg:size-10 lg:rounded-[calc(var(--sf-radius-card)*0.45)]" loading="lazy" />
                )}
                <span className="min-w-0 flex-1">{tab.label}</span>
                <ChevronRightIcon className={cn("hidden size-4 shrink-0 opacity-50 lg:block rtl:rotate-180", i === active && "opacity-100")} aria-hidden />
              </button>
            );
          })}
        </div>
      </div>
      <div className="min-w-0">
        {tabs.map((tab, i) => (
          <div key={i} role="tabpanel" id={`${id}-panel-${i}`} aria-labelledby={`${id}-tab-${i}`} hidden={i !== active} tabIndex={0} className="focus-visible:outline-none">
            {tab.panel}
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ sticky story

/**
 * Marks which chapter of a sticky story is in the middle of the screen (`data-active` on the section), so the sticky
 * picture beside the text crossfades to that chapter's picture (styles.css). Without JS the first picture shows.
 */
export function StickyStoryWatch({ id }: { id: string }) {
  React.useEffect(() => {
    const root = document.getElementById(id);
    if (!root || typeof IntersectionObserver === "undefined") return;
    const chapters = [...root.querySelectorAll<HTMLElement>("[data-story-chapter]")];
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) root.setAttribute("data-active", (e.target as HTMLElement).dataset.storyChapter ?? "0");
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    chapters.forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [id]);
  return null;
}

// ------------------------------------------------------------------ size finder

/**
 * "Find your size": a group toggle (Men / Women / Kids, a radio group) over size chips that open the listing filtered
 * to that size in the group's category; with `footLength`, a foot-length box (cm) marks the size that fits.
 */
export function SizeFinder({ id, optionName, footLength, groups }: { id: string; optionName: string; footLength: boolean; groups: { label: string; categoryId?: string; sizes: string[] }[] }) {
  const { t } = useStore();
  const [g, setG] = React.useState(0);
  const [cm, setCm] = React.useState("");
  const group = groups[g] ?? groups[0];
  if (!group) return null;
  const foot = Number(cm.replace(",", "."));
  const fit = cm.trim() ? sizeForFoot(group.sizes, foot) : null;
  const hrefFor = (size: string) => {
    const p = new URLSearchParams();
    if (group.categoryId) p.set("cat", group.categoryId);
    p.append(`opt.${optionName}`, size);
    return `${STORE_PATHS.search}?${p.toString()}`;
  };
  return (
    <div className="grid gap-5" data-testid="size-finder">
      {groups.length > 1 && (
        <div role="radiogroup" aria-label={t("layouts.sizeGroup")} className="flex w-full gap-1 rounded-[1.5rem] border bg-card p-1 sm:inline-flex sm:w-fit">
          {groups.map((x, i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={i === g}
              onClick={() => setG(i)}
              className={cn("min-h-10 min-w-0 flex-1 rounded-full px-2 py-1.5 text-sm leading-tight font-semibold transition-colors focus-ring sm:flex-none sm:px-5", i === g ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {x.label}
            </button>
          ))}
        </div>
      )}
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" aria-label={t("layouts.sizePick", { group: group.label })}>
        {group.sizes.map((size) => (
          <li key={size} className="shrink-0">
            <Link
              href={hrefFor(size)}
              aria-current={fit === size ? "true" : undefined}
              className={cn(
                "flex h-12 min-w-14 items-center justify-center rounded-[calc(var(--sf-radius-card)*0.6)] border-2 px-4 text-base font-semibold tabular-nums transition-colors focus-ring",
                fit === size ? "border-primary bg-primary text-primary-foreground shadow-md shadow-primary/25" : "bg-background hover:border-primary/60",
              )}
            >
              {size}
            </Link>
          </li>
        ))}
      </ul>
      {footLength && (
        <div className="grid gap-2 sm:max-w-md">
          <label htmlFor={`${id}-cm`} className="text-sm font-semibold">
            {t("layouts.sizeFoot")}
          </label>
          <div className="flex items-center gap-3">
            <input
              id={`${id}-cm`}
              inputMode="decimal"
              placeholder="25.4"
              value={cm}
              onChange={(e) => setCm(e.target.value.replace(/[^\d.,]/g, "").slice(0, 5))}
              className="h-12 w-full rounded-[calc(var(--sf-radius-card)*0.6)] border bg-background px-4 text-base tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-32"
              aria-describedby={`${id}-fit`}
            />
            <span className="shrink-0 text-sm text-muted-foreground">cm</span>
          </div>
          <p id={`${id}-fit`} className="min-h-5 text-sm" aria-live="polite">
            {cm.trim() ? (fit ? t("layouts.sizeYours", { size: fit }) : t("layouts.sizeNone")) : <span className="text-muted-foreground">{t("layouts.sizeFootHint")}</span>}
          </p>
        </div>
      )}
    </div>
  );
}


// ------------------------------------------------------------------ shade finder (swatches)

export interface SwatchProduct {
  id: string;
  name: string;
  slug: string;
  image: string | null;
  /** One per shade value: the variant to add (`byAlso`: the variant per value of the second option, when there is one). */
  shades: { value: string; variantId: string; price: number; mrp: number | null; hex: string | null; depth: SkinDepth | null; byAlso?: Record<string, { variantId: string; price: number; mrp: number | null }> }[];
  /** A second option the shopper picks first (a case's phone model): its label and values in the product's order. */
  also?: { name: string; label: string; values: string[] };
}

const DEPTHS: SkinDepth[] = ["fair", "wheatish", "dusky", "deep"];

/**
 * Shade swatches per product (tabs when there are several), an optional skin-depth filter, and the chosen shade's
 * name, price and Add to cart (that variant). Swatches are radio buttons; the colour is decoration, the name is the label.
 */
export function Swatches({ id, products }: { id: string; products: SwatchProduct[] }) {
  const { t, cart, shell } = useStore();
  const [tab, setTab] = React.useState(0);
  const [depth, setDepth] = React.useState<SkinDepth | null>(null);
  const [picked, setPicked] = React.useState<Record<string, string>>({});
  // The second option's value per product ("iPhone-style 6.1-inch"), when the products have one.
  const [alsoPicked, setAlsoPicked] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const p = products[tab] ?? products[0];
  if (!p) return null;
  const other = p.also ? (alsoPicked[p.id] ?? "") : "";
  // With a second option: only the shades that exist for the chosen value, at that exact variant's price.
  const forOther = p.also && other ? p.shades.flatMap((s) => (s.byAlso?.[other] ? [{ ...s, ...s.byAlso[other] }] : [])) : p.shades;
  const depths = DEPTHS.filter((d) => forOther.some((s) => s.depth === d));
  const shown = depth ? forOther.filter((s) => s.depth === depth) : forOther;
  const chosen = forOther.find((s) => s.value === picked[p.id]) ?? null;
  const needsOther = !!p.also && !other;
  const add = async () => {
    if (!chosen || needsOther) return;
    setBusy(true);
    try {
      await cart.add(chosen.variantId, 1, { productId: p.id, value: chosen.price });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(14rem,20rem)] md:items-start" data-testid="swatches">
      <div className="grid min-w-0 gap-5">
        {products.length > 1 && (
          <div role="tablist" aria-label={t("layouts.swatchProducts")} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:px-0">
            {products.map((x, i) => (
              <button
                key={x.id}
                type="button"
                role="tab"
                aria-selected={i === tab}
                aria-controls={`${id}-panel`}
                onClick={() => {
                  setTab(i);
                  setDepth(null);
                }}
                className={cn("h-10 shrink-0 rounded-full border px-4 text-sm font-semibold whitespace-nowrap transition-colors focus-ring", i === tab ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:border-primary/50")}
              >
                {x.name}
              </button>
            ))}
          </div>
        )}
        <div id={`${id}-panel`} role={products.length > 1 ? "tabpanel" : undefined} className="grid gap-4">
          {p.also && (
            <label className="grid max-w-sm gap-1.5 text-sm font-medium" data-testid="swatch-also">
              {p.also.label}
              <select
                value={other}
                onChange={(e) => setAlsoPicked((m) => ({ ...m, [p.id]: e.target.value }))}
                className="h-11 w-full rounded-[calc(var(--radius)*0.75)] border bg-background px-3 text-sm font-normal focus-ring"
              >
                <option value="">{t("layouts.swatchAlsoPlaceholder")}</option>
                {p.also.values.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          )}
          {depths.length > 1 && (
            <div role="group" aria-label={t("layouts.depthFilter")} className="flex flex-wrap gap-2">
              {[null, ...depths].map((d) => (
                <button
                  key={d ?? "all"}
                  type="button"
                  aria-pressed={depth === d}
                  onClick={() => setDepth(d)}
                  className={cn("h-9 rounded-full border px-3.5 text-sm font-medium transition-colors focus-ring", depth === d ? "border-foreground bg-foreground text-background" : "bg-background hover:border-foreground/40")}
                >
                  {d ? t(`layouts.depth.${d}`) : t("layouts.depthAll")}
                </button>
              ))}
            </div>
          )}
          <div role="radiogroup" aria-label={t("layouts.shadePick")} className="flex flex-wrap gap-3">
            {shown.map((s) => {
              const on = picked[p.id] === s.value;
              return (
                <button
                  key={s.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={s.value}
                  title={s.value}
                  onClick={() => setPicked((m) => ({ ...m, [p.id]: s.value }))}
                  className={cn("relative size-11 rounded-full ring-offset-2 ring-offset-background transition-transform focus-ring hover:scale-110 motion-reduce:hover:scale-100 sm:size-12", on ? "ring-2 ring-foreground" : "ring-1 ring-border")}
                  style={{ background: s.hex ?? "#d6d3d1" }}
                >
                  {!s.hex && <span className="text-sm font-semibold text-neutral-700">{s.value.charAt(0)}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="grid gap-4 rounded-[var(--sf-radius-card)] border bg-card p-4 shadow-card" aria-live="polite">
        <Link href={STORE_PATHS.product(p.slug)} className="group flex items-center gap-3 focus-ring">
          <span className="size-16 shrink-0 overflow-hidden rounded-[calc(var(--sf-radius-card)*0.6)] bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {imageUrl(p.image) && <img src={imageUrl(p.image)!} alt="" className="size-full object-cover" loading="lazy" />}
          </span>
          <span className="min-w-0 text-sm leading-snug font-semibold group-hover:text-primary">{p.name}</span>
        </Link>
        {needsOther && p.also ? (
          <p className="text-sm text-muted-foreground" data-testid="swatch-also-first">
            {t("layouts.swatchAlsoFirst", { name: p.also.label })}
          </p>
        ) : chosen ? (
          <>
            <p className="flex items-center gap-3 text-sm">
              <span aria-hidden className="size-8 shrink-0 rounded-full ring-1 ring-border" style={{ background: chosen.hex ?? "#d6d3d1" }} />
              <span>
                {t("layouts.shadeSelected")} <span className="font-semibold">{chosen.value}</span>
              </span>
            </p>
            <Price price={chosen.price} mrp={chosen.mrp} t={t} />
            {shell.open && (
              <button type="button" onClick={() => void add()} disabled={busy} className="sf-btn inline-flex h-12 items-center justify-center gap-2 bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/25 focus-ring disabled:opacity-70" data-testid="shade-add">
                {busy ? <Loader2Icon className="size-4 animate-spin" aria-hidden /> : null}
                {t("product.addToCart")}
              </button>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("layouts.shadeHint", { count: p.shades.length })}</p>
        )}
      </div>
    </div>
  );
}
