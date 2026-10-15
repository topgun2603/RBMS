"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createTranslator,
  formatDate as formatDateBase,
  normalizeLocale,
  SUPPORTED_LOCALES,
  type Locale,
  type Messages,
  type Translator,
} from "@srirealtime/i18n/client";
import { api, ApiError } from "./api";
import { getToken, LOCALE_KEY, readStored, useStored, writeStored } from "./session";

export { SUPPORTED_LOCALES };
export type { Locale, Messages, Translator };

export const LOCALE_NAMES: Record<Locale, string> = { en: "English", ta: "தமிழ்" };

/** A message bundle: English is complete; Tamil falls back to English key by key. */
export interface MessageBundle {
  en: Messages;
  ta: Messages;
}

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translator;
  formatDate: (d: Date | string | number, opts?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (n: number, opts?: Intl.NumberFormatOptions) => string;
}

const I18nContext = React.createContext<I18nValue | null>(null);

/**
 * Namespaces whose `<ns>.errors.<code>` keys describeError() looks at (module ids, then "web").
 * Set by createWebApp; module-level because describeError(err, t) is called from plain callbacks.
 */
let errorNamespaces: string[] = ["web"];
export function setErrorNamespaces(ns: string[]) {
  errorNamespaces = [...new Set([...ns, "web"])];
}

/**
 * Merges the kit's and every module's bundles. Server bundles (GET /v1/i18n/messages, tenant overrides) win for keys in
 * one of `namespaces`, so a stale server bundle can't blank strings of other apps.
 */
export function I18nProvider({
  bundles,
  namespaces,
  children,
}: {
  bundles: MessageBundle[];
  namespaces: string[];
  children: React.ReactNode;
}) {
  const stored = useStored(LOCALE_KEY);
  const locale = normalizeLocale(stored ?? "en");

  // First visit: pick the browser language once.
  React.useEffect(() => {
    if (readStored(LOCALE_KEY) === null) writeStored(LOCALE_KEY, normalizeLocale(navigator.language));
  }, []);

  React.useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // Optional server overrides (per tenant). The app is fully usable without them.
  const { data } = useQuery({
    queryKey: ["i18n", locale],
    queryFn: () => api<{ locale: string; messages: Messages }>("/i18n/messages", { query: { locale }, anonymous: true }),
    staleTime: 10 * 60_000,
    retry: 0,
  });

  const merged = React.useMemo(() => {
    const en: Messages = Object.assign({}, ...bundles.map((b) => b.en));
    const ta: Messages = Object.assign({}, en, ...bundles.map((b) => b.ta));
    return { en, ta };
  }, [bundles]);

  const nsKey = namespaces.join("|");
  const value = React.useMemo<I18nValue>(() => {
    const local = locale === "en" ? merged.en : merged.ta;
    const prefixes = nsKey.split("|").map((n) => `${n}.`);
    const server: Messages = {};
    for (const [k, v] of Object.entries(data?.messages ?? {})) if (v && prefixes.some((p) => k.startsWith(p))) server[k] = v;
    const t = createTranslator({ ...local, ...server }, merged.en, locale);
    return {
      locale,
      t,
      setLocale: (next) => {
        writeStored(LOCALE_KEY, next);
        if (getToken()) api.patch("/auth/me", { locale: next }).catch(() => undefined);
      },
      formatDate: (d, opts) => formatDateBase(locale, d, opts),
      // Numbers stay en-IN (Latin digits, lakh grouping) in both languages.
      formatNumber: (n, opts) => new Intl.NumberFormat("en-IN", opts).format(n),
    };
  }, [data, locale, merged, nsKey]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = React.useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}

/** Translate a dynamic key, falling back to `fallback` when it's not in any bundle. */
export const tOr = (t: Translator, key: string, fallback: string) => (t.has(key) ? t(key) : fallback);

export const isPlanLimit = (err: unknown) => err instanceof ApiError && (err.status === 402 || err.code === "plan_limit");
export const isFeatureDisabled = (err: unknown) => err instanceof ApiError && err.code === "feature_disabled";

/** Human message for any thrown error: feature and plan limits, known codes (module namespaces first), else the server message. */
export function describeError(err: unknown, t: Translator): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return t("web.errors.network");
    const d = (err.details ?? {}) as { module?: string; key?: string; limit?: number; used?: number; feature?: string; reason?: string };
    if (isPlanLimit(err)) {
      if (d.feature) return t("web.errors.featureNotInPlan");
      if (d.module) return t("web.errors.moduleNotInPlan");
      return typeof d.limit === "number" ? t("web.errors.planLimitCount", { limit: d.limit }) : t("web.errors.planLimit");
    }
    if (isFeatureDisabled(err)) return t(d.reason === "shop" ? "web.errors.featureTurnedOff" : "web.errors.featureUnavailable");
    for (const ns of errorNamespaces) {
      const key = `${ns}.errors.${err.code}`;
      if (t.has(key)) return t(key);
    }
    if (err.status === 403) return t("web.errors.forbidden");
    return err.message || t("web.errors.generic");
  }
  if (err instanceof Error && err.message) return err.message;
  return t("web.errors.generic");
}
