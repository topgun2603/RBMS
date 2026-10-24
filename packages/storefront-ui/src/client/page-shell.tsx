"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HomeIcon, LayoutGridIcon, SearchIcon, ShoppingBagIcon, UserRoundIcon } from "lucide-react";
import { STORE_PATHS } from "@srirealtime/cms/seo";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@srirealtime/ui/components/sheet";
import { cn } from "@srirealtime/ui/lib/utils";
import { CategoryArt } from "../components/category-art";
import type { MenuItem } from "../types";
import { LocaleSwitch, Logo, NavLink, ThemeToggle, type NavCategory } from "./header";
import { useStore } from "./store-context";

/*
 * Page layouts beyond the header (theme `pageLayout`, `mobileNav`; branding LAYOUT_OPTIONS): the category rail
 * (marketplace style), the sidebar menu (the header becomes a vertical column on desktop) and the phone tab bar.
 * Rendered by pages/layout.tsx only for the shops that chose them; styles.css lays the page out around them.
 */

const isCategoryPath = (path: string, slug: string) => path === STORE_PATHS.category(slug) || path.startsWith(`${STORE_PATHS.category(slug)}/`);
/** Pages that shop the catalogue (the rail shows there): home, listings, product pages. */
export const railPage = (path: string) => path === "/" || path === STORE_PATHS.products || path === STORE_PATHS.search || /^\/(c|p|collections)\//.test(path);
/** The phone strip only on browsing pages (a product page keeps its picture first). */
const stripPage = (path: string) => path === "/" || path === STORE_PATHS.products || path === STORE_PATHS.search || /^\/(c|collections)\//.test(path);

// ------------------------------------------------------------------ category rail

/**
 * A sticky list of the shop's categories beside the page on desktop (the open category's sub-categories under it),
 * and a swipeable strip of category chips at the top of browsing pages on phones.
 */
