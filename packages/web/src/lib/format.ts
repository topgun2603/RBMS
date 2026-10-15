/** "98765 43210" → "+919876543210"; emails are lowercased; anything else is invalid. */
export function normalizeTarget(raw: string): { target: string; kind: "phone" | "email" | "invalid" } {
  const v = raw.trim();
  if (v.includes("@")) {
    const email = v.toLowerCase();
    return { target: email, kind: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "email" : "invalid" };
  }
  const digits = v.replace(/[^\d+]/g, "");
  if (/^[6-9]\d{9}$/.test(digits)) return { target: `+91${digits}`, kind: "phone" };
  if (/^0[6-9]\d{9}$/.test(digits)) return { target: `+91${digits.slice(1)}`, kind: "phone" };
  if (/^91[6-9]\d{9}$/.test(digits)) return { target: `+${digits}`, kind: "phone" };
  if (/^\+\d{8,15}$/.test(digits)) return { target: digits, kind: "phone" };
  return { target: v, kind: "invalid" };
}

/** "invoices.credit-book" → "Invoices credit book" (last-resort label). */
export function humanizeKey(key: string): string {
  const s = key.replace(/[._-]+/g, " ").trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : key;
}
