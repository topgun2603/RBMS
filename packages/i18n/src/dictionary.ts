import { DEFAULT_LOCALE, type Locale, type Messages } from "./client";

export interface OverrideLike {
  tenantId: string | null;
  appId: string | null;
  locale: string;
  key: string;
  value: string;
}

/**
 * Precedence of DB overrides (low → high):
 * app-wide (no tenant, no app) < app-specific (no tenant) < tenant (all apps) < tenant + app.
 */
export function overrideRank(row: Pick<OverrideLike, "tenantId" | "appId">): number {
  return (row.tenantId ? 2 : 0) + (row.appId ? 1 : 0);
}

export interface DictionaryInput {
  /** Base layers in increasing precedence, per locale: built-ins, extra bundles, app (code) messages. */
  base: Array<Partial<Record<Locale, Messages>> | undefined>;
  /** Override rows already filtered to the relevant tenant/app. */
  overrides: OverrideLike[];
}

function layerFor(locale: Locale, input: DictionaryInput): Messages {
  const out: Messages = {};
  for (const layer of input.base) Object.assign(out, layer?.[locale]);
  const rows = input.overrides.filter((r) => r.locale === locale).sort((a, b) => overrideRank(a) - overrideRank(b));
  for (const r of rows) out[r.key] = r.value;
  return out;
}

/** Merged dictionary for `locale`; non-default locales fall back to English for missing keys. */
export function buildDictionary(locale: Locale, input: DictionaryInput): Messages {
  const own = layerFor(locale, input);
  if (locale === DEFAULT_LOCALE) return own;
  return { ...layerFor(DEFAULT_LOCALE, input), ...own };
}
