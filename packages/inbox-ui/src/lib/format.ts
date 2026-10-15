/** Formatting helpers for the inbox (money in paise, Indian phone numbers). */

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const money = (paise: number | null | undefined) => inr.format((paise ?? 0) / 100);

/** "+919876543210" → "+91 98765 43210". */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const m = /^\+91([6-9]\d{4})(\d{5})$/.exec(phone);
  return m ? `+91 ${m[1]} ${m[2]}` : phone;
}

/** "Anbu Selvan" → "AS" style initials are done by InitialsAvatar; this picks a display name. */
export function displayNameOf(p: { name?: string | null; phone?: string | null; email?: string | null } | null | undefined, fallback: string): string {
  return p?.name?.trim() || formatPhone(p?.phone) || p?.email || fallback;
}

/** Bytes → "1.2 MB". */
export function fileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Percentage (0–100, one decimal) of `part` in `whole`; 0 when there's nothing. */
export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

/** Lower-case, trimmed, spaces → "-" (the support API's tag rule), deduped. */
export function cleanTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean))].slice(0, 20);
}

/**
 * A pasted phone list → audience items. One per line: "phone", "phone, name" or "phone<TAB>name"; extra columns
 * become variables named by a header row when the first line starts with a non-digit ("phone,name,amount").
 */
export function parsePhoneList(text: string): { items: { phone: string; name?: string; variables?: Record<string, string> }[]; skipped: number } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { items: [], skipped: 0 };
  const split = (l: string) => l.split(/\t|,|;/).map((c) => c.trim());
  let header: string[] | null = null;
  if (!/^[+\d(]/.test(lines[0]!)) header = split(lines.shift()!).map((h) => h.toLowerCase().replace(/[^a-z0-9_]/g, "_"));
  const items: { phone: string; name?: string; variables?: Record<string, string> }[] = [];
  let skipped = 0;
  for (const l of lines) {
    const cols = split(l);
    const phone = cols[0] ?? "";
    if (phone.replace(/\D/g, "").length < 8) {
      skipped++;
      continue;
    }
    const item: { phone: string; name?: string; variables?: Record<string, string> } = { phone };
    if (cols[1]) item.name = cols[1];
    if (header && cols.length > 2) {
      const vars: Record<string, string> = {};
      for (let i = 2; i < cols.length; i++) if (header[i] && cols[i]) vars[header[i]!] = cols[i]!;
      if (Object.keys(vars).length) item.variables = vars;
    }
    items.push(item);
  }
  return { items: items.slice(0, 10_000), skipped };
}
