import { badRequest, conflict, notFound } from "@rbms/core";
import type { Db } from "@rbms/db";
import { and, asc, count, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { listApplies, pickList, resolvePrice, unitOf, type PricingEntry, type PricingItem, type PricingList, type ResolvedPrice } from "./resolve";
import { customerGroups, customerPricing, priceListItems, priceLists, type CustomerGroupRow, type PriceListItemRow, type PriceListRow } from "./schema";

// ------------------------------------------------------------------ ports

/** An item as price lists need it (catalogue variant, apps/api wires the catalogue). */
export interface PricingItemRecord extends PricingItem {
  name: string;
  sku?: string | null;
  barcode?: string | null;
}

export interface PricingItemsPort {
  /** Items by id (unknown / deleted ids left out), with their alternate units. */
  items(tenantId: string, ids: string[]): Promise<PricingItemRecord[]>;
}

/** Customers (invoices). Optional: without it customer ids aren't checked and groups list ids only. */
export interface PricingCustomersPort {
  /** Names of these customers (unknown ids left out). */
  names(tenantId: string, ids: string[]): Promise<{ id: string; name: string; phone: string | null }[]>;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export interface PriceListsDeps {
  db: Db;
  items: PricingItemsPort;
  customers?: PricingCustomersPort;
  log?: LoggerPort;
  /** "YYYY-MM-DD" in IST (tests override). */
  today?: () => string;
}

// ------------------------------------------------------------------ schemas

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const money = z.number().int("Amounts are in whole paise").min(0).max(1_000_000_000);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const priceListInputSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a name").max(60),
    /** −10 = 10% off the item price, 5 = 5% markup; null = only the list's own prices. */
    adjustPct: z.number().gt(-100, "A discount must be under 100%").max(1000).nullish().transform((v) => v ?? null),
    roundRupee: z.boolean().default(false),
    validFrom: dateStr.nullish().transform((v) => v ?? null),
    validTo: dateStr.nullish().transform((v) => v ?? null),
    active: z.boolean().default(true),
    isDefault: z.boolean().default(false),
    note: optText(500),
  })
  .superRefine((v, ctx) => {
    if (v.validFrom && v.validTo && v.validTo < v.validFrom) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["validTo"], message: "'Valid to' must be on or after 'valid from'" });
  });
export type PriceListInput = z.input<typeof priceListInputSchema>;

const priceListPatchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  adjustPct: z.number().gt(-100).max(1000).nullable().optional(),
  roundRupee: z.boolean().optional(),
  validFrom: dateStr.nullable().optional(),
  validTo: dateStr.nullable().optional(),
  active: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export type PriceListPatch = z.input<typeof priceListPatchSchema>;

export const MAX_LIST_ENTRIES = 5000;

export const priceEntryInputSchema = z.object({
  itemId: z.string().uuid(),
  /** Null / absent = the item's base unit. */
  unit: optText(16),
  /** Slab: from this quantity up (0 = any). */
  minQty: z.number().min(0).max(1_000_000).default(0),
  price: money,
});
export const priceEntriesInputSchema = z.object({ items: z.array(priceEntryInputSchema).max(MAX_LIST_ENTRIES, `At most ${MAX_LIST_ENTRIES} prices in a list`) });
export type PriceEntryInput = z.input<typeof priceEntryInputSchema>;

export const customerGroupInputSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(60),
  priceListId: z.string().uuid().nullish().transform((v) => v ?? null),
  note: optText(500),
});
export type CustomerGroupInput = z.input<typeof customerGroupInputSchema>;

export const customerPricingInputSchema = z.object({
  groupId: z.string().uuid().nullable().optional(),
  priceListId: z.string().uuid().nullable().optional(),
});
export type CustomerPricingInput = z.input<typeof customerPricingInputSchema>;

export const resolveInputSchema = z.object({
  customerId: z.string().uuid().nullish(),
  /** A list picked on the bill, or "none" for item prices only. Absent = the customer's list. */
  priceListId: z.union([z.string().uuid(), z.literal("none")]).nullish(),
  date: dateStr.optional(),
  lines: z
    .array(z.object({ itemId: z.string().uuid(), unit: z.string().trim().max(16).nullish(), qty: z.number().positive().max(1_000_000).default(1) }))
    .max(200),
});
export type ResolveInput = z.input<typeof resolveInputSchema>;

