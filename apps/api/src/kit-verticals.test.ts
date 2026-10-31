import { JOB_TEMPLATES } from "@rbms/jobcards";
import { describe, expect, it } from "vitest";
import type { FeatureDef } from "@rbms/core";
import { BUSINESS_TYPES, PACKS } from "@rbms/verticals";
import { toLookup, type ProductRow, type VariantRow } from "@rbms/catalogue";
import { emptyContext, type RequestContext } from "@rbms/core";
import Fastify from "fastify";
import type { Logger } from "pino";
import { counterResolveSchema, createCounter, createSolutionPresets, createStarter, defaultPreset, demandOf, effectivePreset, includedFor, normalizeTradeLabel, switchableFor, type StarterDeps } from "./kit-verticals";

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

describe("solution presets for the batch 9 packs", () => {
  const sw = switchableFor(REGISTRY, SV);
  it("classes and event trades don't see job cards; classes keep memberships and bookings", () => {
    for (const id of ["tuition", "dance_music", "yoga", "driving_school"] as const) {
      const on = defaultPreset(PACKS[id], sw);
      expect(on, id).not.toContain("jobcards");
      expect(on, id).toEqual(expect.arrayContaining(["memberships", "bookings"]));
    }
    expect(defaultPreset(PACKS.catering, sw)).not.toContain("jobcards");
    expect(defaultPreset(PACKS.event_decor, sw)).not.toContain("memberships");
  });
  it("laundry and AC service start on today's job cards and bookings; electricals bring serials and warranty", () => {
    for (const id of ["laundry", "ac_service"] as const) expect(defaultPreset(PACKS[id], sw), id).toEqual(expect.arrayContaining(["jobcards", "bookings"]));
    expect(defaultPreset(PACKS.electricals, sw)).toEqual(expect.arrayContaining(["serials", "serials.warranty"]));
    // The general packs add and remove nothing: every on-by-default feature of the app, no trade engines.
    expect(defaultPreset(PACKS.general_services, sw)).toEqual(["invoices.credit-book", "jobcards", "jobcards.tracking", "memberships", "bookings"]);
  });
  it("lists a preset summary for every solution", async () => {
    const presets = createSolutionPresets({
      registry: () => REGISTRY,
      profile: async () => ({ features: SV }),
      settings: { get: async () => ({ presets: {} }), setApp: async () => undefined },
    });
    expect(Object.keys(await presets.summary()).sort()).toEqual([...BUSINESS_TYPES].sort());
  });
});

describe("workshop packs and the job card templates", () => {
  it("every pack's jobTemplate is a real job card template, and a pack with one keeps job cards on", () => {
    for (const id of BUSINESS_TYPES) {
      const t = PACKS[id].jobTemplate;
      if (!t) continue;
      expect(JOB_TEMPLATES as readonly string[], id).toContain(t);
      expect(PACKS[id].off ?? [], id).not.toContain("jobcards");
    }
  });
});

