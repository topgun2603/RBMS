import { CMS_LIMITS, isReservedSlug, menuItemsSchema, slugProblem, slugify, uniqueSlug, blockSchema, type MenuItem } from "@srirealtime/cms";
import { z } from "zod";
import { AREA, fail, type MenuArea, type PageArea } from "../areas";
import type { StudioEnv, StudioState } from "../types";
import { defineOp, failInvalid, isSafeLink } from "./util";

const MENU = z.enum(["header", "footer"]);
const TYPES = z.enum(["url", "page", "category", "collection"]);
type MenuName = z.infer<typeof MENU>;

const load = (st: StudioState, m: MenuName) => structuredClone(st.get<MenuArea>(AREA.menu(m)).items) as MenuItem[];
const store = (st: StudioState, m: MenuName, items: MenuItem[]) => {
  const ok = menuItemsSchema.safeParse(items);
  if (!ok.success) return failInvalid(ok.error);
  st.set(AREA.menu(m), { items: ok.data } satisfies MenuArea);
};

/** A menu item by id or by its label (case-insensitive), top level or sub-item. */
function find(items: MenuItem[], ref: string): { list: MenuItem[]; index: number } {
  const low = ref.trim().toLowerCase();
  for (const pass of ["id", "label"] as const) {
    const match = (it: MenuItem) => (pass === "id" ? it.id === ref : it.label.trim().toLowerCase() === low);
    let i = items.findIndex(match);
    if (i >= 0) return { list: items, index: i };
    for (const top of items) {
      i = (top.children ?? []).findIndex(match as never);
      if (i >= 0) return { list: top.children as MenuItem[], index: i };
    }
  }
  return fail("menu_item_not_found", `I could not find "${ref}" in that menu.`, `அந்த மெனுவில் "${ref}" இல்லை.`);
}

function checkTarget(i: { type: string; href?: string; ref?: string }, env: StudioEnv) {
  if (i.type === "url") {
    if (!i.href) fail("menu_needs_link", "A link needs an address.", "இணைப்புக்கு முகவரி வேண்டும்.");
    if (!isSafeLink(i.href)) fail("unsafe_link", "Menu links can only go to pages of your shop, or phone, mail or WhatsApp links.", "மெனு இணைப்புகள் உங்கள் கடையின் பக்கங்கள் அல்லது தொலைபேசி, மின்னஞ்சல், WhatsApp இணைப்புகளுக்கு மட்டுமே செல்லலாம்.");
    return;
  }
  const pool = i.type === "page" ? env.refs.pages : i.type === "category" ? env.refs.categories : env.refs.collections;
  if (!i.ref || !pool.includes(i.ref)) fail("unknown_target", `There is no ${i.type} "${i.ref ?? ""}" in your shop.`, `உங்கள் கடையில் "${i.ref ?? ""}" ${i.type} இல்லை.`);
}

const itemBody = z.object({ label: z.string().trim().min(1).max(60), type: TYPES.default("url"), href: z.string().trim().max(300).optional(), ref: z.string().trim().max(120).optional() });
const where = z.enum(["start", "end", "before", "after"]);

function newId(items: MenuItem[]) {
  const used = new Set(items.flatMap((i) => [i.id, ...(i.children ?? []).map((c) => c.id)]));
  for (let n = 1; ; n++) if (!used.has(`st-m${n}`)) return `st-m${n}`;
}

function put(items: MenuItem[], item: MenuItem, w: z.infer<typeof where>, relativeTo: string | undefined, parent: string | undefined) {
  let list = items;
  if (parent) {
    const f = find(items, parent);
    const p = f.list[f.index]!;
    if (f.list !== items) fail("menu_depth", "Menus nest at most 2 levels.", "மெனுக்கள் அதிகபட்சம் 2 நிலைகள் மட்டுமே.");
    p.children = p.children ?? [];
    list = p.children as MenuItem[];
  }
  if (w === "start") list.unshift(item);
  else if (w === "end") list.push(item);
  else {
    if (!relativeTo) fail("place_needs_ref", `Say which item it goes ${w}.`, "எந்த உருப்படிக்கு முன்/பின் என்று சொல்லுங்கள்.");
    const f = find(items, relativeTo);
    f.list.splice(w === "before" ? f.index : f.index + 1, 0, item);
  }
}

