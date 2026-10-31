import { HOME_SECTION_TYPES, homeSectionSchema, homeTranslationsSchema, type HomeDoc, CMS_LIMITS } from "@rbms/cms";
import { z } from "zod";
import { AREA, fail, type HomeArea } from "../areas";
import type { Bi, StudioEnv, StudioState } from "../types";
import { checkUrls, defineOp, failInvalid, urlsIn } from "./util";

const area = AREA.home;

/**
 * Section types Studio may ADD: the ones that need no picture, video or product list the shop has not already chosen
 * (Studio never invents pictures, testimonials, statistics or product ids). Any existing section can be edited, moved,
 * hidden or removed.
 */
export const STUDIO_ADDABLE_SECTIONS = [
  "hero",
  "hero-split",
  "categories",
  "collection",
  "category-mosaic",
  "category-shelf",
  "tiles",
  "text",
  "usp",
  "offer",
  "faq",
  "newsletter",
  "product-tabs",
  "bestsellers",
  "recently-viewed",
  "recommended",
  "reviews-summary",
  "blog-posts",
  "location",
  "appointment",
  "gold-rates",
] as const;

export const SECTION_BLURB: Record<string, string> = {
  hero: "full-width banner slides: slides[{heading, subheading, cta{label,href}, imageUrl: null}] (null picture = brand gradient)",
  "hero-split": "picture beside words: heading, text?, eyebrow?, cta?, cta2?, imageSide left|right, imageUrl null",
  categories: "category tiles: title?, layout (circles|cards|slider|icon-list|big-grid|rounded-squares|story-rings|pills|tiles|banner-row|bento|minimal-list), showCounts?, columns?, categoryIds? (ids from catalogue_overview)",
  collection: "a product shelf of one collection: collectionSlug (from catalogue_overview), title?, layout carousel|grid, limit 1-48",
  "category-mosaic": "big bento category tiles: title?, categoryIds? (up to 7)",
  "category-shelf": "a shelf per category: title?, categoryIds?, showImages",
  tiles: "link tiles: title?, layout row|grid, items[{label, note?, collectionSlug?|href?}]",
  text: "a text block: heading?, markdown",
  usp: "highlights strip: layout cards|inline|centered|split, items[{icon (truck|cash|return|shield|star|gift|phone|leaf|clock|tag|heart|check), title, text?}], title?, text?",
  offer: "an offer strip: heading, text?, eyebrow?, code? (a coupon code the shop already has), endsAt? (ISO date-time), cta?{label,href}",
  faq: "questions: title?, items[{q, a}]",
  newsletter: "email sign-up band: heading, text?, layout band|split|card|inline",
  "product-tabs": "tabs of products: title?, layout grid|carousel, tabs[{label, source: new|bestsellers|sale|collection, collectionSlug?}]",
  bestsellers: "best sellers shelf: title?, layout, limit?",
  "recently-viewed": "shopper's recently viewed products: title?",
  recommended: "recommended products: title?, layout",
  "reviews-summary": "customer reviews strip: title?, limit",
  "blog-posts": "latest posts: title?, limit",
  location: "shop address and map: title?, address?, phone?",
  appointment: "booking call to action: heading, text?, cta",
  "gold-rates": "today's gold and silver rates board: title?, showSilver",
};

type Doc = HomeDoc;

function working(st: StudioState): { a: HomeArea; doc: Doc } {
  const a = st.get<HomeArea>(area);
  if (a.unpublished) fail("home_unpublished", "Your home page has edits that are not published yet. Publish or discard them in the Home page editor first, then ask again.", "உங்கள் முகப்புப் பக்கத்தில் வெளியிடப்படாத மாற்றங்கள் உள்ளன. முதலில் முகப்புப் பக்க எடிட்டரில் அவற்றை வெளியிடுங்கள் அல்லது நீக்குங்கள், பிறகு மீண்டும் கேளுங்கள்.");
  if (!a.doc) fail("home_default", "Your home page is still the automatic one. Open Home page once and publish it, then Studio can change it.", "உங்கள் முகப்புப் பக்கம் இன்னும் தானியங்கி பக்கமாகவே உள்ளது. முகப்புப் பக்கத்தைத் திறந்து ஒருமுறை வெளியிடுங்கள், பிறகு Studio மாற்றும்.");
  return { a, doc: structuredClone(a.doc) as Doc };
}
const commit = (st: StudioState, a: HomeArea, doc: Doc) => st.set(area, { ...a, doc } satisfies HomeArea);

