import { createHash } from "node:crypto";
import type { AuthService } from "@rbms/auth";
import { catalogCategories, catalogItemUnits, catalogProducts, catalogVariants, itemName } from "@rbms/catalogue";
import { forbidden, type AuditPort } from "@rbms/core";
import { gstRateAtPrice } from "@rbms/gst";
import { and, eq, gt, inArray, sql, type Db, type SQL } from "@rbms/db";
import { stockItems } from "@rbms/inventory";
import { createPos, type DisplayHostPorts, type PosCatalogPort, type PosInvoicesPort, type PosItem, type PosQuotaPort } from "@rbms/pos";
import { scaleItems } from "@rbms/scales";
import type { TenancyService } from "@rbms/tenancy";
import { toTenantRef } from "@rbms/tenancy";
import type { Logger } from "pino";

/** Units that make an item weighed at the counter (with or without a scales PLU). */
const WEIGHT_UNITS = ["kg", "kgs", "g", "gm", "gms", "gram", "grams"];

/**
 * The POS catalogue over the catalogue, inventory and scales tables (docs/pos-terminals.md "Catalogue for the POS").
 * Sellable = live variant of a live, active product sold on the billing or POS channel (store-only products are left
 * out). An item "changes" when its variant, product, scale PLU or (with stock on) its stock row changes; soft deletes
 * and archiving show up as removals in a delta.
 */
