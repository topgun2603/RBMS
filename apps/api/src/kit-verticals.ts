import { themePreset } from "@srirealtime/branding";
import { badRequest, defineModule, notFound, requireRole, requireSuperAdmin, requireTenant, type FeatureDef, type SrModule } from "@srirealtime/core";
import { grants } from "@srirealtime/features";
import { and, eq, inArray, isNull, sql, type Db } from "@srirealtime/db";
import { settingsValues } from "@srirealtime/settings";
import { tenants } from "@srirealtime/tenancy";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BUSINESS_TYPES, PACKS, packFor, packOrDefault, starterHome, type BusinessPack, type BusinessType } from "@srirealtime/verticals";
import type { Logger } from "pino";

/**
 * Business packs applied to a shop (docs/verticals.md): the trade in the `store` settings, the pack's theme preset in
 * branding, starter categories and a starter home page. Used by the on-tenant-created "starter" hook for new shops and
 * by scripts for existing ones. Each step is skipped when the shop already has its own (categories, a published home).
 */
export interface StarterDeps {
  storeSettings: { get(scope: { tenantId: string }): Promise<Record<string, unknown>>; setTenant(tenantId: string, patch: Record<string, unknown>): Promise<unknown> };
  branding: { update(tenantId: string, patch: unknown): Promise<unknown> };
  catalogue: {
    listCategories(tenantId: string): Promise<{ items: unknown[] }>;
    createCategory(tenantId: string, input: { name: string; sort?: number }): Promise<unknown>;
  };
  /** The solution preset: which of the app's optional features the shop starts with on (written as shop switches). */
  presets?: SolutionPresets;
  features?: { applyToggles(tenantId: string, toggles: Readonly<Record<string, boolean>>): Promise<number> };
  cms: {
    getHome(tenantId: string): Promise<{ published: unknown | null }>;
    saveHomeDraft(tenantId: string, input: unknown): Promise<unknown>;
    publishHome(tenantId: string): Promise<unknown>;
  };
  log: Logger;
}

export interface StarterOptions {
  /** Apply the pack's theme preset (colours, fonts, layout). Default true. */
  theme?: boolean;
  /** Create starter categories and publish a starter home when the shop has none. Default true. */
  content?: boolean;
  locale?: "en" | "ta";
}

export function createStarter(deps: StarterDeps) {
  async function apply(
    tenant: { id: string; name: string; appId: string | null; slug?: string; planId?: string | null },
    businessType: string | null | undefined,
    opts: StarterOptions = {},
  ): Promise<BusinessPack> {
    const pack = packOrDefault(businessType, tenant.appId);
    await deps.storeSettings.setTenant(tenant.id, { businessType: pack.id });
    if (deps.presets && deps.features) {
      const toggles = await deps.presets.toggles(pack.id, tenant.appId);
      await deps.features
        .applyToggles(tenant.id, toggles)
        .catch((err: unknown) => deps.log.warn({ err, tenantId: tenant.id }, "starter: could not apply the solution preset"));
    }

    const preset = themePreset(pack.preset);
    if (preset && opts.theme !== false) {
      await deps.branding.update(tenant.id, {
        tokens: {
          colors: {
            primary: preset.colors.primary,
            accent: preset.colors.accent ?? null,
            background: preset.colors.background ?? null,
            foreground: preset.colors.foreground ?? null,
          },
          fontSans: preset.fontSans,
          fontHeading: preset.fontHeading,
          radius: preset.radius,
          mode: preset.mode,
          theme: preset.theme,
          preset: preset.id,
        },
      });
    }

    if (opts.content !== false) {
      const cats = await deps.catalogue.listCategories(tenant.id);
      if (cats.items.length === 0) {
        for (const [i, name] of pack.categories.entries()) await deps.catalogue.createCategory(tenant.id, { name, sort: (i + 1) * 10 });
      }
      const home = await deps.cms.getHome(tenant.id);
      if (!home.published) {
        await deps.cms.saveHomeDraft(tenant.id, { sections: starterHome(pack, tenant.name, opts.locale ?? "en") });
        await deps.cms.publishHome(tenant.id);
      }
    }
    deps.log.info({ tenantId: tenant.id, pack: pack.id, preset: preset?.id }, "starter: business pack applied");
    return pack;
  }
  return { apply };
}

