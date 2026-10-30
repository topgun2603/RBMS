import { describe, expect, it } from "vitest";
import type { FeatureDef } from "@rbms/core";
import { PACKS } from "@rbms/verticals";
import { toLookup, type ProductRow, type VariantRow } from "@rbms/catalogue";
import { emptyContext, type RequestContext } from "@rbms/core";
import Fastify from "fastify";
import type { Logger } from "pino";
import { counterResolveSchema, createCounter, createSolutionPresets, defaultPreset, effectivePreset, includedFor, switchableFor } from "./kit-verticals";

const def = (key: string, extra: Partial<FeatureDef> = {}): FeatureDef => ({
  key,
  module: key.split(".")[0]!,
  label: key,
  description: "",
  ...extra,
});

const REGISTRY: FeatureDef[] = [
  def("invoices"),
  def("invoices.credit-book", { shopToggle: true }),
  def("jobcards", { shopToggle: true }),
  def("jobcards.tracking", { shopToggle: true, dependsOn: ["jobcards"] }),
  def("memberships", { shopToggle: true }),
  def("bookings", { shopToggle: true }),
  def("serials", { shopToggle: true, defaultOn: false }),
  def("serials.warranty", { shopToggle: true, defaultOn: false }),
  def("scales", { shopToggle: true, defaultOn: false }),
];
const SV = ["invoices", "invoices.credit-book", "jobcards.*", "memberships.*", "bookings.*", "serials.*"];

describe("solution presets", () => {
  it("splits the app's features into switchable and always included", () => {
    expect(switchableFor(REGISTRY, SV).map((d) => d.key)).toEqual([
      "invoices.credit-book",
      "jobcards",
      "jobcards.tracking",
      "memberships",
      "bookings",
      "serials",
      "serials.warranty",
    ]);
    expect(includedFor(REGISTRY, SV).map((d) => d.key)).toEqual(["invoices"]);
    // scales isn't in the app: not switchable for its shops
    expect(switchableFor(REGISTRY, SV).some((d) => d.key === "scales")).toBe(false);
  });

  it("defaults: on-by-default features, plus the trade's engines, minus what the trade doesn't use", () => {
    const sw = switchableFor(REGISTRY, SV);
    // gym: no job cards (module id switches off the whole module)
    expect(defaultPreset(PACKS.gym, sw)).toEqual(["invoices.credit-book", "memberships", "bookings"]);
    // repair: serial numbers on, no memberships
    expect(defaultPreset(PACKS.repair, sw)).toEqual(["invoices.credit-book", "jobcards", "jobcards.tracking", "bookings", "serials", "serials.warranty"]);
    // spa: like the salon, bookings and memberships without job cards
    expect(defaultPreset(PACKS.spa, sw)).toEqual(defaultPreset(PACKS.salon, sw));
    expect(defaultPreset(PACKS.spa, sw)).toEqual(["invoices.credit-book", "memberships", "bookings"]);
  });

  it("a stored preset is narrowed to what the app can switch now", () => {
    const sw = switchableFor(REGISTRY, SV);
    expect(effectivePreset(["memberships", "scales", "gone"], PACKS.gym, sw)).toEqual(["memberships"]);
    expect(effectivePreset(undefined, PACKS.gym, sw)).toEqual(defaultPreset(PACKS.gym, sw));
  });

  it("saves, resets and turns a preset into shop switches", async () => {
    let stored: Record<string, string[]> = {};
    const presets = createSolutionPresets({
      registry: () => REGISTRY,
      profile: async (appId) => (appId === "SV" ? { features: SV } : null),
      settings: { get: async () => ({ presets: stored }), setApp: async (p) => void (stored = p.presets) },
    });
    const v = await presets.save("gym", ["memberships", "jobcards"]);
    expect(v.customised).toBe(true);
    expect(v.on).toEqual(["jobcards", "memberships"]);
    expect(await presets.toggles("gym", "SV")).toMatchObject({ jobcards: true, memberships: true, bookings: false, serials: false });
    await expect(presets.save("gym", ["scales"])).rejects.toThrow(/Not switchable/);
    const reset = await presets.save("gym", null);
    expect(reset.customised).toBe(false);
    expect(reset.switchable.find((d) => d.key === "jobcards")).toMatchObject({ on: false, byDefault: false });
    const summary = await presets.summary();
    expect(summary.gym).toEqual({ on: 3, switchable: 7, customised: false });
  });
});

describe("counter resolve", () => {
  const TENANT = "11111111-1111-4111-8111-111111111111";
  const at = new Date("2026-10-01T05:00:00Z");
  // A catalogue lookup shaped by the catalogue's own toLookup.
  const lookup = toLookup(
    {
      id: "33333333-3333-4333-8333-333333333333",
      tenantId: TENANT,
      productId: "22222222-2222-4222-8222-222222222222",
      sku: null,
      barcode: null,
      title: "",
      optionValues: {},
      price: 4000,
      mrp: null,
      cost: null,
      weightGrams: null,
      position: 0,
      isDefault: true,
      deletedAt: null,
      createdAt: at,
      updatedAt: at,
    } as VariantRow,
    {
      id: "22222222-2222-4222-8222-222222222222",
      tenantId: TENANT,
      name: "Tomato",
      slug: "tomato",
      categoryId: null,
      hsn: "0702",
      gstRate: 0,
      unit: "kg",
      taxInclusive: false,
      status: "active",
      channels: ["billing", "pos"],
      images: [],
      createdAt: at,
      updatedAt: at,
    } as unknown as ProductRow,
  );

  it("answers a scale label with the variant and weight, matching counterResolveSchema", async () => {
    const counter = createCounter({ variants: async () => [lookup], log: { warn() {} } as unknown as Logger });
    counter.add("scales", async (_t, code) => (code.startsWith("21") ? { itemId: lookup.id, qty: 1.25 } : null));
    const app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (req) => {
      req.ctx = {
        ...emptyContext(),
        tenant: { id: TENANT, slug: "sri", planId: "pro", appId: "BL" },
        user: { id: "u1", sessionId: "s1", platformRoles: [], tenantRoles: ["staff"] },
      } as RequestContext;
    });
    let config: unknown;
    app.addHook("onRoute", (r) => {
      config = r.config;
    });
    await app.register(counter.module.routes!, { prefix: "/v1/counter" });
    expect(config).toMatchObject({ permission: "invoices.create" });
    const res = await app.inject({ url: "/v1/counter/resolve?code=2100012012500" });
    expect(res.statusCode, res.body).toBe(200);
    const json = res.json();
    expect(counterResolveSchema.parse(json)).toEqual(json);
    expect(json.qty).toBe(1.25);
    expect((await app.inject({ url: "/v1/counter/resolve?code=999" })).statusCode).not.toBe(200);
    await app.close();
  });
});
