/**
 * Menu from a photo: the vision model transcribes a printed menu; code cleans it, works out portions and prices in paise,
 * marks veg / egg / non-veg only from explicit marks, finds dishes the shop already has, and fills the HSN/SAC and GST from
 * the shop's own dishes. Nothing is created until the owner reviews the table and confirms; the creation goes through the
 * normal catalogue path.
 */
import { z } from "zod";
import type { AiSchema } from "../../types";
import { VISION_SAFETY_RULES, jConf, jNum, jStr, zConf, zNum, zStr } from "../../vision/shared";
import { Flags, cleanText, safeText, type Flag } from "../common";

export const MENU_FEATURE = "menu-photo";
export const MENU_CREDITS_HINT = 60;
export const MARKS = ["veg", "egg", "nonveg", "unknown"] as const;
export type Mark = (typeof MARKS)[number];

export const MENU_SYSTEM = `You read photos (or a PDF) of a printed restaurant menu in India so the owner can add the dishes to their billing system after checking. The menu may be in English, Tamil or both, and may span several photos (pages of one menu).

For each dish:
- name: the dish name in English as printed. If the menu prints only Tamil, transliterate the name into English letters and keep the Tamil in nameTa. "" if unreadable.
- nameTa: the Tamil name ONLY if it is printed on the menu, else "".
- category: the section heading the dish sits under (Starters, Biryani, Parotta, Beverages...), "" if none.
- description: a description ONLY if printed, else "".
- mark: "veg", "egg" or "nonveg" ONLY when the menu shows it explicitly (a green or red/brown dot symbol, the words Veg / Non-Veg / Egg, a (V) or (NV) mark, or the section is titled Veg or Non-Veg). Otherwise "unknown". Never infer it from the dish name.
- portions: every price listed for the dish, as { label, price }. label is as printed (Half, Full, Regular, Large, Small, 250 ml, Plate, 4 pcs...). If the dish has a single price, return one entry with label "". price is the number printed, in rupees (plain number, no currency sign). null when a price is shown as "MP", "-" or cannot be read.
- confidence: high / medium / low for the dish (name, price and mark).
Never invent a dish or a price. Do not read offers, phone numbers, addresses or taxes as dishes. Do not merge two different dishes. If two columns show Half and Full prices for several dishes, give each dish both portions.
- readable: false when the image is not a menu or cannot be read; explain briefly in "notes".
${VISION_SAFETY_RULES}`;

export const MENU_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["readable", "notes", "dishes"],
  properties: {
    readable: { type: "boolean" },
    notes: jStr,
    dishes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "nameTa", "category", "description", "mark", "portions", "confidence"],
        properties: {
          name: jStr,
          nameTa: jStr,
          category: jStr,
          description: jStr,
          mark: { type: "string", enum: [...MARKS] },
          portions: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "price"], properties: { label: jStr, price: jNum } } },
          confidence: jConf,
        },
      },
    },
  },
} as const;

export const MenuRawSchema = z.object({
  readable: z.boolean().catch(false),
  notes: zStr,
  dishes: z
    .array(
      z.object({
        name: zStr,
        nameTa: zStr,
        category: zStr,
        description: zStr,
        mark: z.enum(MARKS).catch("unknown"),
        portions: z.array(z.object({ label: zStr, price: zNum })).max(8).catch([]),
        confidence: zConf,
      }),
    )
    .max(300)
    .catch([]),
});
export type MenuRaw = z.infer<typeof MenuRawSchema>;
export const MENU_SCHEMA: AiSchema<MenuRaw> = { name: "restaurant_menu", jsonSchema: MENU_JSON_SCHEMA as unknown as Record<string, unknown>, zod: MenuRawSchema as unknown as z.ZodType<MenuRaw> };

// ------------------------------------------------------------------ names

const TAMIL = /[஀-௿]/;
export const normDish = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9஀-௿\s]/g, " ")
    .replace(/\b(the|a|special|style|fry|dish)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n]!;
}