type Sec = Doc["sections"][number] & { id?: string };

/** A section by id, by "#3" (position), or by a type name (the first of that type). */
export function findSection(doc: Doc, ref: string): { index: number; byType: boolean; many: boolean } {
  const secs = doc.sections as Sec[];
  let i = secs.findIndex((s) => s.id === ref);
  if (i >= 0) return { index: i, byType: false, many: false };
  const pos = /^#(\d{1,3})$/.exec(ref);
  if (pos) {
    i = Number(pos[1]) - 1;
    if (i >= 0 && i < secs.length) return { index: i, byType: false, many: false };
  }
  const type = ref.replace(/^type:/, "");
  const all = secs.map((s, n) => (s.type === type ? n : -1)).filter((n) => n >= 0);
  if (all.length) return { index: all[0]!, byType: true, many: all.length > 1 };
  return fail("section_not_found", `I could not find a section "${ref}" on your home page.`, `உங்கள் முகப்புப் பக்கத்தில் "${ref}" பகுதி இல்லை.`);
}

const place = z.object({
  where: z.enum(["top", "bottom", "above", "below"]),
  relativeTo: z.string().trim().max(60).optional(),
});
type Place = z.infer<typeof place>;
const placeHelp = 'where: top|bottom|above|below, relativeTo? (a section ref, required for above/below)';

function insertAt(doc: Doc, sec: Sec, pl: Place): void {
  const secs = doc.sections as Sec[];
  if (pl.where === "top") secs.unshift(sec);
  else if (pl.where === "bottom") secs.push(sec);
  else {
    if (!pl.relativeTo) fail("place_needs_ref", `Say which section it goes ${pl.where}.`, "எந்தப் பகுதிக்கு மேலே/கீழே என்று சொல்லுங்கள்.");
    const { index } = findSection(doc, pl.relativeTo);
    secs.splice(pl.where === "above" ? index : index + 1, 0, sec);
  }
  if (secs.length > CMS_LIMITS.sections) fail("too_many_sections", "The home page cannot hold more sections.", "முகப்புப் பக்கத்தில் மேலும் பகுதிகளைச் சேர்க்க முடியாது.");
}

function newId(doc: Doc, type: string): string {
  const used = new Set((doc.sections as Sec[]).map((s) => s.id));
  for (let n = 1; ; n++) {
    const id = `st-${type}-${n}`;
    if (!used.has(id)) return id;
  }
}

const labelOf = (s: Sec) => {
  const r = s as unknown as Record<string, unknown>;
  const t = (r.title ?? r.heading ?? (Array.isArray(r.slides) ? (r.slides[0] as { heading?: string })?.heading : undefined)) as string | undefined;
  return t ? `${s.type} "${String(t).slice(0, 40)}"` : s.type;
};

function checkRefs(sec: Record<string, unknown>, env: StudioEnv) {
  if (typeof sec.collectionSlug === "string" && !env.refs.collections.includes(sec.collectionSlug))
    fail("unknown_collection", `There is no collection "${sec.collectionSlug}" in your shop.`, `உங்கள் கடையில் "${sec.collectionSlug}" தொகுப்பு இல்லை.`);
  const ids = sec.categoryIds;
  if (Array.isArray(ids)) for (const id of ids) if (!env.refs.categoryIds.includes(String(id))) fail("unknown_category", "One of the categories is not in your shop.", "அந்த வகைகளில் ஒன்று உங்கள் கடையில் இல்லை.");
  const items = (sec.items ?? sec.tabs) as unknown;
  if (Array.isArray(items))
    for (const it of items) {
      const slug = (it as { collectionSlug?: string })?.collectionSlug;
      if (slug && !env.refs.collections.includes(slug)) fail("unknown_collection", `There is no collection "${slug}" in your shop.`, `உங்கள் கடையில் "${slug}" தொகுப்பு இல்லை.`);
    }
}

