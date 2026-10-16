"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDownIcon, SettingsIcon } from "lucide-react";
import { cn, motion } from "@srirealtime/ui";
import { BUILT_IN_SETTINGS } from "../app/builtins";
import { useVisibleSettings } from "../app/session";
import { useI18n } from "../lib/i18n";

const FADE = "1.75rem";

/** CSS mask that fades only the edge(s) with more tabs behind them. */
function fadeMask(left: boolean, right: boolean): React.CSSProperties | undefined {
  if (!left && !right) return undefined;
  const mask = `linear-gradient(to right, ${left ? "transparent" : "#000"}, #000 ${left ? FADE : "0px"}, #000 calc(100% - ${right ? FADE : "0px"}), ${right ? "transparent" : "#000"})`;
  return { maskImage: mask, WebkitMaskImage: mask };
}

/** Tracks whether a horizontal scroller has hidden content on either side. */
function useOverflowEdges(ref: React.RefObject<HTMLElement | null>, deps: unknown[]) {
  const [edges, setEdges] = React.useState({ left: false, right: false });
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-measure when the tab list changes
  }, deps);
  return edges;
}

/**
 * Tabs across every settings page the app's modules contribute (plus Settings → Features). From `sm` up: a
 * tab bar that wraps onto more rows when the tabs don't fit (every page stays visible; the narrow settings column is too
 * tight for one scrolling row). On phones: a native select (the OS picker handles a long list better than a cramped row).
 */
export function SettingsNav({ className }: { className?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = (usePathname() ?? "").replace(/\/+$/, "") || "/";
  const pages = useVisibleSettings(BUILT_IN_SETTINGS);
  const scroller = React.useRef<HTMLUListElement>(null);
  const activeRef = React.useRef<HTMLAnchorElement>(null);
  const edges = useOverflowEdges(scroller, [pages.length]);
  const active = pages.find((p) => p.href === pathname) ?? null;

  // Keep the active tab visible (scroll the bar only: never the page).
  React.useLayoutEffect(() => {
    const el = scroller.current;
    const tab = activeRef.current;
    if (!el || !tab) return;
    const pad = 32;
    const start = tab.offsetLeft; // the list is the offsetParent (relative), so this ignores its scroll
    const end = start + tab.offsetWidth;
    if (start - pad < el.scrollLeft) el.scrollLeft = Math.max(0, start - pad);
    else if (end + pad > el.scrollLeft + el.clientWidth) el.scrollLeft = end + pad - el.clientWidth;
  }, [active?.href, pages.length]);

  if (pages.length < 2) return null;
  const ActiveIcon = active?.icon ?? SettingsIcon;

  return (
    <nav aria-label={t("web.settings.tabs")} className={cn("mb-5", className)}>
      {/* Phones: native select */}
      <div className="relative sm:hidden">
        <ActiveIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-primary" />
        <select
          aria-label={t("web.settings.tabs")}
          value={active?.href ?? ""}
          onChange={(e) => router.push(e.target.value)}
          className="h-11 w-full appearance-none rounded-xl border bg-card pr-10 pl-9 text-base font-medium shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {!active && <option value="">{t("web.settings.title")}</option>}
          {pages.map((p) => (
            <option key={p.href} value={p.href}>
              {t(p.label)}
            </option>
          ))}
        </select>
        <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
      </div>

      {/* sm and up: wrapping tab bar */}
      <div className="hidden max-w-full rounded-xl border bg-card p-1 shadow-xs sm:flex sm:w-fit">
        <ul
          ref={scroller}
          className="relative flex min-w-0 flex-wrap gap-1"
          style={fadeMask(edges.left, edges.right)}
        >
          {pages.map((p) => {
            const isActive = p.href === active?.href;
            const Icon = p.icon ?? SettingsIcon;
            return (
              <li key={p.href} className="shrink-0">
                <Link
                  ref={isActive ? activeRef : undefined}
                  href={p.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "relative flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    isActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {isActive && (
                    <motion.span
                      layoutId="sr-settings-tab"
                      className="absolute inset-0 rounded-lg bg-primary/10"
                      transition={{ type: "spring", stiffness: 500, damping: 40 }}
                    />
                  )}
                  <Icon className="relative size-4" />
                  <span className="relative">{t(p.label)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