export function posCatalogPort(db: Db, stockOn: (tenantId: string) => Promise<boolean>): PosCatalogPort {
  const v = catalogVariants;
  const p = catalogProducts;
  const s = scaleItems;
  const epoch = sql`'epoch'::timestamptz`;
  const sellable = sql<boolean>`(${v.deletedAt} is null and ${p.deletedAt} is null and ${p.status} = 'active' and ${p.channels} && array['billing','pos']::text[])`;
  const stockOf = (col: SQL) => sql`(select ${col} from ${stockItems} si where si.tenant_id = ${v.tenantId} and si.item_id = ${v.id})`;

  async function select(tenantId: string, where: SQL | undefined, opts: { since?: Date | null; limit?: number; afterId?: string | null } = {}) {
    const withStock = await stockOn(tenantId);
    const changedAt = withStock
      ? sql`greatest(${v.updatedAt}, ${p.updatedAt}, coalesce(${s.updatedAt}, ${epoch}), coalesce(${stockOf(sql`max(si.updated_at)`)}, ${epoch}))`
      : sql`greatest(${v.updatedAt}, ${p.updatedAt}, coalesce(${s.updatedAt}, ${epoch}))`;
    const q = db
      .select({
        v: { id: v.id, title: v.title, sku: v.sku, barcode: v.barcode, price: v.price, mrp: v.mrp, updatedAt: v.updatedAt },
        p: { id: p.id, name: p.name, categoryId: p.categoryId, hsn: p.hsn, gstRate: p.gstRate, gstRule: p.gstRule, unit: p.unit, taxInclusive: p.taxInclusive, images: p.images, updatedAt: p.updatedAt },
        scale: { plu: s.plu, soldBy: s.soldBy, tareGrams: s.tareGrams, active: s.active },
        sellable,
        changedAt: sql<string>`${changedAt}`,
        qty: withStock ? sql<string | null>`${stockOf(sql`sum(si.qty)`)}` : sql<string | null>`null`,
        reorder: withStock ? sql<string | null>`${stockOf(sql`sum(si.reorder_level)`)}` : sql<string | null>`null`,
        track: withStock ? sql<boolean | null>`${stockOf(sql`bool_and(si.track)`)}` : sql<boolean | null>`null`,
        // Alternate units (box of 12 …); a change touches the variant's updated_at, so deltas carry it.
        units: sql<{ unit: string; factor: string | number; barcode: string | null; price: number | null; mrp: number | null }[] | null>`(select json_agg(json_build_object('unit', u.unit, 'factor', u.factor, 'barcode', u.barcode, 'price', u.price, 'mrp', u.mrp) order by u.position) from ${catalogItemUnits} u where u.tenant_id = ${v.tenantId} and u.variant_id = ${v.id})`,
      })
      .from(v)
      .innerJoin(p, eq(p.id, v.productId))
      .leftJoin(s, and(eq(s.tenantId, v.tenantId), eq(s.itemId, v.id), eq(s.active, true)))
      .where(
        and(
          eq(v.tenantId, tenantId),
          eq(p.tenantId, tenantId),
          where,
          opts.since ? sql`${changedAt} > ${opts.since.toISOString()}::timestamptz` : undefined,
          opts.afterId ? gt(v.id, opts.afterId) : undefined,
        ),
      )
      .orderBy(sql`${v.id} asc`);
    const rows = opts.limit ? await q.limit(opts.limit) : await q;
    return rows.map((r) => {
      const unit = r.p.unit;
      const weighed = WEIGHT_UNITS.includes(unit.trim().toLowerCase()) || r.scale?.soldBy === "weight";
      const qty = r.qty === null ? null : Number(r.qty);
      const status: NonNullable<PosItem["stock"]>["status"] | null = !withStock
        ? null
        : r.track === false
          ? "untracked"
          : (qty ?? 0) <= 0
            ? "out"
            : Number(r.reorder ?? 0) > 0 && (qty ?? 0) <= Number(r.reorder)
              ? "low"
              : "ok";
      const item: PosItem = {
        itemId: r.v.id,
        productId: r.p.id,
        name: itemName(r.p.name, r.v.title),
        variantTitle: r.v.title,
        sku: r.v.sku,
        barcodes: r.v.barcode ? [r.v.barcode] : [],
        categoryId: r.p.categoryId ?? null,
        price: r.v.price,
        mrp: r.v.mrp,
        taxInclusive: r.p.taxInclusive,
        // Price-band products (apparel / footwear): the band at this variant's price; bill lines re-band after discounts.
        gstRate: r.p.gstRule ? gstRateAtPrice(r.p.gstRule, r.v.price, r.p.taxInclusive) : r.p.gstRate,
        ...(r.p.gstRule ? { gstRule: r.p.gstRule } : {}),
        hsn: r.p.hsn,
        unit,
        soldBy: weighed ? "weight" : "unit",
        plu: r.scale?.plu != null ? String(r.scale.plu) : null,
        image: r.p.images?.[0]?.url ?? null,
        stock: status ? { qty: qty ?? 0, status } : null,
        active: true,
        updatedAt: new Date(r.changedAt),
        tareKg: r.scale?.tareGrams ? r.scale.tareGrams / 1000 : null,
      };
      if (r.units?.length) {
        item.units = r.units.map((u) => {
          const factor = Number(u.factor);
          return { unit: u.unit, factor, barcode: u.barcode, ownPrice: u.price, price: u.price ?? Math.round(r.v.price * factor), mrp: u.mrp ?? (r.v.mrp ? Math.round(r.v.mrp * factor) : null) };
        });
      }
      return { id: r.v.id, sellable: Boolean(r.sellable), item };
    });
  }

  return {
    rows: async (tenantId, q) => {
      const rows = await select(tenantId, q.since ? undefined : sellable, { since: q.since, limit: q.limit, afterId: q.afterId });
      return rows.map((r) => ({ id: r.id, item: r.sellable ? r.item : null }));
    },
    categories: async (tenantId) =>
      (
        await db
          .select({ id: catalogCategories.id, name: catalogCategories.name, parentId: catalogCategories.parentId, position: catalogCategories.sort })
          .from(catalogCategories)
          .where(and(eq(catalogCategories.tenantId, tenantId), eq(catalogCategories.active, true)))
          .orderBy(sql`${catalogCategories.sort} asc`, sql`${catalogCategories.name} asc`)
      ).map((c) => ({ ...c, parentId: c.parentId ?? null })),
    items: async (tenantId, ids) => {
      const valid = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
      if (!valid.length) return [];
      return (await select(tenantId, and(sellable, inArray(v.id, valid)))).map((r) => r.item);
    },
  };
}

