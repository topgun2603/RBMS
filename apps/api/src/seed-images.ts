import { rasterizeSvg } from "@rbms/uploads";
import type { Logger } from "pino";
import type { Kit } from "./kit";

/**
 * Placeholder product pictures for the demo store: an SVG drawn in code (a soft colour per product, a garment line
 * icon picked from the name/category, the product's initials and name), rendered to WebP on the server and stored
 * through the uploads service as a public file. No SVG is stored or served, and user uploads keep their allow-list.
 *
 * Idempotent: a product gets a placeholder only when it has no pictures, or when all its pictures are earlier
 * placeholders of an older design (then they are replaced and the old files removed). Pictures an owner added are
 * never touched.
 */

/** Bump to redraw existing placeholders on the next seed run. */
export const PLACEHOLDER_VERSION = 2;
export const PLACEHOLDER_PURPOSE = "demo-placeholder";
const W = 800;
const H = 1000;

export type GarmentKind = "saree" | "shirt" | "kurta" | "dress" | "bottoms" | "dupatta" | "generic";

/** Picks the line icon from the product name (first) and category. */
export function garmentKind(name: string, category?: string | null): GarmentKind {
  const rules: [GarmentKind, RegExp][] = [
    ["saree", /\b(sarees?|saris?|pattu|kanchipuram|kanjeevaram)\b/i],
    ["dupatta", /\b(dupattas?|stoles?|shawls?|scarf|scarves)\b/i],
    ["dress", /\b(anarkalis?|dress|dresses|gowns?|frocks?|lehengas?|maxi)\b/i],
    ["bottoms", /\b(palazzos?|pant|pants|trousers?|leggings?|jeans|bottoms?|skirts?|dhotis?|veshtis?)\b/i],
    ["shirt", /\b(shirts?|tees?|t-shirts?|tops?|blouses?)\b/i],
    ["kurta", /\b(kurti|kurtis|kurta|kurtas|tunic)\b/i],
  ];
  for (const text of [name, category ?? ""]) for (const [kind, re] of rules) if (re.test(text)) return kind;
  return "generic";
}

interface Palette {
  /** Background, top → bottom. */
  bg: [string, string];
  /** Lines and text. */
  ink: string;
  /** Soft fill inside the garment. */
  fill: string;
}

/** Calm, fabric-like tones that sit well next to each other in a product grid. */
export const PALETTES: Palette[] = [
  { bg: ["#f6efff", "#e6d8fb"], ink: "#4c1d95", fill: "#ddc9fa" },
  { bg: ["#fff0f2", "#f9d3dc"], ink: "#9f1239", fill: "#f6c1cf" },
  { bg: ["#e9f7f4", "#c9ebe4"], ink: "#115e59", fill: "#b5e2d8" },
  { bg: ["#fff5e3", "#fbe1b6"], ink: "#9a3412", fill: "#f8d39b" },
  { bg: ["#edf2ff", "#d3defc"], ink: "#3730a3", fill: "#c3d2fa" },
  { bg: ["#f0f6ea", "#d8e9cd"], ink: "#3f6212", fill: "#c9e0b9" },
  { bg: ["#faf3ec", "#ecdcc8"], ink: "#7c2d12", fill: "#e6cfb3" },
];

