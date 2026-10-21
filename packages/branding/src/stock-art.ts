import { mix, normalizeHex, relativeLuminance, shade, tint } from "./color";
import { stockMotifs, type Motif } from "./stock-motifs";
import { TRADE_PRESETS, TRADE_PRESET_FOR } from "./theme-presets-trades";

/*
 * Stock artwork per trade, drawn in code: no photo packs, nothing downloaded. Each picture is an SVG built from the
 * shop's own brand colours: a calm backdrop (arches, suns, soft bands, kolam dots …) and one to three flat
 * illustrations of what the trade sells (a folded silk saree, a filter-coffee tumbler, a dumbbell …), lit with soft
 * gradients and a faint paper grain so it reads as artwork rather than clip-art.
 *
 * The pictures are served by the API at `/v1/branding/stock/<trade>/<slot>.svg?p=<primary>&a=<accent>&b=<background>`
 * (see stock-routes.ts) — a site path, so the CMS accepts it and the store / editor resolve it against the API like
 * any uploaded file. `stockArtFor(trade, slot)` gives that path in the trade's own preset colours (starter homes).
 * The SVGs carry no script, no external references and no text.
 */

export const STOCK_TRADES = [
  "fashion",
  "pharmacy",
  "restaurant",
  "cloud_kitchen",
  "grocery",
  "bakery",
  "fresh",
  "electronics",
  "repair",
  "salon",
  "gym",
  "jewellery",
  "hardware",
  "optical",
  "tailoring",
] as const;
export type StockTrade = (typeof STOCK_TRADES)[number];

/** Picture slots: wide heroes (16:7), split heroes (4:5), square tiles and a slim banner (16:5). */
export const STOCK_SLOTS = ["hero-1", "hero-2", "hero-3", "split-1", "split-2", "tile-1", "tile-2", "banner-1"] as const;
export type StockSlot = (typeof STOCK_SLOTS)[number];

export const STOCK_SIZES: Record<StockSlot, { w: number; h: number }> = {
  "hero-1": { w: 1600, h: 700 },
  "hero-2": { w: 1600, h: 700 },
  "hero-3": { w: 1600, h: 700 },
  "split-1": { w: 1000, h: 1250 },
  "split-2": { w: 1000, h: 1250 },
  "tile-1": { w: 1000, h: 1000 },
  "tile-2": { w: 1000, h: 1000 },
  "banner-1": { w: 1600, h: 500 },
};

export interface StockColors {
  primary: string;
  accent?: string | null;
  background?: string | null;
}

export const isStockTrade = (v: string): v is StockTrade => (STOCK_TRADES as readonly string[]).includes(v);
export const isStockSlot = (v: string): v is StockSlot => (STOCK_SLOTS as readonly string[]).includes(v);

// ---------------------------------------------------------------- palette

/** Colours a picture is painted with, all derived from the shop's brand colours. */
export interface Palette {
  dark: boolean;
  /** Page colour behind everything. */
  paper: string;
  /** Faint / soft / medium washes of the brand colour over the paper. */
  wash: string;
  soft: string;
  mid: string;
  brand: string;
  /** Brand colour, darker and darkest. */
  deep: string;
  ink: string;
  /** Lighter brand colour for highlights on deep grounds. */
  light: string;
  /** The shop's accent (or a warm cream when the accent is too close to the paper). */
  accent: string;
  /** Zari / brass, nudged towards the brand. */
  gold: string;
  goldDeep: string;
  /** Polished steel. */
  steel: string;
  steelDeep: string;
  cream: string;
  /** Ground shadows. */
  shadow: string;
  /** Display velvet and gem colours: the brand, unless the brand is itself gold / light, then a deep ruby. */
  velvet: string;
  gem: string;
  /** Natural colours (tomato, leaf …), nudged a little towards the brand so they sit in the same picture. */
  nat: (hex: string) => string;
}

const hex = (v: string | null | undefined, fallback: string) => (v ? (normalizeHex(v) ?? fallback) : fallback);

