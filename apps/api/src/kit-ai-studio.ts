import { studio, type AiService } from "@srirealtime/ai";
import type { AuditPort } from "@srirealtime/core";
import type { AuthService } from "@srirealtime/auth";
import type { BrandingService } from "@srirealtime/branding";
import { tenantBranding } from "@srirealtime/branding";
import type { CatalogueService } from "@srirealtime/catalogue";
import { cmsPages, type CmsService } from "@srirealtime/cms";
import type { SrModule } from "@srirealtime/core";
import { and, eq, inArray, isNull, type Db } from "@srirealtime/db";
import type { FeaturesService } from "@srirealtime/features";
import { settingsValues, type SettingsService } from "@srirealtime/settings";
import type { DiscountLimitService, StaffService } from "@srirealtime/staff";
import { tenants, type TenancyService } from "@srirealtime/tenancy";

type Ports = studio.StudioPorts;
type Actor = Parameters<StaffService["createRole"]>[2];

export interface StudioKitDeps {
  db: Db;
  ai: AiService;
  branding: Pick<BrandingService, "get" | "update" | "reset" | "defaults">;
  cms: Pick<CmsService, "getHome" | "saveHomeDraft" | "publishHome" | "getMenu" | "saveMenu" | "listPages" | "createPage" | "setPageStatus" | "deletePage" | "updatePage">;
  settings: SettingsService;
  staff: Pick<StaffService, "listRoles" | "createRole" | "updateRole" | "deleteRole" | "listMembers" | "registry">;
  discounts: Pick<DiscountLimitService, "list" | "set" | "remove">;
  auth: Pick<AuthService, "signInSettings" | "updateSignInOptions">;
  features: Pick<FeaturesService, "resolve" | "setToggle" | "clearToggles">;
  tenancy: Pick<TenancyService, "getRef" | "getById">;
  catalogue: Pick<CatalogueService, "listCategories" | "listCollections" | "listProducts" | "createCategory" | "deleteCategory">;
  audit: AuditPort;
  /** Re-read before the model plans: the shop's own settings namespace "store". */
  storeSettings: { get(scope: { tenantId: string }): Promise<Record<string, unknown>> };
  shops?: (ids: string[]) => Promise<Map<string, { slug: string; name: string }>>;
  now?: () => Date;
}

const json = <T,>(v: T): T => JSON.parse(JSON.stringify(v ?? null));
const eqJson = (a: unknown, b: unknown) => studio.stable(a) === studio.stable(b);

/** Namespaces Studio may read and write, and nothing else. */
const SETTINGS_NAMESPACES = new Set(["store", "billing", "printing", "quotations", "ai"]);

/**
 * The ports Studio reads and writes through (docs/ai.md, Phase 4 part A): every write goes through the service the
 * matching settings screen uses (branding, cms, settings, staff, auth sign-in options, features), so validation,
 * plan checks and audit rules of those services apply unchanged. The only SQL is reading the shop's own saved layer
 * (to restore keys exactly) and finding a page by its address.
 */
