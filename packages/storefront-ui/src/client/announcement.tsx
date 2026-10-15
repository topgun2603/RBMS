"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotionSafe } from "@srirealtime/ui/motion";
import { useStore } from "./store-context";

export interface Announcement {
  text: string;
  href?: string;
}

const KEY = "sr_ribbon_closed";
const useIsoLayoutEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

/**
 * Offer ribbon above the header. Messages come from the shop (home "USP" items, COD / returns settings) — nothing
 * invented. Rotates every 4.5 s with a vertical slide (paused on hover / focus, static with reduced motion);
 * dismissible for the session.
 */
export function AnnouncementBar({ items }: { items: Announcement[] }) {
  const { t } = useStore();
  const reduced = useReducedMotionSafe();
  const [hidden, setHidden] = React.useState(false);
  const [i, setI] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const n = items.length;
  const sig = items.map((x) => x.text).join("|");

  useIsoLayoutEffect(() => {
    try {
      if (sessionStorage.getItem(KEY) === sig) setHidden(true);
    } catch {
      /* ignore */
    }
  }, [sig]);

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
      </div>
    </motion.div>
  );
}
