const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n]!;
  const t = TENS[Math.floor(n / 10)]!;
  return n % 10 ? `${t} ${ONES[n % 10]}` : t;
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", r ? belowHundred(r) : ""].filter(Boolean).join(" ");
}

/** A whole number in words using the Indian system (thousand, lakh, crore). 0 → "Zero". */
export function numberToWordsIndian(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError("Expected a non-negative safe integer");
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  if (crore) parts.push(`${numberToWordsIndian(crore)} Crore`);
  const rest = n % 10_000_000;
  const lakh = Math.floor(rest / 100_000);
  const thousand = Math.floor((rest % 100_000) / 1000);
  const hundreds = rest % 1000;
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (hundreds) parts.push(belowThousand(hundreds));
  return parts.join(" ");
}

/**
 * Paise in words for an invoice: 123456 → "One Thousand Two Hundred Thirty Four Rupees and Fifty Six Paise Only".
 * 0 → "Zero Rupees Only"; 1 → "One Paisa Only"; 100 → "One Rupee Only".
 */
export function amountInWordsINR(paise: number): string {
  const total = Math.round(paise);
  const sign = total < 0 ? "Minus " : "";
  const abs = Math.abs(total);
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  const r = `${numberToWordsIndian(rupees)} ${rupees === 1 ? "Rupee" : "Rupees"}`;
  const ps = `${numberToWordsIndian(p)} ${p === 1 ? "Paisa" : "Paise"}`;
  if (rupees && p) return `${sign}${r} and ${ps} Only`;
  if (p) return `${sign}${ps} Only`;
  return `${sign}${r} Only`;
}
