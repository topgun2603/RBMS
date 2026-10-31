import { homeSectionSchema, homeTranslationsSchema, CMS_LIMITS, type HomeDoc } from "@rbms/cms";
import { BUSINESS_TYPES, PACKS } from "@rbms/verticals";
import { z } from "zod";
import { AREA, fail, patchSettings, settingsOf, type CategoriesArea, type HomeArea, type MenuArea } from "../areas";
import { checkUrls, defineOp, failInvalid, urlsIn } from "./util";

/**
 * Operations only the shop setup assistant plans (docs/ai.md, Phase 7 part A). They are checked, previewed, applied and
 * undone by the same engine as every Studio operation, but they are NOT in the Studio planner's catalogue (`ALL_OPS`):
 * the plan is built in code from the owner's five answers, never by a model choosing these kinds.
 */

const MAX_NAME = 60;
const catName = z
  .string()
  .trim()
  .min(1)
  .max(MAX_NAME)
  .refine((v) => !/[<>{}\\]/.test(v), "Use plain words");
const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export const setCategories = defineOp({
  kind: "catalogue.set_categories",
  group: "catalogue",
  label: { en: "Product groups", ta: "பொருள் வகைகள்" },
  changes: { en: "Adds product groups (categories) and removes empty starter groups", ta: "பொருள் வகைகளைச் சேர்க்கும், காலியான தொடக்க வகைகளை நீக்கும்" },
  risk: "medium",
  permission: "catalogue.manage",
  fullAccess: false,
  features: ["catalogue"],
  visual: true,
  schema: z
    .object({ add: z.array(catName).max(12).default([]), remove: z.array(catName).max(20).default([]) })
    .refine((v) => v.add.length + v.remove.length > 0, "Give a group to add or remove"),
  help: "add: group names to create; remove: names of EMPTY groups to delete",
  areas: () => [AREA.categories, AREA.menu("header"), AREA.menu("footer")],
  target: () => "catalogue:categories",
  describe: (p) => ({
    en: [p.add.length && `Add ${p.add.length} product groups: ${p.add.join(", ")}`, p.remove.length && `remove ${p.remove.length} empty: ${p.remove.join(", ")}`].filter(Boolean).join("; "),
    ta: [p.add.length && `${p.add.length} பொருள் வகைகளைச் சேர்: ${p.add.join(", ")}`, p.remove.length && `காலியான ${p.remove.length} நீக்கு: ${p.remove.join(", ")}`].filter(Boolean).join("; "),
  }),
  run(p, st) {
    const cur = structuredClone(st.get<CategoriesArea>(AREA.categories));
    const linked = new Set(
      [AREA.menu("header"), AREA.menu("footer")].flatMap((a) => (st.get<MenuArea>(a).items ?? []).flatMap((i) => [i, ...(i.children ?? [])])).filter((i) => i.type === "category").map((i) => String(i.ref ?? "")),
    );
    // A group that has products, sub-groups or a menu link is kept (and said so), never deleted.
    const kept: string[] = [];
    for (const name of p.remove) {
      const i = cur.items.findIndex((c) => key(c.name) === key(name));
      if (i < 0) continue;
      const c = cur.items[i]!;
      if (c.products > 0 || cur.items.some((x) => x.parentId && x.parentId === c.id) || linked.has(c.slug)) {
        kept.push(c.name);
        continue;
      }
      cur.items.splice(i, 1);
    }
    for (const name of p.add) {
      if (cur.items.some((c) => key(c.name) === key(name))) continue;
      cur.items.push({ id: null, name: name.trim(), slug: "", products: 0, parentId: null });
    }
    if (cur.items.length > 200) fail("too_many_categories", "That is too many product groups.", "பொருள் வகைகள் மிக அதிகம்.");
    st.set(AREA.categories, cur);
    if (kept.length) return [{ en: `Kept because they have products, sub-groups or a menu link: ${kept.join(", ")}`, ta: `பொருட்கள், துணை வகைகள் அல்லது மெனு இணைப்பு உள்ளதால் வைக்கப்பட்டவை: ${kept.join(", ")}` }];
  },
});

