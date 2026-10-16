"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MenuIcon, MoonIcon, SunIcon, ArrowRightIcon } from "lucide-react";
import { Button } from "@srirealtime/ui/components/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@srirealtime/ui/components/sheet";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "@srirealtime/ui/motion";
import { cn } from "@srirealtime/ui/lib/utils";
import type { Locale } from "@srirealtime/i18n/client";
import { useSite } from "./site-context";
import { Logo } from "./logo";

const NAV = [
  { href: "/billing", key: "nav.billing" },
  { href: "/online-store", key: "nav.onlineStore" },
  { href: "/pricing", key: "nav.pricing" },
] as const;

export function LocaleSwitch({ className, id = "h" }: { className?: string; id?: string }) {
  const { locale, setLocale, t } = useSite();
  const opts: { l: Locale; label: string }[] = [
    { l: "en", label: "EN" },
    { l: "ta", label: "தமிழ்" },
  ];
  return (
    <div className={cn("relative inline-flex items-center rounded-full border bg-card p-0.5 text-xs", className)} role="group" aria-label={t("nav.language")} data-testid="locale-switch">
      {opts.map((o) => (
        <button
          key={o.l}
          type="button"
          lang={o.l}
          aria-pressed={locale === o.l}
          onClick={() => locale !== o.l && setLocale(o.l)}
          className={cn("relative h-8 rounded-full px-3 font-semibold transition-colors focus-ring", locale === o.l ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {locale === o.l && <motion.span layoutId={`locale-pill-${id}`} className="absolute inset-0 rounded-full bg-primary" transition={{ type: "spring", stiffness: 500, damping: 35 }} />}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

const THEME_KEY = "sr_theme";

/** Applies the saved (or system) theme before first paint. */
export const THEME_SCRIPT = `try{var s=localStorage.getItem("${THEME_KEY}");if(s==="dark"||(!s&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`;

export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useSite();
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
  const label = dark ? t("nav.lightMode") : t("nav.darkMode");
  return (
    <Button type="button" variant="ghost" size="icon" onClick={toggle} aria-pressed={dark} aria-label={label} title={label} className={cn("relative overflow-hidden rounded-full", className)} data-testid="theme-toggle">
      <AnimatePresence initial={false} mode="wait">
        <motion.span key={dark ? "moon" : "sun"} initial={{ y: 14, opacity: 0, rotate: -45 }} animate={{ y: 0, opacity: 1, rotate: 0 }} exit={{ y: -14, opacity: 0, rotate: 45 }} transition={{ duration: 0.2 }} className="flex">
          {dark ? <MoonIcon className="size-5" /> : <SunIcon className="size-5" />}
        </motion.span>
      </AnimatePresence>
    </Button>
  );
}

export function SiteHeader() {
  const { t } = useSite();
  const pathname = usePathname();
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 8));
  React.useEffect(() => setOpen(false), [pathname]);
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className={cn("sticky top-0 z-40 border-b border-transparent transition-[background-color,border-color,box-shadow] duration-300", scrolled ? "border-border/70 bg-background/80 shadow-sm backdrop-blur-xl" : "bg-background/40 backdrop-blur-sm")}>
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="rounded-lg focus-ring" aria-label="Srirealtime">
          <Logo />
        </Link>

        <nav className="ml-6 hidden items-center gap-1 lg:flex" aria-label={t("nav.products")}>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={cn("relative rounded-full px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-colors focus-ring", active(n.href) ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {active(n.href) && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-full bg-accent" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              <span className="relative">{t(n.key)}</span>
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <LocaleSwitch className="hidden sm:inline-flex" />
          <ThemeToggle />
          <Button asChild variant="ghost" className="hidden lg:inline-flex">
            <Link href="/login">{t("nav.login")}</Link>
          </Button>
          <Button asChild className="group hidden rounded-full sm:inline-flex" data-testid="header-trial">
            <Link href="/signup">
              {t("nav.startTrial")}
              <ArrowRightIcon className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          </Button>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full lg:hidden" aria-label={t("nav.menu")}>
                <MenuIcon className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[min(88vw,22rem)] p-0">
              <SheetTitle className="sr-only">{t("nav.menu")}</SheetTitle>
              <div className="flex h-full flex-col gap-6 p-6 pt-14">
                <nav className="grid gap-1">
                  {[{ href: "/", key: "nav.home" }, ...NAV, { href: "/login", key: "nav.login" }].map((n, i) => (
                    <motion.div key={n.href} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 + i * 0.04, duration: 0.3 }}>
                      <Link href={n.href} className={cn("block rounded-xl px-4 py-3 text-base font-medium focus-ring", (n.href === "/" ? pathname === "/" : active(n.href)) ? "bg-accent" : "hover:bg-accent/60")}>
                        {t(n.key)}
                      </Link>
                    </motion.div>
                  ))}
                </nav>
                <LocaleSwitch id="sheet" className="self-start" />
                <Button asChild size="lg" className="mt-auto rounded-full">
                  <Link href="/signup">{t("cta.trial")}</Link>
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