export type Starter = ReturnType<typeof createStarter>;

// ---------------------------------------------------------------- solution presets

/**
 * Settings namespace `solutions` (platform layer only): each solution's preset as the list of the app's optional
 * features that are on. A solution without a stored preset uses its default (`defaultPreset`).
 */
export const SOLUTIONS_SETTINGS_SCHEMA = z.object({ presets: z.record(z.string(), z.array(z.string().max(80)).max(500)) });
export const SOLUTIONS_SETTINGS_DEFAULTS: { presets: Record<string, string[]> } = { presets: {} };

/** Features a shop of the app can switch on or off (the app offers them and the owner may switch them). */
export function switchableFor(registry: readonly FeatureDef[], appGrants: readonly string[] | null): FeatureDef[] {
  return registry.filter((d) => d.shopToggle && (appGrants === null || grants(appGrants, d)));
}

/** Features the app always includes (not switchable by the shop, so the same for every solution of the app). */
export function includedFor(registry: readonly FeatureDef[], appGrants: readonly string[] | null): FeatureDef[] {
  return registry.filter((d) => !d.shopToggle && (appGrants === null || grants(appGrants, d)));
}

/**
 * The preset a solution starts from: the switchable features that are on by default, plus the trade's own engines
 * (`pack.features`), minus what the trade doesn't use (`pack.off`: keys, or module ids for a whole module).
 */
export function defaultPreset(pack: Pick<BusinessPack, "features" | "off">, switchable: readonly FeatureDef[]): string[] {
  const extra = new Set(pack.features ?? []);
  const off = new Set(pack.off ?? []);
  return switchable
    .filter((d) => (d.defaultOn !== false || extra.has(d.key)) && !off.has(d.key) && !off.has(d.module))
    .map((d) => d.key);
}

/** A stored preset narrowed to what the app can switch now (features may have been added or removed since). */
export function effectivePreset(
  stored: readonly string[] | undefined,
  pack: Pick<BusinessPack, "features" | "off">,
  switchable: readonly FeatureDef[],
): string[] {
  if (!stored) return defaultPreset(pack, switchable);
  const keys = new Set(stored);
  return switchable.filter((d) => keys.has(d.key)).map((d) => d.key);
}

export interface SolutionPresetsDeps {
  registry(): FeatureDef[];
  profile(appId: string): Promise<{ features: string[] } | null>;
  settings: { get(): Promise<{ presets?: Record<string, string[]> }>; setApp(patch: { presets: Record<string, string[]> }): Promise<unknown> };
}

export interface SolutionPresetView {
  id: BusinessType;
  appId: string;
  /** Features the shop can switch, with whether the preset has them on and whether the default does. */
  switchable: (FeatureDef & { on: boolean; byDefault: boolean })[];
  /** Features the app always includes. */
  included: FeatureDef[];
  on: string[];
  customised: boolean;
}