export function CategoryRail({ categories }: { categories: NavCategory[] }) {
  const { t } = useStore();
  const path = usePathname();
  if (!categories.length || !railPage(path)) return null;
  const allActive = path === STORE_PATHS.products;
  return (
    <>
      <nav aria-label={t("layouts.railLabel")} className="sf-rail hidden w-60 shrink-0 lg:block xl:w-64" data-testid="category-rail">
        <div className="sticky top-20 grid max-h-[calc(100dvh-6rem)] gap-1 overflow-y-auto overscroll-contain py-6 ps-4 pe-2 scrollbar-thin sm:ps-6 lg:ps-8">
          <p className="mb-2 px-3 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">{t("layouts.railTitle")}</p>
          <Link
            href={STORE_PATHS.products}
            aria-current={allActive ? "page" : undefined}
            className={cn("flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors focus-ring", allActive ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
          >
            <LayoutGridIcon className="size-4 shrink-0" aria-hidden /> {t("layouts.railAll")}
          </Link>
          <ul className="grid gap-0.5">
            {categories.map((c, i) => {
              const open = isCategoryPath(path, c.slug) || !!c.children?.some((k) => isCategoryPath(path, k.slug));
              const here = path === STORE_PATHS.category(c.slug);
              return (
                <li key={c.id}>
                  <Link
                    href={STORE_PATHS.category(c.slug)}
                    aria-current={here ? "page" : undefined}
                    className={cn(
                      "flex min-h-11 items-center gap-3 rounded-xl px-2 py-1.5 text-sm leading-snug transition-colors focus-ring",
                      here ? "bg-primary/12 font-semibold text-primary" : open ? "font-semibold" : "text-foreground/80 hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <span className="relative block size-8 shrink-0 overflow-hidden rounded-lg bg-muted">
                      <CategoryArt name={c.name} slug={c.slug} image={c.imageUrl} tone={i} compact className="size-full" />
                    </span>
                    <span className="min-w-0 flex-1">{c.name}</span>
                  </Link>
                  {open && c.children && c.children.length > 0 && (
                    <ul className="ms-7 mt-0.5 mb-1 grid gap-0.5 border-s ps-3">
                      {c.children.map((k) => {
                        const kHere = isCategoryPath(path, k.slug);
                        return (
                          <li key={k.id}>
                            <Link
                              href={STORE_PATHS.category(k.slug)}
                              aria-current={kHere ? "page" : undefined}
                              className={cn("flex min-h-9 items-center rounded-lg px-2 text-sm leading-snug focus-ring", kHere ? "font-semibold text-primary" : "text-muted-foreground hover:text-foreground")}
                            >
                              {k.name}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </nav>
      {stripPage(path) && (
        <nav aria-label={t("layouts.railLabel")} className="sf-rail-strip border-b bg-background lg:hidden">
          <ul className="flex gap-2 overflow-x-auto px-4 py-3 scrollbar-none sm:px-6">
            {categories.map((c, i) => {
              const here = isCategoryPath(path, c.slug);
              return (
                <li key={c.id} className="shrink-0">
                  <Link
                    href={STORE_PATHS.category(c.slug)}
                    aria-current={here ? "page" : undefined}
                    className={cn("flex h-10 items-center gap-2 rounded-full border ps-1 pe-3.5 text-sm font-medium whitespace-nowrap focus-ring", here ? "border-primary bg-primary text-primary-foreground" : "bg-card")}
                  >
                    <span className="relative block size-8 overflow-hidden rounded-full bg-muted">
                      <CategoryArt name={c.name} slug={c.slug} image={c.imageUrl} tone={i} compact className="size-full" />
                    </span>
                    {c.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </>
  );
}

// ------------------------------------------------------------------ sidebar menu

/**
 * The header as a fixed vertical column on desktop: logo, search, the shop's menu, its categories, then language,
 * light / dark, account and cart. Phones keep the normal header (styles.css hides one or the other).
 */
export function SideNav({ menu, categories }: { menu: MenuItem[]; categories: NavCategory[] }) {
  const { t, cart, auth } = useStore();
  const path = usePathname();
  const active = (href: string | null) => !!href && (href === "/" ? path === "/" : path.startsWith(href.split("?")[0]!));
  const item = "flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm leading-snug transition-colors focus-ring";
  return (
    <aside className="sf-sidenav fixed inset-y-0 start-0 z-40 hidden w-64 flex-col border-e bg-background/95 backdrop-blur lg:flex" aria-label={t("layouts.sideNav")} data-testid="side-nav">
      <div className="px-5 pt-6 pb-4">
        <Logo wrap />
      </div>
      <form action={STORE_PATHS.search} role="search" className="relative mx-4 mb-3">
        <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          name="q"
          type="search"
          placeholder={t("search.placeholder")}
          aria-label={t("nav.search")}
          className="h-10 w-full rounded-full border bg-card ps-9 pe-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </form>
      <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4 scrollbar-thin" aria-label={t("nav.menu")}>
        <ul className="grid gap-0.5">
          <li>
            <Link href="/" aria-current={path === "/" ? "page" : undefined} className={cn(item, path === "/" ? "bg-primary/12 font-semibold text-primary" : "hover:bg-accent")}>
              <HomeIcon className="size-4 shrink-0" aria-hidden /> {t("nav.home")}
            </Link>
          </li>
          {menu.map((m, i) => (
            <li key={i}>
              {m.href ? (
                <NavLink href={m.href} className={cn(item, active(m.href) ? "bg-primary/12 font-semibold text-primary" : "hover:bg-accent")}>
                  {m.label}
                </NavLink>
              ) : (
                <p className="px-3 pt-3 pb-1 text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">{m.label}</p>
              )}
              {m.children && m.children.length > 0 && (
                <ul className="ms-4 grid gap-0.5 border-s ps-2">
                  {m.children.map((k, j) =>
                    k.href ? (
                      <li key={j}>
                        <NavLink href={k.href} className={cn(item, "min-h-9 text-muted-foreground hover:text-foreground", active(k.href) && "font-semibold text-primary")}>
                          {k.label}
                        </NavLink>
                      </li>
                    ) : null,
                  )}
                </ul>
              )}
            </li>
          ))}
        </ul>
        {categories.length > 0 && (
          <>
            <p className="mt-5 mb-1.5 px-3 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">{t("nav.categories")}</p>
            <ul className="grid gap-0.5">
              {categories.map((c, i) => {
                const here = isCategoryPath(path, c.slug);
                return (
                  <li key={c.id}>
                    <Link href={STORE_PATHS.category(c.slug)} aria-current={here ? "page" : undefined} className={cn(item, "px-2", here ? "bg-primary/12 font-semibold text-primary" : "text-foreground/80 hover:bg-accent hover:text-foreground")}>
                      <span className="relative block size-7 shrink-0 overflow-hidden rounded-lg bg-muted">
                        <CategoryArt name={c.name} slug={c.slug} image={c.imageUrl} tone={i} compact className="size-full" />
                      </span>
                      <span className="min-w-0 flex-1">{c.name}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </nav>
      <div className="grid gap-3 border-t p-4">
        <div className="flex items-center justify-between gap-2">
          <LocaleSwitch />
          <ThemeToggle />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Link href="/account" className="sf-btn inline-flex h-10 items-center justify-center gap-2 border text-sm font-semibold focus-ring hover:bg-accent">
            <UserRoundIcon className="size-4" aria-hidden /> <span className="truncate">{auth.user?.name?.split(" ")[0] || t("nav.account")}</span>
          </Link>
          <button
            type="button"
            onClick={() => cart.setMiniOpen(true)}
            className="sf-btn relative inline-flex h-10 items-center justify-center gap-2 bg-primary text-sm font-semibold text-primary-foreground focus-ring"
            aria-label={`${t("nav.cart")} (${t("cart.items", { count: cart.count })})`}
            data-cart-target
          >
            <ShoppingBagIcon className="size-4" aria-hidden /> {t("nav.cart")}
            {cart.count > 0 && <span className="rounded-full bg-primary-foreground px-1.5 text-[11px] font-bold text-primary tabular-nums">{cart.count > 99 ? "99+" : cart.count}</span>}
          </button>
        </div>
      </div>
    </aside>
  );
}

// ------------------------------------------------------------------ phone tab bar

/** App-like bottom bar on phones: Home, Categories (a sheet), Search, Cart (opens the mini cart) and Account. */
export function TabBar({ categories }: { categories: NavCategory[] }) {
  const { t, cart } = useStore();
  const path = usePathname();
  const [cats, setCats] = React.useState(false);
  if (path === "/checkout") return null;
  const tab = "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] leading-tight font-medium focus-ring";
  const on = (yes: boolean) => (yes ? "text-primary" : "text-muted-foreground");
  return (
    <>
      <nav aria-label={t("layouts.tabs")} className="sf-tabbar fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" data-testid="tab-bar">
        <ul className="flex h-16 items-stretch">
          <li className="flex flex-1">
            <Link href="/" aria-current={path === "/" ? "page" : undefined} className={cn(tab, on(path === "/"))}>
              <HomeIcon className="size-5" aria-hidden />
              <span className="max-w-full truncate px-1">{t("layouts.tabHome")}</span>
            </Link>
          </li>
          <li className="flex flex-1">
            <button type="button" onClick={() => setCats(true)} aria-expanded={cats} className={cn(tab, on(cats || /^\/(c|products)\b/.test(path)))}>
              <LayoutGridIcon className="size-5" aria-hidden />
              <span className="max-w-full truncate px-1">{t("layouts.tabCategories")}</span>
            </button>
          </li>
          <li className="flex flex-1">
            <Link href={STORE_PATHS.search} aria-current={path === STORE_PATHS.search ? "page" : undefined} className={cn(tab, on(path === STORE_PATHS.search))}>
              <SearchIcon className="size-5" aria-hidden />
              <span className="max-w-full truncate px-1">{t("layouts.tabSearch")}</span>
            </Link>
          </li>
          <li className="flex flex-1">
            <button
              type="button"
              onClick={() => cart.setMiniOpen(true)}
              className={cn(tab, on(path === "/cart"))}
              aria-label={`${t("layouts.tabCart")} (${t("cart.items", { count: cart.count })})`}
              data-cart-target
            >
              <span className="relative">
                <ShoppingBagIcon className="size-5" aria-hidden />
                {cart.count > 0 && (
                  <span className="absolute -top-1.5 -end-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground ring-2 ring-background tabular-nums">
                    {cart.count > 99 ? "99+" : cart.count}
                  </span>
                )}
              </span>
              <span className="max-w-full truncate px-1" aria-hidden>
                {t("layouts.tabCart")}
              </span>
            </button>
          </li>
          <li className="flex flex-1">
            <Link href="/account" aria-current={path.startsWith("/account") ? "page" : undefined} className={cn(tab, on(path.startsWith("/account")))}>
              <UserRoundIcon className="size-5" aria-hidden />
              <span className="max-w-full truncate px-1">{t("layouts.tabAccount")}</span>
            </Link>
          </li>
        </ul>
      </nav>
      <Sheet open={cats} onOpenChange={setCats}>
        <SheetContent side="bottom" className="max-h-[80dvh] gap-0 rounded-t-2xl p-0">
          <SheetHeader className="border-b px-5 py-4">
            <SheetTitle>{t("nav.categories")}</SheetTitle>
            <SheetDescription className="sr-only">{t("layouts.railTitle")}</SheetDescription>
          </SheetHeader>
          <ul className="grid grid-cols-3 gap-x-2 gap-y-4 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <li>
              <Link href={STORE_PATHS.products} onClick={() => setCats(false)} className="grid justify-items-center gap-1.5 rounded-xl p-1 text-center text-xs leading-snug font-medium focus-ring">
                <span className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <LayoutGridIcon className="size-6" aria-hidden />
                </span>
                {t("layouts.railAll")}
              </Link>
            </li>
            {categories.map((c, i) => (
              <li key={c.id}>
                <Link href={STORE_PATHS.category(c.slug)} onClick={() => setCats(false)} className="grid justify-items-center gap-1.5 rounded-xl p-1 text-center text-xs leading-snug font-medium focus-ring">
                  <span className="relative block size-16 overflow-hidden rounded-2xl bg-muted">
                    <CategoryArt name={c.name} slug={c.slug} image={c.imageUrl} tone={i} className="size-full" />
                  </span>
                  <span className="line-clamp-2">{c.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}
