import { PACKS, packOrDefault } from "@rbms/verticals";
import type { BrandingArea, CategoriesArea, HomeArea, SettingsArea } from "../studio/areas";
import type { PlannedOp } from "../studio/types";
import { buildHome, isStarterHome } from "./home";
import type { SetupProposal, ShopContext } from "./proposal";

type Bi = { en: string; ta: string };

/** What the plan builder reads of the shop (Studio areas plus the switches that decide which steps exist). */
export interface ShopState {
  branding: BrandingArea;
  home: HomeArea;
  categories: CategoriesArea;
  store: SettingsArea;
  /** Feature keys that are on: storefront, cms, catalogue. */
  features: Set<string>;
}

const fold = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Turns the proposal into Studio operations against the shop as it is now. Only what differs is planned. Never planned:
 * the app, the plan, feature switches, prices, contact details or anything about money. The trade's own feature
 * engines are only mentioned in the notes.
 */
export function planSetup(p: SetupProposal, ctx: ShopContext, s: ShopState, facts: string): { ops: PlannedOp[]; notes: Bi[] } {
  const ops: PlannedOp[] = [];
  const notes: Bi[] = [];
  const storefront = s.features.has("storefront");
  const currentTrade = packOrDefault(ctx.trade, ctx.appId).id;

  if (p.trade.source !== "kept" && p.trade.id !== (s.store.effective.businessType || currentTrade)) {
    ops.push({ kind: "store.set_trade", params: { businessType: p.trade.id }, why: "trade" });
  }

  if (storefront) {
    if ((s.branding.tokens as { preset?: string }).preset !== p.preset) ops.push({ kind: "theme.apply_preset", params: { presetId: p.preset }, why: "look" });
    if (p.colour && (s.branding.tokens as { colors?: { primary?: string } }).colors?.primary !== p.colour) ops.push({ kind: "theme.set_colors", params: { primary: p.colour }, why: "colour" });
  } else {
    notes.push({ en: "Your app has no online store, so the store look was left as it is.", ta: "உங்கள் செயலியில் ஆன்லைன் கடை இல்லை, அதனால் கடைத் தோற்றம் மாற்றப்படவில்லை." });
  }

  if (s.features.has("catalogue")) {
    const have = new Set(s.categories.items.map((c) => fold(c.name)));
    // A Tamil-only store names its groups in Tamil.
    const names = p.storeLanguages === "ta" ? p.categories.namesTa : p.categories.names;
    const add = names.filter((n) => !have.has(fold(n))).slice(0, 12);
    // Only empty groups that the trade's starter put there are removed, and only when the owner's own list replaces them.
    const starterNames = new Set([...PACKS[currentTrade].categories, ...PACKS[p.trade.id].categories].map(fold));
    const wanted = new Set(names.map(fold));
    const remove =
      p.categories.source === "owner" || p.trade.id !== currentTrade
        ? s.categories.items.filter((c) => c.products === 0 && !c.parentId && starterNames.has(fold(c.name)) && !wanted.has(fold(c.name)) && !s.categories.items.some((x) => x.parentId === c.id)).map((c) => c.name)
        : [];
    if (add.length || remove.length) ops.push({ kind: "catalogue.set_categories", params: { add, remove }, why: "groups" });
  }

  if (storefront) {
    const f = p.fulfilment;
    const cur = s.store.effective as { deliveryEnabled?: boolean; pickupEnabled?: boolean };
    const params: Record<string, boolean> = {};
    if (f.delivery !== null && f.delivery !== (cur.deliveryEnabled !== false)) params.deliveryEnabled = f.delivery;
    if (f.pickup !== null && f.pickup !== (cur.pickupEnabled === true)) params.pickupEnabled = f.pickup;
    const delivery = params.deliveryEnabled ?? cur.deliveryEnabled !== false;
    const pickup = params.pickupEnabled ?? cur.pickupEnabled === true;
    if (Object.keys(params).length && (delivery || pickup)) ops.push({ kind: "store.set_fulfilment", params, why: "fulfilment" });
  }

  if (s.features.has("cms")) {
    if (s.home.unpublished) notes.push({ en: "Your home page has unpublished edits, so it was left as it is.", ta: "உங்கள் முகப்புப் பக்கத்தில் வெளியிடப்படாத மாற்றங்கள் உள்ளன, அதனால் அப்படியே விடப்பட்டது." });
    else if (!isStarterHome(s.home.doc)) notes.push({ en: "You have already designed your home page, so it was left as it is. Ask the Studio assistant to change it.", ta: "நீங்கள் ஏற்கெனவே முகப்புப் பக்கத்தை வடிவமைத்துள்ளீர்கள், அதனால் அப்படியே விடப்பட்டது. மாற்ற Studio உதவியாளரிடம் கேளுங்கள்." });
    else {
      const home = buildHome(p, ctx.shopName, facts);
      const same = JSON.stringify(home.sections) === JSON.stringify(s.home.doc?.sections ?? null) && JSON.stringify(home.translations ?? null) === JSON.stringify(s.home.doc?.translations ?? null);
      if (!same) ops.push({ kind: "home.set_layout", params: { sections: home.sections, ...(home.translations ? { translations: home.translations } : {}) }, why: "home" });
    }
  }
  return { ops, notes };
}