/** Stable small hash (FNV-1a) so a product always gets the same colour. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const paletteFor = (name: string): Palette => PALETTES[hash(name.trim().toLowerCase()) % PALETTES.length]!;

/** "Silk Saree (Kanchipuram)" → "SS"; "Kurti (cotton)" → "K". */
export function initials(name: string): string {
  const words = name
    .replace(/\(.*?\)/g, " ")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  return (words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "•").slice(0, 2);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Garment outlines in a 200×200 box (stroke = ink, fill = soft tone). */
function garment(kind: GarmentKind, p: Palette): string {
  const line = `fill="none" stroke="${p.ink}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"`;
  const body = `fill="${p.fill}" stroke="${p.ink}" stroke-width="3.5" stroke-linejoin="round"`;
  switch (kind) {
    case "kurta":
      return `<path ${body} d="M78 26 90 20Q100 28 110 20L122 26 152 46 142 76 130 68V184H70V68L58 76 48 46Z"/>
        <path ${line} d="M92 20Q100 34 108 20M100 30V70M70 150Q76 152 80 184M130 150Q124 152 120 184"/>
        <circle cx="100" cy="82" r="2.4" fill="${p.ink}"/><circle cx="100" cy="96" r="2.4" fill="${p.ink}"/>
        <path ${line} d="M80 120Q100 126 120 120" stroke-opacity="0.45"/>`;
    case "dress":
      return `<path ${body} d="M82 26Q100 40 118 26L130 34 124 84 168 178H32L76 84 70 34Z"/>
        <path ${line} d="M76 84Q100 94 124 84M64 128Q100 140 136 128M48 162Q100 176 152 162"/>`;
    case "shirt":
      return `<path ${body} d="M74 30 88 24 100 36 112 24 126 30 160 52 148 84 136 76V178H64V76L52 84 40 52Z"/>
        <path ${line} d="M88 24 100 52 112 24M100 52V178"/>
        <circle cx="108" cy="74" r="2.4" fill="${p.ink}"/><circle cx="108" cy="100" r="2.4" fill="${p.ink}"/><circle cx="108" cy="126" r="2.4" fill="${p.ink}"/>`;
    case "bottoms":
      return `<path ${body} d="M66 26H134L142 50 164 178H110L100 84 90 178H36L58 50Z"/>
        <path ${line} d="M62 44H138M100 44V84"/>`;
    case "saree":
      return `<rect x="30" y="66" width="140" height="104" rx="10" ${body}/>
        <path fill="${p.ink}" fill-opacity="0.18" d="M30 150H170V160Q170 170 160 170H40Q30 170 30 160Z"/>
        <path ${line} d="M30 148H170"/>
        <path ${body} d="M96 66 136 66 112 170 72 170Z"/>
        <path ${line} d="M104 82 122 82M100 100 118 100M96 118 114 118M92 136 110 136" stroke-opacity="0.6"/>
        <circle cx="48" cy="90" r="3" fill="${p.ink}" fill-opacity="0.5"/><circle cx="66" cy="106" r="3" fill="${p.ink}" fill-opacity="0.5"/><circle cx="48" cy="122" r="3" fill="${p.ink}" fill-opacity="0.5"/>
        <circle cx="152" cy="90" r="3" fill="${p.ink}" fill-opacity="0.5"/><circle cx="152" cy="122" r="3" fill="${p.ink}" fill-opacity="0.5"/>
        <path ${line} d="M48 160H58M64 160H74M128 160H138M144 160H154"/>`;
    case "dupatta":
      return `<path ${body} d="M40 46Q70 30 100 46T160 46L160 70Q130 54 100 70T40 70Z"/>
        <path ${body} d="M60 70Q66 120 52 178H78Q90 120 84 64M140 70Q134 120 148 178H122Q110 120 116 64"/>
        <path ${line} d="M52 178 50 188M60 178 60 188M70 178 70 188M122 178 120 188M132 178 132 188M142 178 144 188"/>`;
    case "generic":
      return `<path ${line} d="M100 44Q100 30 112 30T122 44Q122 54 100 64L36 112Q28 120 40 122H160Q172 120 164 112L100 64"/>
        <rect x="70" y="128" width="60" height="50" rx="8" ${body}/>
        <circle cx="100" cy="142" r="4" fill="${p.ink}"/>`;
  }
}

/** The placeholder as SVG markup (800×1000, the store's 4:5 product picture). */
export function placeholderSvg(name: string, category?: string | null, shopName?: string): string {
  const p = paletteFor(name);
  const kind = garmentKind(name, category);
  const title = name.length > 26 ? `${name.slice(0, 25).trimEnd()}…` : name;
  const fontSize = title.length > 22 ? 40 : title.length > 16 ? 46 : 52;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${p.bg[0]}"/><stop offset="1" stop-color="${p.bg[1]}"/></linearGradient>
    <pattern id="dots" width="40" height="40" patternUnits="userSpaceOnUse"><circle cx="20" cy="20" r="2" fill="${p.ink}" fill-opacity="0.07"/></pattern>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#dots)"/>
  <circle cx="400" cy="430" r="250" fill="#ffffff" fill-opacity="0.55"/>
  <circle cx="400" cy="430" r="290" fill="none" stroke="${p.ink}" stroke-opacity="0.12" stroke-width="2" stroke-dasharray="2 10" stroke-linecap="round"/>
  <g transform="translate(220 250) scale(1.8)">${garment(kind, p)}</g>
  <g font-family="Georgia, 'Times New Roman', serif" fill="${p.ink}" text-anchor="middle">
    <text x="400" y="820" font-size="${fontSize}" font-weight="700">${esc(title)}</text>
    ${shopName ? `<text x="400" y="872" font-family="'Segoe UI', Arial, sans-serif" font-size="22" letter-spacing="6" fill-opacity="0.7">${esc(shopName.toUpperCase())}</text>` : ""}
  </g>
  <g font-family="'Segoe UI', Arial, sans-serif" text-anchor="middle">
    <circle cx="${W - 84}" cy="${H - 84}" r="38" fill="${p.ink}" fill-opacity="0.9"/>
    <text x="${W - 84}" y="${H - 73}" font-size="28" font-weight="700" fill="#ffffff">${esc(initials(name))}</text>
  </g>
</svg>`;
}

const PLACEHOLDER_URL = new RegExp(`/${PLACEHOLDER_PURPOSE}/\\d{4}/\\d{2}/([0-9a-f-]{36})-[^/]*$`, "i");
const currentMarker = `-ph${PLACEHOLDER_VERSION}.webp`;

/** The uploads file id when `url` is one of our placeholders, else null. */
export function placeholderFileId(url: string): string | null {
  return PLACEHOLDER_URL.exec(url)?.[1] ?? null;
}

/** What to do with a product's pictures: keep them, or (re)place them with a fresh placeholder. */
export function placeholderAction(images: readonly { url: string }[]): "add" | "replace" | "keep" {
  if (images.length === 0) return "add";
  if (!images.every((i) => placeholderFileId(i.url))) return "keep"; // an owner's picture is there
  return images.some((i) => i.url.endsWith(currentMarker)) ? "keep" : "replace";
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "product";

/**
 * Gives the named products (or every product, when `names` is omitted) a generated placeholder picture where they
 * have none. Returns how many products got one.
 */
export async function seedProductImages(kit: Kit, tenantId: string, log: Logger, label: string, opts: { names?: string[]; shopName?: string } = {}) {
  const wanted = opts.names ? new Set(opts.names) : null;
  const categories = new Map((await kit.catalogue.service.listCategories(tenantId)).items.map((c) => [c.id, c.name]));
  const list = await kit.catalogue.service.listProducts(tenantId, { limit: 200 });
  let done = 0;
  for (const summary of list.items) {
    if (wanted && !wanted.has(summary.name)) continue;
    const product = await kit.catalogue.service.getProduct(tenantId, summary.id);
    const old = [...product.images];
    const action = placeholderAction(old);
    if (action === "keep") continue;
    const category = product.categoryId ? (categories.get(product.categoryId) ?? null) : null;
    const body = await rasterizeSvg(placeholderSvg(product.name, category, opts.shopName), { width: W });
    const file = await kit.uploads.service.storeGenerated({
      tenantId,
      filename: `${slugify(product.name)}${currentMarker}`,
      contentType: "image/webp",
      body,
      visibility: "public",
      purpose: PLACEHOLDER_PURPOSE,
    });
    await kit.catalogue.service.updateProduct(tenantId, product.id, { images: [{ url: file.url, alt: product.name }] });
    if (action === "replace") {
      for (const img of old) {
        const id = placeholderFileId(img.url);
        if (id) await kit.uploads.service.remove(id, tenantId).catch(() => undefined);
      }
    }
    done++;
    log.info({ product: product.name, url: file.url }, `${label}: placeholder picture ${action === "add" ? "added" : "redrawn"}`);
  }
  return done;
}
