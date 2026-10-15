import { formatINR, stateName } from "@srirealtime/gst";
import QRCode from "qrcode";
import { FONT_STACK, fontFaceCss } from "./fonts";
import type { Branding, DocLocale, Paper } from "./types";

/** Escapes text for HTML element content and attribute values. */
export function esc(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escaped text with line breaks kept (addresses, terms). */
export const escLines = (value: unknown) => esc(value).replace(/\r?\n/g, "<br>");

export const money = (paise: number | null | undefined) => formatINR(paise ?? 0);

const qtyFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });
export const qty = (n: number) => qtyFmt.format(n);

export const pct = (r: number) => `${r}%`;

/** "33" → "33 – Tamil Nadu". */
export function stateLabel(code: string | null | undefined): string {
  if (!code) return "—";
  const name = stateName(code);
  return name ? `${code} – ${name}` : code;
}

const dateFmts: Record<DocLocale, Intl.DateTimeFormat> = {
  en: new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }),
  ta: new Intl.DateTimeFormat("ta-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }),
};

/** "2026-10-15" (IST date) or a Date → "15 Oct 2026". */
export function fmtDate(value: string | Date | null | undefined, locale: DocLocale): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00+05:30` : value) : value;
  if (Number.isNaN(d.getTime())) return esc(String(value));
  return dateFmts[locale].format(d);
}

/** Only http(s) and data:image URLs may be used as image sources. */
export function safeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = url.trim();
  if (/^https?:\/\/[^\s"'<>]+$/i.test(u)) return u;
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/i.test(u)) return u;
  return null;
}

/** Hex / rgb() / hsl() colours only; anything else falls back. */
export function safeColor(value: string | null | undefined, fallback = "#0f766e"): string {
  const v = value?.trim() ?? "";
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
  if (/^(rgb|hsl)a?\(\s*[\d.%\s,/-]+\)$/i.test(v)) return v;
  return fallback;
}

/** Tenant CSS can't close the style element or pull remote resources. */
export function safeCss(css: string | null | undefined): string {
  if (!css) return "";
  return css
    .replace(/<\/?\s*style/gi, "")
    .replace(/</g, "\\3c ")
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\(\s*(['"]?)(?!data:)[^)]*\1\s*\)/gi, "none")
    .slice(0, 20_000);
}

/** QR code as an inline SVG (synchronous; built from qrcode's module matrix). */
export function qrSvg(text: string, sizePx = 112, label = "QR code"): string {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const quiet = 2;
  const dim = n + quiet * 2;
  let path = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (qr.modules.data[y * n + x]) path += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" class="qr" width="${sizePx}" height="${sizePx}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" role="img" aria-label="${esc(label)}"><rect width="${dim}" height="${dim}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

const PAGE_CSS: Record<Paper, string> = {
  A4: "@page{size:A4;margin:12mm 12mm 14mm}",
  A6: "@page{size:A6;margin:4mm}",
  // Height is set by the driver from the content; width is the roll.
  "80mm": "@page{margin:2mm 3mm}",
};

const BASE_CSS = `
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff}
body{font-family:${FONT_STACK};color:#111827;font-size:10pt;line-height:1.4;-webkit-print-color-adjust:exact;print-color-adjust:exact}
h1,h2,h3,p{margin:0}
table{border-collapse:collapse;width:100%}
th{font-weight:600;text-align:left}
.r{text-align:right}.c{text-align:center}.num{font-variant-numeric:tabular-nums;white-space:nowrap}
.muted{color:#6b7280}.b{font-weight:700}.mono{font-family:"SR Noto Sans",monospace;letter-spacing:.02em}
.small{font-size:8pt}.xs{font-size:7pt}.pre{white-space:pre-line}
.avoid{break-inside:avoid;page-break-inside:avoid}
.stamp{position:fixed;top:40%;left:0;right:0;text-align:center;font-size:64pt;font-weight:700;letter-spacing:.15em;color:rgba(220,38,38,.18);transform:rotate(-24deg);text-transform:uppercase;z-index:10;pointer-events:none}
.qr{display:block}
`;

/** A full HTML document with embedded fonts, page size, base styles, branding colour and tenant CSS. */
export function page(opts: {
  title: string;
  paper: Paper;
  locale: DocLocale;
  branding: Branding;
  css: string;
  body: string;
}): string {
  const primary = safeColor(opts.branding.primary);
  return `<!doctype html>
<html lang="${opts.locale === "ta" ? "ta" : "en"}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; font-src data:; style-src 'unsafe-inline'">
<title>${esc(opts.title)}</title>
<style>
${fontFaceCss()}
${PAGE_CSS[opts.paper]}
:root{--primary:${primary}}
${BASE_CSS}
${opts.css}
${safeCss(opts.branding.css)}
</style>
</head>
<body>
${opts.body}
</body>
</html>`;
}
