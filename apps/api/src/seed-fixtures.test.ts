import { describe, expect, it, vi } from "vitest";
import type { Kit } from "./kit";
import { homeMissing, seedStoreContent } from "./seed-fixtures";

const log = { info: vi.fn() } as never;
const spec = { shopName: "Anbu", contactPhone: "+911", contactEmail: "a@b.in", instagram: "https://instagram.com/a", aboutText: "Hi" };

/** A kit whose shop already has everything (settings, zones, collection, home, about page, menus). */
function fullShop(home: { draft: unknown; published: unknown; publishedAt: Date | null }) {
  const cms = {
    getHome: vi.fn(async () => home),
    saveHomeDraft: vi.fn(),
    publishHome: vi.fn(),
    listPages: vi.fn(async () => ({ items: [{ slug: "about" }] })),
    createPage: vi.fn(),
    setPageStatus: vi.fn(),
    getMenu: vi.fn(async () => ({ items: [{ label: "Shop" }] })),
    saveMenu: vi.fn(),
  };
  const kit = {
    settings: { service: { handle: () => ({ get: async () => ({ contactPhone: "+911" }), setTenant: vi.fn() }) } },
    delivery: { service: { listZones: async () => ({ total: 2 }), createZone: vi.fn(), createRate: vi.fn() } },
    catalogue: { service: { listCollections: async () => ({ items: [{ slug: "new-arrivals" }] }), createCollection: vi.fn() } },
    cms: { service: cms },
  } as unknown as Kit;
  return { kit, cms };
}

describe("seedStoreContent never overwrites a shop's content", () => {
  it("homeMissing is true only for a shop that never had a home", () => {
    expect(homeMissing({ draft: null, published: null, publishedAt: null })).toBe(true);
    expect(homeMissing({ draft: { sections: [] }, published: null, publishedAt: null })).toBe(false);
    expect(homeMissing({ draft: null, published: { sections: [] }, publishedAt: null })).toBe(false);
    expect(homeMissing({ draft: null, published: null, publishedAt: new Date() })).toBe(false);
  });

  it("leaves a published home, an unpublished draft, pages and menus alone", async () => {
    for (const home of [
      { draft: { sections: [1, 2, 3] }, published: { sections: [1, 2, 3] }, publishedAt: new Date() },
      { draft: { sections: [1] }, published: null, publishedAt: null },
    ]) {
      const { kit, cms } = fullShop(home);
      await seedStoreContent(kit, "t1", spec, log, "anbu");
      expect(cms.saveHomeDraft).not.toHaveBeenCalled();
      expect(cms.publishHome).not.toHaveBeenCalled();
      expect(cms.createPage).not.toHaveBeenCalled();
      expect(cms.saveMenu).not.toHaveBeenCalled();
      // The about page is looked up by slug, not just on the first list page.
      expect(cms.listPages).toHaveBeenCalledWith("t1", expect.objectContaining({ q: "about" }));
    }
  });

  it("creates the home page when the shop has none", async () => {
    const { kit, cms } = fullShop({ draft: null, published: null, publishedAt: null });
    await seedStoreContent(kit, "t1", spec, log, "anbu");
    expect(cms.saveHomeDraft).toHaveBeenCalledTimes(1);
    expect(cms.publishHome).toHaveBeenCalledTimes(1);
  });
});
