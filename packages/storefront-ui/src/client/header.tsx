"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowRightIcon, ChevronDownIcon, HeartIcon, LayoutGridIcon, MenuIcon, MoonIcon, PackageSearchIcon, ShoppingBagIcon, SparklesIcon, SunIcon, UserRoundIcon } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@srirealtime/ui/components/sheet";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@srirealtime/ui/components/accordion";
import { Button } from "@srirealtime/ui/components/button";
import { cn } from "@srirealtime/ui/lib/utils";
import {
  AnimatedNumber,
  AnimatePresence,
  motion,
  useAnimationControls,
  useMotionValueEvent,
  useReducedMotionSafe,
  useScroll,
  type Variants,
} from "@srirealtime/ui/motion";
import { STORE_PATHS } from "@srirealtime/cms/seo";
import { imageUrl, money } from "../lib/format";
import type { Locale } from "../lib/messages";
import type { MenuItem } from "../types";
import { Empty, StoreImage } from "../components/bits";
import { EmptyBagArt } from "../components/illustrations";
import { CartLineRow } from "./cart-lines";
import { FreeShippingMeter } from "./cart-view";
import { CART_BUMP_EVENT } from "./fly-to-cart";
import { SearchBox } from "./search-box";
import { useStore } from "./store-context";
import { useWishlist } from "./wishlist";
import { track } from "./analytics";
import { helpCentreOn } from "../lib/features";

export interface NavCategory {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
}

export interface NavCollection {
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
}

const isExternal = (href: string) => /^(https?:|tel:|mailto:)/i.test(href);