export function createSolutionPresets(deps: SolutionPresetsDeps) {
  async function grantsOf(appId: string | null) {
    return appId ? ((await deps.profile(appId))?.features ?? []) : null;
  }
  async function stored() {
    return (await deps.settings.get()).presets ?? {};
  }
  async function view(id: BusinessType): Promise<SolutionPresetView> {
    const pack = PACKS[id];
    const app = await grantsOf(pack.appId);
    const registry = deps.registry();
    const sw = switchableFor(registry, app);
    const saved = (await stored())[id];
    const on = new Set(effectivePreset(saved, pack, sw));
    const byDefault = new Set(defaultPreset(pack, sw));
    return {
      id,
      appId: pack.appId,
      switchable: sw.map((d) => ({ ...d, on: on.has(d.key), byDefault: byDefault.has(d.key) })),
      included: includedFor(registry, app),
      on: [...on],
      customised: saved !== undefined,
    };
  }
  /** Saves a preset (`null`: back to the default). Keys the solution's app can't switch are refused. */
  async function save(id: BusinessType, features: string[] | null): Promise<SolutionPresetView> {
    const all = { ...(await stored()) };
    if (features === null) delete all[id];
    else {
      const sw = new Set(switchableFor(deps.registry(), await grantsOf(PACKS[id].appId)).map((d) => d.key));
      const bad = features.filter((k) => !sw.has(k));
      if (bad.length) throw badRequest(`Not switchable in this app: ${bad.join(", ")}`, { features: bad });
      all[id] = [...new Set(features)];
    }
    await deps.settings.setApp({ presets: all });
    return view(id);
  }
  /** The shop switches for a solution on a shop of `appId` (the shop's own app may differ from the solution's). */
  async function toggles(id: BusinessType, appId: string | null): Promise<Record<string, boolean>> {
    const sw = switchableFor(deps.registry(), await grantsOf(appId));
    const on = new Set(effectivePreset((await stored())[id], PACKS[id], sw));
    return Object.fromEntries(sw.map((d) => [d.key, on.has(d.key)]));
  }
  /** On / switchable counts per solution, for the solution list. */
  async function summary(): Promise<Record<string, { on: number; switchable: number; customised: boolean }>> {
    const saved = await stored();
    const registry = deps.registry();
    const byApp = new Map<string, FeatureDef[]>();
    const out: Record<string, { on: number; switchable: number; customised: boolean }> = {};
    for (const id of BUSINESS_TYPES) {
      const pack = PACKS[id];
      if (!byApp.has(pack.appId)) byApp.set(pack.appId, switchableFor(registry, await grantsOf(pack.appId)));
      const sw = byApp.get(pack.appId)!;
      out[id] = { on: effectivePreset(saved[id], pack, sw).length, switchable: sw.length, customised: saved[id] !== undefined };
    }
    return out;
  }
  return { view, save, toggles, summary };
}

export type SolutionPresets = ReturnType<typeof createSolutionPresets>;

// ---------------------------------------------------------------- platform: solutions (super-admin)


export interface SolutionsDeps {
  db: Db;
  starter: Starter;
  presets: SolutionPresets;
  features: { applyToggles(tenantId: string, toggles: Readonly<Record<string, boolean>>): Promise<number> };
  tenancy: {
    getById(id: string): Promise<{ id: string; name: string; slug: string; planId: string | null; appId: string | null } | null>;
    setApp(id: string, appId: string | null): Promise<unknown>;
  };
}

const applyBody = z
  .object({
    businessType: z.enum(BUSINESS_TYPES),
    /** Apply the solution's look (theme preset). Default true. */
    theme: z.boolean().default(true),
    /** Starter categories + home page when the shop has none. Default true. */
    content: z.boolean().default(true),
    /** Also move the shop to the solution's app (e.g. Services). Default false. */
    switchApp: z.boolean().default(false),
  })
  .strict();

/**
 * `/v1/solutions` (super-admin): the 15 predefined solutions with how many shops run each, every shop's solution, and
 * switching a shop to another solution (its look, starter content, optionally its app).
 */
