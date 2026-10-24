/** Paise as "1,23,456.50" (Indian grouping, two decimals, no currency symbol: receipts say "Rs." only on totals). */
export function formatMoney(paise: number): string {
  const neg = paise < 0;
  const p = Math.abs(Math.round(paise));
  const rupees = Math.floor(p / 100).toString();
  const frac = (p % 100).toString().padStart(2, "0");
  const last3 = rupees.slice(-3);
  const rest = rupees.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3;
  return `${neg ? "-" : ""}${grouped}.${frac}`;
}

/** A quantity with up to 3 decimals and no trailing zeros ("2", "0.75"). */
export function formatQty(qty: number): string {
  return Number(qty.toFixed(3)).toString();
}
