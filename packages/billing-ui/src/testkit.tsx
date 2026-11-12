import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator, formatDate } from "@rbms/i18n/client";
import { billingMessages } from "./lib/messages";

/**
 * Test support: what `useI18n()` returns for a language, built from the real billing bundles (Tamil falls back to English
 * key by key, as in the app). Tests mock `@rbms/web`'s `useI18n` with it, because the app's provider reads the language
 * from localStorage, which a server render never has. Not part of the shipped module.
 */
export function i18nFor(locale: "en" | "ta") {
  const t = createTranslator(billingMessages[locale], billingMessages.en, locale);
  return {
    locale,
    t,
    setLocale: () => undefined,
    formatDate: (d: Date | string | number, opts?: Intl.DateTimeFormatOptions) => formatDate(locale, d, opts),
    formatNumber: (n: number, opts?: Intl.NumberFormatOptions) => new Intl.NumberFormat("en-IN", opts).format(n),
  };
}

/** Server-renders a component with an empty (or seeded) React Query client, and returns its HTML. */
export function html(node: ReactElement, seed?: (client: QueryClient) => void): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed?.(client);
  return renderToStaticMarkup(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

/** The visible text of rendered HTML: tags dropped, entities for quotes and ampersands decoded, spaces collapsed. */
export const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