export const addItem = defineOp({
  kind: "menu.add_item",
  group: "menus",
  label: { en: "Add a menu link", ta: "மெனுவில் இணைப்பைச் சேர்" },
  changes: { en: "A new link in the header or footer menu", ta: "ஹெடர் அல்லது ஃபூட்டர் மெனுவில் புதிய இணைப்பு" },
  risk: "medium",
  permission: "cms.manage",
  fullAccess: false,
  features: ["cms"],
  schema: itemBody.extend({ menu: MENU, where: where.default("end"), relativeTo: z.string().trim().max(60).optional(), parent: z.string().trim().max(60).optional() }),
  help: "menu: header|footer; label; type: page|category|collection|url; ref (slug of the page/category/collection from list_pages / catalogue_overview) or href (url type: a /path, tel:, mailto: or WhatsApp link); where: start|end|before|after, relativeTo? (item id or label), parent? (item id or label to add a sub-link)",
  areas: (p) => [AREA.menu(p.menu)],
  target: (p) => `menu:${p.menu}`,
  describe: (p) => ({ en: `Add "${p.label}" to the ${p.menu} menu`, ta: `${p.menu === "header" ? "மேல்" : "கீழ்"} மெனுவில் "${p.label}" சேர்` }),
  run(p, st, env) {
    checkTarget(p, env);
    const items = load(st, p.menu);
    const item = { id: newId(items), label: p.label, type: p.type, ...(p.type === "url" ? { href: p.href } : { ref: p.ref }) } as MenuItem;
    put(items, item, p.where, p.relativeTo, p.parent);
    store(st, p.menu, items);
  },
});

export const removeItem = defineOp({
  kind: "menu.remove_item",
  group: "menus",
  label: { en: "Remove a menu link", ta: "மெனு இணைப்பை நீக்கு" },
  changes: { en: "A link (and its sub-links) from the menu", ta: "மெனுவிலிருந்து இணைப்பு (அதன் துணை இணைப்புகளுடன்)" },
  risk: "medium",
  permission: "cms.manage",
  fullAccess: false,
  features: ["cms"],
  schema: z.object({ menu: MENU, item: z.string().trim().min(1).max(60) }),
  help: "menu: header|footer; item: the item's id or label from get_menus",
  areas: (p) => [AREA.menu(p.menu)],
  target: (p) => `menu:${p.menu}:${p.item}`,
  describe: (p) => ({ en: `Remove "${p.item}" from the ${p.menu} menu`, ta: `${p.menu === "header" ? "மேல்" : "கீழ்"} மெனுவிலிருந்து "${p.item}" நீக்கு` }),
  run(p, st) {
    const items = load(st, p.menu);
    const f = find(items, p.item);
    f.list.splice(f.index, 1);
    store(st, p.menu, items);
  },
});

export const editItem = defineOp({
  kind: "menu.edit_item",
  group: "menus",
  label: { en: "Rename or relink a menu item", ta: "மெனு உருப்படியின் பெயர்/இணைப்பை மாற்று" },
  changes: { en: "The label or target of a menu link", ta: "மெனு இணைப்பின் பெயர் அல்லது இலக்கு" },
  risk: "medium",
  permission: "cms.manage",
  fullAccess: false,
  features: ["cms"],
  schema: z.object({ menu: MENU, item: z.string().trim().min(1).max(60), label: z.string().trim().min(1).max(60).optional(), type: TYPES.optional(), href: z.string().trim().max(300).optional(), ref: z.string().trim().max(120).optional() }),
  help: "menu: header|footer; item: id or label; label?, type?, href?, ref? (as in menu.add_item)",
  areas: (p) => [AREA.menu(p.menu)],
  target: (p) => `menu:${p.menu}:${p.item}`,
  describe: (p) => ({ en: `Change "${p.item}" in the ${p.menu} menu${p.label ? ` to "${p.label}"` : ""}`, ta: `${p.menu === "header" ? "மேல்" : "கீழ்"} மெனுவில் "${p.item}" மாற்று${p.label ? ` → "${p.label}"` : ""}` }),
  run(p, st, env) {
    const items = load(st, p.menu);
    const f = find(items, p.item);
    const cur = f.list[f.index]!;
    const type = p.type ?? cur.type;
    const next = { ...cur, label: p.label ?? cur.label, type } as MenuItem;
    if (p.type !== undefined || p.href !== undefined || p.ref !== undefined) {
      if (type === "url") {
        next.href = p.href ?? cur.href;
        delete next.ref;
      } else {
        next.ref = p.ref ?? cur.ref;
        delete next.href;
      }
      checkTarget({ type, href: next.href, ref: next.ref }, env);
    }
    f.list[f.index] = next;
    store(st, p.menu, items);
  },
});

export const moveItem = defineOp({
  kind: "menu.move_item",
  group: "menus",
  label: { en: "Move a menu item", ta: "மெனு உருப்படியை நகர்த்து" },
  changes: { en: "The order of the menu", ta: "மெனுவின் வரிசை" },
  risk: "low",
  permission: "cms.manage",
  fullAccess: false,
  features: ["cms"],
  schema: z.object({ menu: MENU, item: z.string().trim().min(1).max(60), where, relativeTo: z.string().trim().max(60).optional() }),
  help: "menu: header|footer; item: id or label; where: start|end|before|after, relativeTo? (id or label)",
  areas: (p) => [AREA.menu(p.menu)],
  target: (p) => `menu:${p.menu}:order`,
  describe: (p) => ({ en: `Move "${p.item}" ${p.where}${p.relativeTo ? ` "${p.relativeTo}"` : ""} in the ${p.menu} menu`, ta: `"${p.item}" ஐ ${p.menu === "header" ? "மேல்" : "கீழ்"} மெனுவில் நகர்த்து (${p.where}${p.relativeTo ? ` "${p.relativeTo}"` : ""})` }),
  run(p, st) {
    const items = load(st, p.menu);
    const f = find(items, p.item);
    const [item] = f.list.splice(f.index, 1);
    put(items, item!, p.where, p.relativeTo, undefined);
    store(st, p.menu, items);
  },
});

