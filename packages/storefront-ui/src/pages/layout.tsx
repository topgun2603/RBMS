import * as React from "react";
import type { Metadata, Viewport } from "next";
import { localizeSections } from "@srirealtime/cms/localize";
import { apiGetSafe, getBranding, getConfig, getMenus, getRequestInfo, getShell, getStoreT, storeCss } from "../server/api";
import { helpCentreOn } from "../lib/features";
import { imageUrl } from "../lib/format";
import type { Collection, HomeSection, List, StoreConfig, StoreThemeView } from "../types";
import { navCategories, opensWithFullBleedHero } from "../lib/chrome";
import type { Translator } from "../lib/messages";
import { trustAnnouncements } from "../lib/trust";
import { StoreProvider } from "../client/store-context";
import { PageViewTracker, StoreHeader, type NavCollection } from "../client/header";
import { alternateSchemeCss, isDarkShop, themeScript, type SchemeTokens } from "../lib/scheme";
import { AnnouncementBar, type Announcement } from "../client/announcement";
import { FloatingActions } from "../client/floating";
import { CompareTray } from "../client/compare";
import { CategoryRail, SideNav, TabBar } from "../client/page-shell";
import { StorePageTransition } from "../client/page-transition";
import { StoreFooter } from "../components/footer";
import { getCategories } from "./listing";
import { getHome } from "./home";
import { PreviewMount } from "./preview";
import { PwaClient } from "../client/pwa";
import { brandColors, PWA_EARLY_SCRIPT, PWA_ICON_BASE } from "../lib/pwa";

/** Root metadata: title template with the shop name, favicon, metadataBase for absolute OG URLs. */
export async function storeRootMetadata(): Promise<Metadata> {
  const [info, config, branding] = await Promise.all([getRequestInfo(), getConfig().catch(() => null), getBranding()]);
  const name = config?.shop.name ?? "Store";
  const icon = imageUrl(branding?.faviconUrl ?? null);
  return {
    metadataBase: new URL(info.baseUrl),
    title: { default: name, template: `%s | ${name}` },
    applicationName: name,
    icons: { icon: icon ?? "/favicon.svg", apple: `${PWA_ICON_BASE}/apple-touch-icon.png` },
    formatDetection: { telephone: false },
    // Installable storefront: the shop's own manifest (server/pwa) and its iOS home-screen title.
    ...(config ? { manifest: "/manifest.webmanifest", appleWebApp: { capable: true, title: name, statusBarStyle: "default" as const } } : {}),
  };
}

/** Root viewport: the browser / installed-app bar in the shop's brand primary (the manifest's theme_color). */
export async function storeViewport(): Promise<Viewport> {
  const branding = await getBranding();
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: brandColors(branding?.tokens).primary,
  };
}

/** Ribbon messages from what the shop already published (home USPs) and its settings — never invented offers. */
function announcements(sections: HomeSection[], config: StoreConfig, t: Translator, locale: string): Announcement[] {
  const out: Announcement[] = [];
  for (const s of sections) if (s.type === "usp") for (const it of s.items) out.push({ text: it.text ? `${it.title} · ${it.text}` : it.title });
  // No USPs: what the shop's settings and trade back up (lib/trust.ts), e.g. "Pay on confirmation" for crackers.
  if (!out.length) out.push(...trustAnnouncements(config, t, locale));
  return out.slice(0, 5);
}