// ------------------------------------------------------------------ views

export interface PriceList {
  id: string;
  name: string;
  adjustPct: number | null;
  roundRupee: boolean;
  validFrom: string | null;
  validTo: string | null;
  active: boolean;
  isDefault: boolean;
  note: string | null;
  /** On today (active and within its dates). */
  current: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PriceListSummary extends PriceList {
  entryCount: number;
  groupCount: number;
  customerCount: number;
}

export interface PriceEntry {
  id: string;
  itemId: string;
  /** Null when the item no longer exists. */
  itemName: string | null;
  sku: string | null;
  baseUnit: string | null;
  unit: string | null;
  minQty: number;
  price: number;
  /** The item's own price for that unit (to compare). */
  itemPrice: number | null;
}

export interface PriceListDetail extends PriceList {
  entries: PriceEntry[];
}

export interface CustomerGroup {
  id: string;
  name: string;
  priceListId: string | null;
  priceListName: string | null;
  note: string | null;
  customerCount: number;
}

export interface CustomerPricing {
  customerId: string;
  groupId: string | null;
  groupName: string | null;
  priceListId: string | null;
  /** The list the customer's bills use: their own, else the group's (null = item prices / the default list). */
  effectiveListId: string | null;
  effectiveListName: string | null;
}

export interface ResolveResult {
  /** The list picked for the bill (null = item prices, plus the default list's slabs when there is one). */
  list: { id: string; name: string } | null;
  defaultList: { id: string; name: string } | null;
  lines: (ResolvedPrice & { qty: number })[];
}

/** Everything the POS needs to price offline (`GET /v1/pricelists/cache`). */
export interface PricingCache {
  lists: PricingList[];
  defaultListId: string | null;
  groups: { id: string; name: string; priceListId: string | null }[];
  customers: { customerId: string; groupId: string | null; priceListId: string | null }[];
  /** ms when it was made. */
  at: number;
}

const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const num = (v: unknown) => Number(v ?? 0);
const unitKey = (u: string | null | undefined) => (u ?? "").trim().toLowerCase();

const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };

/**
 * Price lists, quantity slabs, customer groups and per-customer lists, and price resolution for bill lines
 * (docs/price-lists-units.md).
 */
export class PriceListsService {
  private readonly db: Db;
  private readonly log: LoggerPort;
  private readonly today: () => string;

  constructor(private readonly deps: PriceListsDeps) {
    this.db = deps.db;
    this.log = deps.log ?? noopLogger;
    this.today = deps.today ?? istToday;
  }