/** 0..1: how alike two dish names are (same words in any order, or a small typo). */
export function dishSimilarity(a: string, b: string): number {
  const x = normDish(a);
  const y = normDish(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const tx = [...new Set(x.split(" "))].sort().join(" ");
  const ty = [...new Set(y.split(" "))].sort().join(" ");
  if (tx === ty) return 0.98;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

// ------------------------------------------------------------------ processing

export interface ExistingDish {
  id: string;
  name: string;
  hsn: string | null;
  gstRate: number;
}

export interface MenuContext {
  existing: ExistingDish[];
  /** Names of the shop's categories (to say which ones will be created). */
  categories: string[];
}

export interface DraftPortion {
  label: string;
  /** Paise, as printed (GST included, like the shop's existing dishes). Null = no price read: the owner types it. */
  price: number | null;
}

export interface DraftDish {
  n: number;
  name: string;
  nameTa: string | null;
  category: string | null;
  description: string | null;
  /** true = veg, false = non-veg (egg is false with `egg` set), null = not marked on the menu. */
  veg: boolean | null;
  egg: boolean;
  mark: Mark;
  portions: DraftPortion[];
  confidence: "high" | "medium" | "low";
  /** Existing dish with the same / nearly the same name. */
  duplicateOf: { id: string; name: string; similarity: number } | null;
  /** Ticked by default: no duplicate, every portion priced, not low confidence. */
  select: boolean;
  why: string | null;
  newCategory: boolean;
}

export interface MenuDefaults {
  hsn: string;
  gstRate: number;
  /** "shop" = taken from the shop's existing dishes. */
  source: "shop" | "default";
}

export interface MenuDraft {
  readable: boolean;
  notes: string | null;
  dishes: DraftDish[];
  defaults: MenuDefaults;
  flags: Flag[];
}

export const RESTAURANT_SAC = "996331";
export const RESTAURANT_GST = 5;

/** The most common HSN/SAC and GST rate among the shop's own dishes. */
export function shopDefaults(existing: ExistingDish[]): MenuDefaults {
  const counts = new Map<string, { hsn: string; gst: number; n: number }>();
  for (const e of existing) {
    if (!e.hsn) continue;
    const k = `${e.hsn}|${e.gstRate}`;
    const c = counts.get(k) ?? { hsn: e.hsn, gst: e.gstRate, n: 0 };
    c.n++;
    counts.set(k, c);
  }
  const best = [...counts.values()].sort((a, b) => b.n - a.n)[0];
  return best ? { hsn: best.hsn, gstRate: best.gst, source: "shop" } : { hsn: RESTAURANT_SAC, gstRate: RESTAURANT_GST, source: "default" };
}

const MAX_PRICE = 50_000;

export function processMenu(raw: MenuRaw, ctx: MenuContext): MenuDraft {
  const flags = new Flags();
  const merged = new Map<string, DraftDish>();
  const catKey = new Set(ctx.categories.map((c) => normDish(c)));
  let n = 0;
  raw.dishes.forEach((r, i) => {
    const name = safeText(r.name, 100, flags, "name", i);
    if (!name) {
      if (r.name) return; // dropped (injection): already flagged
      flags.add("dish_unreadable", "warn", { line: i });
      return;
    }
    const nameTaRaw = safeText(r.nameTa, 100, flags, "nameTa", i);
    const nameTa = nameTaRaw && TAMIL.test(nameTaRaw) ? nameTaRaw : null;
    const category = safeText(r.category, 60, flags, "category", i);
    const description = safeText(r.description, 300, flags, "description", i);
    const portions: DraftPortion[] = [];
    for (const p of r.portions) {
      const label = safeText(p.label, 30, flags, "portion", i) ?? "";
      let price: number | null = null;
      if (p.price !== null && Number.isFinite(p.price)) {
        if (p.price >= 1 && p.price <= MAX_PRICE) price = Math.round(p.price * 100);
        else flags.add("price_out_of_range", "warn", { line: i });
      }
      if (!portions.some((x) => x.label.toLowerCase() === label.toLowerCase() && x.price === price)) portions.push({ label, price });
    }
    if (portions.length === 0) portions.push({ label: "", price: null });
    const key = `${normDish(name)}|${normDish(category ?? "")}`;
    const prior = merged.get(key);
    if (prior) {
      for (const p of portions) if (!prior.portions.some((x) => x.label.toLowerCase() === p.label.toLowerCase())) prior.portions.push(p);
      flags.add("merged_duplicate", "info", { line: i });
      return;
    }
    const mark = r.mark;
    const dup = ctx.existing
      .map((e) => ({ e, s: dishSimilarity(name, e.name) }))
      .filter((x) => x.s >= 0.85)
      .sort((a, b) => b.s - a.s)[0];
    n++;
    merged.set(key, {
      n,
      name,
      nameTa,
      category,
      description,
      veg: mark === "veg" ? true : mark === "unknown" ? null : false,
      egg: mark === "egg",
      mark,
      portions,
      confidence: r.confidence,
      duplicateOf: dup ? { id: dup.e.id, name: dup.e.name, similarity: Math.round(dup.s * 100) / 100 } : null,
      select: false,
      why: null,
      newCategory: !!category && !catKey.has(normDish(category)),
    });
  });
  const dishes = [...merged.values()];
  for (const d of dishes) {
    // Portions of one dish need distinct labels so they can become variants; blank labels are named by position.
    if (d.portions.length > 1) {
      const used = new Set<string>();
      d.portions.forEach((p, k) => {
        const base = p.label.trim() || (k === 0 ? "Regular" : `Option ${k + 1}`);
        let l = base;
        for (let c = 2; used.has(l.toLowerCase()); c++) l = `${base} ${c}`;
        used.add(l.toLowerCase());
        p.label = l;
      });
    }
    const unpriced = d.portions.some((p) => p.price === null);
    d.why = d.duplicateOf ? "duplicate" : unpriced ? "price_missing" : d.confidence === "low" ? "low_confidence" : null;
    d.select = d.why === null;
  }
  if (dishes.length === 0 && raw.readable) flags.add("no_dishes", "warn");
  const dup = dishes.filter((d) => d.duplicateOf).length;
  if (dup) flags.add("duplicates", "info", { params: { count: dup } });
  return { readable: raw.readable, notes: cleanText(raw.notes, 300), dishes, defaults: shopDefaults(ctx.existing), flags: flags.list };
}

/** The catalogue product a confirmed draft dish becomes (prices GST-included, one variant per portion, like the shop's other dishes). */
export function productFor(d: DraftDish, defaults: MenuDefaults, categoryId: string | null) {
  const multi = d.portions.length > 1;
  const tags = ["menu-photo", d.veg === true ? "veg" : d.egg ? "egg" : d.veg === false ? "non-veg" : null].filter((x): x is string => !!x);
  const diet = d.veg === true ? "Veg" : d.egg ? "Egg" : d.veg === false ? "Non-veg" : null;
  return {
    name: d.name,
    description: d.description ?? undefined,
    categoryId: categoryId ?? undefined,
    hsn: defaults.hsn,
    gstRate: defaults.gstRate,
    unit: "plate",
    taxInclusive: true,
    status: "active" as const,
    tags,
    attributes: diet ? { Diet: diet } : {},
    options: multi ? [{ name: "Portion", values: d.portions.map((p) => p.label) }] : [],
    variants: d.portions.map((p, i) => ({
      title: multi ? p.label : "",
      optionValues: multi ? { Portion: p.label } : {},
      price: p.price ?? 0,
      mrp: p.price ?? 0,
      isDefault: i === 0,
    })),
  };
}