/** `data-sf-*` attributes the theme CSS keys on (styles.css → "Theme variants"). */
function themeAttributes(theme: StoreThemeView): Record<string, string> {
  return Object.fromEntries(Object.entries(theme).map(([k, v]) => [`data-sf-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, v]));
}

/** One Google Fonts stylesheet for the shop's families (every family used here has 400 and 700). */
function fontsHref(fonts: string[] | undefined): string | null {
  const families = [...new Set((fonts ?? []).filter((f) => /^[A-Za-z0-9 -]{1,64}$/.test(f) && !/^(system-ui|sans-serif|serif)$/i.test(f)))];
  if (!families.length) return null;
  return `https://fonts.googleapis.com/css2?${families.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;700`).join("&")}&display=swap`;
}

/**
 * Everything around a store page: branding CSS (server-injected), providers, offer ribbon, header (mega menu),
 * closed banner, footer, floating WhatsApp / back-to-top. Unknown hosts get a "store not found" screen (404 semantics
 * are handled by the pages via notFound()).
 */
export async function StoreLayout({ children }: { children: React.ReactNode }) {
  const info = await getRequestInfo();
  const config = await getConfig().catch(() => null);
  // No shop on this host: pages call requireStore() → notFound() → StoreNotFound renders "store not found" (HTTP 404).
  if (!config) return <main className="flex min-h-dvh items-center justify-center p-6">{children}</main>;
  const [branding, menus, cats, cols, home] = await Promise.all([
    getBranding(),
    getMenus(),
    getCategories(),
    apiGetSafe<List<Collection>>("/catalog/public/collections", { items: [], total: 0 }, { revalidate: 120 }),
    getHome(),
  ]);
  const shell = await getShell(config, branding);
  const schemeTokens = (branding?.tokens ?? null) as SchemeTokens | null;
  const darkShop = isDarkShop(schemeTokens);
  const t = await getStoreT();
  const fonts = fontsHref(config.shop.fonts);
  const categories = navCategories(cats.items);
  const f = cols.items[0];
  const featured: NavCollection | null = f ? { name: f.name, slug: f.slug, description: f.description, imageUrl: f.imageUrl } : null;
  return (
    <>
      {/* Saved light/dark choice, applied before first paint. */}
      <script dangerouslySetInnerHTML={{ __html: themeScript(darkShop) }} />
      {/* Keeps an early beforeinstallprompt for the install banner (client/pwa). */}
      <script dangerouslySetInnerHTML={{ __html: PWA_EARLY_SCRIPT }} />
      {/* Tenant branding overrides --primary, --radius, fonts … (unlayered, so it beats the design-system defaults). */}
      <style id="sr-branding" dangerouslySetInnerHTML={{ __html: storeCss(config.shop.css || branding?.css) }} />
      {/* The shop's other scheme for the light / dark switch, derived from its brand colours (lib/scheme). */}
      <style id="sr-scheme" dangerouslySetInnerHTML={{ __html: alternateSchemeCss(schemeTokens) }} />
      {fonts && (
        <>
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link rel="stylesheet" href={fonts} />
        </>
      )}
      <StoreProvider shell={shell} locale={info.locale}>
        <div id="top" className="sf-root" data-sf-scheme={darkShop ? "dark" : "light"} {...themeAttributes(shell.theme)} data-sf-brand-fonts={(config.shop.fonts?.length ?? 0) > 1 ? "" : undefined}>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">
          {t("nav.skip")}
        </a>
        <AnnouncementBar items={announcements(localizeSections(home.sections, home.translations, info.locale), config, t, info.locale)} />
        {!config.open && (
          <div role="status" className="bg-warning/20 px-4 py-2 text-center text-sm font-medium text-warning-ink" data-testid="store-closed">
            {config.closedMessage || t("store.closed")}
          </div>
        )}
        {/* Page layout (theme `pageLayout`): the rail and the sidebar sit beside the page, so no header over the banner. */}
        <StoreHeader
          menu={menus.header}
          categories={categories}
          featured={featured}
          overlayHero={shell.theme.pageLayout !== "rail" && shell.theme.pageLayout !== "sidebar" && opensWithFullBleedHero(home.sections, shell.theme)}
        />
        {shell.theme.pageLayout === "sidebar" && <SideNav menu={menus.header} categories={categories} />}
        <PageViewTracker />
        <div className="sf-shell">
          {shell.theme.pageLayout === "rail" && <CategoryRail categories={categories} />}
          <main id="main" className="min-h-[60dvh] min-w-0 flex-1">
            <StorePageTransition>{children}</StorePageTransition>
          </main>
        </div>
        <StoreFooter config={config} menu={menus.footer} t={t} locale={info.locale} help={helpCentreOn(shell.features)} variant={shell.theme.footer} logoUrl={shell.logoUrl} />
        <FloatingActions whatsapp={config.shop.social?.whatsapp ?? null} />
        {shell.theme.compare === "on" && <CompareTray />}
        {shell.theme.mobileNav === "tabs" && <TabBar categories={categories} />}
        <PreviewMount />
        <PwaClient installBanner={(config as { installBanner?: boolean }).installBanner !== false} />
        </div>
      </StoreProvider>
    </>
  );
}
