"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createTranslator,
  formatCurrencyINR,
  formatDate as formatDateBase,
  normalizeLocale,
  SUPPORTED_LOCALES,
  type Locale,
  type Messages,
  type Translator,
} from "@rbms/i18n/client";
import { api, ApiError } from "./api";
import { getToken, LOCALE_KEY, readStored, useStored, useTenantSlug, writeStored } from "./session";
import { adminMessages } from "./admin-messages";

export { SUPPORTED_LOCALES };
export type { Locale };

export const LOCALE_NAMES: Record<Locale, string> = { en: "English", ta: "தமிழ்" };

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translator;
  /** True until the server bundle for the current locale has loaded (local fallbacks show meanwhile). */
  loading: boolean;
  formatDate: (d: Date | string | number, opts?: Intl.DateTimeFormatOptions) => string;
  formatDateTime: (d: Date | string | number) => string;
  formatRelative: (d: Date | string | number) => string;
  formatCurrency: (rupees: number, opts?: Intl.NumberFormatOptions) => string;
  formatNumber: (n: number, opts?: Intl.NumberFormatOptions) => string;
}

const I18nContext = React.createContext<I18nValue | null>(null);

/** Local admin.* strings so the panel works before they land in the server bundles. */
function localFallback(locale: Locale): Messages {
  return locale === "en" ? adminMessages.en : { ...adminMessages.en, ...adminMessages.ta };
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const stored = useStored(LOCALE_KEY);
  const tenant = useTenantSlug();
  const locale = normalizeLocale(stored ?? "en");

  // First visit: pick the browser language once.
  React.useEffect(() => {
    if (readStored(LOCALE_KEY) === null) writeStored(LOCALE_KEY, normalizeLocale(navigator.language));
  }, []);

  React.useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const { data, isLoading } = useQuery({
    queryKey: ["i18n", locale, tenant],
    queryFn: () => api<{ locale: string; messages: Messages }>("/i18n/messages", { query: { locale } }),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const value = React.useMemo<I18nValue>(() => {
    const t = createTranslator(data?.messages ?? {}, localFallback(locale), locale);
    const tag = locale === "ta" ? "ta-IN" : "en-IN";
    return {
      locale,
      t,
      loading: isLoading,
      setLocale: (next) => {
        writeStored(LOCALE_KEY, next);
        // Persist on the profile too (best effort) so emails/SMS use it.
        if (getToken()) api.patch("/auth/me", { locale: next }).catch(() => undefined);
      },
      formatDate: (d, opts) => formatDateBase(locale, d, opts),
      formatDateTime: (d) => formatDateBase(locale, d, { dateStyle: "medium", timeStyle: "short" }),
      formatRelative: (d) => {
        const date = d instanceof Date ? d : new Date(d);
        const diff = (date.getTime() - Date.now()) / 1000;
        const abs = Math.abs(diff);
        const rtf = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
        if (abs < 60) return rtf.format(Math.round(diff), "second");
        if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
        if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
        if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
        return formatDateBase(locale, date);
      },
      formatCurrency: (rupees, opts) => formatCurrencyINR(locale, rupees, opts),
      formatNumber: (n, opts) => new Intl.NumberFormat(tag, opts).format(n),
    };
  }, [data, locale, isLoading]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = React.useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}

/** Translate a dynamic key, falling back to `fallback` (e.g. the raw role/status) when it's not in any bundle. */
export const tOr = (t: Translator, key: string, fallback: string) => (t.has(key) ? t(key) : fallback);

/** Human message for any thrown error: `admin.errors.<code>` if translated, else the server message. */
export function describeError(err: unknown, t: Translator): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return t("admin.errors.network");
    const key = `admin.errors.${err.code}`;
    if (t.has(key)) return t(key);
    return err.message || t("admin.errors.generic");
  }
  if (err instanceof Error && err.message) return err.message;
  return t("admin.errors.generic");
}