/**
 * Replaces the whole home page with sections the assistant built in code (the trade's starter layout with the owner's
 * own words). Refuses over unpublished edits, like every home operation. The automatic default home may be replaced.
 */
export const setHomeLayout = defineOp({
  kind: "home.set_layout",
  group: "home",
  label: { en: "Set up the home page", ta: "முகப்புப் பக்கத்தை அமை" },
  changes: { en: "Every section of the home page, with Tamil words when asked", ta: "முகப்புப் பக்கத்தின் எல்லாப் பகுதிகளும், கேட்டால் தமிழ்ச் சொற்களுடன்" },
  risk: "medium",
  permission: "cms.manage",
  fullAccess: false,
  features: ["cms"],
  visual: true,
  schema: z.object({
    sections: z.array(z.record(z.string(), z.unknown())).min(1).max(CMS_LIMITS.sections),
    translations: z.record(z.string(), z.unknown()).optional(),
  }),
  help: "sections: the complete list of home sections; translations?: { ta: { <section id>: words } }",
  areas: () => [AREA.home],
  target: () => "home:layout",
  describe: (p) => {
    const types = p.sections.map((s) => String(s.type)).join(", ");
    return { en: `Set up the home page with ${p.sections.length} sections (${types})`, ta: `முகப்புப் பக்கத்தை ${p.sections.length} பகுதிகளுடன் அமை (${types})` };
  },
  run(p, st) {
    const a = st.get<HomeArea>(AREA.home);
    if (a.unpublished) fail("home_unpublished", "Your home page has edits that are not published yet, so it was left as it is. Publish or discard them in the Home page editor first.", "உங்கள் முகப்புப் பக்கத்தில் வெளியிடப்படாத மாற்றங்கள் உள்ளன, அதனால் அப்படியே விடப்பட்டது. முதலில் முகப்புப் பக்க எடிட்டரில் அவற்றை வெளியிடுங்கள் அல்லது நீக்குங்கள்.");
    const known = urlsIn(a.doc);
    const sections = p.sections.map((raw) => {
      checkUrls(raw, known);
      const ok = homeSectionSchema.safeParse(raw);
      if (!ok.success) return failInvalid(ok.error);
      return ok.data;
    });
    const ids = sections.map((s) => (s as { id?: string }).id).filter(Boolean);
    if (new Set(ids).size !== ids.length) fail("duplicate_section_id", "Two sections have the same id.", "இரண்டு பகுதிகளுக்கு ஒரே ஐடி உள்ளது.");
    let translations: HomeDoc["translations"] | undefined;
    if (p.translations && Object.keys(p.translations).length) {
      const ok = homeTranslationsSchema.safeParse(p.translations);
      if (!ok.success) return failInvalid(ok.error);
      translations = ok.data;
    }
    const doc = { ...(a.doc ?? {}), sections, ...(translations ? { translations } : {}) } as HomeDoc;
    if (!translations) delete (doc as { translations?: unknown }).translations;
    st.set(AREA.home, { ...a, doc } satisfies HomeArea);
  },
});

/** The shop's trade (`store.businessType`): what the storefront calls things and which pack hints show. Never the app or the plan. */
export const setTrade = defineOp({
  kind: "store.set_trade",
  group: "store",
  label: { en: "Type of business", ta: "வணிக வகை" },
  changes: { en: "The trade the store's words and hints follow (not your app or plan)", ta: "கடையின் சொற்களும் குறிப்புகளும் பின்பற்றும் வணிக வகை (உங்கள் செயலியோ திட்டமோ அல்ல)" },
  risk: "low",
  permission: null,
  fullAccess: true,
  features: [],
  schema: z.object({ businessType: z.enum(BUSINESS_TYPES) }),
  help: `businessType: ${BUSINESS_TYPES.join("|")}`,
  areas: () => [AREA.settings("store")],
  target: () => "store:trade",
  describe: (p) => ({ en: `Type of business: ${PACKS[p.businessType].name}`, ta: `வணிக வகை: ${PACKS[p.businessType].nameTa}` }),
  run(p, st) {
    if (settingsOf(st, "store").businessType === p.businessType) return;
    patchSettings(st, "store", { businessType: p.businessType });
  },
});

export const SETUP_OPS = [setCategories, setHomeLayout, setTrade];
