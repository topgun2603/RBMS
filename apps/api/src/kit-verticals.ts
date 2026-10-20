import { themePreset } from "@srirealtime/branding";
import { badRequest, defineModule, notFound, requireRole, requireSuperAdmin, requireTenant, type SrModule } from "@srirealtime/core";
import { and, eq, inArray, isNull, sql, type Db } from "@srirealtime/db";
import { settingsValues } from "@srirealtime/settings";
import { tenants } from "@srirealtime/tenancy";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BUSINESS_TYPES, PACKS, packFor, packOrDefault, starterHome, type BusinessPack } from "@srirealtime/verticals";
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
  /** Turns the pack's own engines on for the shop (`setToggle` of the features service). */
  features?: { setToggle(tenant: { id: string; slug: string; planId: string | null; appId: string | null }, key: string, enabled: boolean): Promise<unknown> };
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
    for (const key of pack.features ?? []) {
      await deps.features
        ?.setToggle({ id: tenant.id, slug: tenant.slug ?? "", planId: tenant.planId ?? null, appId: tenant.appId }, key, true)
        .catch((err: unknown) => deps.log.warn({ err, tenantId: tenant.id, key }, "starter: could not switch the feature on"));
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

// ---------------------------------------------------------------- platform: solutions (super-admin)


export interface SolutionsDeps {
  db: Db;
  starter: Starter;
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
      const all = await typesOf();
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
          };
        }),
      };
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
