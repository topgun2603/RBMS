import { describe, expect, it } from "vitest";
import type { OnboardingStep } from "@rbms/onboarding";
import { createStudioPorts } from "./kit-ai-studio";
import { createAiOnboardingKit } from "./kit-ai-onboarding";

const T = "11111111-1111-4111-8111-111111111111";

/** A catalogue with the category calls the Studio ports use (create refuses duplicates, delete refuses non-empty). */
function fakeCatalogue(seed: { name: string; productCount?: number }[]) {
  let n = 0;
  const items = seed.map((c) => ({ id: `c${++n}`, name: c.name, slug: c.name.toLowerCase(), parentId: null as string | null, sort: n * 10, productCount: c.productCount ?? 0, active: true }));
  return {
    items,
    async listCategories() {
      return { items: structuredClone(items), total: items.length };
    },
    async createCategory(_t: string, input: { name: string; sort?: number }) {
      if (items.some((c) => c.name.toLowerCase() === input.name.toLowerCase())) throw new Error("duplicate");
      const c = { id: `c${++n}`, name: input.name, slug: input.name.toLowerCase(), parentId: null, sort: input.sort ?? 0, productCount: 0, active: true };
      items.push(c);
      return c;
    },
    async deleteCategory(_t: string, id: string) {
      const i = items.findIndex((c) => c.id === id);
      if (items[i]!.productCount > 0) throw new Error("Move the products out of this category first");
      items.splice(i, 1);
    },
    async listCollections() {
      return { items: [] };
    },
    async listProducts() {
      return { items: [], total: 0 };
    },
  };
}

const ctx = { tenantId: T, actor: { userId: "u1", fullAccess: true, permissions: ["*"] } };

describe("Studio ports: the product groups area (shop setup assistant)", () => {
  it("reads groups with product counts, creates new names, deletes removed names, and undo swaps them back", async () => {
    const cat = fakeCatalogue([{ name: "Sarees" }, { name: "Kurtis", productCount: 3 }, { name: "Menswear" }]);
    const ports = createStudioPorts({ catalogue: cat } as never);
    const before = (await ports.readAreas(T, ["categories"])).categories as { items: { name: string; products: number }[] };
    expect(before.items.map((c) => [c.name, c.products])).toEqual([["Sarees", 0], ["Kurtis", 3], ["Menswear", 0]]);
    const after = { items: [...before.items.filter((c) => c.name !== "Menswear"), { id: null, name: "Silk sarees", slug: "", products: 0, parentId: null }] };
    await ports.writeArea(ctx as never, "categories", before, after);
    expect(cat.items.map((c) => c.name)).toEqual(["Sarees", "Kurtis", "Silk sarees"]);
    expect(cat.items.find((c) => c.name === "Silk sarees")!.sort).toBeGreaterThan(30);
    // Undo: the engine writes `before` over what is there now.
    const now = (await ports.readAreas(T, ["categories"])).categories;
    await ports.writeArea(ctx as never, "categories", now, before);
    expect(cat.items.map((c) => c.name).sort()).toEqual(["Kurtis", "Menswear", "Sarees"]);
  });

  it("a group that has products is never deleted (the catalogue refuses and the error reaches the engine)", async () => {
    const cat = fakeCatalogue([{ name: "Kurtis", productCount: 3 }]);
    const ports = createStudioPorts({ catalogue: cat } as never);
    const before = (await ports.readAreas(T, ["categories"])).categories;
    await expect(ports.writeArea(ctx as never, "categories", before, { items: [] })).rejects.toThrow(/products/);
    expect(cat.items).toHaveLength(1);
  });
});

describe("setup checklist step", () => {
  function kit(onboarding: unknown, products: boolean) {
    const steps: OnboardingStep[] = [];
    createAiOnboardingKit({
      ai: {} as never,
      studio: { service: {} as never, ports: {} as never },
      aiSettings: { get: async () => ({ enabled: false, features: {}, onboarding }), setTenant: async () => undefined },
      tenancy: { getById: async () => ({ name: "Shop", appId: "EC" }) },
      hasProducts: async () => products,
      registerStep: (s) => steps.push(s),
    });
    return steps[0]!;
  }
  it("is the first step, for the AI feature, and done once applied, dismissed or the shop already has products", async () => {
    const s = kit(undefined, false);
    expect(s).toMatchObject({ key: "shop-setup-assistant", feature: "ai", href: "settings/shop-setup" });
    expect(s.order).toBeLessThan(10);
    expect(await s.check(T)).toBe(false);
    expect(await kit({ status: "applied" }, false).check(T)).toBe(true);
    expect(await kit({ status: "dismissed" }, false).check(T)).toBe(true);
    expect(await kit({ status: "planned" }, false).check(T)).toBe(false);
    expect(await kit(undefined, true).check(T)).toBe(true);
  });
});