// ------------------------------------------------------------------ pages

export const createPage = defineOp({
  kind: "page.create",
  group: "pages",
  label: { en: "Create a page", ta: "பக்கத்தை உருவாக்கு" },
  changes: { en: "A new text page (for example About us, Offers)", ta: "புதிய உரைப் பக்கம் (எ.கா. எங்களைப் பற்றி, சலுகைகள்)" },
  risk: "medium",
  permission: "cms.manage",
  fullAccess: false,
  features: ["cms"],
  schema: z.object({
    title: z.string().trim().min(1).max(CMS_LIMITS.title),
    slug: z.string().trim().toLowerCase().max(80).optional(),
    paragraphs: z.array(z.string().trim().min(1).max(4000)).min(1).max(12),
    publish: z.boolean().default(false),
  }),
  help: "title; slug? (lowercase-with-hyphens address); paragraphs: text paragraphs (plain words the owner gave; do not invent facts); publish? true to make it live now",
  areas: (p) => [AREA.page(slugOf(p))],
  target: (p) => `page:${slugOf(p)}`,
  describe: (p) => ({ en: `Create the page "${p.title}"${p.publish ? " and publish it" : " (saved as a draft)"}`, ta: `"${p.title}" பக்கத்தை உருவாக்கு${p.publish ? " (உடனே வெளியிடு)" : " (வரைவாக)"}` }),
  run(p, st, env) {
    const slug = slugOf(p);
    const taken = new Set(env.refs.pages);
    const problem = p.slug ? slugProblem(slug, taken) : null;
    if (problem || (!p.slug && (taken.has(slug) || isReservedSlug(slug)))) fail("slug_unavailable", `The page address "${slug}" is ${problem === "reserved" ? "reserved by the store" : "already used"}. Pick another title or address.`, `"${slug}" முகவரி ${problem === "reserved" ? "கடையால் ஒதுக்கப்பட்டுள்ளது" : "ஏற்கனவே பயன்பாட்டில் உள்ளது"}. வேறு தலைப்பு/முகவரி தேர்வு செய்யுங்கள்.`);
    const blocks = p.paragraphs.map((markdown, n) => ({ type: "paragraph", id: `st-p${n + 1}`, markdown }));
    const ok = z.array(blockSchema).safeParse(blocks);
    if (!ok.success) return failInvalid(ok.error);
    st.set(AREA.page(slug), { exists: true, id: null, slug, title: p.title, blocks: ok.data, status: p.publish ? "published" : "draft" } satisfies PageArea);
  },
});

function slugOf(p: { title: string; slug?: string }): string {
  if (p.slug) return p.slug;
  const base = slugify(p.title, "page", () => "new");
  return uniqueSlug(base, new Set());
}

export const setPageStatus = defineOp({
  kind: "page.set_status",
  group: "pages",
  label: { en: "Publish or unpublish a page", ta: "பக்கத்தை வெளியிடு / திரும்பப்பெறு" },
  changes: { en: "Whether a page is live on the store", ta: "ஒரு பக்கம் கடையில் தெரிகிறதா" },
  risk: "medium",
  permission: "cms.manage",
  fullAccess: false,
  features: ["cms"],
  schema: z.object({ slug: z.string().trim().toLowerCase().min(1).max(80), status: z.enum(["published", "draft"]) }),
  help: "slug: the page address from list_pages; status: published|draft",
  areas: (p) => [AREA.page(p.slug)],
  target: (p) => `page:${p.slug}`,
  describe: (p) => ({ en: `${p.status === "published" ? "Publish" : "Unpublish"} the page "${p.slug}"`, ta: `"${p.slug}" பக்கத்தை ${p.status === "published" ? "வெளியிடு" : "திரும்பப்பெறு"}` }),
  run(p, st) {
    const cur = st.get<PageArea>(AREA.page(p.slug));
    if (!cur.exists) fail("page_not_found", `There is no page "${p.slug}".`, `"${p.slug}" பக்கம் இல்லை.`);
    st.set(AREA.page(p.slug), { ...cur, status: p.status } satisfies PageArea);
  },
});

export const MENU_PAGE_OPS = [addItem, removeItem, editItem, moveItem, createPage, setPageStatus];
