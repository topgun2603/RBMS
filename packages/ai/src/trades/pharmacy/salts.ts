/**
 * Active ingredients from a medicine's composition text ("Aceclofenac 100 mg + Paracetamol 325 mg"), in code.
 * Used for duplicate-salt detection, the interaction lookup and prescription matching. No model is involved.
 */

const STOP_WORDS = new Set(["sodium", "potassium", "hydrochloride", "hcl", "diethylamine", "proxetil", "sulphate", "sulfate", "dihydrate", "tablet", "tablets", "capsule", "capsules", "syrup", "ip", "bp", "usp", "sr", "er", "xl", "cr", "mr", "dispersible", "forte"]);

/** Names that are the same active substance (or the same family for duplicate purposes) -> the name we compare on. */
const ALIASES: [RegExp, string][] = [
  [/^levocetirizine/, "cetirizine"],
  [/^cetirizine/, "cetirizine"],
  [/^acetaminophen|^paracetamol/, "paracetamol"],
  [/^ferrous|^iron/, "iron"],
  [/^vitamin d3?$|^cholecalciferol|^vit d3?$/, "vitamin d3"],
  [/^ascorbic acid|^vitamin c$/, "vitamin c"],
  [/^clavulanic acid|^clavulanate/, "clavulanic acid"],
  [/^magnesium/, "antacid"],
  [/^aluminium hydroxide|^aluminum hydroxide/, "antacid"],
  [/^diclofenac/, "diclofenac"],
  [/^calcium/, "calcium"],
  [/^zinc/, "zinc"],
  [/^folic acid/, "folic acid"],
  [/^insulin/, "insulin"],
  [/^acetylsalicylic acid|^aspirin/, "aspirin"],
];

const UNIT = /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|ug|g|gm|ml|iu|%|units?|l)\b(?:\s*\/\s*\d*\s*(?:ml|g|mg|dose))?/gi;

/** Ingredients that are not active salts (devices, herbal jams...) never count as duplicates. */
const NOT_A_SALT = /\b(thermometer|monitor|bandage|cotton|mask|diaper|napkin|bottle|nebuli[sz]er|oximeter|glucometer|strips?|shampoo|toothpaste|lotion|sanitizer|herbal|ayurvedic|siddha|extract|whey|supplement|lozenge|jam|powder)\b/i;

export function canonIngredient(raw: string): string | null {
  let t = raw.toLowerCase().replace(/\(.*?\)/g, " ").replace(UNIT, " ").replace(/[0-9.,%]+/g, " ");
  t = t
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .join(" ")
    .trim();
  if (t.length < 3 || NOT_A_SALT.test(t)) return null;
  for (const [rx, to] of ALIASES) if (rx.test(t)) return to;
  return t;
}

/** The distinct active ingredients of a composition, in order. */
export function ingredientsOf(composition: string | null | undefined): string[] {
  if (!composition) return [];
  const out: string[] = [];
  for (const part of composition.split(/\s*(?:\+|\/|,|&|\band\b)\s*/i)) {
    const c = canonIngredient(part);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/** Strength numbers (mg, mcg, g, IU, %) written in a text, as "650mg"; used to tell 500 mg from 650 mg. */
export function strengthsOf(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.toLowerCase().matchAll(/(\d+(?:\.\d+)?)\s*(mg|mcg|µg|ug|g|gm|iu|%)/g)) {
    const unit = m[2] === "ug" || m[2] === "µg" ? "mcg" : m[2] === "gm" ? "g" : m[2];
    out.push(`${Number(m[1])}${unit}`);
  }
  return [...new Set(out)];
}

const TOPICAL = /\b(gel|cream|ointment|spray|lotion|drops?|shampoo|inhaler|paint|patch)\b/i;
/** Applied on the skin, eye or breathed in: the same salt in a tablet and a gel is not "the same salt twice" for a warning. */
export const isTopical = (nameOrComposition: string) => TOPICAL.test(nameOrComposition);