/** A light / golden brand would vanish against gold jewellery, so velvet and gems switch to ruby. */
function jewelTones(brand: string, dark: boolean): { velvet: string; gem: string } {
  const light = relativeLuminance(brand) > 0.3;
  if (light) return { velvet: dark ? "#4a1222" : "#5c1428", gem: "#c0163f" };
  return { velvet: dark ? mix(brand, "#000000", 0.45) : shade(brand, 0.45), gem: tint(brand, 0.1) };
}

export function stockPalette(colors: StockColors): Palette {
  const brand = hex(colors.primary, "#7c3aed");
  const bg = hex(colors.background, "#ffffff");
  const dark = relativeLuminance(bg) < 0.2;
  const rawAccent = colors.accent ? normalizeHex(colors.accent) : null;
  if (dark) {
    const accent = rawAccent && relativeLuminance(rawAccent) > 0.25 ? rawAccent : tint(brand, 0.55);
    return {
      dark,
      paper: bg,
      wash: mix(bg, brand, 0.08),
      soft: mix(bg, brand, 0.18),
      mid: mix(bg, brand, 0.42),
      brand,
      deep: shade(brand, 0.3),
      ink: mix(bg, "#000000", 0.35),
      light: tint(brand, 0.45),
      accent,
      gold: mix("#e2b25a", brand, 0.12),
      goldDeep: mix("#9a6a1e", brand, 0.12),
      steel: mix("#d9dee5", brand, 0.06),
      steelDeep: mix("#6d7684", brand, 0.08),
      cream: mix("#f6ead2", brand, 0.06),
      shadow: "#000000",
      ...jewelTones(brand, true),
      nat: (c) => mix(c, brand, 0.08),
    };
  }
  const accent = rawAccent && Math.abs(relativeLuminance(rawAccent) - relativeLuminance(bg)) > 0.08 ? rawAccent : mix("#f3dfb8", brand, 0.12);
  return {
    dark,
    paper: bg,
    wash: mix(bg, brand, 0.06),
    soft: mix(bg, brand, 0.14),
    mid: mix(bg, brand, 0.34),
    brand,
    deep: shade(brand, 0.32),
    ink: shade(brand, 0.62),
    light: tint(brand, 0.5),
    accent,
    gold: mix("#d9a441", brand, 0.1),
    goldDeep: mix("#8f5f17", brand, 0.12),
    steel: mix("#dfe3e8", brand, 0.05),
    steelDeep: mix("#7b8494", brand, 0.08),
    cream: mix("#fbf1de", bg, 0.4),
    shadow: shade(brand, 0.7),
    ...jewelTones(brand, false),
    nat: (c) => mix(c, brand, 0.1),
  };
}

// ---------------------------------------------------------------- drawing context

/** Collects <defs> (gradients, patterns) with ids unique to one picture. */
export class Ctx {
  private defs: string[] = [];
  private n = 0;
  constructor(readonly pal: Palette, readonly rnd: () => number) {}

  id(prefix = "d") {
    return `${prefix}${++this.n}`;
  }

  /** Linear gradient top → bottom (or along x1,y1 → x2,y2 in the box); returns `url(#…)`. */
  lin(stops: (string | [string, number])[], x1 = 0, y1 = 0, x2 = 0, y2 = 1, opacity?: number[]): string {
    const id = this.id("l");
    this.defs.push(`<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stopsXml(stops, opacity)}</linearGradient>`);
    return `url(#${id})`;
  }

  /** Radial gradient; returns `url(#…)`. */
  rad(stops: (string | [string, number])[], cx = 0.5, cy = 0.5, r = 0.5, opacity?: number[]): string {
    const id = this.id("r");
    this.defs.push(`<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stopsXml(stops, opacity)}</radialGradient>`);
    return `url(#${id})`;
  }

  def(xml: string) {
    this.defs.push(xml);
  }

  defsXml() {
    return this.defs.join("");
  }
}

