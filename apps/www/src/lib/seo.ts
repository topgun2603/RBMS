import type { Metadata } from "next";
import type { Locale } from "@rbms/i18n/client";
import { SITE_URL } from "./site";

/** Page metadata with canonical URL, OpenGraph and Twitter card. */
export function pageMetadata(opts: { title: string; description: string; path: string; locale: Locale; noindex?: boolean; absoluteTitle?: boolean }): Metadata {
  const url = `${SITE_URL}${opts.path === "/" ? "" : opts.path}` || SITE_URL;
  return {
    title: opts.absoluteTitle ? { absolute: opts.title } : opts.title,
    description: opts.description,
    alternates: { canonical: url, languages: { en: `${url}?lang=en`, ta: `${url}?lang=ta` } },
    openGraph: {
      type: "website",
      url,
      siteName: "RBMS",
      title: opts.title,
      description: opts.description,
      locale: opts.locale === "ta" ? "ta_IN" : "en_IN",
      // images: app/opengraph-image.tsx (file convention) applies to every page.
    },
    twitter: { card: "summary_large_image", title: opts.title, description: opts.description },
    robots: opts.noindex ? { index: false, follow: true } : undefined,
  };
}

export const organizationJsonLd = () => ({
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "RBMS",
  url: SITE_URL,
  logo: `${SITE_URL}/icon.svg`,
  description: "Billing and online store software for shops in Tamil Nadu and across India.",
  areaServed: { "@type": "Country", name: "India" },
  address: { "@type": "PostalAddress", addressRegion: "Tamil Nadu", addressCountry: "IN" },
});
