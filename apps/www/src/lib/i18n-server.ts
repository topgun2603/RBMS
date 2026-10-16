import { cache } from "react";
import { cookies, headers } from "next/headers";
import { normalizeLocale, type Locale } from "@srirealtime/i18n/client";
import { LOCALE_COOKIE, translatorFor } from "./messages";

/** Header the middleware sets when the URL carries `?lang=` (wins over the cookie for that request). */
export const LOCALE_HEADER = "x-sr-locale";

/** The request's locale: `?lang=` (via middleware) → cookie → English. */
export const getLocale = cache(async (): Promise<Locale> => {
  const h = await headers();
  const fromQuery = h.get(LOCALE_HEADER);
  if (fromQuery) return normalizeLocale(fromQuery);
  const c = await cookies();
  return normalizeLocale(c.get(LOCALE_COOKIE)?.value);
});

export async function getT() {
  const locale = await getLocale();
  return { locale, t: translatorFor(locale) };
}