export function createStudioPorts(d: StudioKitDeps): Ports {
  const read: Record<string, (tenantId: string, area: string) => Promise<unknown>> = {
    branding: async (tenantId) => {
      const [row] = await d.db.select().from(tenantBranding).where(eq(tenantBranding.tenantId, tenantId)).limit(1);
      return { appName: row?.appName ?? null, tokens: json(row?.tokens ?? {}) };
    },
    home: async (tenantId) => {
      const h = await d.cms.getHome(tenantId);
      return json({ doc: h.published, unpublished: h.hasUnpublishedChanges });
    },
    menu: async (tenantId, area) => ({ items: json((await d.cms.getMenu(tenantId, area.slice(5) as "header" | "footer")).items) }),
    page: async (tenantId, area) => {
      const slug = area.slice(5);
      const [row] = await d.db.select().from(cmsPages).where(and(eq(cmsPages.tenantId, tenantId), eq(cmsPages.slug, slug))).limit(1);
      return row ? { exists: true, id: row.id, slug, title: row.title, blocks: json(row.blocks ?? []), status: row.status } : { exists: false, id: null, slug, title: "", blocks: [], status: "draft" };
    },
    settings: async (tenantId, area) => {
      const ns = area.slice(9);
      if (!SETTINGS_NAMESPACES.has(ns)) throw new Error(`Studio cannot read settings "${ns}"`);
      const [row] = await d.db.select({ value: settingsValues.value }).from(settingsValues).where(and(eq(settingsValues.namespace, ns), eq(settingsValues.tenantId, tenantId), isNull(settingsValues.userId))).limit(1);
      const effective = await d.settings.handle(ns).get({ tenantId });
      return { layer: json(row?.value ?? {}), effective: json(effective) };
    },
    roles: async (tenantId) => ({
      roles: (await d.staff.listRoles(tenantId)).map((r) => ({ key: r.key, name: r.name, description: r.description ?? "", permissions: [...r.permissions], builtin: r.builtin })),
    }),
    discounts: async (tenantId) => ({
      items: (await d.discounts.list(tenantId)).items.map((i) => ({ scope: i.scope, subject: i.subject, maxPercent: i.maxPercent, maxAmount: i.maxAmount })),
    }),
    signin: async (tenantId) => {
      const o = (await d.auth.signInSettings(tenantId)).options;
      return json({ staff: o.staff, customer: o.customer });
    },
    categories: async (tenantId) => ({
      items: (await d.catalogue.listCategories(tenantId)).items.map((c) => ({ id: c.id, name: c.name, slug: c.slug, products: c.productCount, parentId: c.parentId ?? null })),
    }),
    feature: async (tenantId, area) => {
      const key = area.slice(8);
      const ref = await d.tenancy.getRef(tenantId);
      if (!ref) throw new Error("shop not found");
      const f = (await d.features.resolve(ref)).features.find((x) => x.key === key);
      if (!f) return { key, label: key, shopEnabled: null, enabled: false, reason: "app", shopToggle: false };
      return { key, label: f.label, shopEnabled: f.shopEnabled, enabled: f.enabled, reason: f.reason, shopToggle: f.shopToggle };
    },
  };
  const readOne = (tenantId: string, area: string) => {
    const family = area.includes(":") ? area.slice(0, area.indexOf(":")) : area;
    const fn = read[family];
    if (!fn) throw new Error(`Unknown Studio area "${area}"`);
    return fn(tenantId, area);
  };

  const staffActor = (a: studio.WriteContext): Actor => ({ userId: a.actor.userId, level: a.actor.fullAccess ? "admin" : "staff", ip: a.ip ?? null, userAgent: a.userAgent ?? null });

  const writers: Record<string, (c: studio.WriteContext, area: string, before: any, after: any) => Promise<void>> = {
    async branding(c, _a, before, after) {
      const [row] = await d.db.select().from(tenantBranding).where(eq(tenantBranding.tenantId, c.tenantId)).limit(1);
      const keep = { logoUrl: row?.logoUrl ?? null, logoDarkUrl: row?.logoDarkUrl ?? null, faviconUrl: row?.faviconUrl ?? null };
      await d.branding.reset(c.tenantId);
      try {
        const empty = Object.keys(after.tokens ?? {}).length === 0 && !after.appName && !keep.logoUrl && !keep.logoDarkUrl && !keep.faviconUrl;
        if (!empty) await d.branding.update(c.tenantId, { appName: after.appName, ...keep, tokens: after.tokens });
      } catch (e) {
        // Put the previous look back before reporting.
        await d.branding.update(c.tenantId, { appName: before.appName, ...keep, tokens: before.tokens }).catch(() => undefined);
        throw e;
      }
    },
    async home(c, _a, _before, after) {
      if (!after.doc) return;
      await d.cms.saveHomeDraft(c.tenantId, after.doc);
      await d.cms.publishHome(c.tenantId);
    },
    async menu(c, area, _b, after) {
      await d.cms.saveMenu(c.tenantId, area.slice(5) as "header" | "footer", after.items);
    },
    async page(c, _a, before, after) {
      if (!before.exists && after.exists) {
        const p = await d.cms.createPage(c.tenantId, { title: after.title, slug: after.slug, blocks: after.blocks });
        if (after.status === "published") await d.cms.setPageStatus(c.tenantId, p.id, "published");
      } else if (before.exists && !after.exists) {
        await d.cms.deletePage(c.tenantId, before.id);
      } else if (before.exists && after.exists && before.status !== after.status) {
        await d.cms.setPageStatus(c.tenantId, before.id, after.status);
      }
    },
    async settings(c, area, before, after) {
      const ns = area.slice(9);
      if (!SETTINGS_NAMESPACES.has(ns)) throw new Error(`Studio cannot write settings "${ns}"`);
      const patch: Record<string, unknown> = {};
      for (const k of new Set([...Object.keys(before.layer), ...Object.keys(after.layer)])) {
        if (eqJson(before.layer[k], after.layer[k])) continue;
        patch[k] = k in after.layer ? after.layer[k] : null;
      }
      if (Object.keys(patch).length) await d.settings.handle(ns).setTenant(c.tenantId, patch as never);
    },
    async roles(c, _a, before, after) {
      const had = new Map<string, any>(before.roles.map((r: any) => [r.key, r]));
      const will = new Map<string, any>(after.roles.map((r: any) => [r.key, r]));
      const who = staffActor(c);
      for (const [key, r] of will) {
        const o = had.get(key);
        if (!o) await d.staff.createRole(c.tenantId, { key, name: r.name, description: r.description, permissions: r.permissions }, who);
        else if (!eqJson(o, r)) await d.staff.updateRole(c.tenantId, key, { name: r.name, description: r.description, permissions: r.permissions }, who);
      }
      for (const key of had.keys()) if (!will.has(key)) await d.staff.deleteRole(c.tenantId, key, who);
    },
    async discounts(c, _a, before, after) {
      const key = (r: any) => `${r.scope}:${r.subject}`;
      const had = new Map<string, any>(before.items.map((r: any) => [key(r), r]));
      const will = new Map<string, any>(after.items.map((r: any) => [key(r), r]));
      const who = { userId: c.actor.userId, ip: c.ip ?? null, userAgent: c.userAgent ?? null };
      for (const [k, r] of will) if (!eqJson(had.get(k), r)) await d.discounts.set(c.tenantId, { scope: r.scope, subject: r.subject, maxPercent: r.maxPercent, maxAmount: r.maxAmount }, who);
      for (const [k, r] of had) if (!will.has(k)) await d.discounts.remove(c.tenantId, r.scope, r.subject, who);
    },
    async signin(c, _a, _before, after) {
      await d.auth.updateSignInOptions(c.tenantId, { staff: after.staff, customer: after.customer }, c.actor.userId);
    },
    // Product groups by name: names only in `after` are created, names only in `before` are deleted (the catalogue
    // refuses to delete a group that has products or sub-groups). Undo runs the same with the two swapped.
    async categories(c, _a, before, after) {
      const k = (n: string) => n.trim().toLowerCase();
      const had = new Map<string, any>(before.items.map((x: any) => [k(x.name), x]));
      const will = new Map<string, any>(after.items.map((x: any) => [k(x.name), x]));
      const now = (await d.catalogue.listCategories(c.tenantId)).items;
      let sort = now.reduce((m, x) => Math.max(m, x.sort ?? 0), 0);
      for (const [name, x] of will) {
        if (had.has(name) || now.some((y) => k(y.name) === name)) continue;
        sort += 10;
        await d.catalogue.createCategory(c.tenantId, { name: x.name, sort });
      }
      for (const [name] of had) {
        if (will.has(name)) continue;
        const row = now.find((y) => k(y.name) === name);
        if (row) await d.catalogue.deleteCategory(c.tenantId, row.id);
      }
    },
    async feature(c, area, _before, after) {
      const key = area.slice(8);
      const ref = await d.tenancy.getRef(c.tenantId);
      if (!ref) throw new Error("shop not found");
      if (after.shopEnabled === null) await d.features.clearToggles(c.tenantId, key);
      else await d.features.setToggle(ref, key, after.shopEnabled, c.actor.userId);
    },
  };

  return {
    async env(tenantId) {
      const ref = await d.tenancy.getRef(tenantId);
      const [cats, cols, pages, feats, sign, store] = await Promise.all([
        d.catalogue.listCategories(tenantId),
        d.catalogue.listCollections(tenantId, { limit: 100 } as never),
        d.cms.listPages(tenantId, { limit: 100 }),
        ref ? d.features.resolve(ref) : Promise.resolve({ features: [] as { key: string; label: string; shopToggle: boolean }[] }),
        d.auth.signInSettings(tenantId),
        d.storeSettings.get({ tenantId }),
      ]);
      return {
        now: (d.now ?? (() => new Date()))(),
        brandDefaults: json(d.branding.defaults) as Record<string, unknown>,
        knownPermissions: d.staff.registry().map((p) => p.key),
        signInPlatform: sign.platform as Record<string, boolean>,
        trade: typeof store.businessType === "string" ? store.businessType : "",
        refs: {
          categories: cats.items.map((c) => c.slug),
          categoryIds: cats.items.map((c) => c.id),
          collections: cols.items.map((c) => c.slug),
          pages: pages.items.map((p) => p.slug),
        },
        toggles: feats.features.filter((f) => f.shopToggle).map((f) => ({ key: f.key, label: f.label })),
      };
    },
    async readAreas(tenantId, areas) {
      const out: Record<string, unknown> = {};
      for (const a of areas) out[a] = await readOne(tenantId, a);
      return out;
    },
    async writeArea(ctx, area, before, after) {
      const family = area.includes(":") ? area.slice(0, area.indexOf(":")) : area;
      const w = writers[family];
      if (!w) throw new Error(`Unknown Studio area "${area}"`);
      await w(ctx, area, before, after);
    },
    async feature(tenantId, key) {
      const ref = await d.tenancy.getRef(tenantId);
      if (!ref) return { enabled: false, reason: "app", label: key };
      const f = (await d.features.resolve(ref)).features.find((x) => x.key === key);
      return f ? { enabled: f.enabled, reason: f.reason, label: f.label } : { enabled: false, reason: "app", label: key };
    },
    async features(tenantId) {
      const ref = await d.tenancy.getRef(tenantId);
      if (!ref) return [];
      return (await d.features.resolve(ref)).features.map((f) => ({ key: f.key, label: f.label, enabled: f.enabled, switchable: f.shopToggle }));
    },
    async catalogue(tenantId) {
      const [cats, cols, prods] = await Promise.all([d.catalogue.listCategories(tenantId), d.catalogue.listCollections(tenantId, { limit: 40 } as never), d.catalogue.listProducts(tenantId, { limit: 8 } as never)]);
      return {
        categories: cats.items.filter((c) => c.active).slice(0, 30).map((c) => ({ id: c.id, slug: c.slug, name: c.name, products: c.productCount })),
        collections: cols.items.filter((c) => c.active).slice(0, 30).map((c) => ({ slug: c.slug, title: c.name })),
        products: prods.items.slice(0, 8).map((p) => ({ name: p.name, price: Math.round(p.priceMin / 100) })),
      };
    },
    async pages(tenantId) {
      return (await d.cms.listPages(tenantId, { limit: 100 })).items.map((p) => ({ slug: p.slug, title: p.title, status: p.status }));
    },
    async roleMembers(tenantId, roleKey) {
      return (await d.staff.listMembers(tenantId)).filter((m) => (m.roles ?? []).includes(`role:${roleKey}`)).length;
    },
    async audit(e) {
      await d.audit.record({ tenantId: e.tenantId, actorUserId: e.userId, action: e.action, entityType: "studio_change", entityId: e.entityId, summary: e.summary, before: e.before, after: e.after, ip: e.ip ?? null });
    },
  };
}

export function createAiStudio(d: StudioKitDeps): { service: studio.StudioService; ports: Ports; module: SrModule; adminModule: SrModule } {
  const ports = createStudioPorts(d);
  const shops =
    d.shops ??
    (async (ids: string[]) => {
      if (ids.length === 0) return new Map<string, { slug: string; name: string }>();
      const rows = await d.db.select({ id: tenants.id, slug: tenants.slug, name: tenants.name }).from(tenants).where(inArray(tenants.id, ids));
      return new Map(rows.map((r) => [r.id, { slug: r.slug, name: r.name }]));
    });
  const service = new studio.StudioService({ store: new studio.DbStudioStore(d.db), ai: d.ai, ports, shops, now: d.now });
  return {
    service,
    ports,
    module: studio.studioModule({ studio: service, trade: async (tenantId) => ((await d.storeSettings.get({ tenantId })).businessType as string | undefined) || null }),
    adminModule: studio.studioAdminModule(service),
  };
}