export interface PosWiringDeps {
  db: Db;
  appSecret: string;
  apiOrigin: string;
  auth: AuthService;
  tenancy: TenancyService;
  staffPermissions: (tenantId: string, roles: string[]) => Promise<string[]>;
  features: { isEnabled(tenantId: string, key: string): Promise<boolean>; enabledKeys(tenantId: string): Promise<string[]> };
  quota: PosQuotaPort;
  shopName: (tenantId: string) => Promise<string | null>;
  branch: (tenantId: string, branchId: string) => Promise<{ id: string; locationId: string | null; active: boolean } | null>;
  billExists: (tenantId: string, invoiceId: string) => Promise<boolean>;
  /** Offline billing: number blocks and bill sync (kit-pos-offline.ts). */
  invoices?: PosInvoicesPort;
  /** Customer display: the idle screen's brand and messages, and the pub/sub its feed rides on. */
  display?: DisplayHostPorts;
  audit: AuditPort;
  log: Logger;
}

/** `@rbms/pos` wired to auth (PIN sessions), tenancy / staff (members), plans, branches, invoices and the catalogue. */
export function createPosWiring(d: PosWiringDeps) {
  return createPos({
    db: d.db,
    config: {
      // Never the raw secret: a key derived for PIN lookups only.
      pinKey: createHash("sha256").update(`pos-pin:${d.appSecret}`).digest("hex"),
      apiOrigin: d.apiOrigin,
    },
    sessions: {
      create: async (userId, input) => {
        const { token, session } = await d.auth.createTerminalSession(userId, input);
        return { token, expiresAt: session.expiresAt, sessionId: session.id };
      },
      revokeTerminal: (terminalId) => d.auth.revokeTerminalSessions(terminalId),
      revokeOne: (sessionId, terminalId) => d.auth.revokeTerminalSession(sessionId, terminalId),
    },
    members: {
      list: async (tenantId) => (await d.tenancy.listMembers(tenantId)).filter((m) => m.status === "active").map((m) => ({ userId: m.userId, roles: m.roles })),
      rolesFor: (tenantId, userId) => d.tenancy.rolesFor(tenantId, userId),
      permissionsFor: d.staffPermissions,
      // Active users only (a disabled account can't use a PIN); staff lists are small.
      users: async (ids) =>
        (await Promise.all([...new Set(ids)].map((id) => d.auth.getUser(id)))).filter((u) => u?.status === "active").map((u) => ({ id: u!.id, name: u!.name })),
    },
    tenants: {
      ref: async (tenantId) => {
        const t = await d.tenancy.getById(tenantId);
        if (!t) return null;
        if (t.status === "suspended") throw forbidden("Tenant suspended");
        return toTenantRef(t);
      },
      shop: async (tenantId) => {
        const t = await d.tenancy.getById(tenantId);
        return t ? { id: t.id, slug: t.slug, name: (await d.shopName(tenantId)) ?? t.name, appId: t.appId ?? null } : null;
      },
    },
    features: { isEnabled: d.features.isEnabled, enabled: d.features.enabledKeys },
    quota: d.quota,
    catalog: posCatalogPort(d.db, (tenantId) => d.features.isEnabled(tenantId, "inventory")),
    branches: {
      get: async (tenantId, branchId) => {
        const b = await d.branch(tenantId, branchId);
        return b && b.active ? b : null;
      },
    },
    bills: { exists: d.billExists },
    ...(d.invoices ? { invoices: d.invoices } : {}),
    ...(d.display ? { display: d.display } : {}),
    audit: d.audit,
    log: d.log,
  });
}