describe("starter: the trade the owner typed", () => {
  const tenant = (appId: string) => ({ id: "t1", name: "Test Shop", appId });
  function setup() {
    const patches: Record<string, unknown>[] = [];
    const deps = {
      storeSettings: { get: async () => ({}), setTenant: async (_id: string, patch: Record<string, unknown>) => void patches.push(patch) },
      branding: { update: async () => undefined },
      catalogue: { listCategories: async () => ({ items: [{}] }), createCategory: async () => undefined },
      cms: { getHome: async () => ({ published: {} }), saveHomeDraft: async () => undefined, publishHome: async () => undefined },
      log: { info: () => undefined, warn: () => undefined },
    } as unknown as StarterDeps;
    return { starter: createStarter(deps), patches };
  }
  it("keeps the typed label even when it maps to a pack", async () => {
    const { starter, patches } = setup();
    const pack = await starter.apply(tenant("SV"), null, { label: "  Tuition   Centre " });
    expect(pack.id).toBe("tuition");
    expect(patches[0]).toEqual({ businessType: "tuition", businessLabel: "Tuition Centre" });
  });
  it("a chosen pack wins over the label, and the label is still saved", async () => {
    const { starter, patches } = setup();
    expect((await starter.apply(tenant("EC"), "footwear", { label: "chappal kadai" })).id).toBe("footwear");
    expect(patches[0]).toEqual({ businessType: "footwear", businessLabel: "chappal kadai" });
  });
  it("an unknown trade lands on the general pack of its app and its text is kept", async () => {
    const { starter, patches } = setup();
    expect((await starter.apply(tenant("EC"), null, { label: "Space rockets" })).id).toBe("general_shop");
    expect((await starter.apply(tenant("BL"), "", { label: "Space rockets" })).id).toBe("general_counter");
    expect((await starter.apply(tenant("SV"), "other", { label: "Lodge" })).id).toBe("general_services");
    expect(patches.map((p) => p.businessLabel)).toEqual(["Space rockets", "Space rockets", "Lodge"]);
  });
  it("without a label it writes only the pack (an earlier label is not cleared); PH and RS keep their trade", async () => {
    const { starter, patches } = setup();
    expect((await starter.apply(tenant("PH"), "whatever")).id).toBe("pharmacy");
    expect((await starter.apply(tenant("RS"), null, { label: "dhaba" })).id).toBe("restaurant");
    expect(patches[0]).toEqual({ businessType: "pharmacy" });
    expect(patches[1]).toEqual({ businessType: "restaurant", businessLabel: "dhaba" });
  });
  it("agri inputs switch batch and expiry tracking on for the shop; other trades leave it alone", async () => {
    const tracked: string[] = [];
    const deps = {
      storeSettings: { get: async () => ({}), setTenant: async () => undefined },
      branding: { update: async () => undefined },
      catalogue: { listCategories: async () => ({ items: [{}] }), createCategory: async () => undefined },
      cms: { getHome: async () => ({ published: {} }), saveHomeDraft: async () => undefined, publishHome: async () => undefined },
      stockBatches: { trackAll: async (id: string) => void tracked.push(id) },
      log: { info: () => undefined, warn: () => undefined },
    } as unknown as StarterDeps;
    const starter = createStarter(deps);
    await starter.apply({ id: "t-agri", name: "Uzhavan Agro", appId: "BL" }, "agri_inputs");
    await starter.apply({ id: "t-tiles", name: "Tiles", appId: "BL" }, "tiles_sanitary");
    expect(tracked).toEqual(["t-agri"]);
    // A failing switch does not stop the rest of the setup.
    const failing = createStarter({ ...deps, stockBatches: { trackAll: async () => Promise.reject(new Error("db down")) } } as unknown as StarterDeps);
    await expect(failing.apply({ id: "t-agri2", name: "Agro", appId: "BL" }, "agri_inputs")).resolves.toMatchObject({ id: "agri_inputs" });
  });
  it("caps the label at 60 characters", async () => {
    const { starter, patches } = setup();
    await starter.apply(tenant("EC"), null, { label: "x".repeat(200) });
    expect((patches[0]!.businessLabel as string).length).toBe(60);
  });
});

describe("demand list (Not covered)", () => {
  const row = (label: string | null, type: string | null, appId: string | null, createdAt?: string) => ({ label, type, appId, createdAt });
  it("normalizes typed trades: lower-cased, trimmed, single-spaced", () => {
    expect(normalizeTradeLabel("  Lodge   Rooms ")).toBe("lodge rooms");
    expect(normalizeTradeLabel(null)).toBe("");
  });
  it("counts shops on general packs by the typed text, most asked first", () => {
    const items = demandOf([
      row("Lodge", "general_services", "SV", "2026-10-01T00:00:00Z"),
      row("  lodge ", "general_services", "SV", "2026-10-05T00:00:00Z"),
      row("LODGE", "", "EC", "2026-10-03T00:00:00Z"),
      row("Space rockets", "general_shop", "EC", "2026-10-02T00:00:00Z"),
      row("Boat rentals", "general_services", "SV"),
    ]);
    expect(items.map((i) => [i.label, i.shops])).toEqual([["lodge", 3], ["boat rentals", 1], ["space rockets", 1]]);
    expect(items[0]).toMatchObject({ appIds: ["SV", "EC"], lastAt: "2026-10-05T00:00:00.000Z" });
    expect(items[1]!.lastAt).toBeNull();
  });
  it("leaves out shops on a real pack, shops without a label, and keeps PH / RS shops out", () => {
    expect(
      demandOf([
        row("tailor", "tailoring", "SV"),
        row("", "general_shop", "EC"),
        row(null, "general_shop", "EC"),
        row("   ", "general_shop", "EC"),
        row("dhaba", "restaurant", "RS"),
        row("anything", null, "PH"),
        row("kirana", "grocery", "EC"),
      ]),
    ).toEqual([]);
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
