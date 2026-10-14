export type TemplateVars = Record<string, string | number | null | undefined>;

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Replaces `{{var}}` placeholders. Missing variables render as an empty string.
 * With `html: true` the substituted values are HTML-escaped (the template itself is trusted).
 */
export function render(template: string, vars: TemplateVars = {}, opts: { html?: boolean } = {}): string {
  return template.replace(PLACEHOLDER, (_, name: string) => {
    const v = vars[name];
    const s = v === null || v === undefined ? "" : String(v);
    return opts.html ? escapeHtml(s) : s;
  });
}

/** Placeholder names in order of first appearance. */
export function placeholders(template: string): string[] {
  const seen: string[] = [];
  for (const m of template.matchAll(PLACEHOLDER)) {
    const name = m[1]!;
    if (!seen.includes(name)) seen.push(name);
  }
  return seen;
}

/** Turns a plain-text body into minimal HTML; bodies that already contain tags are left alone. */
export function renderEmailHtml(template: string, vars: TemplateVars): string {
  const html = render(looksLikeHtml(template) ? template : escapeHtml(template), vars, { html: true });
  return looksLikeHtml(template) ? html : html.replace(/\r?\n/g, "<br>\n");
}

export const looksLikeHtml = (s: string) => /<[a-z][\s\S]*>/i.test(s);

/** Plain-text alternative for an HTML body. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Masks a phone number or email for logs.
 * "+919876543210" → "+91******3210", "gowtham@x.com" → "g*****m@x.com".
 */
export function maskTarget(to: string): string {
  const t = to.trim();
  const at = t.lastIndexOf("@");
  if (at > 0) {
    const local = t.slice(0, at);
    const domain = t.slice(at);
    if (local.length <= 2) return `${local[0]}*${domain}`;
    return `${local[0]}${"*".repeat(local.length - 2)}${local[local.length - 1]}${domain}`;
  }
  if (/^\+?[\d\s-]{6,}$/.test(t)) {
    const plus = t.startsWith("+");
    const digits = t.replace(/\D/g, "");
    // Keep the country code for E.164 numbers (+91 for India; 2 digits is the common case).
    const keepStart = plus ? Math.min(2, Math.max(0, digits.length - 6)) : 0;
    const keepEnd = 4;
    const hidden = Math.max(0, digits.length - keepStart - keepEnd);
    return `${plus ? "+" : ""}${digits.slice(0, keepStart)}${"*".repeat(hidden)}${digits.slice(digits.length - keepEnd)}`;
  }
  // Push tokens and anything else: keep a short prefix/suffix.
  if (t.length <= 8) return "*".repeat(t.length);
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}