function stopsXml(stops: (string | [string, number])[], opacity?: number[]) {
  return stops
    .map((s, i) => {
      const [c, o] = Array.isArray(s) ? s : [s, stops.length === 1 ? 0 : i / (stops.length - 1)];
      const op = opacity?.[i];
      return `<stop offset="${round(o)}" stop-color="${c}"${op !== undefined ? ` stop-opacity="${op}"` : ""}/>`;
    })
    .join("");
}

export const round = (v: number) => Math.round(v * 100) / 100;

/** Small deterministic PRNG (mulberry32) seeded from a string: the same picture every time. */
export function seeded(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- backdrops

type Scene = "arch" | "sun" | "blobs" | "bands" | "kolam" | "deep" | "grid" | "waves";

/** Each trade's backdrops by slot, so a trade has its own feel (heritage arches, fresh blobs, tech grids …). */
const SCENES: Record<StockTrade, Scene[]> = {
  fashion: ["arch", "deep", "kolam", "arch", "sun", "blobs", "deep", "bands"],
  jewellery: ["deep", "arch", "kolam", "arch", "deep", "sun", "deep", "bands"],
  tailoring: ["arch", "grid", "deep", "arch", "sun", "blobs", "deep", "bands"],
  restaurant: ["sun", "deep", "kolam", "arch", "sun", "blobs", "deep", "bands"],
  cloud_kitchen: ["bands", "deep", "sun", "arch", "deep", "blobs", "sun", "bands"],
  grocery: ["blobs", "waves", "sun", "arch", "blobs", "sun", "deep", "bands"],
  fresh: ["waves", "blobs", "deep", "arch", "blobs", "sun", "deep", "waves"],
  bakery: ["sun", "arch", "blobs", "arch", "sun", "blobs", "deep", "bands"],
  pharmacy: ["grid", "blobs", "deep", "arch", "grid", "sun", "deep", "bands"],
  electronics: ["deep", "grid", "sun", "arch", "deep", "grid", "sun", "bands"],
  repair: ["grid", "deep", "bands", "arch", "grid", "sun", "deep", "bands"],
  salon: ["arch", "sun", "blobs", "arch", "deep", "blobs", "sun", "waves"],
  gym: ["deep", "bands", "grid", "arch", "deep", "sun", "bands", "bands"],
  hardware: ["bands", "grid", "deep", "arch", "grid", "sun", "deep", "bands"],
  optical: ["sun", "grid", "deep", "arch", "blobs", "sun", "deep", "waves"],
};

/** Where the motifs stand: x centre, ground line y, size (px for the 400-unit motif box) for each picture slot. */
interface Spot {
  x: number;
  y: number;
  s: number;
}

function blobPath(cx: number, cy: number, r: number, rnd: () => number, points = 7, wobble = 0.22): string {
  const pts = Array.from({ length: points }, (_, i) => {
    const a = (i / points) * Math.PI * 2;
    const rr = r * (1 - wobble / 2 + rnd() * wobble);
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr] as const;
  });
  // Closed Catmull-Rom → cubic Bézier.
  let d = `M${round(pts[0]![0])} ${round(pts[0]![1])}`;
  for (let i = 0; i < points; i++) {
    const p0 = pts[(i - 1 + points) % points]!;
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % points]!;
    const p3 = pts[(i + 2) % points]!;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${round(c1[0]!)} ${round(c1[1]!)} ${round(c2[0]!)} ${round(c2[1]!)} ${round(p2[0])} ${round(p2[1])}`;
  }
  return `${d}Z`;
}

/** A 4-point sparkle. */
export const sparkle = (x: number, y: number, r: number, fill: string, opacity = 1) =>
  `<path d="M${x} ${y - r}C${x + r * 0.18} ${y - r * 0.18} ${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y}C${x + r * 0.18} ${y + r * 0.18} ${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r}C${x - r * 0.18} ${y + r * 0.18} ${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y}C${x - r * 0.18} ${y - r * 0.18} ${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r}Z" fill="${fill}" opacity="${opacity}"/>`;

function backdrop(scene: Scene, c: Ctx, w: number, h: number, spot: Spot): string {
  const P = c.pal;
  const out: string[] = [];
  const r = Math.min(w, h);
  switch (scene) {
    case "arch": {
      out.push(`<rect width="${w}" height="${h}" fill="${c.lin([P.paper, P.wash])}"/>`);
      const aw = spot.s * 1.08;
      const ah = Math.min(h * 0.86, spot.s * 1.5);
      const x0 = spot.x - aw / 2;
      const top = spot.y - ah;
      const arch = (x: number, y: number, ww: number, hh: number) =>
        `M${round(x)} ${round(y + hh)}V${round(y + ww / 2)}A${round(ww / 2)} ${round(ww / 2)} 0 0 1 ${round(x + ww)} ${round(y + ww / 2)}V${round(y + hh)}Z`;
      out.push(`<path d="${arch(x0 - aw * 0.09, top - aw * 0.09, aw * 1.18, ah + aw * 0.09)}" fill="none" stroke="${P.mid}" stroke-opacity=".55" stroke-width="${round(r * 0.004)}"/>`);
      out.push(`<path d="${arch(x0, top, aw, ah)}" fill="${c.lin([P.soft, P.mid], 0, 0, 0, 1, [1, 0.85])}"/>`);
      // Floor: a soft plinth line across the picture.
      out.push(`<rect x="0" y="${round(spot.y)}" width="${w}" height="${round(h - spot.y)}" fill="${P.soft}" opacity=".7"/>`);
      out.push(`<rect x="0" y="${round(spot.y)}" width="${w}" height="${round(r * 0.006)}" fill="${P.mid}" opacity=".6"/>`);
      for (let i = 0; i < 4; i++) out.push(sparkle(round(spot.x + (c.rnd() - 0.5) * aw * 1.6), round(top + c.rnd() * ah * 0.5), round(r * (0.008 + c.rnd() * 0.01)), P.gold, 0.8));
      break;
    }
    case "sun": {
      out.push(`<rect width="${w}" height="${h}" fill="${c.lin([P.wash, P.paper], 0, 0, 1, 1)}"/>`);
      const sr = spot.s * 0.62;
      out.push(`<circle cx="${round(spot.x)}" cy="${round(spot.y - spot.s * 0.48)}" r="${round(sr * 1.25)}" fill="${P.soft}" opacity=".45"/>`);
      out.push(`<circle cx="${round(spot.x)}" cy="${round(spot.y - spot.s * 0.48)}" r="${round(sr)}" fill="${c.lin([P.accent, P.soft], 0, 0, 0, 1)}"/>`);
      out.push(`<circle cx="${round(spot.x + sr * 1.15)}" cy="${round(spot.y - spot.s * 1.0)}" r="${round(sr * 0.16)}" fill="${P.mid}" opacity=".5"/>`);
      out.push(`<circle cx="${round(spot.x - sr * 1.3)}" cy="${round(spot.y - spot.s * 0.2)}" r="${round(sr * 0.09)}" fill="${P.brand}" opacity=".35"/>`);
      out.push(`<rect x="0" y="${round(spot.y)}" width="${w}" height="${round(h - spot.y)}" fill="${P.soft}" opacity=".55"/>`);
      break;
    }
    case "blobs": {
      out.push(`<rect width="${w}" height="${h}" fill="${P.paper}"/>`);
      out.push(`<path d="${blobPath(spot.x, spot.y - spot.s * 0.45, spot.s * 0.7, c.rnd)}" fill="${c.lin([P.soft, P.mid], 0, 0, 1, 1)}" opacity=".8"/>`);
      out.push(`<path d="${blobPath(spot.x + spot.s * 0.55, spot.y - spot.s * 0.85, spot.s * 0.28, c.rnd)}" fill="${P.accent}" opacity=".7"/>`);
      out.push(`<path d="${blobPath(spot.x - spot.s * 0.7, spot.y - spot.s * 0.1, spot.s * 0.18, c.rnd)}" fill="${P.mid}" opacity=".35"/>`);
      for (let i = 0; i < 14; i++) out.push(`<circle cx="${round(c.rnd() * w)}" cy="${round(c.rnd() * h)}" r="${round(r * (0.003 + c.rnd() * 0.004))}" fill="${P.mid}" opacity=".5"/>`);
      break;
    }
    case "bands": {
      out.push(`<rect width="${w}" height="${h}" fill="${P.paper}"/>`);
      const k = h * 1.4;
      for (let i = 0; i < 4; i++) {
        const x = spot.x - spot.s * 0.9 + i * spot.s * 0.42;
        const col = [P.wash, P.soft, P.mid, P.accent][i]!;
        out.push(`<path d="M${round(x)} ${h}L${round(x + k * 0.55)} 0H${round(x + k * 0.55 + spot.s * 0.4)}L${round(x + spot.s * 0.4)} ${h}Z" fill="${col}" opacity="${[0.9, 0.8, 0.45, 0.55][i]}"/>`);
      }
      out.push(`<rect x="0" y="${round(spot.y)}" width="${w}" height="${round(h - spot.y)}" fill="${P.soft}" opacity=".5"/>`);
      break;
    }
    case "kolam": {
      out.push(`<rect width="${w}" height="${h}" fill="${c.lin([P.paper, P.wash])}"/>`);
      const pid = c.id("p");
      const g = r * 0.055;
      c.def(
        `<pattern id="${pid}" width="${round(g)}" height="${round(g)}" patternUnits="userSpaceOnUse"><circle cx="${round(g / 2)}" cy="${round(g / 2)}" r="${round(g * 0.06)}" fill="${P.mid}"/><path d="M${round(g / 2)} ${round(g * 0.12)}Q${round(g * 0.88)} ${round(g * 0.12)} ${round(g * 0.88)} ${round(g / 2)}Q${round(g * 0.88)} ${round(g * 0.88)} ${round(g / 2)} ${round(g * 0.88)}Q${round(g * 0.12)} ${round(g * 0.88)} ${round(g * 0.12)} ${round(g / 2)}Q${round(g * 0.12)} ${round(g * 0.12)} ${round(g / 2)} ${round(g * 0.12)}Z" fill="none" stroke="${P.mid}" stroke-width="${round(g * 0.025)}" opacity=".7"/></pattern>`,
      );
      const mid = c.id("m");
      c.def(`<radialGradient id="${mid}" cx="${round(spot.x / w)}" cy="${round((spot.y - spot.s * 0.5) / h)}" r=".55"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity=".05"/></radialGradient><mask id="${mid}m"><rect width="${w}" height="${h}" fill="url(#${mid})"/></mask>`);
      out.push(`<rect width="${w}" height="${h}" fill="url(#${pid})" mask="url(#${mid}m)" opacity=".8"/>`);
      out.push(`<circle cx="${round(spot.x)}" cy="${round(spot.y - spot.s * 0.48)}" r="${round(spot.s * 0.6)}" fill="${c.rad([P.paper, P.wash], 0.5, 0.5, 0.5)}"/>`);
      out.push(`<circle cx="${round(spot.x)}" cy="${round(spot.y - spot.s * 0.48)}" r="${round(spot.s * 0.6)}" fill="none" stroke="${P.gold}" stroke-width="${round(r * 0.003)}" stroke-dasharray="${round(r * 0.002)} ${round(r * 0.012)}" stroke-linecap="round"/>`);
      out.push(`<rect x="0" y="${round(spot.y)}" width="${w}" height="${round(h - spot.y)}" fill="${P.soft}" opacity=".6"/>`);
      break;
    }
    case "deep": {
      const base = P.dark ? P.paper : P.deep;
      out.push(`<rect width="${w}" height="${h}" fill="${c.lin([P.dark ? P.soft : P.brand, base], 1, 0, 0, 1)}"/>`);
      out.push(`<circle cx="${round(spot.x)}" cy="${round(spot.y - spot.s * 0.5)}" r="${round(spot.s * 0.85)}" fill="${c.rad([P.light, P.brand], 0.5, 0.5, 0.5, [P.dark ? 0.35 : 0.45, 0])}"/>`);
      for (let i = 1; i <= 4; i++)
        out.push(`<circle cx="${round(spot.x)}" cy="${round(spot.y - spot.s * 0.5)}" r="${round(spot.s * (0.45 + i * 0.22))}" fill="none" stroke="${P.light}" stroke-opacity="${round(0.22 - i * 0.04)}" stroke-width="${round(r * 0.0025)}"/>`);
      out.push(`<rect x="0" y="${round(spot.y)}" width="${w}" height="${round(h - spot.y)}" fill="#000" opacity=".16"/>`);
      for (let i = 0; i < 5; i++) out.push(sparkle(round(spot.x + (c.rnd() - 0.5) * spot.s * 2), round(spot.y - spot.s * (0.4 + c.rnd() * 0.8)), round(r * (0.006 + c.rnd() * 0.01)), P.gold, 0.9));
      break;
    }
    case "grid": {
      out.push(`<rect width="${w}" height="${h}" fill="${c.lin([P.paper, P.wash], 0, 0, 1, 1)}"/>`);
      const pid = c.id("p");
      const g = r * 0.06;
      c.def(`<pattern id="${pid}" width="${round(g)}" height="${round(g)}" patternUnits="userSpaceOnUse"><path d="M${round(g)} 0H0V${round(g)}" fill="none" stroke="${P.mid}" stroke-width="${round(g * 0.02)}"/></pattern>`);
      const mid = c.id("m");
      c.def(`<radialGradient id="${mid}" cx="${round(spot.x / w)}" cy="${round((spot.y - spot.s * 0.5) / h)}" r=".6"><stop offset="0" stop-color="#fff" stop-opacity=".8"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient><mask id="${mid}m"><rect width="${w}" height="${h}" fill="url(#${mid})"/></mask>`);
      out.push(`<rect width="${w}" height="${h}" fill="url(#${pid})" mask="url(#${mid}m)" opacity=".7"/>`);
      const cx = spot.x;
      const cy = spot.y - spot.s * 0.48;
      out.push(`<rect x="${round(cx - spot.s * 0.62)}" y="${round(cy - spot.s * 0.62)}" width="${round(spot.s * 1.24)}" height="${round(spot.s * 1.24)}" rx="${round(spot.s * 0.22)}" fill="${c.lin([P.soft, P.wash], 0, 0, 1, 1)}"/>`);
      out.push(`<circle cx="${round(cx + spot.s * 0.62)}" cy="${round(cy - spot.s * 0.62)}" r="${round(spot.s * 0.08)}" fill="${P.brand}" opacity=".85"/>`);
      out.push(`<circle cx="${round(cx - spot.s * 0.8)}" cy="${round(cy + spot.s * 0.3)}" r="${round(spot.s * 0.035)}" fill="${P.mid}"/>`);
      out.push(`<rect x="0" y="${round(spot.y)}" width="${w}" height="${round(h - spot.y)}" fill="${P.soft}" opacity=".45"/>`);
      break;
    }
    case "waves": {
      out.push(`<rect width="${w}" height="${h}" fill="${c.lin([P.paper, P.wash])}"/>`);
      out.push(`<circle cx="${round(spot.x + spot.s * 0.5)}" cy="${round(spot.y - spot.s * 0.95)}" r="${round(spot.s * 0.24)}" fill="${P.accent}" opacity=".9"/>`);
      const wave = (y: number, amp: number, col: string, op: number, ph: number) => {
        const seg = w / 3;
        let d = `M0 ${round(y)}`;
        for (let i = 0; i < 3; i++) d += `Q${round(seg * i + seg / 2)} ${round(y + (i % 2 === ph ? -amp : amp))} ${round(seg * (i + 1))} ${round(y)}`;
        return `<path d="${d}V${h}H0Z" fill="${col}" opacity="${op}"/>`;
      };
      out.push(wave(spot.y - spot.s * 0.35, spot.s * 0.12, P.soft, 0.8, 0));
      out.push(wave(spot.y - spot.s * 0.12, spot.s * 0.1, P.mid, 0.45, 1));
      out.push(`<rect x="0" y="${round(spot.y)}" width="${w}" height="${round(h - spot.y)}" fill="${P.soft}" opacity=".9"/>`);
      break;
    }
  }
  return out.join("");
}

// ---------------------------------------------------------------- composition

/** Where the main motif and its companions stand in each slot (heroes keep the left free for the heading). */
function layout(slot: StockSlot, w: number, h: number): { main: Spot; side: Spot[] } {
  switch (slot) {
    case "hero-1":
      return { main: { x: w * 0.64, y: h * 0.86, s: h * 0.72 }, side: [{ x: w * 0.88, y: h * 0.86, s: h * 0.42 }] };
    case "hero-2":
      return { main: { x: w * 0.7, y: h * 0.84, s: h * 0.68 }, side: [{ x: w * 0.48, y: h * 0.84, s: h * 0.36 }, { x: w * 0.885, y: h * 0.84, s: h * 0.36 }] };
    case "hero-3":
      return { main: { x: w * 0.74, y: h * 0.86, s: h * 0.74 }, side: [] };
    case "split-1":
      return { main: { x: w * 0.5, y: h * 0.8, s: w * 0.72 }, side: [] };
    case "split-2":
      return { main: { x: w * 0.42, y: h * 0.8, s: w * 0.62 }, side: [{ x: w * 0.8, y: h * 0.8, s: w * 0.34 }] };
    case "tile-1":
      return { main: { x: w * 0.5, y: h * 0.84, s: w * 0.66 }, side: [] };
    case "tile-2":
      return { main: { x: w * 0.5, y: h * 0.84, s: w * 0.62 }, side: [] };
    case "banner-1":
      return { main: { x: w * 0.75, y: h * 0.88, s: h * 0.76 }, side: [{ x: w * 0.58, y: h * 0.88, s: h * 0.46 }, { x: w * 0.905, y: h * 0.88, s: h * 0.46 }] };
  }
}

/** Puts a 400-unit motif with its ground line at y=380 on a spot, with a soft contact shadow. */
function place(c: Ctx, m: Motif, spot: Spot, deep: boolean, fill: number): string {
  // Fill `fill` of the frame's height, without getting wider than 1.3 frames.
  const k = Math.min((spot.s * fill) / (380 - m.top), (spot.s * 1.1) / m.width);
  const tx = spot.x - 200 * k;
  const ty = spot.y - 380 * k;
  const shadowFill = deep ? "#000000" : c.pal.shadow;
  const sw = Math.min((m.footprint ?? 0.6) * 200, m.width * 0.55);
  return (
    `<g transform="translate(${round(tx)} ${round(ty)}) scale(${round(k * 1000) / 1000})">` +
    `<ellipse cx="200" cy="382" rx="${round(sw)}" ry="${round(sw * 0.09)}" fill="${shadowFill}" opacity="${deep ? 0.35 : 0.18}" filter="url(#blur)"/>` +
    m.draw(c, c.pal) +
    `</g>`
  );
}

/** Which motif goes where in a slot: [main, ...companions] as indexes into the trade's motif list. */
const PICKS: Record<StockSlot, number[]> = {
  "hero-1": [0, 1],
  "hero-2": [1, 2, 0],
  "hero-3": [2],
  "split-1": [0],
  "split-2": [2, 1],
  "tile-1": [1],
  "tile-2": [0],
  "banner-1": [0, 1, 2],
};

/** The SVG markup of one stock picture in the shop's colours. */
export function stockArtSvg(trade: StockTrade, slot: StockSlot, colors: StockColors): string {
  const { w, h } = STOCK_SIZES[slot];
  const pal = stockPalette(colors);
  const c = new Ctx(pal, seeded(`${trade}:${slot}`));
  const scene = SCENES[trade][STOCK_SLOTS.indexOf(slot)]!;
  const motifs = stockMotifs(trade);
  const { main, side } = layout(slot, w, h);
  const pick = PICKS[slot].map((i) => motifs[i % motifs.length]!);
  const back = backdrop(scene, c, w, h, main);
  const deep = scene === "deep" || pal.dark;
  // Companions first (behind), then the main motif.
  const fig = [...side.map((sp, i) => (pick[i + 1] ? place(c, pick[i + 1]!, sp, deep, 0.9) : "")), place(c, pick[0]!, main, deep, 0.84)].join("");
  const grain = `<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .07 0"/></filter>`;
  const blur = `<filter id="blur" x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="6"/></filter>`;
  const vignette = `<rect width="${w}" height="${h}" fill="${c.rad(["#000", "#000"], 0.5, 0.45, 0.75, [0, deep ? 0.28 : 0.08])}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice">` +
    `<defs>${grain}${blur}${c.defsXml()}</defs>` +
    back +
    fig +
    vignette +
    `<rect width="${w}" height="${h}" filter="url(#grain)" opacity=".9"/>` +
    `</svg>`
  );
}