function parseSection(raw: Record<string, unknown>, doc: Doc, env: StudioEnv): Sec {
  checkUrls(raw, urlsIn(doc));
  checkRefs(raw, env);
  const ok = homeSectionSchema.safeParse(raw);
  if (!ok.success) return failInvalid(ok.error);
  return ok.data as Sec;
}

export const addSection = defineOp({
  kind: "home.add_section",
  group: "home",
  label: { en: "Add a home page section", ta: "முகப்புப் பக்கத்தில் பகுதியைச் சேர்" },
  changes: { en: "A new section on the home page", ta: "முகப்புப் பக்கத்தில் புதிய பகுதி" },
  risk: "medium",
  permission: "cms.manage",
  fullAccess: false,
  features: ["cms"],
  visual: true,
  schema: z.object({
    type: z.enum(STUDIO_ADDABLE_SECTIONS),
    fields: z.record(z.string(), z.unknown()).default({}),
    position: place.default({ where: "bottom" }),
  }),
  help: `type: ${STUDIO_ADDABLE_SECTIONS.join("|")}; fields: the section's own fields (see section_type_info); position: {${placeHelp}}`,
  areas: () => [area],
  target: (p) => `home:add:${p.type}`,
  describe: (p) => ({ en: `Add a "${p.type}" section${p.position.where === "top" ? " at the top" : p.position.where === "bottom" ? " at the bottom" : ` ${p.position.where} ${p.position.relativeTo}`}`, ta: `"${p.type}" பகுதியைச் சேர்${p.position.where === "top" ? " (மேலே)" : p.position.where === "bottom" ? " (கீழே)" : ` (${p.position.relativeTo}-க்கு ${p.position.where === "above" ? "மேலே" : "கீழே"})`}` }),
  run(p, st, env) {
    const { a, doc } = working(st);
    const sec = parseSection({ ...p.fields, type: p.type, id: newId(doc, p.type) }, doc, env);
    insertAt(doc, sec, p.position);
    commit(st, a, doc);
  },
});

export const removeSection = defineOp({
  kind: "home.remove_section",
  group: "home",
  label: { en: "Remove a home page section", ta: "முகப்புப் பக்கப் பகுதியை நீக்கு" },
  changes: { en: "Takes a section off the home page (undo brings it back)", ta: "முகப்புப் பக்கத்திலிருந்து பகுதியை நீக்கும் (Undo மீண்டும் கொண்டுவரும்)" },
  risk: "medium",
  permission: "cms.manage",
  fullAccess: false,
  features: ["cms"],
  visual: true,
  schema: z.object({ section: z.string().trim().min(1).max(60) }),
  help: "section: a section ref from get_home (its id, #position or type)",
  areas: () => [area],
  target: (p) => `home:sec:${p.section}`,
  describe: (p) => ({ en: `Remove the "${p.section}" section`, ta: `"${p.section}" பகுதியை நீக்கு` }),
  run(p, st) {
    const { a, doc } = working(st);
    const { index } = findSection(doc, p.section);
    (doc.sections as Sec[]).splice(index, 1);
    commit(st, a, doc);
    if (doc.sections.length === 0) return [{ en: "The home page will have no sections.", ta: "முகப்புப் பக்கத்தில் எந்தப் பகுதியும் இருக்காது." }];
  },
});