  private view(r: PriceListRow): PriceList {
    return {
      id: r.id,
      name: r.name,
      adjustPct: r.adjustPct,
      roundRupee: r.roundRupee,
      validFrom: r.validFrom,
      validTo: r.validTo,
      active: r.active,
      isDefault: r.isDefault,
      note: r.note,
      current: listApplies(r, this.today()),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  private async listRow(tenantId: string, id: string): Promise<PriceListRow> {
    if (!z.string().uuid().safeParse(id).success) throw notFound("Price list");
    const [row] = await this.db.select().from(priceLists).where(and(eq(priceLists.tenantId, tenantId), eq(priceLists.id, id))).limit(1);
    if (!row) throw notFound("Price list");
    return row;
  }

  private nameTaken(e: unknown): boolean {
    const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
    return code === "23505";
  }

  // ---------------------------------------------------------------- lists

  async lists(tenantId: string): Promise<{ items: PriceListSummary[] }> {
    const [rows, entries, groups, customers] = await Promise.all([
      this.db.select().from(priceLists).where(eq(priceLists.tenantId, tenantId)).orderBy(sql`${priceLists.isDefault} desc`, asc(sql`lower(${priceLists.name})`)),
      this.db.select({ id: priceListItems.priceListId, n: count() }).from(priceListItems).where(eq(priceListItems.tenantId, tenantId)).groupBy(priceListItems.priceListId),
      this.db
        .select({ id: customerGroups.priceListId, n: count() })
        .from(customerGroups)
        .where(and(eq(customerGroups.tenantId, tenantId), isNotNull(customerGroups.priceListId)))
        .groupBy(customerGroups.priceListId),
      this.db
        .select({ id: customerPricing.priceListId, n: count() })
        .from(customerPricing)
        .where(and(eq(customerPricing.tenantId, tenantId), isNotNull(customerPricing.priceListId)))
        .groupBy(customerPricing.priceListId),
    ]);
    const m = (rs: { id: string | null; n: number }[]) => new Map(rs.map((r) => [r.id, r.n]));
    const [e, g, c] = [m(entries), m(groups), m(customers)];
    return { items: rows.map((r) => ({ ...this.view(r), entryCount: e.get(r.id) ?? 0, groupCount: g.get(r.id) ?? 0, customerCount: c.get(r.id) ?? 0 })) };
  }

  async getList(tenantId: string, id: string): Promise<PriceListDetail> {
    const row = await this.listRow(tenantId, id);
    const entries = await this.db
      .select()
      .from(priceListItems)
      .where(and(eq(priceListItems.tenantId, tenantId), eq(priceListItems.priceListId, id)))
      .orderBy(asc(priceListItems.itemId), asc(priceListItems.unit), asc(priceListItems.minQty));
    const items = new Map((await this.deps.items.items(tenantId, [...new Set(entries.map((x) => x.itemId))])).map((i) => [i.id, i]));
    const out = entries.map((x): PriceEntry => {
      const item = items.get(x.itemId);
      const u = item ? unitOf(item, x.unit) : null;
      return {
        id: x.id,
        itemId: x.itemId,
        itemName: item?.name ?? null,
        sku: item?.sku ?? null,
        baseUnit: item?.unit ?? null,
        unit: x.unit,
        minQty: num(x.minQty),
        price: x.price,
        itemPrice: item ? (u ? (u.ownPrice ?? Math.round(item.price * u.factor)) : item.price) : null,
      };
    });
    out.sort((a, b) => (a.itemName ?? "").localeCompare(b.itemName ?? "") || unitKey(a.unit).localeCompare(unitKey(b.unit)) || a.minQty - b.minQty);
    return { ...this.view(row), entries: out };
  }

  async createList(tenantId: string, input: unknown): Promise<PriceList> {
    const b = priceListInputSchema.parse(input);
    try {
      const row = await this.db.transaction(async (tx) => {
        if (b.isDefault) await tx.update(priceLists).set({ isDefault: false }).where(and(eq(priceLists.tenantId, tenantId), eq(priceLists.isDefault, true)));
        const [created] = await tx.insert(priceLists).values({ tenantId, ...b }).returning();
        return created!;
      });
      return this.view(row);
    } catch (e) {
      if (this.nameTaken(e)) throw conflict(`A price list named "${b.name}" already exists`);
      throw e;
    }
  }

  async updateList(tenantId: string, id: string, input: unknown): Promise<PriceList> {
    const p = priceListPatchSchema.parse(input);
    const cur = await this.listRow(tenantId, id);
    const from = p.validFrom !== undefined ? p.validFrom : cur.validFrom;
    const to = p.validTo !== undefined ? p.validTo : cur.validTo;
    if (from && to && to < from) throw badRequest("'Valid to' must be on or after 'valid from'");
    try {
      const row = await this.db.transaction(async (tx) => {
        if (p.isDefault) {
          await tx
            .update(priceLists)
            .set({ isDefault: false })
            .where(and(eq(priceLists.tenantId, tenantId), eq(priceLists.isDefault, true), ne(priceLists.id, id)));
        }
        const [updated] = await tx
          .update(priceLists)
          .set({ ...p, updatedAt: new Date() })
          .where(and(eq(priceLists.tenantId, tenantId), eq(priceLists.id, id)))
          .returning();
        return updated!;
      });
      return this.view(row);
    } catch (e) {
      if (this.nameTaken(e)) throw conflict(`A price list named "${p.name}" already exists`);
      throw e;
    }
  }

  /** Deletes a list and its prices; groups and customers on it fall back to item prices. */
  async deleteList(tenantId: string, id: string): Promise<{ ok: true }> {
    await this.listRow(tenantId, id);
    await this.db.delete(priceLists).where(and(eq(priceLists.tenantId, tenantId), eq(priceLists.id, id)));
    return { ok: true };
  }

  /**
   * Replaces a list's prices. Every item must exist and every unit must be the item's base unit or one of its
   * alternate units; one price per item + unit + slab.
   */
  async setEntries(tenantId: string, id: string, input: unknown): Promise<PriceListDetail> {
    const { items } = priceEntriesInputSchema.parse(input);
    await this.listRow(tenantId, id);
    const known = new Map((await this.deps.items.items(tenantId, [...new Set(items.map((x) => x.itemId))])).map((i) => [i.id, i]));
    const seen = new Set<string>();
    const rows: (typeof priceListItems.$inferInsert)[] = [];
    for (const [i, x] of items.entries()) {
      const item = known.get(x.itemId);
      if (!item) throw badRequest(`Line ${i + 1}: the item no longer exists`, { index: i, itemId: x.itemId });
      // The base unit by name is stored as null, so "pcs" and "" are the same price.
      const isBase = !x.unit || unitKey(x.unit) === unitKey(item.unit);
      const u = isBase ? null : unitOf(item, x.unit);
      if (!isBase && !u) throw badRequest(`Line ${i + 1}: ${item.name} has no unit "${x.unit}"`, { index: i, itemId: x.itemId, unit: x.unit });
      const k = `${x.itemId}|${u ? unitKey(u.unit) : ""}|${x.minQty}`;
      if (seen.has(k)) throw badRequest(`Line ${i + 1}: ${item.name} has two prices for the same unit and quantity`, { index: i });
      seen.add(k);
      rows.push({ tenantId, priceListId: id, itemId: x.itemId, unit: u ? u.unit : null, minQty: String(x.minQty), price: x.price });
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(priceListItems).where(and(eq(priceListItems.tenantId, tenantId), eq(priceListItems.priceListId, id)));
      for (let i = 0; i < rows.length; i += 500) await tx.insert(priceListItems).values(rows.slice(i, i + 500));
      await tx.update(priceLists).set({ updatedAt: new Date() }).where(and(eq(priceLists.tenantId, tenantId), eq(priceLists.id, id)));
    });
    return this.getList(tenantId, id);
  }

  /** Adds or replaces single prices (imports): same item + unit + slab overwrites. Returns how many were written. */
  async upsertEntries(tenantId: string, id: string, entries: { itemId: string; unit: string | null; minQty: number; price: number }[]): Promise<number> {
    if (entries.length === 0) return 0;
    await this.listRow(tenantId, id);
    await this.db.transaction(async (tx) => {
      for (const x of entries) {
        await tx
          .delete(priceListItems)
          .where(
            and(
              eq(priceListItems.tenantId, tenantId),
              eq(priceListItems.priceListId, id),
              eq(priceListItems.itemId, x.itemId),
              sql`coalesce(lower(${priceListItems.unit}), '') = ${unitKey(x.unit)}`,
              eq(priceListItems.minQty, String(x.minQty)),
            ),
          );
        await tx.insert(priceListItems).values({ tenantId, priceListId: id, itemId: x.itemId, unit: x.unit, minQty: String(x.minQty), price: x.price });
      }
      await tx.update(priceLists).set({ updatedAt: new Date() }).where(and(eq(priceLists.tenantId, tenantId), eq(priceLists.id, id)));
    });
    return entries.length;
  }

  /** A list by name (any case), for imports; null when none. */
  async listByName(tenantId: string, name: string): Promise<PriceList | null> {
    const [row] = await this.db
      .select()
      .from(priceLists)
      .where(and(eq(priceLists.tenantId, tenantId), sql`lower(${priceLists.name}) = lower(${name.trim()})`))
      .limit(1);
    return row ? this.view(row) : null;
  }

  /** Every price of every list (exports). */
  async allEntries(tenantId: string): Promise<{ list: PriceList; entry: PriceListItemRow }[]> {
    const [lists, entries] = await Promise.all([
      this.db.select().from(priceLists).where(eq(priceLists.tenantId, tenantId)),
      this.db.select().from(priceListItems).where(eq(priceListItems.tenantId, tenantId)).orderBy(asc(priceListItems.priceListId), asc(priceListItems.itemId), asc(priceListItems.minQty)),
    ]);
    const byId = new Map(lists.map((l) => [l.id, this.view(l)]));
    return entries.filter((e) => byId.has(e.priceListId)).map((entry) => ({ list: byId.get(entry.priceListId)!, entry }));
  }

  // ---------------------------------------------------------------- customer groups

  async groups(tenantId: string): Promise<{ items: CustomerGroup[] }> {
    const [rows, lists, members] = await Promise.all([
      this.db.select().from(customerGroups).where(eq(customerGroups.tenantId, tenantId)).orderBy(asc(sql`lower(${customerGroups.name})`)),
      this.db.select({ id: priceLists.id, name: priceLists.name }).from(priceLists).where(eq(priceLists.tenantId, tenantId)),
      this.db
        .select({ id: customerPricing.groupId, n: count() })
        .from(customerPricing)
        .where(and(eq(customerPricing.tenantId, tenantId), isNotNull(customerPricing.groupId)))
        .groupBy(customerPricing.groupId),
    ]);
    const names = new Map(lists.map((l) => [l.id, l.name]));
    const counts = new Map(members.map((m) => [m.id, m.n]));
    return { items: rows.map((g) => this.groupView(g, names, counts.get(g.id) ?? 0)) };
  }

  private groupView(g: CustomerGroupRow, names: Map<string, string>, customerCount: number): CustomerGroup {
    return { id: g.id, name: g.name, priceListId: g.priceListId, priceListName: g.priceListId ? (names.get(g.priceListId) ?? null) : null, note: g.note, customerCount };
  }

  private async groupRow(tenantId: string, id: string): Promise<CustomerGroupRow> {
    if (!z.string().uuid().safeParse(id).success) throw notFound("Customer group");
    const [row] = await this.db.select().from(customerGroups).where(and(eq(customerGroups.tenantId, tenantId), eq(customerGroups.id, id))).limit(1);
    if (!row) throw notFound("Customer group");
    return row;
  }

  async createGroup(tenantId: string, input: unknown): Promise<CustomerGroup> {
    const b = customerGroupInputSchema.parse(input);
    if (b.priceListId) await this.listRow(tenantId, b.priceListId);
    try {
      const [row] = await this.db.insert(customerGroups).values({ tenantId, ...b }).returning();
      return (await this.groups(tenantId)).items.find((g) => g.id === row!.id)!;
    } catch (e) {
      if (this.nameTaken(e)) throw conflict(`A group named "${b.name}" already exists`);
      throw e;
    }
  }

  async updateGroup(tenantId: string, id: string, input: unknown): Promise<CustomerGroup> {
    const p = customerGroupInputSchema.partial().parse(input);
    await this.groupRow(tenantId, id);
    if (p.priceListId) await this.listRow(tenantId, p.priceListId);
    const patch: Partial<typeof customerGroups.$inferInsert> = { updatedAt: new Date() };
    if (p.name !== undefined) patch.name = p.name;
    if ((input as { priceListId?: unknown })?.priceListId !== undefined) patch.priceListId = p.priceListId ?? null;
    if ((input as { note?: unknown })?.note !== undefined) patch.note = p.note ?? null;
    try {
      await this.db.update(customerGroups).set(patch).where(and(eq(customerGroups.tenantId, tenantId), eq(customerGroups.id, id)));
    } catch (e) {
      if (this.nameTaken(e)) throw conflict(`A group named "${p.name}" already exists`);
      throw e;
    }
    return (await this.groups(tenantId)).items.find((g) => g.id === id)!;
  }

  /** Deletes a group; its customers keep their own list (if any) and leave the group. */
  async deleteGroup(tenantId: string, id: string): Promise<{ ok: true }> {
    await this.groupRow(tenantId, id);
    await this.db.delete(customerGroups).where(and(eq(customerGroups.tenantId, tenantId), eq(customerGroups.id, id)));
    return { ok: true };
  }

  /** The customers in a group (names from the customers port when wired). */
  async groupCustomers(tenantId: string, id: string): Promise<{ items: { id: string; name: string | null; phone: string | null }[] }> {
    await this.groupRow(tenantId, id);
    const rows = await this.db
      .select({ customerId: customerPricing.customerId })
      .from(customerPricing)
      .where(and(eq(customerPricing.tenantId, tenantId), eq(customerPricing.groupId, id)));
    const ids = rows.map((r) => r.customerId);
    const names = this.deps.customers ? new Map((await this.deps.customers.names(tenantId, ids)).map((c) => [c.id, c])) : new Map<string, { name: string; phone: string | null }>();
    return {
      items: ids
        .map((cid) => ({ id: cid, name: names.get(cid)?.name ?? null, phone: names.get(cid)?.phone ?? null }))
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
    };
  }

  // ---------------------------------------------------------------- customers

  async customerPricing(tenantId: string, customerId: string): Promise<CustomerPricing> {
    if (!z.string().uuid().safeParse(customerId).success) throw notFound("Customer");
    const [row] = await this.db
      .select({
        groupId: customerPricing.groupId,
        priceListId: customerPricing.priceListId,
        groupName: customerGroups.name,
        groupListId: customerGroups.priceListId,
      })
      .from(customerPricing)
      .leftJoin(customerGroups, eq(customerGroups.id, customerPricing.groupId))
      .where(and(eq(customerPricing.tenantId, tenantId), eq(customerPricing.customerId, customerId)))
      .limit(1);
    const effective = row?.priceListId ?? row?.groupListId ?? null;
    const list = effective ? await this.listRow(tenantId, effective).catch(() => null) : null;
    return {
      customerId,
      groupId: row?.groupId ?? null,
      groupName: row?.groupName ?? null,
      priceListId: row?.priceListId ?? null,
      effectiveListId: list?.id ?? null,
      effectiveListName: list?.name ?? null,
    };
  }

  /** Sets a customer's group and / or own list (null clears; absent keeps). */
  async setCustomerPricing(tenantId: string, customerId: string, input: unknown): Promise<CustomerPricing> {
    const b = customerPricingInputSchema.parse(input);
    if (!z.string().uuid().safeParse(customerId).success) throw notFound("Customer");
    if (this.deps.customers && (await this.deps.customers.names(tenantId, [customerId])).length === 0) throw notFound("Customer");
    if (b.groupId) await this.groupRow(tenantId, b.groupId);
    if (b.priceListId) await this.listRow(tenantId, b.priceListId);
    const set: Partial<typeof customerPricing.$inferInsert> = { updatedAt: new Date() };
    if (b.groupId !== undefined) set.groupId = b.groupId;
    if (b.priceListId !== undefined) set.priceListId = b.priceListId;
    await this.db
      .insert(customerPricing)
      .values({ tenantId, customerId, groupId: b.groupId ?? null, priceListId: b.priceListId ?? null })
      .onConflictDoUpdate({ target: [customerPricing.tenantId, customerPricing.customerId], set });
    return this.customerPricing(tenantId, customerId);
  }

  // ---------------------------------------------------------------- resolution

  /** Lists with their entries for these items (all entries when `itemIds` is null). */
  private async pricingLists(tenantId: string, ids: string[], itemIds: string[] | null): Promise<Map<string, PricingList>> {
    const out = new Map<string, PricingList>();
    const unique = [...new Set(ids)];
    if (unique.length === 0) return out;
    const [rows, entries] = await Promise.all([
      this.db.select().from(priceLists).where(and(eq(priceLists.tenantId, tenantId), inArray(priceLists.id, unique))),
      itemIds && itemIds.length === 0
        ? Promise.resolve([] as PriceListItemRow[])
        : this.db
            .select()
            .from(priceListItems)
            .where(and(eq(priceListItems.tenantId, tenantId), inArray(priceListItems.priceListId, unique), itemIds ? inArray(priceListItems.itemId, [...new Set(itemIds)]) : undefined)),
    ]);
    for (const r of rows) out.set(r.id, toPricingList(r, []));
    for (const e of entries) (out.get(e.priceListId)?.entries as PricingEntry[] | undefined)?.push(toEntry(e));
    return out;
  }

  /** The bill's list ids: the picked one (or the customer's / group's) and the shop's default list. */
  private async listIdsFor(tenantId: string, customerId: string | null | undefined, chosen: string | null | undefined): Promise<{ listId: string | null; defaultListId: string | null }> {
    const [def] = await this.db
      .select({ id: priceLists.id })
      .from(priceLists)
      .where(and(eq(priceLists.tenantId, tenantId), eq(priceLists.isDefault, true)))
      .limit(1);
    let customerListId: string | null = null;
    let groupListId: string | null = null;
    if (!chosen && customerId) {
      const [row] = await this.db
        .select({ own: customerPricing.priceListId, group: customerGroups.priceListId })
        .from(customerPricing)
        .leftJoin(customerGroups, eq(customerGroups.id, customerPricing.groupId))
        .where(and(eq(customerPricing.tenantId, tenantId), eq(customerPricing.customerId, customerId)))
        .limit(1);
      customerListId = row?.own ?? null;
      groupListId = row?.group ?? null;
    }
    return pickList({ chosen: chosen ?? null, customerListId, groupListId, defaultListId: def?.id ?? null });
  }

  /**
   * Prices for bill lines (`POST /v1/pricelists/resolve`, and the API host for lines sent without a rate): the
   * customer's (or the picked) list, then the default list's slabs, then the item price. Unknown items are left out.
   */
  async resolve(tenantId: string, input: unknown): Promise<ResolveResult> {
    const b = resolveInputSchema.parse(input);
    const date = b.date ?? this.today();
    const itemIds = b.lines.map((l) => l.itemId);
    const [{ listId, defaultListId }, items] = await Promise.all([
      this.listIdsFor(tenantId, b.customerId, b.priceListId),
      this.deps.items.items(tenantId, [...new Set(itemIds)]),
    ]);
    if (b.priceListId && b.priceListId !== "none" && !listId) throw notFound("Price list");
    const lists = await this.pricingLists(tenantId, [listId, defaultListId].filter((x): x is string => !!x), itemIds);
    if (b.priceListId && b.priceListId !== "none" && !lists.has(b.priceListId)) throw notFound("Price list");
    const byId = new Map(items.map((i) => [i.id, i]));
    const order = [listId ? lists.get(listId) : null, defaultListId ? lists.get(defaultListId) : null];
    const lines: ResolveResult["lines"] = [];
    for (const l of b.lines) {
      const item = byId.get(l.itemId);
      if (!item) continue;
      lines.push({ ...resolvePrice({ item, unit: l.unit, qty: l.qty, date, lists: order }), qty: l.qty });
    }
    const ref = (id: string | null) => (id && lists.get(id) ? { id, name: lists.get(id)!.name } : null);
    return { list: ref(listId), defaultList: ref(defaultListId), lines };
  }

  /** Everything the POS needs to price offline: current lists with all their prices, groups and customer links. */
  async cache(tenantId: string): Promise<PricingCache> {
    const [rows, groups, links] = await Promise.all([
      this.db.select().from(priceLists).where(eq(priceLists.tenantId, tenantId)),
      this.db.select({ id: customerGroups.id, name: customerGroups.name, priceListId: customerGroups.priceListId }).from(customerGroups).where(eq(customerGroups.tenantId, tenantId)),
      this.db
        .select({ customerId: customerPricing.customerId, groupId: customerPricing.groupId, priceListId: customerPricing.priceListId })
        .from(customerPricing)
        .where(eq(customerPricing.tenantId, tenantId)),
    ]);
    // Inactive lists and lists already over are left out; lists starting later are kept (the date decides offline).
    const today = this.today();
    const live = rows.filter((r) => r.active && (!r.validTo || r.validTo >= today));
    const lists = await this.pricingLists(
      tenantId,
      live.map((r) => r.id),
      null,
    );
    return {
      lists: [...lists.values()],
      defaultListId: live.find((r) => r.isDefault)?.id ?? null,
      groups,
      customers: links,
      at: Date.now(),
    };
  }
}

function toEntry(e: PriceListItemRow): PricingEntry {
  return { itemId: e.itemId, unit: e.unit, minQty: num(e.minQty), price: e.price };
}

function toPricingList(r: PriceListRow, entries: PricingEntry[]): PricingList {
  return {
    id: r.id,
    name: r.name,
    adjustPct: r.adjustPct,
    roundRupee: r.roundRupee,
    validFrom: r.validFrom,
    validTo: r.validTo,
    active: r.active,
    entries,
  };
}
