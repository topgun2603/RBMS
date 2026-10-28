"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowRightIcon, ChevronDownIcon, HeartIcon, LayoutGridIcon, MenuIcon, MoonIcon, PackageSearchIcon, SearchIcon, ShoppingBagIcon, SparklesIcon, SunIcon, UserRoundIcon } from "lucide-react";
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
import { MiniCartRecommendations } from "./recommend";
import { GiftPrompt, OfferNudges } from "./offers";
import { goodsTotal } from "../lib/offers";
import { useStore } from "./store-context";
import { useWishlist } from "./wishlist";
import { track } from "./analytics";
import { helpCentreOn } from "../lib/features";
import { navFitCount, navLeadFolds, overflowLinks } from "../lib/nav-fit";
import { siteCta, siteOnly } from "../lib/site";

export interface NavCategory {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  /** Sub-categories (the mega menu lists them under their parent). */
  children?: { id: string; name: string; slug: string }[];
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

export function Logo({ className, compact, wrap }: { className?: string; compact?: boolean; /** Long names take two lines instead of an ellipsis (the sidebar page layout's narrow menu). */ wrap?: boolean }) {
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
          <span className={cn(wrap ? "line-clamp-2 leading-tight [overflow-wrap:anywhere]" : "truncate", "font-display text-lg font-semibold tracking-tight", compact && "max-sm:sr-only")}>{shell.name}</span>
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

/** The shop's own scheme: StoreLayout marks .sf-root (React-rendered, so it survives a client re-render of <html>). */
const darkShop = () => document.querySelector(".sf-root")?.getAttribute("data-sf-scheme") === "dark";

/** Puts the page in light or dark (`sf-light` = a dark shop shown light; see lib/scheme). */
function applyScheme(dark: boolean) {
  const d = document.documentElement;
  d.classList.toggle("dark", dark);
  d.classList.toggle("sf-light", !dark && darkShop());
}

/** The saved choice, else the shop's own scheme (what the inline head script applied). */
function savedDark(): boolean {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch {
    /* ignore */
  }
  return saved === "dark" || saved === "light" ? saved === "dark" : darkShop();
}

/** Light / dark switch (the choice is applied before paint by the inline script in StoreLayout). */
export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useStore();
  const [dark, setDark] = React.useState(false);
  React.useEffect(() => {
    // Re-applied on mount too: a client re-render of the root layout resets <html>'s classes to the server's.
    const d = savedDark();
    applyScheme(d);
    setDark(d);
  }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    applyScheme(next);
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

/**
 * Inline script for a light shop: applies the saved theme before first paint. StoreLayout uses lib/scheme
 * `themeScript`, which also knows a dark shop's default.
 */
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
  const { shell } = useStore();
  if (siteOnly(shell.businessType)) return null;
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

/**
 * Store header. Theme `header`: classic (menu in the bar) · centered (logo centred, menu row below) · minimal (drawer
 * only) · bold (brand bar) · split (menu left, logo centred, icons right). `headerStyle`: glass · solid · transparent
 * (over a full-width home banner while at the top; `overlayHero` says the home page starts with one). `sticky`:
 * always · scroll-up (slides away while scrolling down) · never. `megaMenu`: images · columns · off.
 */
export function StoreHeader({
  menu,
  categories = [],
  featured = null,
  overlayHero = false,
}: {
  menu: MenuItem[];
  categories?: NavCategory[];
  featured?: NavCollection | null;
  overlayHero?: boolean;
}) {
  const { t, auth, shell, locale } = useStore();
  const { header: variant, headerStyle, sticky, megaMenu } = shell.theme;
  const site = siteOnly(shell.businessType);
  const cta = siteCta(shell.businessType, locale);
  const navInBar = variant === "classic" || variant === "bold";
  const [navOpen, setNavOpen] = React.useState(false);
  const pathname = usePathname();
  const hideMiniCart = pathname === "/cart" || pathname === "/checkout";
  const reduced = useReducedMotionSafe();
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = React.useState(false);
  const [away, setAway] = React.useState(false);
  const lastY = React.useRef(0);
  useMotionValueEvent(scrollY, "change", (y) => {
    setScrolled(y > 12);
    if (sticky !== "scroll-up") return;
    const d = y - lastY.current;
    if (Math.abs(d) < 8) return;
    setAway(d > 0 && y > 160);
    lastY.current = y;
  });
  React.useEffect(() => setScrolled(window.scrollY > 12), []);
  // Over the home banner the bar overlaps it (styles.css pulls the page up by the bar's height) and stays clear until scrolled.
  const overlay = headerStyle === "transparent" && overlayHero && pathname === "/";
  const clear = overlay && !scrolled;
  const hidden = away && !navOpen;

  const activeIndex = menu.findIndex((item) => !!item.href && item.href !== "/" && pathname.startsWith(item.href.split("?")[0]!));
  const shop = !site && categories.length > 0 && megaMenu !== "off" ?<MegaMenu categories={categories} featured={featured} layout={megaMenu} /> : null;
  const icons = site ? (
    <>
      <LocaleSwitch className="hidden sm:inline-flex" />
      <ThemeToggle className="hidden sm:flex" />
      {cta && (
        <Link
          href={cta.href}
          // Phones: the name keeps the bar (the hero and the menu carry the same link).
          className="sf-btn ms-1 hidden h-10 max-w-[44vw] items-center justify-center bg-primary px-4 sm:inline-flex text-sm font-semibold text-primary-foreground shadow-sm transition-[filter] hover:brightness-110 focus-ring"
          data-testid="site-cta"
        >
          <span className="truncate">{cta.label}</span>
        </Link>
      )}
    </>
  ) : (
    <>
      {overlay && (
        <Link href={STORE_PATHS.search} className="flex size-10 items-center justify-center rounded-full hover:bg-accent focus-ring md:hidden" aria-label={t("nav.search")}>
          <SearchIcon className="size-5" />
        </Link>
      )}
      <LocaleSwitch className="hidden sm:inline-flex" />
      <ThemeToggle className="hidden sm:flex" />
      <WishlistLink />
      <Link
        href="/account"
        // Split bar on small phones: the account link lives in the drawer, so the centred name has room.
        className={cn("relative flex size-10 items-center justify-center rounded-full hover:bg-accent focus-ring", variant === "split" && "max-sm:hidden")}
        aria-label={auth.user?.name ? `${t("nav.account")}: ${auth.user.name}` : t("nav.account")}
      >
        <UserRoundIcon className="size-5" />
        {auth.token && <span aria-hidden className="absolute top-2 right-2 size-2 rounded-full bg-success ring-2 ring-background" />}
      </Link>
      <CartButton asLink={hideMiniCart} />
    </>
  );
  const burger = (
    <Button variant="ghost" size="icon" className={cn("-ms-2 rounded-full", variant !== "minimal" && "lg:hidden")} onClick={() => setNavOpen(true)} aria-label={t("nav.menu")} aria-expanded={navOpen}>
      <MenuIcon className="size-5" />
    </Button>
  );

  return (
    <>
      <motion.header
        className={cn("sf-header z-40", sticky === "never" ? "relative" : "sticky top-0")}
        data-scrolled={scrolled || undefined}
        data-overlay={overlay || undefined}
        data-clear={clear || undefined}
        initial={false}
        animate={{ y: hidden ? "-100%" : "0%" }}
        transition={{ duration: reduced ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Surface: fades from a light wash to frosted glass + shadow once the page scrolls (opacity only). */}
        <div aria-hidden className="sf-header-surface absolute inset-0 border-b border-border/60 bg-background/80 backdrop-blur-md transition-opacity duration-300 supports-[backdrop-filter]:bg-background/70" />
        <motion.div
          aria-hidden
          className="sf-header-surface sf-header-raised absolute inset-0 border-b border-border/80 bg-background/85 shadow-[0_10px_30px_-18px_rgb(0_0_0/0.35)] backdrop-blur-xl backdrop-saturate-150"
          initial={false}
          animate={{ opacity: scrolled ? 1 : 0 }}
          transition={{ duration: reduced ? 0 : 0.25 }}
        />
        {/* Over a photo: a soft shade at the top keeps the white menu readable. */}
        {overlay && <div aria-hidden className="sf-header-shade pointer-events-none absolute inset-x-0 top-0 h-[150%] bg-gradient-to-b from-black/45 to-transparent transition-opacity duration-300" />}
        {variant === "split" ? (
          <div className="relative mx-auto grid h-16 w-full max-w-7xl grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center">
              {burger}
              {/* Split: the menu gets its third of the bar; what doesn't fit goes under "More" (never under the logo). */}
              <OverflowNav lead={shop} menu={menu} activeIndex={activeIndex} label={t("nav.menu")} className="-ms-3 hidden flex-1 lg:flex" />
            </div>
            <div className="max-w-[62vw] min-w-0 lg:max-w-xs">
              <Logo className="mx-auto" />
            </div>
            <div className="flex min-w-0 items-center justify-end gap-0.5">
              <SuspendedSearch className="hidden w-full max-w-[13rem] md:block" expandable />
              {icons}
            </div>
          </div>
        ) : (
          <div className={cn("relative mx-auto flex w-full max-w-7xl items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:px-8", variant === "minimal" ? "h-14" : "h-16")}>
            {burger}
            {variant === "centered" && <SuspendedSearch className="hidden w-full max-w-xs lg:block" expandable />}
            <div className={cn("min-w-0", variant === "centered" && "lg:absolute lg:left-1/2 lg:-translate-x-1/2")}>
              <motion.div initial={false} animate={{ scale: scrolled && !reduced ? 0.93 : 1 }} transition={{ type: "spring", stiffness: 400, damping: 30 }} className={variant === "centered" ? "origin-center" : "origin-left"}>
                <Logo className={variant === "centered" ? "lg:mx-auto" : "me-2"} />
              </motion.div>
            </div>
            {navInBar && <OverflowNav lead={shop} menu={menu} activeIndex={activeIndex} label={t("nav.menu")} className="hidden flex-1 lg:flex" />}
            <SuspendedSearch
              className={cn("ms-auto hidden w-full md:block", variant === "centered" && "lg:hidden", variant === "minimal" && "max-w-sm", navInBar && "lg:w-56 lg:shrink-0 xl:w-72")}
              expandable
            />
            <div className={cn("ms-auto flex items-center gap-0.5 md:ms-1", variant === "centered" && "lg:ms-auto")}>{icons}</div>
          </div>
        )}
        {variant === "centered" && (
          <div className="relative hidden h-11 items-start justify-center lg:flex">
            <OverflowNav lead={shop} menu={menu} activeIndex={activeIndex} label={t("nav.menu")} className="w-full max-w-7xl justify-center px-4 sm:px-6 lg:px-8" />
          </div>
        )}
        {/* Phones: a search row under the bar (over the banner the search icon is used instead, so the bar keeps one height). */}
        {!overlay && !site && (
          <div className="relative px-4 pb-3 md:hidden">
            <SuspendedSearch />
          </div>
        )}
      </motion.header>

      <MobileNav open={navOpen} onOpenChange={setNavOpen} menu={menu} categories={categories} featured={featured} />
      <NavProgress />
      {!site && <MiniCart />}
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

/**
 * The desktop menu row, never wider than its box: items that don't fit move into a "More" dropdown (measured with a
 * ResizeObserver against an invisible copy of the labels, so it follows the window and the font). Until measured
 * (server HTML, first paint) the row is clipped instead of running under the logo. `className` must give the box a
 * width that doesn't depend on its content (a grid column, or flex-1 + min-w-0).
 */
function OverflowNav({ lead, menu, activeIndex, className, label }: { lead: React.ReactNode; menu: MenuItem[]; activeIndex: number; className?: string; label: string }) {
  const { t } = useStore();
  const box = React.useRef<HTMLElement>(null);
  const leadRef = React.useRef<HTMLDivElement>(null);
  const ruler = React.useRef<HTMLDivElement>(null);
  const [count, setCount] = React.useState<number | null>(null);
  // The lead ("Shop" mega menu) folds into "More" too when even the lead and "More" don't fit beside the search box
  // (long Tamil labels at 1024 px); its last measured width is kept so the check works while it is hidden.
  const [foldLead, setFoldLead] = React.useState(false);
  const leadWidth = React.useRef(0);
  const items = menu.filter((m) => m.href || m.children?.length);
  React.useEffect(() => {
    const el = box.current;
    const r = ruler.current;
    if (!el || !r || typeof ResizeObserver === "undefined") return setCount(items.length);
    const fit = () => {
      const widths = [...r.querySelectorAll<HTMLElement>("[data-measure-item]")].map((x) => x.offsetWidth);
      const more = r.querySelector<HTMLElement>("[data-measure-more]")?.offsetWidth ?? 80;
      const cs = getComputedStyle(el);
      const available = el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      if (leadRef.current?.offsetWidth) leadWidth.current = leadRef.current.offsetWidth;
      const fold = navLeadFolds(available, leadWidth.current, widths, more, 2);
      const next = navFitCount(available, fold ? 0 : leadWidth.current, widths, more, 2);
      setFoldLead((f) => (f === fold ? f : fold));
      setCount((c) => (c === next ? c : next));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    ro.observe(r);
    return () => ro.disconnect();
  }, [items.length]);
  const shown = count === null ? items : items.slice(0, count);
  const hidden = count === null ? [] : items.slice(count);
  const folded = !!lead && foldLead && count !== null;
  const moreLinks = [...(folded ? [{ label: t("nav.shop"), type: "url", href: STORE_PATHS.search }] : []), ...overflowLinks(hidden)];
  return (
    <nav ref={box} aria-label={label} className={cn("flex min-w-0 items-center gap-0.5", count === null && "overflow-x-clip", className)} data-nav-fit={count === null ? "pending" : hidden.length || folded ? "more" : "all"}>
      {lead && <div ref={leadRef} className={cn("flex shrink-0", folded && "hidden")}>{lead}</div>}
      {shown.map((item, i) => (
        <DesktopMenuItem key={i} item={item} active={menu.indexOf(item) === activeIndex} />
      ))}
      {moreLinks.length > 0 && <DesktopMenuItem item={{ label: t("footer.more"), type: "url", href: null, children: moreLinks }} active={hidden.some((m) => menu.indexOf(m) === activeIndex)} />}
      {/* The ruler: every label at full width, invisible and out of the flow (positioned by the bar, not this box, so
          the mega menu keeps the bar's full width). */}
      <div ref={ruler} aria-hidden className="pointer-events-none invisible absolute start-0 top-0 flex w-max gap-0.5" inert>
        {items.map((item, i) => (
          <span key={i} className={cn(menuItemCls, "shrink-0")} data-measure-item>
            {item.label}
            {item.children?.length ? <ChevronDownIcon className="size-3.5" /> : null}
          </span>
        ))}
        <span className={cn(menuItemCls, "shrink-0")} data-measure-more>
          {t("footer.more")}
          <ChevronDownIcon className="size-3.5" />
        </span>
      </div>
    </nav>
  );
}

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
          <motion.div {...panelMotion} className="sf-pop absolute start-0 top-full z-50 pt-3 text-popover-foreground">
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

/**
 * Desktop "Shop" mega menu: category tiles with images (or columns of categories with their sub-categories), a
 * featured collection and quick links. Keyboard: Enter / Space / ↓ opens it (↓ moves into the panel), Esc closes it
 * and returns to the button, tabbing out closes it.
 */
function MegaMenu({ categories, featured, layout = "images" }: { categories: NavCategory[]; featured: NavCollection | null; layout?: "images" | "columns" }) {
  const { t } = useStore();
  const hover = useHoverIntent(110, 180);
  const pathname = usePathname();
  React.useEffect(() => hover.setOpen(false), [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = pathname.startsWith("/c/") || pathname === STORE_PATHS.products;
  const id = React.useId();
  const trigger = React.useRef<HTMLButtonElement>(null);
  const panel = React.useRef<HTMLDivElement>(null);
  const focusFirst = () => requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>("a[href]")?.focus());
  return (
    <div
      {...hover.bind}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && hover.setOpen(false)}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !hover.open) return;
        e.stopPropagation();
        hover.setOpen(false);
        trigger.current?.focus();
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={cn(menuItemCls, (active || hover.open) && "text-foreground")}
        aria-expanded={hover.open}
        aria-controls={id}
        onClick={() => hover.setOpen(!hover.open)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown") return;
          e.preventDefault();
          hover.setOpen(true);
          focusFirst();
        }}
        data-testid="mega-trigger"
      >
        <LayoutGridIcon className="size-4 opacity-70" />
        {t("nav.shop")}
        <ChevronDownIcon className={cn("size-3.5 opacity-60 transition-transform duration-200", hover.open && "rotate-180")} />
        {active && <ActiveUnderline />}
      </button>
      <AnimatePresence>
        {hover.open && (
          <motion.div ref={panel} id={id} {...panelMotion} className="sf-mega sf-pop absolute inset-x-0 top-full z-50 px-4 pt-0 text-popover-foreground sm:px-6 lg:px-8" data-testid="mega-menu" data-layout={layout}>
            <div className="mx-auto grid max-h-[calc(100dvh-7rem)] max-w-7xl grid-cols-[1fr_300px] gap-6 overflow-y-auto overscroll-contain rounded-b-3xl border border-t-0 bg-popover p-6 shadow-[var(--elevation-2)]">
              <div>
                <p className="mb-4 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">{t("nav.categories")}</p>
                {layout === "columns" ? (
                  <ul className="grid grid-cols-3 gap-x-6 gap-y-6 xl:grid-cols-4">
                    {categories.slice(0, 12).map((c, i) => (
                      <motion.li key={c.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { delay: 0.025 * i, duration: 0.25 } }} className="min-w-0">
                        <Link href={STORE_PATHS.category(c.slug)} className="group flex items-center gap-1.5 rounded-md text-sm font-semibold hover:text-primary focus-ring">
                          <span className="truncate">{c.name}</span>
                          <ArrowRightIcon className="size-3.5 shrink-0 opacity-0 transition-[opacity,transform] group-hover:translate-x-0.5 group-hover:opacity-70 rtl:rotate-180" />
                        </Link>
                        {!!c.children?.length && (
                          <ul className="mt-2 grid gap-1.5 border-s ps-3">
                            {c.children.slice(0, 6).map((ch) => (
                              <li key={ch.id}>
                                <Link href={STORE_PATHS.category(ch.slug)} className="block truncate rounded-sm text-sm text-foreground/70 hover:text-foreground focus-ring">
                                  {ch.name}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </motion.li>
                    ))}
                  </ul>
                ) : (
                  <ul className="grid grid-cols-3 gap-3 xl:grid-cols-4">
                    {categories.slice(0, 12).map((c, i) => (
                      <motion.li key={c.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { delay: 0.025 * i, duration: 0.25 } }} className="min-w-0">
                        <Link href={STORE_PATHS.category(c.slug)} className="group flex items-center gap-3 rounded-2xl p-2 transition-colors hover:bg-accent focus-ring">
                          <span className="size-14 shrink-0 overflow-hidden rounded-full bg-muted ring-1 ring-black/5 transition-shadow group-hover:ring-4 group-hover:ring-primary/20">
                            <StoreImage src={c.imageUrl} alt="" name={c.name} className="transition-transform duration-500 group-hover:scale-110 motion-reduce:transition-none" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">{c.name}</span>
                            <span className="flex items-center gap-1 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                              {t("list.viewAll")} <ArrowRightIcon className="size-3 rtl:rotate-180" />
                            </span>
                          </span>
                        </Link>
                        {!!c.children?.length && (
                          <p className="ms-[4.75rem] -mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs">
                            {c.children.slice(0, 3).map((ch) => (
                              <Link key={ch.id} href={STORE_PATHS.category(ch.slug)} className="rounded-sm text-muted-foreground hover:text-foreground focus-ring">
                                {ch.name}
                              </Link>
                            ))}
                          </p>
                        )}
                      </motion.li>
                    ))}
                  </ul>
                )}
                <div className="mt-5 flex flex-wrap gap-2 border-t pt-4">
                  <Link href={STORE_PATHS.products} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-secondary px-4 text-sm font-semibold text-secondary-foreground hover:bg-secondary/70 focus-ring">
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
  // "columns" menu: category rows with their sub-categories as accordions (else the picture grid).
  const asList = shell.theme.megaMenu === "columns";
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
                      {asList ? (
                        <ul className="ms-3 grid gap-0.5 border-s ps-2">
                          {categories.map((c) =>
                            c.children?.length ? (
                              <li key={c.id}>
                                <Accordion type="single" collapsible>
                                  <AccordionItem value={c.id} className="border-0">
                                    <AccordionTrigger className="h-11 items-center rounded-lg px-3 py-0 text-sm font-semibold hover:bg-accent hover:no-underline">{c.name}</AccordionTrigger>
                                    <AccordionContent className="pb-1">
                                      <ul className="ms-3 border-s ps-2">
                                        {[{ id: c.id, name: t("list.viewAll"), slug: c.slug }, ...c.children].map((ch) => (
                                          <li key={ch.id}>
                                            <Link href={STORE_PATHS.category(ch.slug)} onClick={close} className="flex h-10 items-center rounded-lg px-3 text-sm text-foreground/80 hover:bg-accent focus-ring">
                                              {ch.name}
                                            </Link>
                                          </li>
                                        ))}
                                      </ul>
                                    </AccordionContent>
                                  </AccordionItem>
                                </Accordion>
                              </li>
                            ) : (
                              <li key={c.id}>
                                <Link href={STORE_PATHS.category(c.slug)} onClick={close} className="flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold hover:bg-accent focus-ring">
                                  <span className="size-7 shrink-0 overflow-hidden rounded-full bg-muted">
                                    <StoreImage src={c.imageUrl} alt="" name={c.name} />
                                  </span>
                                  <span className="truncate">{c.name}</span>
                                </Link>
                              </li>
                            ),
                          )}
                        </ul>
                      ) : (
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
                      )}
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
              // A website-only shop (school) keeps just the help centre: no shop, account or order links.
              ...(siteOnly(shell.businessType)
                ? []
                : [
                    { href: STORE_PATHS.products, label: t("nav.shopAll") },
                    ...(featured ? [{ href: STORE_PATHS.collection(featured.slug), label: featured.name }] : []),
                    { href: "/account", label: t("nav.account") },
                    { href: "/account?tab=wishlist", label: t("nav.wishlist") },
                    { href: "/track", label: t("nav.track") },
                  ]),
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
  const goods = c ? goodsTotal(c) : 0;
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
            {((c.nudges?.length ?? 0) > 0 || (c.gifts ?? []).some((g) => g.unlocked && !g.inCart)) && (
              <div className="grid gap-2 border-b px-4 py-3 empty:hidden">
                <GiftPrompt cart={c} />
                <OfferNudges cart={c} limit={1} compact skipStoreWide onNavigate={close} />
              </div>
            )}
            <ul className="flex-1 divide-y overflow-x-hidden overflow-y-auto px-4">
              <AnimatePresence initial={true} mode="popLayout">
                {c.lines.map((l, i) => (
                  <CartLineRow key={l.variantId} line={l} compact onNavigate={close} index={i} />
                ))}
              </AnimatePresence>
            </ul>
            <MiniCartRecommendations onNavigate={close} />
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