export const moveSection = defineOp({
  kind: "home.move_section",
  group: "home",
  label: { en: "Move a home page section", ta: "முகப்புப் பக்கப் பகுதியை நகர்த்து" },
  changes: { en: "The order of sections on the home page", ta: "முகப்புப் பக்கப் பகுதிகளின் வரிசை" },
  risk: "low",
  permission: "cms.manage",
  fullAccess: false,
  features: ["cms"],
  visual: true,
  schema: z.object({ section: z.string().trim().min(1).max(60), position: place }),
  help: `section: a section ref; position: {${placeHelp}}`,
  areas: () => [area],
  target: (p) => `home:order`,
  describe: (p) => ({ en: `Move "${p.section}" ${p.position.where === "top" ? "to the top" : p.position.where === "bottom" ? "to the bottom" : `${p.position.where} "${p.position.relativeTo}"`}`, ta: `"${p.section}" பகுதியை ${p.position.where === "top" ? "மேலே" : p.position.where === "bottom" ? "கீழே" : `"${p.position.relativeTo}"-க்கு ${p.position.where === "above" ? "மேலே" : "கீழே"}`} நகர்த்து` }),
  run(p, st) {
    const { a, doc } = working(st);
    const { index } = findSection(doc, p.section);
    const [sec] = (doc.sections as Sec[]).splice(index, 1);
    insertAt(doc, sec!, p.position);
    commit(st, a, doc);
  },
});

const styleKeys = ["background", "padding", "width", "align", "animation", "hideOnMobile", "hideOnDesktop", "span", "overlay"];
export const editSection = defineOp({
  kind: "home.edit_section",
  group: "home",
  label: { en: "Edit a home page section", ta: "முகப்புப் பகுதியைத் திருத்து" },
  changes: { en: "Words, layout or style of one section", ta: "ஒரு பகுதியின் சொற்கள், அமைப்பு, பாணி" },
  risk: "medium",
  permission: "cms.manage",
  fullAccess: false,
  features: ["cms"],
  visual: true,
  schema: z.object({ section: z.string().trim().min(1).max(60), fields: z.record(z.string(), z.unknown()) }),
  help: `section: a section ref; fields: the fields to change (merged over the section; "style" merges one level: ${styleKeys.join(", ")})`,
  areas: () => [area],
  target: (p) => `home:sec:${p.section}`,
  describe: (p) => ({ en: `Edit "${p.section}": ${Object.keys(p.fields).join(", ")}`, ta: `"${p.section}" திருத்து: ${Object.keys(p.fields).join(", ")}` }),
  run(p, st, env) {
    const { a, doc } = working(st);
    const { index } = findSection(doc, p.section);
    const cur = (doc.sections as Sec[])[index]! as unknown as Record<string, unknown>;
    if ("type" in p.fields || "id" in p.fields) fail("no_retype", "A section's type and id cannot be changed. Add a new section instead.", "பகுதியின் வகையையும் ஐடியையும் மாற்ற முடியாது. புதிய பகுதியைச் சேர்க்கவும்.");
    const next: Record<string, unknown> = { ...cur, ...p.fields };
    if (p.fields.style && typeof p.fields.style === "object") next.style = { ...((cur.style as object) ?? {}), ...(p.fields.style as object) };
    const sec = parseSection(next, doc, env);
    (doc.sections as Sec[])[index] = sec;
    commit(st, a, doc);
  },
});

