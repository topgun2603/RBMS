/**
 * Foreign currencies on export bills (docs/recurring-export-gstin.md). ISO 4217 codes with their minor-unit digits.
 * Foreign amounts are integers in the currency's minor unit (cents for USD, fils for KWD with 3 digits, whole yen for
 * JPY); INR is always paise. The exchange rate is "rupees for one unit of the currency" as typed by the shop (no live
 * rate feed).
 */

export interface CurrencyDef {
  code: string;
  name: string;
  /** Digits after the decimal point (ISO 4217 minor unit). */
  digits: 0 | 2 | 3;
  symbol: string;
}

export const CURRENCIES: readonly CurrencyDef[] = [
  { code: "USD", name: "US Dollar", digits: 2, symbol: "$" },
  { code: "EUR", name: "Euro", digits: 2, symbol: "€" },
  { code: "GBP", name: "Pound Sterling", digits: 2, symbol: "£" },
  { code: "AED", name: "UAE Dirham", digits: 2, symbol: "AED" },
  { code: "SGD", name: "Singapore Dollar", digits: 2, symbol: "S$" },
  { code: "AUD", name: "Australian Dollar", digits: 2, symbol: "A$" },
  { code: "CAD", name: "Canadian Dollar", digits: 2, symbol: "C$" },
  { code: "CHF", name: "Swiss Franc", digits: 2, symbol: "CHF" },
  { code: "JPY", name: "Yen", digits: 0, symbol: "¥" },
  { code: "CNY", name: "Yuan Renminbi", digits: 2, symbol: "CN¥" },
  { code: "HKD", name: "Hong Kong Dollar", digits: 2, symbol: "HK$" },
  { code: "MYR", name: "Malaysian Ringgit", digits: 2, symbol: "RM" },
  { code: "THB", name: "Baht", digits: 2, symbol: "฿" },
  { code: "IDR", name: "Rupiah", digits: 2, symbol: "Rp" },
  { code: "PHP", name: "Philippine Peso", digits: 2, symbol: "₱" },
  { code: "KRW", name: "Won", digits: 0, symbol: "₩" },
  { code: "NZD", name: "New Zealand Dollar", digits: 2, symbol: "NZ$" },
  { code: "LKR", name: "Sri Lanka Rupee", digits: 2, symbol: "Rs" },
  { code: "NPR", name: "Nepalese Rupee", digits: 2, symbol: "Rs" },
  { code: "BDT", name: "Taka", digits: 2, symbol: "৳" },
  { code: "MVR", name: "Rufiyaa", digits: 2, symbol: "Rf" },
  { code: "PKR", name: "Pakistan Rupee", digits: 2, symbol: "Rs" },
  { code: "SAR", name: "Saudi Riyal", digits: 2, symbol: "SAR" },
  { code: "QAR", name: "Qatari Rial", digits: 2, symbol: "QAR" },
  { code: "OMR", name: "Rial Omani", digits: 3, symbol: "OMR" },
  { code: "KWD", name: "Kuwaiti Dinar", digits: 3, symbol: "KWD" },
  { code: "BHD", name: "Bahraini Dinar", digits: 3, symbol: "BHD" },
  { code: "ZAR", name: "Rand", digits: 2, symbol: "R" },
  { code: "KES", name: "Kenyan Shilling", digits: 2, symbol: "KSh" },
  { code: "NGN", name: "Naira", digits: 2, symbol: "₦" },
  { code: "MUR", name: "Mauritius Rupee", digits: 2, symbol: "Rs" },
  { code: "SEK", name: "Swedish Krona", digits: 2, symbol: "kr" },
  { code: "NOK", name: "Norwegian Krone", digits: 2, symbol: "kr" },
  { code: "DKK", name: "Danish Krone", digits: 2, symbol: "kr" },
  { code: "PLN", name: "Zloty", digits: 2, symbol: "zł" },
  { code: "CZK", name: "Czech Koruna", digits: 2, symbol: "Kč" },
  { code: "HUF", name: "Forint", digits: 2, symbol: "Ft" },
  { code: "RUB", name: "Russian Ruble", digits: 2, symbol: "₽" },
  { code: "TRY", name: "Turkish Lira", digits: 2, symbol: "₺" },
  { code: "ILS", name: "New Israeli Sheqel", digits: 2, symbol: "₪" },
  { code: "EGP", name: "Egyptian Pound", digits: 2, symbol: "E£" },
  { code: "BRL", name: "Brazilian Real", digits: 2, symbol: "R$" },
  { code: "MXN", name: "Mexican Peso", digits: 2, symbol: "MX$" },
  { code: "TWD", name: "New Taiwan Dollar", digits: 2, symbol: "NT$" },
  { code: "VND", name: "Dong", digits: 0, symbol: "₫" },
];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

export const isCurrencyCode = (v: unknown): v is string => typeof v === "string" && BY_CODE.has(v);
export const currencyDef = (code: string): CurrencyDef | null => BY_CODE.get(code) ?? null;
/** Minor-unit digits of a currency (2 when unknown). */
export const currencyDigits = (code: string): number => BY_CODE.get(code)?.digits ?? 2;

const half = (n: number) => Math.sign(n) * Math.round(Math.abs(n));

/** Largest exchange rate accepted (rupees per unit): above any real rate, below float trouble. */
export const MAX_EXCHANGE_RATE = 100_000;

/** A typed exchange rate rounded to 4 decimals (₹83.2475 per USD), or null when not a positive finite number. */
export function normalizeRate(rate: unknown): number | null {
  const n = typeof rate === "string" ? Number(rate.trim()) : typeof rate === "number" ? rate : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > MAX_EXCHANGE_RATE) return null;
  return Math.round(n * 10_000) / 10_000;
}

/** Foreign minor units → paise at `rate` rupees per unit: 1,000 cents at ₹83.25 = 83,250 paise. Half away from zero. */
export function foreignToPaise(minor: number, rate: number, code: string): number {
  const digits = currencyDigits(code);
  // rate × 10⁴ is an integer (normalizeRate), so this stays exact before the one rounding.
  const r4 = Math.round(rate * 10_000);
  return half((minor * r4 * 100) / (10 ** digits * 10_000));
}

/** Paise → foreign minor units at `rate` (for showing a rupee amount, such as IGST, in the bill's currency). */
export function paiseToForeign(paise: number, rate: number, code: string): number {
  const digits = currencyDigits(code);
  const r4 = Math.round(rate * 10_000);
  if (r4 <= 0) return 0;
  return half((paise * 10 ** digits * 10_000) / (r4 * 100));
}

/** "USD 1,234.56" (Western grouping; the bill's rupee figures keep the Indian grouping). */
export function formatForeign(minor: number, code: string): string {
  const digits = currencyDigits(code);
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const units = Math.floor(abs / 10 ** digits);
  const frac = digits ? `.${String(abs % 10 ** digits).padStart(digits, "0")}` : "";
  return `${neg ? "−" : ""}${code} ${units.toLocaleString("en-US")}${frac}`;
}

/** "83.2500" → "83.25"; keeps up to 4 decimals. */
export const formatRate = (rate: number) => String(Math.round(rate * 10_000) / 10_000);
