import type { Metadata, Viewport } from "next";
import { Fraunces, Noto_Sans_Tamil, Plus_Jakarta_Sans } from "next/font/google";
import { getRequestInfo, StoreLayout, storeRootMetadata } from "@srirealtime/storefront-ui";
import "./globals.css";

/* Store faces: Plus Jakarta Sans + Noto Sans Tamil (tenant branding fonts get these as fallbacks); Fraunces for display. */
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-display-face", display: "swap", axes: ["SOFT", "opsz"] });
const notoTamil = Noto_Sans_Tamil({ subsets: ["tamil"], variable: "--font-noto-tamil", display: "swap", weight: ["400", "500", "600", "700"] });

export function generateMetadata(): Promise<Metadata> {
  return storeRootMetadata();
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

/** Server-rendered for SEO: the shop comes from the request host (see @srirealtime/storefront-ui lib/tenant). */
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { locale } = await getRequestInfo();
  return (
    // suppressHydrationWarning: the theme script may add `dark` to <html> before React hydrates.
    <html lang={locale} className={`${jakarta.variable} ${notoTamil.variable} ${fraunces.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <StoreLayout>{children}</StoreLayout>
      </body>
    </html>
  );
}
