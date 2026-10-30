"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotionSafe } from "@rbms/ui/motion";
import { useStore } from "./store-context";

export interface Announcement {
  text: string;
  href?: string;
}

const KEY = "sr_ribbon_closed";
const useIsoLayoutEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

/**
 * Offer ribbon above the header. Messages come from the shop (home "USP" items, COD / returns settings) — nothing
 * invented. Theme `announcement`: dismissible (rotates every 4.5 s with a vertical slide, paused on hover / focus,
 * static with reduced motion; can be closed for the session) · bar (the same, without the close button) · ticker
 * (one scrolling line, paused on hover / focus; the rotating bar with reduced motion).
 */
export function AnnouncementBar({ items }: { items: Announcement[] }) {
  const { t, shell } = useStore();
  const reduced = useReducedMotionSafe();
  const style = shell.theme.announcement;
  if (style === "ticker" && !reduced && items.length > 0) return <AnnouncementTicker items={items} />;
  return <RotatingBar items={items} closable={style === "dismissible"} />;
}

/** The scrolling line: the messages twice in a row, moved by half its width (CSS `sf-marquee`), so it loops seamlessly. */
function AnnouncementTicker({ items }: { items: Announcement[] }) {
  const { t } = useStore();
  // Short lists are repeated so one copy is wider than the screen.
  const run = Array.from({ length: Math.max(1, Math.ceil(6 / items.length)) }, () => items).flat();
  const copy = (hidden: boolean) => (
    <ul className="flex shrink-0 items-center" aria-hidden={hidden || undefined}>
      {run.map((item, i) => (
        // Repeats are read once: only the first run of the first copy is exposed to screen readers.
        <li key={i} className="flex shrink-0 items-center gap-2 px-6 whitespace-nowrap" aria-hidden={!hidden && i >= items.length ? true : undefined}>
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-white/70" />
          {item.href ? (
            <Link href={item.href} tabIndex={hidden || i >= items.length ? -1 : undefined} className="underline-offset-4 hover:underline focus-ring">
              {item.text}
            </Link>
          ) : (
            <span>{item.text}</span>
          )}
        </li>
      ))}
    </ul>
  );
  return (
    <div role="region" aria-label={t("announce.label")} className="sf-ticker relative z-[41] overflow-hidden bg-[image:var(--sf-gradient)] text-primary-foreground" data-testid="announcement" data-style="ticker">
      {/* About 6 s per message, whatever the count. */}
      <div className="sf-ticker-track flex h-9 w-max items-center text-xs font-medium sm:text-[13px]" style={{ animationDuration: `${run.length * 6}s` }}>
        {copy(false)}
        {copy(true)}
      </div>
    </div>
  );
}

function RotatingBar({ items, closable }: { items: Announcement[]; closable: boolean }) {
  const { t } = useStore();
  const reduced = useReducedMotionSafe();
  const [hidden, setHidden] = React.useState(false);
  const [i, setI] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const n = items.length;
  const sig = items.map((x) => x.text).join("|");

  useIsoLayoutEffect(() => {
    if (!closable) return;
    try {
      if (sessionStorage.getItem(KEY) === sig) setHidden(true);
    } catch {
      /* ignore */
    }
  }, [sig, closable]);

  React.useEffect(() => {
    if (n < 2 || paused || reduced) return;
    const id = setTimeout(() => setI((x) => (x + 1) % n), 4500);
    return () => clearTimeout(id);
  }, [i, n, paused, reduced]);

  if (!n || hidden) return null;
  const item = items[i]!;
  const content = <span className="truncate">{item.text}</span>;
  return (
    <motion.div
      role="region"
      aria-label={t("announce.label")}
      className="relative z-[41] overflow-hidden bg-[image:var(--sf-gradient)] text-primary-foreground"
      exit={{ height: 0 }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      data-testid="announcement"
    >
      <div className="mx-auto flex h-9 max-w-7xl items-center gap-2 px-2 text-xs font-medium sm:px-6 sm:text-[13px] lg:px-8">
        {n > 1 ? (
          <button type="button" onClick={() => setI((x) => (x - 1 + n) % n)} aria-label={t("announce.prev")} className="hidden size-7 shrink-0 items-center justify-center rounded-full hover:bg-white/15 focus-ring sm:flex">
            <ChevronLeftIcon className="size-3.5" />
          </button>
        ) : (
          <span className="hidden size-7 sm:block" />
        )}
        <div className="relative flex h-full min-w-0 flex-1 items-center justify-center overflow-hidden" aria-live="polite">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={i}
              initial={{ y: reduced ? 0 : "100%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: reduced ? 0 : "-100%", opacity: 0 }}
              transition={{ duration: reduced ? 0 : 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="flex min-w-0 items-center justify-center gap-2"
            >
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-white/70" />
              {item.href ? (
                <Link href={item.href} className="flex min-w-0 underline-offset-4 hover:underline">
                  {content}
                </Link>
              ) : (
                content
              )}
            </motion.div>
          </AnimatePresence>
        </div>
        {n > 1 && (
          <button type="button" onClick={() => setI((x) => (x + 1) % n)} aria-label={t("announce.next")} className="hidden size-7 shrink-0 items-center justify-center rounded-full hover:bg-white/15 focus-ring sm:flex">
            <ChevronRightIcon className="size-3.5" />
          </button>
        )}
        {closable ? (
          <button
            type="button"
            onClick={() => {
              setHidden(true);
              try {
                sessionStorage.setItem(KEY, sig);
              } catch {
                /* ignore */
              }
            }}
            aria-label={t("announce.close")}
            className="flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-white/15 focus-ring"
          >
            <XIcon className="size-3.5" />
          </button>
        ) : (
          // Keeps the message centred where the close button would be.
          <span aria-hidden className="size-7 shrink-0 max-sm:hidden" />
        )}
      </div>
    </motion.div>
  );
}
