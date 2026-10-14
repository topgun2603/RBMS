/**
 * Browser-safe i18n helpers. No Node, Drizzle or Fastify imports — safe to bundle into any frontend.
 */

/** Flat dictionary with dotted keys, e.g. { "common.save": "Save" }. */
export type Messages = Record<string, string>;

export const SUPPORTED_LOCALES = ["en", "ta"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export type Vars = Record<string, string | number | null | undefined>;

/** "ta-IN", "TA", "ta_LK" → "ta"; anything unsupported → "en". */
export function normalizeLocale(input: string | null | undefined): Locale {
  if (!input) return DEFAULT_LOCALE;
  const base = input.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return (SUPPORTED_LOCALES as readonly string[]).includes(base) ? (base as Locale) : DEFAULT_LOCALE;
}

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(v);

/** BCP-47 tag used for Intl formatting. */
export const intlTag = (locale: Locale | string) => (normalizeLocale(locale) === "ta" ? "ta-IN" : "en-IN");

/** Index of the `}` matching the `{` at `open`, or -1. */
function matchBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

const PLURAL_RE = /^\s*([\w.]+)\s*,\s*plural\s*,([\s\S]*)$/;

function parsePluralOptions(body: string): Map<string, string> {
  const options = new Map<string, string>();
  let i = 0;
  while (i < body.length) {
    const m = /^\s*(=\d+|zero|one|two|few|many|other)\s*\{/.exec(body.slice(i));
    if (!m) break;
    const open = i + m[0].length - 1;
    const close = matchBrace(body, open);
    if (close < 0) break;
    options.set(m[1]!, body.slice(open + 1, close));
    i = close + 1;
  }
  return options;
}

function renderPlural(name: string, body: string, vars: Vars, locale: string): string | null {
  const raw = vars[name];
  const n = typeof raw === "number" ? raw : Number(raw);
  if (raw === undefined || raw === null || Number.isNaN(n)) return null;
  const options = parsePluralOptions(body);
  const category = new Intl.PluralRules(intlTag(locale)).select(n);
  const chosen = options.get(`=${n}`) ?? options.get(category) ?? options.get("other");
  if (chosen === undefined) return null;
  return interpolate(chosen.replace(/#/g, String(n)), vars, locale);
}

/**
 * Replaces `{name}` placeholders and simple ICU plurals:
 * `{count, plural, =0 {no items} one {# item} other {# items}}` (`#` is the number).
 * Unknown placeholders are left as-is so missing variables are visible.
 */
export function interpolate(template: string, vars: Vars = {}, locale: Locale | string = DEFAULT_LOCALE): string {
  let out = "";
  let i = 0;
  while (i < template.length) {
    const open = template.indexOf("{", i);
    if (open < 0) {
      out += template.slice(i);
      break;
    }
    out += template.slice(i, open);
    const close = matchBrace(template, open);
    if (close < 0) {
      out += template.slice(open);
      break;
    }
    const inner = template.slice(open + 1, close);
    const whole = template.slice(open, close + 1);
    const plural = PLURAL_RE.exec(inner);
    if (plural) {
      out += renderPlural(plural[1]!, plural[2]!, vars, locale) ?? whole;
    } else {
      const name = inner.trim();
      const v = vars[name];
      out += v === undefined || v === null ? whole : String(v);
    }
    i = close + 1;
  }
  return out;
}

export type Translator = ((key: string, vars?: Vars) => string) & { has(key: string): boolean };

/** `t(key, vars)`: looks up `messages`, then `fallback`, then returns the key itself. */
export function createTranslator(messages: Messages, fallback?: Messages, locale: Locale | string = DEFAULT_LOCALE): Translator {
  const lookup = (key: string) =>
    Object.prototype.hasOwnProperty.call(messages, key)
      ? messages[key]
      : fallback && Object.prototype.hasOwnProperty.call(fallback, key)
        ? fallback[key]
        : undefined;
  const t = ((key: string, vars?: Vars) => {
    const template = lookup(key);
    return template === undefined ? key : interpolate(template, vars, locale);
  }) as Translator;
  t.has = (key: string) => lookup(key) !== undefined;
  return t;
}

const toDate = (v: Date | string | number) => (v instanceof Date ? v : new Date(v));

export function formatNumber(locale: Locale | string, value: number, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(intlTag(locale), opts).format(value);
}

/** ₹ with Indian digit grouping, e.g. ₹1,23,456.00 */
export function formatCurrencyINR(locale: Locale | string, value: number, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(intlTag(locale), { style: "currency", currency: "INR", ...opts }).format(value);
}

export function formatDate(
  locale: Locale | string,
  value: Date | string | number,
  opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
): string {
  return new Intl.DateTimeFormat(intlTag(locale), { timeZone: "Asia/Kolkata", ...opts }).format(toDate(value));
}