export function createSolutions(deps: SolutionsDeps): SrModule {
  /** businessType per tenant ("" when never chosen), from the `store` settings tenant rows. */
  async function typesOf(ids?: string[]) {
    const rows = await deps.db
      .select({ id: tenants.id, appId: tenants.appId, type: sql<string | null>`${settingsValues.value}->>'businessType'` })
      .from(tenants)
      .leftJoin(settingsValues, and(eq(settingsValues.tenantId, tenants.id), eq(settingsValues.namespace, "store"), isNull(settingsValues.userId)))
      .where(ids ? inArray(tenants.id, ids) : undefined);
    return rows.map((r) => {
      const chosen = packFor(r.type);
      return { tenantId: r.id, appId: r.appId, businessType: chosen?.id ?? null, effective: packOrDefault(r.type, r.appId).id };
    });
  }

  const routes = async (app: FastifyInstance) => {
    app.addHook("preHandler", async (req) => {
      requireSuperAdmin(req.ctx);
    });
    app.get("/", async () => {
      const [all, presets] = await Promise.all([typesOf(), deps.presets.summary()]);
      const counts = new Map<string, number>();
      for (const r of all) counts.set(r.effective, (counts.get(r.effective) ?? 0) + 1);
      return {
        items: BUSINESS_TYPES.map((id) => {
          const p = PACKS[id];
          const preset = themePreset(p.preset);
          return {
            id,
            name: p.name,
            nameTa: p.nameTa,
            tagline: p.tagline,
            appId: p.appId,
            preset: preset ? { id: preset.id, name: preset.name, primary: preset.colors.primary, background: preset.colors.background ?? null, fontHeading: preset.fontHeading } : null,
            categories: p.categories,
            shops: counts.get(id) ?? 0,
            features: presets[id],
          };
        }),
      };
    });
    const solutionParam = z.object({ id: z.enum(BUSINESS_TYPES) });
    app.get("/:id/preset", async (req) => deps.presets.view(solutionParam.parse(req.params).id));
    app.put("/:id/preset", async (req) => {
      const { id } = solutionParam.parse(req.params);
      const b = z
        .object({
          /** The features that are on; null resets to the default preset. */
          features: z.array(z.string().max(80)).max(500).nullable(),
          /** Also apply it now to every shop running this solution (their owners' switches are replaced). */
          applyToShops: z.boolean().default(false),
        })
        .strict()
        .parse(req.body ?? {});
      const view = await deps.presets.save(id, b.features);
      let applied = 0;
      if (b.applyToShops) {
        for (const t of (await typesOf()).filter((r) => r.effective === id)) {
          await deps.features.applyToggles(t.tenantId, await deps.presets.toggles(id, t.appId));
          applied++;
        }
      }
      return { ...view, applied };
    });
    app.get("/tenants", async (req) => {
      const { ids } = z
        .object({ ids: z.string().optional().transform((v) => (v ? v.split(",").filter(Boolean) : [])).pipe(z.array(z.string().uuid()).max(500)) })
        .parse(req.query ?? {});
      return { items: ids.length ? await typesOf(ids) : [] };
    });
    app.put("/tenants/:id", async (req) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const b = applyBody.parse(req.body ?? {});
      const tenant = await deps.tenancy.getById(id);
      if (!tenant) throw notFound("Shop");
      const pack = PACKS[b.businessType];
      if (b.switchApp && tenant.appId !== pack.appId) await deps.tenancy.setApp(id, pack.appId);
      else if (!b.switchApp && !tenant.appId) throw badRequest("This shop has no app; switch its app too");
      await deps.starter.apply(
        { id, name: tenant.name, slug: tenant.slug, planId: tenant.planId, appId: b.switchApp ? pack.appId : tenant.appId },
        b.businessType,
        { theme: b.theme, content: b.content },
      );
      return (await typesOf([id]))[0];
    });
  };
  return defineModule({ id: "solutions", routes });
}

// ---------------------------------------------------------------- counter: scanned codes no item barcode matches

/** A resolver's answer for a scanned code: the catalogue item, plus the weight (scale label) or the unit (serial). */
export interface ResolvedCode {
  itemId: string;
  qty?: number;
  serial?: string;
}
export type CodeResolver = (tenantId: string, code: string) => Promise<ResolvedCode | null>;

/**
 * `GET /v1/counter/resolve?code=` for the POS: weighing-scale labels, serial numbers / IMEIs… Each engine registers a
 * resolver (`counter.add`); the first answer wins and comes back with the item as the catalogue's lookup returns it.
 * 404 when nothing matches. Staff who can make bills.
 */
export function createCounter(deps: { variants(tenantId: string, ids: string[]): Promise<unknown[]>; log: Logger }) {
  const resolvers: { name: string; run: CodeResolver }[] = [];
  const codeQuery = z.object({ code: z.string().trim().min(3).max(64) });
  const routes = async (app: FastifyInstance) => {
    app.get("/resolve", { config: { permission: ["invoices.create", "invoices.view"] } }, async (req) => {
      requireRole(req.ctx, "owner", "admin", "staff");
      const tenantId = requireTenant(req.ctx).id;
      const { code } = codeQuery.parse(req.query ?? {});
      for (const r of resolvers) {
        const hit = await r.run(tenantId, code).catch((err: unknown) => {
          deps.log.warn({ err, resolver: r.name }, "counter: resolver failed");
          return null;
        });
        if (!hit) continue;
        const [variant] = await deps.variants(tenantId, [hit.itemId]);
        if (!variant) continue;
        return { variant, ...(hit.qty !== undefined ? { qty: hit.qty } : {}), ...(hit.serial ? { serial: hit.serial } : {}) };
      }
      throw notFound("Code");
    });
  };
  return {
    module: defineModule({ id: "counter", routes }),
    /** Registers a resolver (asked in the order added). */
    add(name: string, run: CodeResolver) {
      resolvers.push({ name, run });
    },
  };
}
