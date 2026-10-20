"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDownIcon, SettingsIcon } from "lucide-react";
import { cn, motion } from "@srirealtime/ui";
import { BUILT_IN_SETTINGS } from "../app/builtins";
import { useVisibleSettings, type MountedSettingsPage } from "../app/session";
import { useI18n } from "../lib/i18n";

/** True inside <SettingsLayout>: the layout draws the menu, so pages' own <SettingsNav /> render nothing. */
const SettingsFrameContext = React.createContext(false);

/** Whether the current page sits inside the settings layout (Page uses it to drop its own frame). */
export function useInSettingsFrame() {
  return React.useContext(SettingsFrameContext);
}

/** Groups consecutive pages of the same module (kit pages last), so the menu can show a divider between groups. */
function groupByModule(pages: MountedSettingsPage[]): MountedSettingsPage[][] {
  const groups: MountedSettingsPage[][] = [];
  let key: string | null | undefined;
  for (const p of pages) {
    const k = p.module?.id ?? null;
    if (groups.length === 0 || k !== key) groups.push([]);
    groups[groups.length - 1]!.push(p);
    key = k;
  }
  return groups;
}

function useSettingsMenu() {
  const pathname = (usePathname() ?? "").replace(/\/+$/, "") || "/";
  const pages = useVisibleSettings(BUILT_IN_SETTINGS);
  const active = pages.find((p) => p.href === pathname) ?? null;
  return { pages, active };
}

/** Phones and small tablets: a native select (the OS picker handles a long list better than a cramped row). */
function SettingsSelect({ pages, active, className }: { pages: MountedSettingsPage[]; active: MountedSettingsPage | null; className?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const ActiveIcon = active?.icon ?? SettingsIcon;
  return (
    <div className={cn("relative", className)}>
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
  );
}

/**
 * Desktop: a vertical tab rail, one row per page, dividers between modules, a sliding highlight on the active page.
 * Like the sidebar, the list scrolls inside the card (the title stays put) and the active page is scrolled into view.
 */
function SettingsRail({ pages, active }: { pages: MountedSettingsPage[]; active: MountedSettingsPage | null }) {
  const { t } = useI18n();
  const listRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    listRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest" });
  }, [active?.href]);
  return (
    <nav aria-label={t("web.settings.tabs")} className="flex max-h-full min-h-0 flex-col rounded-2xl border bg-card py-2 shadow-xs">
      <p className="shrink-0 px-5 pt-2 pb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("web.settings.title")}</p>
      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 [scrollbar-color:var(--color-border)_transparent] [scrollbar-width:thin]"
      >
        {groupByModule(pages).map((group, i) => (
          <ul key={group[0]!.href} className={cn("grid gap-0.5", i > 0 && "mt-1.5 border-t pt-1.5")}>
            {group.map((p) => {
              const isActive = p.href === active?.href;
              const Icon = p.icon ?? SettingsIcon;
              return (
                <li key={p.href}>
                  <Link
                    href={p.href}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "relative flex min-h-10 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                      isActive ? "text-primary" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="sr-settings-rail"
                        className="absolute inset-0 rounded-lg bg-primary/10"
                        transition={{ type: "spring", stiffness: 500, damping: 40 }}
                      />
                    )}
                    {isActive && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" aria-hidden />}
                    <Icon className="relative size-4 shrink-0" />
                    <span className="relative min-w-0 leading-snug">{t(p.label)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ))}
      </div>
    </nav>
  );
}

/**
 * Frame for every settings page: a vertical tab rail on the left (lg and up, sticky while the page scrolls) and the
 * page on the right; below lg a select above the page. The router wraps settings pages in it, so pages don't draw
 * their own navigation.
 */
export function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { pages, active } = useSettingsMenu();
  if (pages.length < 2) return <>{children}</>;
  return (
    <SettingsFrameContext.Provider value={true}>
      <div className="mx-auto w-full max-w-7xl px-page py-page-y">
        <SettingsSelect pages={pages} active={active} className="mb-section lg:hidden" />
        <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start lg:gap-8">
          {/* Height leaves room for the header above and a page's sticky save bar below. */}
          <aside className="hidden lg:sticky lg:top-20 lg:flex lg:max-h-[calc(100dvh-11rem)] lg:flex-col">
            <SettingsRail pages={pages} active={active} />
          </aside>
          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </SettingsFrameContext.Provider>
  );
}

/**
 * Settings navigation for a page rendered outside <SettingsLayout> (a select on small screens, the rail otherwise).
 * Inside the layout (every page the router mounts under /settings) it renders nothing: the layout already shows it.
 */
export function SettingsNav({ className }: { className?: string }) {
  const inFrame = useInSettingsFrame();
  const { pages, active } = useSettingsMenu();
  if (inFrame || pages.length < 2) return null;
  return (
    <div className={cn("mb-section", className)}>
      <SettingsSelect pages={pages} active={active} className="lg:hidden" />
      <div className="hidden lg:block">
        <SettingsRail pages={pages} active={active} />
      </div>
    </div>
  );
}
