/** India Standard Time, UTC+05:30. */
export const IST_OFFSET_MINUTES = 330;

const formatters = new Map<string, Intl.NumberFormat>();

/** Paise as rupees with Indian grouping: 123456 → "₹1,234.56", 10000000 → "₹1,00,000.00". */
export function formatINR(paise: number, locale = "en-IN"): string {
  let f = formatters.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(locale, { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
    formatters.set(locale, f);
  }
  return f.format(Math.round(paise) / 100);
}

/** Today's date in IST as "YYYY-MM-DD". */
export function todayIST(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/** True for a real calendar date written as "YYYY-MM-DD". */
export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
