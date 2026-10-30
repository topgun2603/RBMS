"use client";

import * as React from "react";
import { cn } from "@rbms/ui";

/**
 * List + thread layout. From `md` up both panes sit side by side at the viewport height under the top bar (3.5rem).
 * On phones only one shows: the list (normal page flow, with the tab bar) or, when a conversation is open, the
 * thread as a full-screen layer under the top bar (its composer sits at the bottom; the route is `immersive`).
 */
export function TwoPane({
  list,
  thread,
  open,
  aside,
  className,
}: {
  list: React.ReactNode;
  thread: React.ReactNode;
  /** A conversation is selected (phones show the thread). */
  open: boolean;
  /** Optional third column from `xl` (contact details, notes). */
  aside?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "md:grid md:h-[calc(100dvh-3.5rem)] md:overflow-hidden md:border-t md:border-border/60",
        aside ? "md:grid-cols-[20rem_minmax(0,1fr)] xl:grid-cols-[22rem_minmax(0,1fr)_20rem]" : "md:grid-cols-[20rem_minmax(0,1fr)] xl:grid-cols-[24rem_minmax(0,1fr)]",
        className,
      )}
    >
      <div className={cn("min-h-0 min-w-0 md:flex md:flex-col md:border-r md:border-border/60", open && "hidden md:flex")}>{list}</div>
      <div
        className={cn(
          "min-h-0 min-w-0 flex-col bg-page",
          open ? "fixed inset-x-0 top-14 bottom-0 z-20 flex md:static md:z-auto" : "hidden md:flex",
        )}
      >
        {thread}
      </div>
      {aside && <div className="hidden min-h-0 min-w-0 overflow-y-auto border-l border-border/60 xl:block">{aside}</div>}
    </div>
  );
}

/** Scrollable message area that keeps the reader's place when older messages load above and follows new ones at the bottom. */
export function useThreadScroll(deps: { count: number; lastId: string | null; resetKey: string | null }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const atBottom = React.useRef(true);
  const prevHeight = React.useRef(0);
  const prevLast = React.useRef<string | null>(null);
  const [showJump, setShowJump] = React.useState(false);

  const onScroll = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom.current) setShowJump(false);
  }, []);

  const toBottom = React.useCallback((smooth = false) => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    atBottom.current = true;
    setShowJump(false);
  }, []);

  // New conversation: start at the bottom.
  React.useLayoutEffect(() => {
    prevLast.current = null;
    prevHeight.current = 0;
    atBottom.current = true;
  }, [deps.resetKey]);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const newLast = deps.lastId !== prevLast.current;
    if (prevLast.current === null || (newLast && atBottom.current)) toBottom(prevLast.current !== null);
    else if (newLast) setShowJump(true);
    else if (prevHeight.current && el.scrollHeight > prevHeight.current) {
      // Older messages were prepended: keep the same message under the reader's eye.
      el.scrollTop += el.scrollHeight - prevHeight.current;
    }
    prevHeight.current = el.scrollHeight;
    prevLast.current = deps.lastId;
  }, [deps.count, deps.lastId, toBottom]);

  return { ref, onScroll, toBottom, showJump };
}

/** Calls `onVisible` when the sentinel scrolls into view (load older messages / more rows). */
export function useSentinel(onVisible: () => void, enabled: boolean, root?: React.RefObject<HTMLElement | null>) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const cb = React.useRef(onVisible);
  cb.current = onVisible;
  React.useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && cb.current(), { root: root?.current ?? null, rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, root]);
  return ref;
}