// ---------------------------------------------------------------- URLs

const strip = (v: string | null | undefined) => (v ? (normalizeHex(v) ?? "").replace("#", "") : "");

/** The site path the API serves a picture at (`/v1/branding/stock/<trade>/<slot>.svg?p=…`). */
export function stockArtPath(trade: StockTrade, slot: StockSlot, colors?: StockColors): string {
  const q = colors ? [["p", strip(colors.primary)], ["a", strip(colors.accent)], ["b", strip(colors.background)]].filter(([, v]) => v) : [];
  return `/v1/branding/stock/${trade}/${slot}.svg${q.length ? `?${q.map(([k, v]) => `${k}=${v}`).join("&")}` : ""}`;
}

/** A trade's own preset colours (the look a new shop of that trade starts with). */
export function tradeColors(trade: StockTrade): StockColors {
  const preset = TRADE_PRESETS.find((p) => p.id === TRADE_PRESET_FOR[trade]);
  return { primary: preset?.colors.primary ?? "#7c3aed", accent: preset?.colors.accent ?? null, background: preset?.colors.background ?? null };
}

/**
 * The stock picture for a trade's slot as a site path, in the shop's colours when given, else the trade preset's.
 * Starter homes use it so a new shop never opens on a blank gradient: `imageUrl: stockArtFor(pack.id, "hero-1")`.
 * Unknown trades fall back to fashion's pictures.
 */
export function stockArtFor(trade: string, slot: StockSlot, colors?: StockColors): string {
  const t = isStockTrade(trade) ? trade : "fashion";
  return stockArtPath(t, slot, colors ?? tradeColors(t));
}

/** The picture as a `data:` URL (thumbnails in the media library, no request per picture). */
export function stockArtDataUrl(trade: StockTrade, slot: StockSlot, colors: StockColors): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(stockArtSvg(trade, slot, colors))}`;
}

/** Parses `p` / `a` / `b` query values (hex without '#') back into colours; missing ones fall back to the trade's. */
export function stockColorsFromQuery(trade: StockTrade, q: { p?: string; a?: string; b?: string }): StockColors {
  const fix = (v?: string) => (v && /^[0-9a-f]{6}$/i.test(v) ? `#${v.toLowerCase()}` : null);
  const base = tradeColors(trade);
  const primary = fix(q.p);
  return primary ? { primary, accent: fix(q.a), background: fix(q.b) } : base;
}
