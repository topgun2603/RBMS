import sharp from "sharp";

/**
 * A ready-to-share square post image composed in code (AI Phase 4 part B, "Social posts"): the product photo, a short title,
 * the price, the shop name and logo, in the shop's theme colours. No model draws anything: every pixel is the shop's own photo,
 * logo and text, so nothing can be invented. Used by the owner's "Social post" dialog; the owner downloads or shares it
 * (nothing is posted for them).
 */
export interface SocialImageInput {
  /** The product photo (any raster format sharp reads). Without it a colour block with the title's first letter is used. */
  photo?: Buffer | null;
  logo?: Buffer | null;
  shopName: string;
  title: string;
  /** Already formatted, e.g. "₹1,250" or "from ₹499". */
  priceText?: string | null;
  /** A small tag on the photo ("New arrival"). Only pass it when it is true. */
  badge?: string | null;
  /** #rrggbb theme colours. */
  primary?: string | null;
  accent?: string | null;
  /** Edge in pixels (default 1080). */
  size?: number;
  format?: "png" | "jpeg";
}

const FONT = "'Noto Sans Tamil','Nirmala UI','Noto Sans','Segoe UI','DejaVu Sans',Arial,sans-serif";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export function hexOr(v: string | null | undefined, fallback: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((v ?? "").trim());
  return m ? `#${m[1]!.toLowerCase()}` : fallback;
}
const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
/** Relative luminance 0..1. */
export function luminance(hex: string): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb(hex);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
/** Black or white, whichever reads better on `bg`. */
export const inkOn = (bg: string): string => (luminance(bg) > 0.4 ? "#161616" : "#ffffff");
function shade(hex: string, k: number): string {
  const [r, g, b] = rgb(hex).map((c) => Math.max(0, Math.min(255, Math.round(c * k))));
  return `#${[r, g, b].map((c) => c!.toString(16).padStart(2, "0")).join("")}`;
}

const isTamilChar = (ch: string) => /[஀-௿]/.test(ch);
const textWidth = (s: string, px: number) => [...s].reduce((n, ch) => n + px * (isTamilChar(ch) ? 0.62 : /[A-Z0-9]/.test(ch) ? 0.62 : ch === " " ? 0.3 : 0.52), 0);

/** Greedy wrap into at most `maxLines` lines no wider than `maxWidth`; the last line ends with "…" when text was cut. Pure. */
export function wrapLines(text: string, px: number, maxWidth: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const all: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (!cur || textWidth(next, px) <= maxWidth) cur = next;
    else {
      all.push(cur);
      cur = w;
    }
  }
  if (cur) all.push(cur);
  const cut = all.length > maxLines;
  const lines = all.slice(0, maxLines);
  const fit = (l: string, ellipsis: boolean) => {
    let t = l;
    while (t.length > 1 && textWidth(ellipsis ? `${t}…` : t, px) > maxWidth) t = t.slice(0, -1).trimEnd();
    return ellipsis ? `${t}…` : t;
  };
  return lines.map((l, i) => (i === lines.length - 1 && cut ? fit(l, true) : textWidth(l, px) > maxWidth ? fit(l, true) : l));
}

