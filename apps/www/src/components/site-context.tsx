"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Locale, Translator } from "@rbms/i18n/client";
import { LOCALE_COOKIE, translatorFor } from "@/lib/messages";

interface SiteCtx {
  locale: Locale;
  t: Translator;
  setLocale(l: Locale): void;
}

const Ctx = React.createContext<SiteCtx | null>(null);

export function useSite(): SiteCtx {
  const c = React.useContext(Ctx);
  if (!c) throw new Error("useSite outside <SiteProvider>");
  return c;
}

function SearchParamCleaner({ onReady }: { onReady: (strip: () => void) => void }) {
  const search = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  React.useEffect(() => {
    onReady(() => {
      if (!search.has("lang")) return router.refresh();
      const next = new URLSearchParams(search.toString());
      next.delete("lang");
      const qs = next.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
      router.refresh();
    });
  }, [search, pathname, router, onReady]);
  return null;
}

/** Locale + translator for client islands. Switching language sets the cookie and re-renders the server pages. */
export function SiteProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const router = useRouter();
  const t = React.useMemo(() => translatorFor(locale), [locale]);
  const refresh = React.useRef<() => void>(() => router.refresh());
  const onReady = React.useCallback((fn: () => void) => {
    refresh.current = fn;
  }, []);
  const setLocale = React.useCallback((l: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    document.documentElement.lang = l;
    refresh.current();
  }, []);
  const value = React.useMemo(() => ({ locale, t, setLocale }), [locale, t, setLocale]);
  return (
    <Ctx.Provider value={value}>
      <React.Suspense fallback={null}>
        <SearchParamCleaner onReady={onReady} />
      </React.Suspense>
      {children}
    </Ctx.Provider>
  );
}
