import * as React from "react";
import type { Metadata } from "next";
import { apiGetSafe, getBranding, getConfig, getMenus, getRequestInfo, getShell, getStoreT, storeCss } from "../server/api";
import { helpCentreOn } from "../lib/features";
import { imageUrl } from "../lib/format";
import type { Collection, HomeSection, List, StoreConfig, StoreThemeView } from "../types";
import type { Translator } from "../lib/messages";
import { StoreProvider } from "../client/store-context";
import { PageViewTracker, StoreHeader, THEME_SCRIPT, type NavCategory, type NavCollection } from "../client/header";
import { AnnouncementBar, type Announcement } from "../client/announcement";
import { FloatingActions } from "../client/floating";
import { StorePageTransition } from "../client/page-transition";
import { StoreFooter } from "../components/footer";
import { getCategories } from "./listing";
import { getHome } from "./home";

/** Root metadata: title template with the shop name, favicon, metadataBase for absolute OG URLs. */
export async function storeRootMetadata(): Promise<Metadata> {
  const [info, config, branding] = await Promise.all([getRequestInfo(), getConfig().catch(() => null), getBranding()]);
  const name = config?.shop.name ?? "Store";
  const icon = imageUrl(branding?.faviconUrl ?? null);
  return {
    metadataBase: new URL(info.baseUrl),
    title: { default: name, template: `%s | ${name}` },
    applicationName: name,
    icons: { icon: icon ?? "/favicon.svg" },
    formatDetection: { telephone: false },
  };
}

/** Ribbon messages from what the shop already published (home USPs) and its settings — never invented offers. */
function announcements(sections: HomeSection[], config: StoreConfig, t: Translator): Announcement[] {
  const out: Announcement[] = [];
  for (const s of sections) if (s.type === "usp") for (const it of s.items) out.push({ text: it.text ? `${it.title} · ${it.text}` : it.title });
  if (!out.length) {
    if (config.codEnabled) out.push({ text: t("announce.cod") });
    if (config.policies.returns?.trim()) out.push({ text: t("announce.returns"), href: "/policies/returns" });
  }
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
  const t = await getStoreT();
  const fonts = fontsHref(config.shop.fonts);
  const categories: NavCategory[] = cats.items.filter((c) => !c.parentId).map((c) => ({ id: c.id, name: c.name, slug: c.slug, imageUrl: c.imageUrl }));
  const f = cols.items[0];
  const featured: NavCollection | null = f ? { name: f.name, slug: f.slug, description: f.description, imageUrl: f.imageUrl } : null;
  return (
    <>
      {/* Saved light/dark choice, applied before first paint. */}
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      {/* Tenant branding overrides --primary, --radius, fonts … (unlayered, so it beats the design-system defaults). */}
      <style id="sr-branding" dangerouslySetInnerHTML={{ __html: storeCss(config.shop.css || branding?.css) }} />
      {fonts && (
        <>
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link rel="stylesheet" href={fonts} />
        </>
      )}
      <StoreProvider shell={shell} locale={info.locale}>
        <div className="sf-root" {...themeAttributes(shell.theme)} data-sf-brand-fonts={(config.shop.fonts?.length ?? 0) > 1 ? "" : undefined}>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">
          {t("nav.skip")}
        </a>
        <AnnouncementBar items={announcements(home.sections, config, t)} />
        {!config.open && (
          <div role="status" className="bg-warning/20 px-4 py-2 text-center text-sm font-medium text-warning-ink" data-testid="store-closed">
            {config.closedMessage || t("store.closed")}
          </div>
        )}
        <StoreHeader menu={menus.header} categories={categories} featured={featured} />
        <PageViewTracker />
        <main id="main" className="min-h-[60dvh]">
          <StorePageTransition>{children}</StorePageTransition>
        </main>
        <StoreFooter config={config} menu={menus.footer} t={t} help={helpCentreOn(shell.features)} />
        <FloatingActions whatsapp={config.shop.social?.whatsapp ?? null} />
        </div>
      </StoreProvider>
    </>
  );
}
