export interface UpiLinkInput {
  /** Payee UPI id, e.g. "shop@okicici". */
  vpa: string;
  /** Payee name shown in the payer's app. */
  name: string;
  amountPaise: number;
  /** Transaction note, e.g. the invoice number. */
  note?: string;
}

/** Percent-encodes, but keeps "@" readable (some UPI apps fail on "%40" in pa). */
const enc = (v: string) => encodeURIComponent(v).replace(/%40/g, "@");

/** upi://pay?pa=..&pn=..&am=123.45&cu=INR&tn=.. (NPCI deep link). */
export function upiLink({ vpa, name, amountPaise, note }: UpiLinkInput): string {
  const paise = Math.round(amountPaise);
  if (paise < 0) throw new RangeError("Amount can't be negative");
  const am = `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;
  const parts = [`pa=${enc(vpa.trim())}`, `pn=${enc(name.trim())}`, `am=${am}`, "cu=INR"];
  if (note?.trim()) parts.push(`tn=${enc(note.trim().slice(0, 80))}`);
  return `upi://pay?${parts.join("&")}`;
}
