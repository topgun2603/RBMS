import type { Metadata, Viewport } from "next";
import { Noto_Sans_Tamil, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { BRANDING_BOOT_SCRIPT } from "@srirealtime/web/branding-boot";
import { AppRoot } from "./app-root";

/* UI face + Tamil fallback. They feed --font-sans/--font-heading through these variables (see @srirealtime/ui styles);
 * tenant branding CSS that sets --font-sans still wins. */
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", display: "swap" });
const notoTamil = Noto_Sans_Tamil({ subsets: ["tamil"], variable: "--font-noto-tamil", display: "swap", weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: { default: "Billing", template: "%s · Billing" },
  description: "GST billing for your shop",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf8" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1816" },
  ],
};

/** Fonts, metadata, global CSS and the module router (<AppRoot>), mounted here so it persists across navigation. */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${jakarta.variable} ${notoTamil.variable}`}>
      <head>
        {/* The shop's last-seen colours before first paint (no default-indigo flash while branding loads). */}
        <script dangerouslySetInnerHTML={{ __html: BRANDING_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-dvh">
        <AppRoot />
        {children}
      </body>
    </html>
  );
}