export const setVisibility = defineOp({
  kind: "home.set_visibility",
  group: "home",
  label: { en: "Show or hide a section", ta: "பகுதியைக் காட்டு / மறை" },
  changes: { en: "Hide a section everywhere, or only on phones or computers", ta: "பகுதியை எல்லா இடத்திலும் அல்லது கைபேசி/கணினியில் மட்டும் மறை" },
  risk: "medium",
  permission: "cms.manage",
  fullAccess: false,
  features: ["cms"],
  visual: true,
  schema: z
    .object({ section: z.string().trim().min(1).max(60), hidden: z.boolean().optional(), hideOnMobile: z.boolean().optional(), hideOnDesktop: z.boolean().optional() })
    .refine((v) => v.hidden !== undefined || v.hideOnMobile !== undefined || v.hideOnDesktop !== undefined, "Say what to show or hide"),
  help: "section: a section ref; hidden? (hide everywhere), hideOnMobile?, hideOnDesktop?",
  areas: () => [area],
  target: (p) => `home:sec:${p.section}`,
  describe: (p) => ({ en: `${p.hidden === true ? "Hide" : p.hidden === false ? "Show" : "Change visibility of"} "${p.section}"${p.hideOnMobile !== undefined ? (p.hideOnMobile ? " (hidden on phones)" : " (shown on phones)") : ""}${p.hideOnDesktop !== undefined ? (p.hideOnDesktop ? " (hidden on computers)" : " (shown on computers)") : ""}`, ta: `"${p.section}" பகுதியை ${p.hidden === true ? "மறை" : p.hidden === false ? "காட்டு" : "காட்சி மாற்று"}${p.hideOnMobile !== undefined ? (p.hideOnMobile ? " (கைபேசியில் மறைப்பு)" : " (கைபேசியில் காட்டு)") : ""}${p.hideOnDesktop !== undefined ? (p.hideOnDesktop ? " (கணினியில் மறைப்பு)" : " (கணினியில் காட்டு)") : ""}` }),
  run(p, st) {
    const { a, doc } = working(st);
    const { index } = findSection(doc, p.section);
    const sec = (doc.sections as Sec[])[index]! as unknown as Record<string, unknown>;
    const style = { ...((sec.style as Record<string, unknown>) ?? {}) };
    if (p.hidden !== undefined) {
      if (p.hidden) sec.hidden = true;
      else delete sec.hidden;
    }
    if (p.hideOnMobile !== undefined) style.hideOnMobile = p.hideOnMobile || undefined;
    if (p.hideOnDesktop !== undefined) style.hideOnDesktop = p.hideOnDesktop || undefined;
    for (const k of Object.keys(style)) if (style[k] === undefined) delete style[k];
    if (Object.keys(style).length) sec.style = style;
    else delete sec.style;
    commit(st, a, doc);
    if (sec.hidden || (style.hideOnMobile && style.hideOnDesktop)) return [{ en: "This section will not show on any screen.", ta: "இந்தப் பகுதி எந்தத் திரையிலும் தெரியாது." }];
  },
});

export const setTamil = defineOp({
  kind: "home.set_tamil_text",
  group: "home",
  label: { en: "Tamil words for a section", ta: "பகுதிக்கான தமிழ்ச் சொற்கள்" },
  changes: { en: "What shoppers who browse in Tamil see for that section", ta: "தமிழில் உலாவும் வாடிக்கையாளர்கள் அந்தப் பகுதியில் காணும் சொற்கள்" },
  risk: "medium",
  permission: "cms.manage",
  fullAccess: false,
  features: ["cms"],
  visual: false,
  schema: z.object({ section: z.string().trim().min(1).max(60), words: z.record(z.string(), z.unknown()) }),
  help: 'section: a section ref; words: a sparse copy of the section with only the words in Tamil, e.g. {"heading":"பொங்கல் சிறப்பு","items":[{"title":"..."}]} (links, pictures and ids always come from the section)',
  areas: () => [area],
  target: (p) => `home:ta:${p.section}`,
  describe: (p) => ({ en: `Tamil words for "${p.section}": ${Object.keys(p.words).join(", ")}`, ta: `"${p.section}" பகுதிக்கான தமிழ்ச் சொற்கள்: ${Object.keys(p.words).join(", ")}` }),
  run(p, st) {
    const { a, doc } = working(st);
    const { index } = findSection(doc, p.section);
    const sec = (doc.sections as Sec[])[index]!;
    if (!sec.id) fail("section_no_id", "This section has no id, so it cannot carry translations. Edit it once in the Home page editor.", "இந்தப் பகுதிக்கு ஐடி இல்லை; முகப்புப் பக்க எடிட்டரில் ஒருமுறை திருத்துங்கள்.");
    const merged = { ...(doc.translations ?? {}), ta: { ...((doc.translations as { ta?: Record<string, unknown> } | undefined)?.ta ?? {}), [sec.id]: p.words } };
    const ok = homeTranslationsSchema.safeParse(merged);
    if (!ok.success) return failInvalid(ok.error);
    (doc as { translations?: unknown }).translations = ok.data;
    commit(st, a, doc);
  },
});

export const HOME_OPS = [addSection, removeSection, moveSection, editSection, setVisibility, setTamil];
export type { Bi };
export const HOME_SECTION_TYPE_LIST = HOME_SECTION_TYPES;
