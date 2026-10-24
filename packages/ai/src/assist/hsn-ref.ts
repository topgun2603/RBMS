import { HSN_DATA } from "../data/hsn-data";

/**
 * The HSN / SAC reference (official GST portal master, see data/hsn-data.ts). Used to CHECK what the model suggests:
 * a heading that is not in this table is never shown as a suggestion.
 */
export interface HsnEntry {
  code: string;
  kind: "goods" | "service";
  description: string;
}

let loaded: { byKey: Map<string, HsnEntry>; headings: HsnEntry[]; sub: Map<string, HsnEntry[]> } | null = null;

function load() {
  if (loaded) return loaded;
  const byKey = new Map<string, HsnEntry>();
  const headings: HsnEntry[] = [];
  const sub = new Map<string, HsnEntry[]>();
  for (const line of HSN_DATA.split("\n")) {
    const [k, code, ...rest] = line.split("|");
    if (!code) continue;
    const e: HsnEntry = { code, kind: k === "S" ? "service" : "goods", description: rest.join("|") };
    byKey.set(`${e.kind}:${code}`, e);
    if (code.length === 4 && e.kind === "goods") headings.push(e);
    if (code.length === 6 && e.kind === "goods") {
      const key = `goods:${code.slice(0, 4)}`;
      const list = sub.get(key) ?? [];
      list.push(e);
      sub.set(key, list);
    }
  }
  loaded = { byKey, headings, sub };
  return loaded;
}

export const hsnKind = (code: string): "goods" | "service" => (code.startsWith("99") ? "service" : "goods");
export const digitsOf = (v: unknown) => String(v ?? "").replace(/\D/g, "");
export const lookupHsn = (code: string): HsnEntry | undefined => load().byKey.get(`${hsnKind(code)}:${code}`);

/**
 * Checks a code the model gave. Returns the code to show (4 or 6 digits) with the official description, or null.
 * A code longer than 6 digits is cut back to its 6-digit subheading when that exists, else to the heading. A 6-digit code
 * that is not in the table falls back to its heading (still a real heading). 2-digit chapters are too vague: null.
 */
export function validateHsn(raw: unknown): { code: string; description: string; kind: "goods" | "service" } | null {
  const d = digitsOf(raw);
  if (d.length < 4 || d.length > 8) return null;
  for (const len of [6, 4]) {
    if (d.length < len) continue;
    const c = d.slice(0, len);
    const e = lookupHsn(c);
    if (e) return { code: c, description: e.description, kind: e.kind };
  }
  return null;
}

const STOP = new Set(["the", "and", "for", "with", "pack", "packet", "set", "new", "small", "big", "large", "size", "inch", "service", "services", "other", "others", "including", "include", "included", "article", "articles", "product", "products", "parts", "part", "goods", "thereof", "whether", "not", "elsewhere", "specified"]);
const tokens = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((x) => x.length > 2 && !STOP.has(x) && !/^\d+$/.test(x))
    .map((x) => (x.length > 4 && x.endsWith("s") ? x.slice(0, -1) : x));

/** Keyword search of goods headings by description words and the words of their subheadings; helps the model on a re-ask. */
export function searchHeadings(query: string, limit = 12): HsnEntry[] {
  const q = tokens(query);
  if (q.length === 0) return [];
  const { headings, sub } = load();
  const scored: { e: HsnEntry; s: number }[] = [];
  for (const h of headings) {
    const own = new Set(tokens(h.description));
    const kidSet = new Set((sub.get(`goods:${h.code}`) ?? []).flatMap((x) => tokens(x.description)));
    let s = 0;
    for (const x of q) {
      if (own.has(x)) s += 3;
      else if (kidSet.has(x)) s += 1.5;
    }
    if (s > 0) scored.push({ e: h, s: s / Math.sqrt(1 + own.size / 8) });
  }
  return scored.sort((a, b) => b.s - a.s || a.e.code.localeCompare(b.e.code)).slice(0, limit).map((x) => x.e);
}

/** Do two descriptions share a content word? Used to catch a code whose real title has nothing to do with what the model said it was. */
export function sharesWord(a: string, b: string): boolean {
  const x = new Set(tokens(a));
  return tokens(b).some((w) => x.has(w));
}

/** The 4-digit SAC headings (services), for the prompt: a service must be named by one of these. */
export function sacHeadings(): HsnEntry[] {
  const { byKey } = load();
  return [...byKey.values()].filter((e) => e.kind === "service" && e.code.length === 4);
}

export const hsnStats = () => {
  const { byKey, headings } = load();
  return { entries: byKey.size, headings: headings.length };
};
