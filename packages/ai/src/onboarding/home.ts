import { PACKS, starterHome, type BusinessType } from "@srirealtime/verticals";
import { filterClaims } from "../assist/safety";
import type { SetupProposal } from "./proposal";

type Sec = Record<string, unknown> & { type: string; id?: string };
type L = "en" | "ta";

const STATED_USP = {
  delivery: { icon: "truck", en: ["Home delivery", "Order online, we bring it to you"], ta: ["வீட்டு டெலிவரி", "ஆன்லைனில் ஆர்டர் செய்யுங்கள், வீட்டுக்குக் கொண்டு வருவோம்"] },
  pickup: { icon: "clock", en: ["Pick up at the shop", "Order online and collect it"], ta: ["கடையில் வாங்கலாம்", "ஆன்லைனில் ஆர்டர் செய்து வந்து வாங்கிக்கொள்ளுங்கள்"] },
  tamil: { icon: "heart", en: ["Tamil and English", "Shop in the language you like"], ta: ["தமிழும் ஆங்கிலமும்", "விரும்பிய மொழியில் வாங்குங்கள்"] },
} as const;

/** Words of a section (for `translations.ta`): strings, lists and objects only, never flags, numbers or links. */
export function wordsOf(v: unknown, key = ""): unknown {
  if (typeof v === "string") return /(?:href|url|Url|id)$/.test(key) || key === "type" || key === "icon" || key === "layout" ? undefined : v;
  if (Array.isArray(v)) {
    const out = v.map((x) => wordsOf(x) ?? {});
    return out.length ? out : undefined;
  }
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (["style", "hidden", "id", "type", "imageSide", "showSilver", "categoryIds"].includes(k)) continue;
      const w = wordsOf(x, k);
      if (w !== undefined) out[k] = w;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}

/**
 * The trade's starter home (packages/verticals starter.ts) with the owner's own words: the hero says what the owner said,
 * the highlights strip lists only what the owner stated (delivery, pickup, languages) and is hidden when they stated
 * nothing, made-up opening hours and service durations are left out, and words that promise something are filtered
 * against the answers. Customer quotes, menus and FAQ answers stay hidden as in the starter.
 */
export function buildHome(p: SetupProposal, shopName: string, facts: string): { sections: Sec[]; translations?: { ta: Record<string, unknown> } } {
  const pack = PACKS[p.trade.id as BusinessType];
  const build = (l: L): Sec[] => {
    const words = p.hero[l];
    const out: Sec[] = [];
    for (const raw of starterHome(pack, shopName, l) as Sec[]) {
      const s = structuredClone(raw);
      if (s.type === "hero") {
        const slides = s.slides as Record<string, unknown>[];
        slides[0] = { ...slides[0], heading: shopName ? `${shopName}: ${words.heading}`.slice(0, 120) : words.heading, subheading: words.text };
      } else if (s.type === "hero-split") {
        s.heading = words.heading;
        s.text = words.text;
      } else if (s.type === "usp") {
        const items: Record<string, unknown>[] = [];
        if (p.fulfilment.delivery) items.push({ icon: STATED_USP.delivery.icon, title: STATED_USP.delivery[l][0], text: STATED_USP.delivery[l][1] });
        if (p.fulfilment.pickup) items.push({ icon: STATED_USP.pickup.icon, title: STATED_USP.pickup[l][0], text: STATED_USP.pickup[l][1] });
        if (p.storeLanguages === "both") items.push({ icon: STATED_USP.tamil.icon, title: STATED_USP.tamil[l][0], text: STATED_USP.tamil[l][1] });
        // Nothing stated: keep the trade's highlights as a hidden draft to edit, like the starter's quotes.
        if (items.length >= 2) s.items = items;
        else s.hidden = true;
      } else if (s.type === "location") {
        s.hours = [];
      } else if (s.type === "appointment") {
        s.services = ((s.services as Record<string, unknown>[] | undefined) ?? []).map(({ duration: _d, ...rest }) => rest);
      } else if (s.type === "newsletter" && typeof s.text === "string") {
        const c = filterClaims(s.text, facts);
        if (c.text) s.text = c.text;
        else delete s.text;
      }
      out.push(s);
    }
    return out;
  };
  if (p.storeLanguages === "ta") return { sections: build("ta") };
  const sections = build("en");
  if (p.storeLanguages === "en") return { sections };
  const ta: Record<string, unknown> = {};
  for (const s of build("ta")) {
    const w = s.id ? wordsOf(s) : undefined;
    if (w && s.id) ta[s.id] = w;
  }
  return { sections, translations: { ta } };
}

/** Section ids of the starter home of any trade: a home made only of these (or none) has not been designed by the owner yet. */
export function isStarterHome(doc: { sections?: unknown[] } | null | undefined): boolean {
  if (!doc) return true;
  const secs = (doc.sections ?? []) as { id?: string }[];
  return secs.every((s) => typeof s.id === "string" && s.id.startsWith("starter-"));
}