export async function composeSocialImage(input: SocialImageInput): Promise<Buffer> {
  const S = input.size ?? 1080;
  const k = S / 1080;
  const px = (n: number) => Math.round(n * k);
  const primary = hexOr(input.primary, "#7a1f3d");
  const accent = hexOr(input.accent, "#f2c14e");
  const ink = inkOn(primary);
  const pillInk = inkOn(accent);
  const m = px(56);
  const photoH = px(700);
  const photoW = S - 2 * m;
  const radius = px(36);

  // ---- the photo (cover-fit, rounded)
  let photoBuf: Buffer;
  if (input.photo) {
    const src = await sharp(input.photo, { animated: false }).rotate().resize({ width: photoW, height: photoH, fit: "cover", position: "attention" }).png().toBuffer();
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${photoW}" height="${photoH}"><rect width="${photoW}" height="${photoH}" rx="${radius}" fill="#fff"/></svg>`);
    photoBuf = await sharp(src).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  } else {
    const letter = esc((input.title.trim()[0] ?? "?").toUpperCase());
    photoBuf = await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${photoW}" height="${photoH}"><rect width="${photoW}" height="${photoH}" rx="${radius}" fill="${shade(primary, 1.25)}"/><text x="50%" y="58%" text-anchor="middle" font-family="${FONT}" font-size="${px(380)}" font-weight="700" fill="${accent}" opacity="0.85">${letter}</text></svg>`,
      ),
    )
      .png()
      .toBuffer();
  }

  // ---- text blocks
  const titlePx = px(58);
  const titleLines = wrapLines(input.title, titlePx, S - 2 * m - px(10), 2);
  const titleY = m + photoH + px(84);
  const titleSvg = titleLines.map((l, i) => `<text x="${m}" y="${titleY + i * px(66)}" font-family="${FONT}" font-size="${titlePx}" font-weight="700" fill="${ink}">${esc(l)}</text>`).join("");
  let pillSvg = "";
  if (input.priceText) {
    const pPx = px(52);
    const w = Math.round(textWidth(input.priceText, pPx) + px(60));
    const h = px(84);
    const x = S - m - w;
    const y = m + photoH - h / 2;
    pillSvg = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${accent}"/><text x="${x + w / 2}" y="${y + h / 2 + pPx * 0.35}" text-anchor="middle" font-family="${FONT}" font-size="${pPx}" font-weight="700" fill="${pillInk}">${esc(input.priceText)}</text>`;
  }
  let badgeSvg = "";
  if (input.badge) {
    const bPx = px(30);
    const w = Math.round(textWidth(input.badge, bPx) + px(44));
    const h = px(58);
    badgeSvg = `<rect x="${m + px(24)}" y="${m + px(24)}" width="${w}" height="${h}" rx="${h / 2}" fill="${primary}"/><text x="${m + px(24) + w / 2}" y="${m + px(24) + h / 2 + bPx * 0.35}" text-anchor="middle" font-family="${FONT}" font-size="${bPx}" font-weight="700" fill="${ink}">${esc(input.badge)}</text>`;
  }
  const footY = S - px(44);
  const logoSize = px(64);
  const shopPx = px(32);
  const hasLogo = !!input.logo;
  const shopX = hasLogo ? m + logoSize + px(18) : m;
  const shopText = wrapLines(input.shopName, shopPx, S - shopX - m, 1)[0] ?? "";
  const footSvg = `<text x="${shopX}" y="${footY - px(14)}" font-family="${FONT}" font-size="${shopPx}" font-weight="600" fill="${ink}" opacity="0.92">${esc(shopText)}</text>`;

  const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${shade(primary, 1.08)}"/><stop offset="1" stop-color="${shade(primary, 0.78)}"/></linearGradient></defs><rect width="${S}" height="${S}" fill="url(#g)"/></svg>`;
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">${titleSvg}${footSvg}</svg>`;
  const top = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">${pillSvg}${badgeSvg}</svg>`;

  const layers: sharp.OverlayOptions[] = [
    { input: photoBuf, left: m, top: m },
    { input: Buffer.from(overlay), left: 0, top: 0 },
    { input: Buffer.from(top), left: 0, top: 0 },
  ];
  if (input.logo) {
    try {
      const logo = await sharp(input.logo, { animated: false }).resize({ width: logoSize, height: logoSize, fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer();
      const circle = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${logoSize}" height="${logoSize}"><circle cx="${logoSize / 2}" cy="${logoSize / 2}" r="${logoSize / 2}" fill="#fff"/></svg>`);
      const round = await sharp(logo).composite([{ input: circle, blend: "dest-in" }]).png().toBuffer();
      layers.push({ input: await sharp({ create: { width: logoSize, height: logoSize, channels: 4, background: "#ffffff" } }).composite([{ input: round }]).png().toBuffer(), left: m, top: S - px(44) - logoSize + px(8) });
    } catch {
      // an unreadable logo is left out; the shop name still shows
    }
  }
  const img = sharp(Buffer.from(bg)).composite(layers);
  return input.format === "jpeg" ? img.jpeg({ quality: 90 }).toBuffer() : img.png().toBuffer();
}
