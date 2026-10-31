import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Noto_Sans_Tamil, Plus_Jakarta_Sans } from "next/font/google";
import { Toaster } from "@rbms/ui/components/sonner";
import { getT } from "@/lib/i18n-server";
import { SITE_URL } from "@/lib/site";
import { organizationJsonLd } from "@/lib/seo";
import { SiteProvider } from "@/components/site-context";
import { SiteHeader, THEME_SCRIPT } from "@/components/header";
import { SiteFooter } from "@/components/footer";
import { MfaDialog } from "@/components/mfa-dialog";
import { JsonLd } from "@/components/json-ld";
import "./globals.css";

/* Body: Plus Jakarta Sans; Tamil falls through to Noto Sans Tamil in the same stack; display: Bricolage Grotesque. */
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", display: "swap" });
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display-face", display: "swap" });
const notoTamil = Noto_Sans_Tamil({ subsets: ["tamil"], variable: "--font-noto-tamil", display: "swap", weight: ["400", "500", "600", "700"] });

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: `RBMS: ${t("brand.tagline")}`, template: "%s | RBMS" },
    description: t("hero.sub"),
    applicationName: "RBMS",
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fdfcfa" },
    { media: "(prefers-color-scheme: dark)", color: "#16130f" },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { locale, t } = await getT();
  return (
    // suppressHydrationWarning: the theme script may add `dark` to <html> before React hydrates.
    <html lang={locale} className={`${jakarta.variable} ${notoTamil.variable} ${display.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh overflow-x-clip bg-background text-foreground antialiased">
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <JsonLd data={organizationJsonLd()} />
        <SiteProvider locale={locale}>
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">
            {t("nav.skip")}
          </a>
          <SiteHeader />
          <main id="main" className="min-h-[60dvh]">
            {children}
          </main>
          <SiteFooter t={t} />
          <MfaDialog />
          <Toaster />
        </SiteProvider>
      </body>
    </html>
  );
}
