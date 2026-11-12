import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator, formatDate } from "@rbms/i18n/client";
import { ordersMessages } from "./lib/messages";

/**
 * Test support: what `useI18n()` returns for a language, built from the real orders bundles (Tamil falls back to English
 * key by key, as in the app). Tests mock `@rbms/web`'s `useI18n` with it, because the app's provider reads the language
 * from localStorage, which a server render never has. Not part of the shipped module.
 */
export function i18nFor(locale: "en" | "ta") {
  const t = createTranslator(ordersMessages[locale], ordersMessages.en, locale);
  return {
    locale,
    t,
    setLocale: () => undefined,
    formatDate: (d: Date | string | number, opts?: Intl.DateTimeFormatOptions) => formatDate(locale, d, opts),
    formatNumber: (n: number, opts?: Intl.NumberFormatOptions) => new Intl.NumberFormat("en-IN", opts).format(n),
  };
}

/** Server-renders a component inside an empty React Query client and returns its visible text, spaces collapsed. */
export function renderText(node: ReactElement): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
