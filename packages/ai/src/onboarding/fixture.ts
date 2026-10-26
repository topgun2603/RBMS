import { homeDocSchema } from "@srirealtime/cms";
import { PACKS, starterHome, type BusinessType } from "@srirealtime/verticals";
import { randomUUID } from "node:crypto";
import { MemoryStudioStore } from "../studio/store";
import { StudioService } from "../studio/engine";
import { fakeShop, type FakeShop } from "../studio/fixture";
import type { CategoriesArea } from "../studio/areas";
import { SetupAssistant, type SetupProgress } from "./service";
import type { SetupRunner } from "./read";

/**
 * A new shop for the tests and evals: the Studio fake shop with the trade's starter home and starter product groups (what
 * sign-up gives a shop), a catalogue switch, and progress kept in memory.
 */
export interface NewShop extends FakeShop {
  progress: Map<string, SetupProgress>;
  setup: SetupAssistant;
  studio: StudioService;
  store: MemoryStudioStore;
}

export function newShop(ai: SetupRunner, over: { trade?: BusinessType; appId?: string | null; name?: string; products?: Record<string, number>; catalogue?: boolean; storefront?: boolean } = {}): NewShop {
  const trade = over.trade ?? "fashion";
  const shop = fakeShop({ trade }) as NewShop;
  const name = over.name ?? "Anbu Textiles";
  shop.areas.set("home", { doc: homeDocSchema.parse({ sections: starterHome(PACKS[trade], name, "en") }), unpublished: false });
  shop.areas.set("categories", {
    items: PACKS[trade].categories.map((n) => ({ id: randomUUID(), name: n, slug: n.toLowerCase().replace(/[^a-z0-9]+/g, "-"), products: over.products?.[n] ?? 0, parentId: null })),
  } satisfies CategoriesArea);
  const store = shop.areas.get("settings:store") as { layer: Record<string, unknown>; effective: Record<string, unknown> };
  store.layer.businessType = trade;
  store.effective.businessType = trade;
  shop.areas.set("branding", { appName: name, tokens: { preset: PACKS[trade].preset } });
  if (over.storefront === false) shop.setFeature("storefront", false, "app");

  const base = shop.ports;
  const catalogueOn = over.catalogue !== false;
  shop.ports = {
    ...base,
    async feature(t, key) {
      if (key === "catalogue") return { enabled: catalogueOn, reason: catalogueOn ? null : "app", label: "Catalogue" };
      return base.feature(t, key);
    },
    async writeArea(ctx, area, before, after) {
      if (area === "categories") {
        if (shop.failWrite === area) throw new Error("write refused");
        shop.writes.push({ area, before: structuredClone(before), after: structuredClone(after) });
        const a = structuredClone(after) as CategoriesArea;
        for (const c of a.items) if (!c.id) Object.assign(c, { id: randomUUID(), slug: c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") });
        shop.areas.set(area, a);
        return;
      }
      return base.writeArea(ctx, area, before, after);
    },
  };
  shop.progress = new Map();
  shop.store = new MemoryStudioStore();
  shop.studio = new StudioService({ store: shop.store, ai: ai, ports: shop.ports });
  shop.setup = new SetupAssistant({
    ai,
    studio: shop.studio,
    ports: shop.ports,
    progress: { get: async (t) => shop.progress.get(t) ?? null, set: async (t, p) => void shop.progress.set(t, structuredClone(p)) },
    shop: async () => ({ name, appId: over.appId === undefined ? "EC" : over.appId }),
    now: () => new Date("2026-10-27T06:00:00Z"),
  });
  return shop;
}