export function NavLink({ href, className, children, onClick }: { href: string; className?: string; children: React.ReactNode; onClick?: () => void }) {
  return isExternal(href) ? (
    <a href={href} className={className} onClick={onClick} {...(/^https?:/i.test(href) ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {children}
    </a>
  ) : (
    <Link href={href} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  const { shell } = useStore();
  const logo = imageUrl(shell.logoUrl);
  return (
    <Link href="/" className={cn("flex min-w-0 items-center gap-2.5 rounded-lg focus-ring", className)} aria-label={shell.name}>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt={shell.name} className="h-9 w-auto max-w-[160px] object-contain" />
      ) : (
        <>
          <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[image:var(--sf-gradient)] font-display text-lg font-bold text-primary-foreground shadow-sm shadow-primary/30">
            {shell.name.trim().charAt(0).toUpperCase()}
          </span>
          <span className={cn("truncate font-display text-lg font-semibold tracking-tight", compact && "max-sm:sr-only")}>{shell.name}</span>
        </>
      )}
    </Link>
  );
}

export function LocaleSwitch({ className }: { className?: string }) {
  const { locale, setLocale, t } = useStore();
  const opts: { l: Locale; label: string }[] = [
    { l: "en", label: "EN" },
    { l: "ta", label: "தமிழ்" },
  ];
  return (
    <div className={cn("relative inline-flex items-center rounded-full border bg-card p-0.5 text-xs", className)} role="group" aria-label={t("nav.language")}>
      {opts.map((o) => (
        <button
          key={o.l}
          type="button"
          lang={o.l}
          aria-pressed={locale === o.l}
          onClick={() => locale !== o.l && setLocale(o.l)}
          className={cn("relative rounded-full px-2.5 py-1 font-semibold transition-colors focus-ring", locale === o.l ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {locale === o.l && <motion.span layoutId={`locale-pill-${className ?? ""}`} className="absolute inset-0 rounded-full bg-primary" transition={{ type: "spring", stiffness: 500, damping: 35 }} />}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

const THEME_KEY = "sr_theme";

/** Light / dark switch (the choice is applied before paint by the inline script in StoreLayout). */
export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useStore();
  const [dark, setDark] = React.useState(false);
  React.useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      /* ignore */
    }
  };
  return (
    <button type="button" onClick={toggle} aria-pressed={dark} aria-label={dark ? t("nav.lightMode") : t("nav.darkMode")} title={dark ? t("nav.lightMode") : t("nav.darkMode")} className={cn("relative flex size-10 items-center justify-center overflow-hidden rounded-full hover:bg-accent focus-ring", className)}>
      <AnimatePresence initial={false} mode="wait">
        <motion.span key={dark ? "moon" : "sun"} initial={{ y: 14, opacity: 0, rotate: -45 }} animate={{ y: 0, opacity: 1, rotate: 0 }} exit={{ y: -14, opacity: 0, rotate: 45 }} transition={{ duration: 0.2 }} className="flex">
          {dark ? <MoonIcon className="size-5" /> : <SunIcon className="size-5" />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

/** Inline script for StoreLayout: applies the saved theme before first paint (no flash). */
export const THEME_SCRIPT = `try{if(localStorage.getItem("${THEME_KEY}")==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

/** Sends a page_view on every client navigation. */
export function PageViewTracker() {
  return (
    <React.Suspense fallback={null}>
      <PageViews />
    </React.Suspense>
  );
}

function PageViews() {
  const pathname = usePathname();
  const search = useSearchParams();
  const qs = search?.toString();
  React.useEffect(() => {
    track({ type: "page_view", path: pathname });
  }, [pathname, qs]);
  return null;
}

/**
 * Thin brand-coloured progress bar at the top while a client navigation is in flight: starts on an internal link
 * click, finishes when the URL changes. Transform-only (scaleX).
 */
export function NavProgress() {
  return (
    <React.Suspense fallback={null}>
      <NavProgressInner />
    </React.Suspense>
  );
}

function NavProgressInner() {
  const pathname = usePathname();
  const search = useSearchParams();
  const key = `${pathname}?${search?.toString() ?? ""}`;
  const [state, setState] = React.useState<"idle" | "loading" | "done">("idle");
  const reduced = useReducedMotionSafe();

  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement).closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      setState("loading");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  React.useEffect(() => {
    setState((s) => (s === "loading" ? "done" : s));
  }, [key]);

  React.useEffect(() => {
    if (state !== "done") return;
    const id = setTimeout(() => setState("idle"), 350);
    return () => clearTimeout(id);
  }, [state]);

  if (reduced) return null;
  return (
    <AnimatePresence>
      {state !== "idle" && (
        <motion.div
          aria-hidden
          className="fixed inset-x-0 top-0 z-[70] h-0.5 origin-left bg-[image:var(--sf-gradient)] shadow-[0_0_8px_var(--primary)]"
          initial={{ scaleX: 0, opacity: 1 }}
          animate={state === "loading" ? { scaleX: 0.82, transition: { duration: 6, ease: [0.1, 0.8, 0.2, 1] } } : { scaleX: 1, transition: { duration: 0.2 } }}
          exit={{ opacity: 0, transition: { duration: 0.25 } }}
        />
      )}
    </AnimatePresence>
  );
}

/** Search box prefilled with ?q= on the search page (own Suspense boundary: useSearchParams). */
function HeaderSearch({ className, expandable }: { className?: string; expandable?: boolean }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const q = pathname === STORE_PATHS.search ? (search?.get("q") ?? "") : "";
  return <SearchBox className={className} initial={q} expandable={expandable} />;
}

function SuspendedSearch({ className, expandable }: { className?: string; expandable?: boolean }) {
  return (
    <React.Suspense fallback={<div className={cn("h-11 rounded-full border bg-card", className)} />}>
      <HeaderSearch className={className} expandable={expandable} />
    </React.Suspense>
  );
}

/** Open after a short hover (or on focus / click); close with a grace period so moving to the panel doesn't drop it. */
function useHoverIntent(openDelay = 90, closeDelay = 160) {
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedule = React.useCallback((v: boolean, d: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(v), d);
  }, []);
  React.useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return {
    open,
    setOpen: (v: boolean) => {
      if (timer.current) clearTimeout(timer.current);
      setOpen(v);
    },
    bind: {
      onPointerEnter: (e: React.PointerEvent) => e.pointerType === "mouse" && schedule(true, openDelay),
      onPointerLeave: (e: React.PointerEvent) => e.pointerType === "mouse" && schedule(false, closeDelay),
    },
  };
}

const panelMotion = {
  initial: { opacity: 0, y: -8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.15 } },
} as const;

export function StoreHeader({ menu, categories = [], featured = null }: { menu: MenuItem[]; categories?: NavCategory[]; featured?: NavCollection | null }) {
  const { t, auth, shell } = useStore();
  // Theme header: classic (menu in the bar) · centered (logo centred, menu row below) · minimal (drawer only) · bold (brand bar).
  const variant = shell.theme.header;
  const navInBar = variant === "classic" || variant === "bold";
  const [navOpen, setNavOpen] = React.useState(false);
  const pathname = usePathname();
  const hideMiniCart = pathname === "/cart" || pathname === "/checkout";
  const reduced = useReducedMotionSafe();
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = React.useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 12));
  React.useEffect(() => setScrolled(window.scrollY > 12), []);

  const activeIndex = menu.findIndex((item) => !!item.href && item.href !== "/" && pathname.startsWith(item.href.split("?")[0]!));

  return (
    <>
      <header className="sf-header sticky top-0 z-40" data-scrolled={scrolled || undefined}>
        {/* Surface: fades from a light wash to frosted glass + shadow once the page scrolls (opacity only). */}
        <div aria-hidden className="sf-header-surface absolute inset-0 border-b border-border/60 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/70" />
        <motion.div
          aria-hidden
          className="sf-header-surface absolute inset-0 border-b border-border/80 bg-background/85 shadow-[0_10px_30px_-18px_rgb(0_0_0/0.35)] backdrop-blur-xl backdrop-saturate-150"
          initial={false}
          animate={{ opacity: scrolled ? 1 : 0 }}
          transition={{ duration: reduced ? 0 : 0.25 }}
        />
        <div className={cn("relative mx-auto flex w-full max-w-7xl items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:px-8", variant === "minimal" ? "h-14" : "h-16")}>
          <Button variant="ghost" size="icon" className={cn("-ms-2 rounded-full", variant !== "minimal" && "lg:hidden")} onClick={() => setNavOpen(true)} aria-label={t("nav.menu")} aria-expanded={navOpen}>
            <MenuIcon className="size-5" />
          </Button>
          {variant === "centered" && <SuspendedSearch className="hidden w-full max-w-xs lg:block" expandable />}
          <div className={cn(variant === "centered" && "lg:absolute lg:left-1/2 lg:-translate-x-1/2")}>
            <motion.div initial={false} animate={{ scale: scrolled && !reduced ? 0.93 : 1 }} transition={{ type: "spring", stiffness: 400, damping: 30 }} className={variant === "centered" ? "origin-center" : "origin-left"}>
              <Logo className={variant === "centered" ? "lg:mx-auto" : "me-2"} />
            </motion.div>
          </div>
          {navInBar && (
            <nav aria-label={t("nav.menu")} className="hidden items-center gap-0.5 lg:flex">
              {categories.length > 0 && <MegaMenu categories={categories} featured={featured} />}
              {menu.map((item, i) => (
                <DesktopMenuItem key={i} item={item} active={i === activeIndex} />
              ))}
            </nav>
          )}
          <SuspendedSearch className={cn("ms-auto hidden w-full md:block", variant === "centered" && "lg:hidden", variant === "minimal" && "max-w-sm")} expandable />
          <div className={cn("ms-auto flex items-center gap-0.5 md:ms-1", variant === "centered" && "lg:ms-auto")}>
            <LocaleSwitch className="hidden sm:inline-flex" />
            <ThemeToggle className="hidden sm:flex" />
            <WishlistLink />
            <Link
              href="/account"
              className="relative flex size-10 items-center justify-center rounded-full hover:bg-accent focus-ring"
              aria-label={auth.user?.name ? `${t("nav.account")}: ${auth.user.name}` : t("nav.account")}
            >
              <UserRoundIcon className="size-5" />
              {auth.token && <span aria-hidden className="absolute top-2 right-2 size-2 rounded-full bg-success ring-2 ring-background" />}
            </Link>
            <CartButton asLink={hideMiniCart} />
          </div>
        </div>
        {variant === "centered" && (
          <nav aria-label={t("nav.menu")} className="relative hidden items-center justify-center gap-0.5 pb-2 lg:flex">
            {categories.length > 0 && <MegaMenu categories={categories} featured={featured} />}
            {menu.map((item, i) => (
              <DesktopMenuItem key={i} item={item} active={i === activeIndex} />
            ))}
          </nav>
        )}
        <div className="relative px-4 pb-3 md:hidden">
          <SuspendedSearch />
        </div>
      </header>

      <MobileNav open={navOpen} onOpenChange={setNavOpen} menu={menu} categories={categories} featured={featured} />
      <NavProgress />
      <MiniCart />
    </>
  );
}

function WishlistLink() {
  const { t, auth } = useStore();
  const { count, off } = useWishlist();
  if (!auth.token || off) return null;
  return (
    <Link href="/account?tab=wishlist" className="relative hidden size-10 items-center justify-center rounded-full hover:bg-accent focus-ring sm:flex" aria-label={`${t("nav.wishlist")} (${count})`}>
      <HeartIcon className="size-5" />
      <AnimatePresence>
        {count > 0 && (
          <motion.span
            key="badge"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground px-1 text-[11px] font-bold text-background ring-2 ring-background"
          >
            {count > 99 ? "99+" : count}
          </motion.span>
        )}
      </AnimatePresence>
    </Link>
  );
}

function CartButton({ asLink }: { asLink: boolean }) {
  const { t, cart } = useStore();
  const icon = useAnimationControls();
  const badge = useAnimationControls();
  const reduced = useReducedMotionSafe();

  React.useEffect(() => {
    const bump = () => {
      if (reduced) return;
      void icon.start({ rotate: [0, -14, 10, -6, 0], scale: [1, 1.15, 1], transition: { duration: 0.55 } });
      void badge.start({ scale: [1, 1.45, 0.9, 1], transition: { duration: 0.5, ease: "easeOut" } });
    };
    window.addEventListener(CART_BUMP_EVENT, bump);
    return () => window.removeEventListener(CART_BUMP_EVENT, bump);
  }, [icon, badge, reduced]);

  const cls = "relative flex size-10 items-center justify-center rounded-full hover:bg-accent focus-ring";
  const label = `${t("nav.cart")} (${t("cart.items", { count: cart.count })})`;
  const inner = (
    <>
      <motion.span animate={icon} className="flex" data-cart-icon>
        <ShoppingBagIcon className="size-5" />
      </motion.span>
      <AnimatePresence>
        {cart.count > 0 && (
          <motion.span key="badge" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="absolute -top-0.5 -right-0.5">
            <motion.span
              animate={badge}
              className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground ring-2 ring-background"
              data-testid="cart-count"
            >
              {cart.count > 99 ? "99+" : cart.count}
            </motion.span>
          </motion.span>
        )}
      </AnimatePresence>
    </>
  );
  return asLink ? (
    <Link href="/cart" className={cls} aria-label={label} data-testid="cart-button" data-cart-target>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={() => cart.setMiniOpen(true)} className={cls} aria-label={label} data-testid="cart-button" data-cart-target>
      {inner}
    </button>
  );
}

const menuItemCls = "relative inline-flex h-9 items-center gap-1 rounded-full px-3 whitespace-nowrap text-sm font-medium text-foreground/75 transition-colors hover:text-foreground focus-ring";

function ActiveUnderline() {
  return <motion.span layoutId="nav-underline" className="absolute inset-x-3 -bottom-[14px] h-0.5 rounded-full bg-primary" transition={{ type: "spring", stiffness: 420, damping: 34 }} />;
}

function DesktopMenuItem({ item, active }: { item: MenuItem; active: boolean }) {
  const hover = useHoverIntent();
  const pathname = usePathname();
  React.useEffect(() => hover.setOpen(false), [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  const cls = cn(menuItemCls, active && "text-foreground");
  if (!item.children?.length)
    return item.href ? (
      <NavLink href={item.href} className={cls}>
        {item.label}
        {active && <ActiveUnderline />}
      </NavLink>
    ) : null;
  return (
    <div
      className="relative"
      {...hover.bind}
      onFocus={() => hover.setOpen(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && hover.setOpen(false)}
      onKeyDown={(e) => e.key === "Escape" && hover.setOpen(false)}
    >
      <button type="button" className={cls} aria-expanded={hover.open} aria-haspopup="true" onClick={() => hover.setOpen(!hover.open)}>
        {item.label}
        <ChevronDownIcon className={cn("size-3.5 opacity-60 transition-transform duration-200", hover.open && "rotate-180")} />
        {active && <ActiveUnderline />}
      </button>
      <AnimatePresence>
        {hover.open && (
          <motion.div {...panelMotion} className="absolute top-full left-0 z-50 pt-3">
            <ul className="min-w-56 rounded-2xl border bg-popover p-1.5 shadow-[var(--elevation-2)]">
              {item.href && (
                <li>
                  <NavLink href={item.href} className="flex items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold hover:bg-accent focus-ring">
                    {item.label}
                    <ArrowRightIcon className="size-3.5 opacity-60" />
                  </NavLink>
                </li>
              )}
              {item.children.map((c, i) =>
                c.href ? (
                  <motion.li key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0, transition: { delay: 0.03 * i } }}>
                    <NavLink href={c.href} className="block rounded-xl px-3 py-2 text-sm hover:bg-accent focus-ring">
                      {c.label}
                    </NavLink>
                  </motion.li>
                ) : null,
              )}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Desktop "Shop" mega menu: category tiles with images, a featured collection and quick links. */
function MegaMenu({ categories, featured }: { categories: NavCategory[]; featured: NavCollection | null }) {
  const { t } = useStore();
  const hover = useHoverIntent(110, 180);
  const pathname = usePathname();
  React.useEffect(() => hover.setOpen(false), [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = pathname.startsWith("/c/") || pathname === STORE_PATHS.products;
  const id = React.useId();
  return (
    <div
      {...hover.bind}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && hover.setOpen(false)}
      onKeyDown={(e) => e.key === "Escape" && hover.setOpen(false)}
    >
      <button type="button" className={cn(menuItemCls, (active || hover.open) && "text-foreground")} aria-expanded={hover.open} aria-controls={id} onClick={() => hover.setOpen(!hover.open)} data-testid="mega-trigger">
        <LayoutGridIcon className="size-4 opacity-70" />
        {t("nav.shop")}
        <ChevronDownIcon className={cn("size-3.5 opacity-60 transition-transform duration-200", hover.open && "rotate-180")} />
        {active && <ActiveUnderline />}
      </button>
      <AnimatePresence>
        {hover.open && (
          <motion.div id={id} {...panelMotion} className="absolute inset-x-0 top-full z-50 px-4 pt-0 sm:px-6 lg:px-8" data-testid="mega-menu">
            <div className="mx-auto grid max-w-7xl grid-cols-[1fr_300px] gap-6 overflow-hidden rounded-b-3xl border border-t-0 bg-popover p-6 shadow-[var(--elevation-2)]">
              <div>
                <p className="mb-4 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">{t("nav.categories")}</p>
                <ul className="grid grid-cols-3 gap-3 xl:grid-cols-4">
                  {categories.slice(0, 12).map((c, i) => (
                    <motion.li key={c.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { delay: 0.025 * i, duration: 0.25 } }}>
                      <Link href={STORE_PATHS.category(c.slug)} className="group flex items-center gap-3 rounded-2xl p-2 transition-colors hover:bg-accent focus-ring">
                        <span className="size-14 shrink-0 overflow-hidden rounded-full bg-muted ring-1 ring-black/5 transition-shadow group-hover:ring-4 group-hover:ring-primary/20">
                          <StoreImage src={c.imageUrl} alt="" name={c.name} className="transition-transform duration-500 group-hover:scale-110 motion-reduce:transition-none" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{c.name}</span>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                            {t("list.viewAll")} <ArrowRightIcon className="size-3" />
                          </span>
                        </span>
                      </Link>
                    </motion.li>
                  ))}
                </ul>
                <div className="mt-5 flex flex-wrap gap-2 border-t pt-4">
                  <Link href={STORE_PATHS.products} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-secondary px-4 text-sm font-semibold hover:bg-secondary/70 focus-ring">
                    {t("nav.shopAll")} <ArrowRightIcon className="size-3.5" />
                  </Link>
                  <Link href={`${STORE_PATHS.products}?sort=new`} className="inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-medium hover:bg-accent focus-ring">
                    <SparklesIcon className="size-3.5 text-primary" /> {t("nav.newArrivals")}
                  </Link>
                  <Link href="/track" className="inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-medium hover:bg-accent focus-ring">
                    <PackageSearchIcon className="size-3.5 text-primary" /> {t("nav.track")}
                  </Link>
                </div>
              </div>
              <FeaturedTile featured={featured} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FeaturedTile({ featured }: { featured: NavCollection | null }) {
  const { t } = useStore();
  const href = featured ? STORE_PATHS.collection(featured.slug) : `${STORE_PATHS.products}?sort=new`;
  const img = imageUrl(featured?.imageUrl ?? null);
  return (
    <Link href={href} className="group relative flex min-h-56 flex-col justify-end overflow-hidden rounded-2xl p-5 text-white focus-ring">
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} alt="" className="absolute inset-0 size-full object-cover transition-transform duration-700 group-hover:scale-105" />
      ) : (
        <span aria-hidden className="sf-brand-hero absolute inset-0 transition-transform duration-700 group-hover:scale-105" />
      )}
      <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
      <span className="relative">
        <span className="text-[11px] font-semibold tracking-[0.16em] text-white/80 uppercase">{t("nav.featured")}</span>
        <span className="mt-1 block font-display text-2xl leading-tight font-semibold">{featured?.name ?? t("nav.newArrivals")}</span>
        {featured?.description && <span className="mt-1 line-clamp-2 block text-sm text-white/80">{featured.description}</span>}
        <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold">
          {t("home.shopNow")} <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-1" />
        </span>
      </span>
    </Link>
  );
}

const drawerList: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.035, delayChildren: 0.08 } } };
const drawerItem: Variants = { hidden: { opacity: 0, x: -14 }, show: { opacity: 1, x: 0, transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] as const } } };

function MobileNav({ open, onOpenChange, menu, categories, featured }: { open: boolean; onOpenChange: (o: boolean) => void; menu: MenuItem[]; categories: NavCategory[]; featured: NavCollection | null }) {
  const { t, shell } = useStore();
  const close = () => onOpenChange(false);
  const row = "flex h-12 items-center rounded-xl px-3 text-base font-medium hover:bg-accent focus-ring";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[88vw] max-w-sm gap-0 p-0 data-[state=open]:duration-400 data-[state=open]:ease-[cubic-bezier(0.32,0.72,0,1)]" closeLabel={t("nav.closeMenu")} data-testid="nav-drawer">
        <SheetHeader className="border-b bg-tint-1">
          <SheetTitle asChild>
            <div>
              <Logo />
            </div>
          </SheetTitle>
          <SheetDescription className="sr-only">{t("nav.menu")}</SheetDescription>
        </SheetHeader>
        <nav className="flex-1 overflow-y-auto p-2" aria-label={t("nav.menu")}>
          <motion.ul className="grid gap-0.5" variants={drawerList} initial="hidden" animate="show">
            {categories.length > 0 && (
              <motion.li variants={drawerItem}>
                <Accordion type="single" collapsible defaultValue="cats">
                  <AccordionItem value="cats" className="border-0">
                    <AccordionTrigger className="h-12 items-center rounded-xl px-3 py-0 text-base font-semibold hover:bg-accent hover:no-underline">{t("nav.categories")}</AccordionTrigger>
                    <AccordionContent className="pb-2">
                      <ul className="grid grid-cols-3 gap-2 px-2 pt-1">
                        {categories.map((c) => (
                          <li key={c.id}>
                            <Link href={STORE_PATHS.category(c.slug)} onClick={close} className="group flex flex-col items-center gap-1.5 rounded-xl p-1.5 text-center focus-ring">
                              <span className="size-16 overflow-hidden rounded-full bg-muted ring-1 ring-black/5 transition-shadow group-active:ring-4 group-active:ring-primary/25">
                                <StoreImage src={c.imageUrl} alt="" name={c.name} />
                              </span>
                              <span className="line-clamp-1 text-xs font-semibold">{c.name}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </motion.li>
            )}
            {menu.map((item, i) =>
              item.children?.length ? (
                <motion.li key={i} variants={drawerItem}>
                  <Accordion type="single" collapsible>
                    <AccordionItem value="x" className="border-0">
                      <AccordionTrigger className="h-12 items-center rounded-xl px-3 py-0 text-base font-medium hover:bg-accent hover:no-underline">{item.label}</AccordionTrigger>
                      <AccordionContent className="pb-1">
                        <ul className="ms-3 border-s ps-2">
                          {item.href && (
                            <li>
                              <NavLink href={item.href} onClick={close} className="flex h-10 items-center rounded-lg px-3 text-sm font-semibold hover:bg-accent">
                                {item.label}
                              </NavLink>
                            </li>
                          )}
                          {item.children.map((c, j) =>
                            c.href ? (
                              <li key={j}>
                                <NavLink href={c.href} onClick={close} className="flex h-10 items-center rounded-lg px-3 text-sm text-foreground/80 hover:bg-accent">
                                  {c.label}
                                </NavLink>
                              </li>
                            ) : null,
                          )}
                        </ul>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </motion.li>
              ) : item.href ? (
                <motion.li key={i} variants={drawerItem}>
                  <NavLink href={item.href} onClick={close} className={row}>
                    {item.label}
                  </NavLink>
                </motion.li>
              ) : null,
            )}
            {[
              { href: STORE_PATHS.products, label: t("nav.shopAll") },
              ...(featured ? [{ href: STORE_PATHS.collection(featured.slug), label: featured.name }] : []),
              { href: "/account", label: t("nav.account") },
              { href: "/account?tab=wishlist", label: t("nav.wishlist") },
              { href: "/track", label: t("nav.track") },
              ...(helpCentreOn(shell.features) ? [{ href: "/help", label: t("help.title") }] : []),
            ]
              // Skip links the shop's own menu already has (same target or same name).
              .filter((l) => !menu.some((m) => m.href === l.href || m.label.trim().toLowerCase() === l.label.trim().toLowerCase()))
              .map((l) => (
              <motion.li key={l.href} variants={drawerItem}>
                <Link href={l.href} onClick={close} className={row}>
                  {l.label}
                </Link>
              </motion.li>
            ))}
          </motion.ul>
        </nav>
        <div className="flex items-center justify-between gap-3 border-t p-4">
          <span className="text-sm text-muted-foreground">{t("nav.language")}</span>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <LocaleSwitch className="drawer" />
          </div>
        </div>
        {shell.contactPhone && (
          <a href={`tel:${shell.contactPhone}`} className="border-t px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] text-sm text-muted-foreground">
            {t("footer.contact")}: <span className="font-medium text-foreground">{shell.contactPhone}</span>
          </a>
        )}
      </SheetContent>
    </Sheet>
  );
}

function MiniCart() {
  const { t, cart } = useStore();
  const c = cart.cart;
  const close = () => cart.setMiniOpen(false);
  const goods = c ? c.subtotal - c.discount : 0;
  return (
    <Sheet open={cart.miniOpen} onOpenChange={cart.setMiniOpen}>
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 data-[state=closed]:duration-250 data-[state=open]:duration-500 data-[state=open]:ease-[cubic-bezier(0.32,0.72,0,1)] sm:max-w-md"
        closeLabel={t("common.close")}
        data-testid="mini-cart"
      >
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2 font-display text-xl">
            {t("cart.title")}
            {c && c.itemCount > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 font-sans text-xs font-semibold text-primary">{t("cart.items", { count: c.itemCount })}</span>
            )}
          </SheetTitle>
          <SheetDescription className="sr-only">{t("cart.title")}</SheetDescription>
        </SheetHeader>
        {!c || c.lines.length === 0 ? (
          <div className="flex flex-1 items-center p-6">
            <Empty
              className="w-full border-0 bg-transparent"
              illustration={<EmptyBagArt />}
              title={t("cart.empty")}
              body={t("cart.emptyHint")}
              action={
                <Button asChild onClick={close} className="rounded-full px-6">
                  <Link href={STORE_PATHS.products}>{t("cart.startShopping")}</Link>
                </Button>
              }
            />
          </div>
        ) : (
          <>
            <FreeShippingMeter cart={c} className="border-b px-4 py-3" />
            <ul className="flex-1 divide-y overflow-x-hidden overflow-y-auto px-4">
              <AnimatePresence initial={true} mode="popLayout">
                {c.lines.map((l, i) => (
                  <CartLineRow key={l.variantId} line={l} compact onNavigate={close} index={i} />
                ))}
              </AnimatePresence>
            </ul>
            <div className="grid gap-3 border-t bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t("cart.subtotal")}</span>
                <AnimatedNumber value={goods} format={(n) => money(Math.round(n))} className="sf-price text-lg font-bold" />
              </div>
              <p className="-mt-2 text-xs text-muted-foreground">
                {t("cart.shipping")}: {t("cart.shippingAtCheckout")}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button asChild variant="outline" size="lg" className="h-12 rounded-full" onClick={close}>
                  <Link href="/cart">{t("cart.viewCart")}</Link>
                </Button>
                <Button asChild size="lg" className="h-12 rounded-full" onClick={close}>
                  <Link href="/checkout" data-testid="mini-checkout">
                    {t("cart.checkout")}
                  </Link>
                </Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
