import { badRequest, conflict, notFound } from "@rbms/core";
import type { Db } from "@rbms/db";
import { areaUnitFactor, boxesForArea, convertArea, exclusiveOf, gstRateAtPrice, normaliseAreaUnit, type AreaUnit, type GstRateRule } from "@rbms/gst";
import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { catalogItemUnits, catalogProducts, catalogVariants, type ItemUnitRow } from "./schema";
import type { ItemUnit } from "./types";

/**
 * Alternate units (docs/price-lists-units.md): per variant, extra units with a conversion to the product's base unit
 * (1 box = 12 pcs, 1 bag = 25 kg), each with an optional barcode and price. Stock is always kept in the base unit;
 * the units only change how a line is counted and priced.
 */

export const MAX_ITEM_UNITS = 10;

const unitName = z
  .string()
  .trim()
  .min(1, "Enter the unit")
  .max(16, "Units are at most 16 characters")
  .regex(/^[\p{L}\p{N} ./-]+$/u, "Units use letters, digits, space, '.', '/' and '-'");
const money = z.number().int("Amounts are in whole paise").min(0).max(1_000_000_000);

export const itemUnitInputSchema = z.object({
  unit: unitName,
  /** Base units in one of this unit: 12 for a box of 12 pieces. Up to 6 decimals. */
  factor: z
    .number()
    .positive("The conversion must be more than zero")
    .max(1_000_000, "The conversion is too large")
    .refine((f) => Math.abs(Math.round(f * 1e6) - f * 1e6) < 1e-3, "At most 6 decimals"),
  barcode: z.string().trim().max(64).nullish().transform((v) => (v ? v : null)),
  /** Paise for one of this unit (incl. GST when the product is tax-inclusive); null = factor × the item price. */
  price: money.nullish().transform((v) => v ?? null),
  mrp: money.nullish().transform((v) => v ?? null),
});
export type ItemUnitInput = z.input<typeof itemUnitInputSchema>;
export const itemUnitsInputSchema = z.object({ units: z.array(itemUnitInputSchema).max(MAX_ITEM_UNITS, `At most ${MAX_ITEM_UNITS} units`) });

const key = (u: string) => u.trim().toLowerCase();

/**
 * Checks a unit list against the base unit: names unique (any case) and not the base unit itself, a factor other than
 * 1, barcodes unique within the list. Returns the problems (empty = fine).
 */
export function unitProblems(units: readonly { unit: string; factor: number; barcode?: string | null }[], baseUnit: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const codes = new Set<string>();
  for (const u of units) {
    const k = key(u.unit);
    if (k === key(baseUnit)) out.push(`"${u.unit}" is the item's own unit`);
    else if (seen.has(k)) out.push(`"${u.unit}" is listed twice`);
    seen.add(k);
    if (u.factor === 1) out.push(`1 ${u.unit} = 1 ${baseUnit}: use the item's own unit instead`);
    // Area items: "sqm" on a "sqft" item has one right factor; anything else would move the wrong stock.
    const baseArea = normaliseAreaUnit(baseUnit);
    const altArea = normaliseAreaUnit(u.unit);
    if (baseArea && altArea && altArea !== baseArea && Math.abs(u.factor - areaUnitFactor(baseArea, altArea)) > 1e-4) {
      out.push(`1 ${u.unit} = ${areaUnitFactor(baseArea, altArea)} ${baseUnit}`);
    }
    if (u.barcode) {
      if (codes.has(u.barcode)) out.push(`Barcode ${u.barcode} is used twice`);
      codes.add(u.barcode);
    }
  }
  return out;
}

/** Paise for one `factor` unit when it has no price of its own: `round(factor × base price)`. */
export const scaledPrice = (basePrice: number, factor: number) => Math.round(basePrice * factor);

/** A stored unit row as items carry it, priced against its variant. */
export function toItemUnit(
  r: Pick<ItemUnitRow, "unit" | "factor" | "barcode" | "price" | "mrp">,
  v: { price: number; mrp?: number | null },
  p: { gstRate: number; gstRule?: GstRateRule | null; taxInclusive: boolean },
): ItemUnit {
  const factor = Number(r.factor);
  const price = r.price ?? scaledPrice(v.price, factor);
  // A price-band product is banded per piece: the box price over its pieces.
  const rate = p.gstRule ? gstRateAtPrice(p.gstRule, Math.round(price / factor), p.taxInclusive) : p.gstRate;
  return {
    unit: r.unit,
    factor,
    barcode: r.barcode,
    ownPrice: r.price,
    price,
    rate: exclusiveOf(price, rate, p.taxInclusive),
    mrp: r.mrp ?? (v.mrp ? scaledPrice(v.mrp, factor) : null),
  };
}

/** Finds a unit of an item by name (any case); null = the base unit or unknown. */
export function findUnit<T extends { unit: string }>(units: readonly T[] | undefined, unit: string | null | undefined): T | null {
  if (!unit || !units?.length) return null;
  const k = key(unit);
  return units.find((u) => key(u.unit) === k) ?? null;
}

export interface AreaQuoteInput {
  /** Area to cover, in `areaUnit`. */
  area: number;
  areaUnit?: AreaUnit;
  /** Cutting / breakage allowance, percent. */
  wastagePct?: number;
  /** Which alternate unit is the box (default: the first one that isn't an area unit). */
  boxUnit?: string | null;
}

export const areaQuoteInputSchema = z.object({
  area: z.number().positive("Enter the area").max(1_000_000),
  areaUnit: z.enum(["sqft", "sqm"]).optional(),
  wastagePct: z.number().min(0).max(100).optional(),
  boxUnit: z.string().trim().max(16).nullish(),
});

export interface AreaQuote {
  /** How the line is sold: whole `box`es, or by `area` when the item has no box unit. */
  mode: "box" | "area";
  /** The bill line to add: the unit and quantity. */
  line: { unit: string; qty: number };
  /** Boxes to sell (null by area). */
  boxes: number | null;
  /** Area of one box in the item's base area unit (null by area). */
  coverage: number | null;
  baseUnit: string;
  /** Needed with wastage, covered by the line, and left over, in `areaUnit`. */
  needed: number;
  covered: number;
  spare: number;
  areaUnit: AreaUnit;
  /** Paise for one line unit and for the whole line (item price basis: incl. GST when tax-inclusive). */
  unitPrice: number;
  total: number;
}

/**
 * What it takes to cover an area, for the counter and the storefront ("120 sq ft, 10 % wastage → 9 boxes"). The item's
 * base unit must be an area unit; a box is an alternate unit whose factor is the coverage in that unit. Without a box
 * unit the line is sold by area itself.
 */
export function quoteByArea(item: { baseUnit: string; price: number; units: readonly ItemUnit[] }, input: AreaQuoteInput): AreaQuote {
  const base = normaliseAreaUnit(item.baseUnit);
  if (!base) throw badRequest(`This item is sold by ${item.baseUnit}, not by area`);
  const areaUnit = input.areaUnit ?? base;
  const box = input.boxUnit ? findUnit(item.units, input.boxUnit) : (item.units.find((u) => !normaliseAreaUnit(u.unit)) ?? null);
  if (input.boxUnit && !box) throw badRequest(`No "${input.boxUnit}" unit on this item`);
  const wastagePct = input.wastagePct ?? 0;
  if (!box) {
    const needed = Math.round(convertArea(input.area * (1 + wastagePct / 100), areaUnit, base) * 1000) / 1000;
    const qty = Math.ceil(needed * 1000 - 1e-6) / 1000;
    return {
      mode: "area",
      line: { unit: item.baseUnit, qty },
      boxes: null,
      coverage: null,
      baseUnit: item.baseUnit,
      needed: Math.round(input.area * (1 + wastagePct / 100) * 1000) / 1000,
      covered: Math.round(convertArea(qty, base, areaUnit) * 1000) / 1000,
      spare: Math.round((convertArea(qty, base, areaUnit) - input.area * (1 + wastagePct / 100)) * 1000) / 1000,
      areaUnit,
      unitPrice: item.price,
      total: Math.round(qty * item.price),
    };
  }
  const r = boxesForArea({ area: input.area, areaUnit, coverage: box.factor, coverageUnit: base, wastagePct });
  return {
    mode: "box",
    line: { unit: box.unit, qty: r.boxes },
    boxes: r.boxes,
    coverage: box.factor,
    baseUnit: item.baseUnit,
    needed: r.needed,
    covered: r.covered,
    spare: r.spare,
    areaUnit,
    unitPrice: box.price,
    total: r.boxes * box.price,
  };
}

export class CatalogueUnits {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Rows of these variants, in position order. */
  async rows(tenantId: string, variantIds: readonly string[]): Promise<Map<string, ItemUnitRow[]>> {
    const out = new Map<string, ItemUnitRow[]>();
    const ids = [...new Set(variantIds)];
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const rows = await this.db
        .select()
        .from(catalogItemUnits)
        .where(and(eq(catalogItemUnits.tenantId, tenantId), inArray(catalogItemUnits.variantId, chunk)))
        .orderBy(asc(catalogItemUnits.position), asc(catalogItemUnits.unit));
      for (const r of rows) out.set(r.variantId, [...(out.get(r.variantId) ?? []), r]);
    }
    return out;
  }

  /** The units of a live variant with its base unit. 404 for an unknown variant. */
  async list(tenantId: string, variantId: string): Promise<{ variantId: string; baseUnit: string; units: ItemUnit[] }> {
    const found = await this.variant(tenantId, variantId);
    const rows = (await this.rows(tenantId, [variantId])).get(variantId) ?? [];
    return { variantId, baseUnit: found.p.unit, units: rows.map((r) => toItemUnit(r, found.v, found.p)) };
  }

  /**
   * Replaces a variant's units (an empty list removes them). Barcodes must not belong to another item or unit. Touches
   * the variant's `updated_at` so POS catalogue deltas pick the change up.
   */
  async set(tenantId: string, variantId: string, input: unknown): Promise<{ variantId: string; baseUnit: string; units: ItemUnit[] }> {
    const { units } = itemUnitsInputSchema.parse(input);
    const found = await this.variant(tenantId, variantId);
    const problems = unitProblems(units, found.p.unit);
    if (problems.length) throw badRequest(problems[0]!, { problems });
    const codes = units.map((u) => u.barcode).filter((c): c is string => !!c);
    if (codes.length) {
      const [variantHit] = await this.db
        .select({ id: catalogVariants.id, barcode: catalogVariants.barcode })
        .from(catalogVariants)
        .where(and(eq(catalogVariants.tenantId, tenantId), isNull(catalogVariants.deletedAt), inArray(catalogVariants.barcode, codes)))
        .limit(1);
      if (variantHit) throw conflict(`Barcode ${variantHit.barcode} already belongs to an item`);
      const [unitHit] = await this.db
        .select({ barcode: catalogItemUnits.barcode })
        .from(catalogItemUnits)
        .where(and(eq(catalogItemUnits.tenantId, tenantId), ne(catalogItemUnits.variantId, variantId), inArray(catalogItemUnits.barcode, codes)))
        .limit(1);
      if (unitHit) throw conflict(`Barcode ${unitHit.barcode} already belongs to another item's unit`);
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(catalogItemUnits).where(and(eq(catalogItemUnits.tenantId, tenantId), eq(catalogItemUnits.variantId, variantId)));
      if (units.length) {
        await tx.insert(catalogItemUnits).values(
          units.map((u, i) => ({
            tenantId,
            variantId,
            unit: u.unit,
            factor: String(u.factor),
            barcode: u.barcode,
            price: u.price,
            mrp: u.mrp,
            position: i,
          })),
        );
      }
      await tx
        .update(catalogVariants)
        .set({ updatedAt: this.now() })
        .where(and(eq(catalogVariants.tenantId, tenantId), eq(catalogVariants.id, variantId)));
    });
    return this.list(tenantId, variantId);
  }

  /** Boxes (or area) that cover `input.area` of a variant sold by area, priced from the catalogue. */
  async areaQuote(tenantId: string, variantId: string, input: unknown): Promise<AreaQuote> {
    const parsed = areaQuoteInputSchema.parse(input);
    const found = await this.variant(tenantId, variantId);
    const rows = (await this.rows(tenantId, [variantId])).get(variantId) ?? [];
    const units = rows.map((r) => toItemUnit(r, found.v, found.p));
    return quoteByArea({ baseUnit: found.p.unit, price: found.v.price, units }, parsed);
  }

  /** The variant and unit a unit barcode belongs to (live variants only), or null. */
  async byBarcode(tenantId: string, code: string): Promise<{ variantId: string; unit: string } | null> {
    const [row] = await this.db
      .select({ variantId: catalogItemUnits.variantId, unit: catalogItemUnits.unit })
      .from(catalogItemUnits)
      .innerJoin(catalogVariants, eq(catalogVariants.id, catalogItemUnits.variantId))
      .where(and(eq(catalogItemUnits.tenantId, tenantId), eq(catalogItemUnits.barcode, code), isNull(catalogVariants.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  /** Adds `units` to items that have alternate units (priced against each item's own price). */
  async attach<T extends { id: string; price: number; gstRate: number; gstRule?: GstRateRule | null; taxInclusive: boolean; mrp?: number | null; units?: ItemUnit[] }>(
    tenantId: string,
    items: T[],
  ): Promise<T[]> {
    if (items.length === 0) return items;
    const rows = await this.rows(
      tenantId,
      items.map((i) => i.id),
    );
    if (rows.size === 0) return items;
    return items.map((i) => {
      const mine = rows.get(i.id);
      return mine?.length ? { ...i, units: mine.map((r) => toItemUnit(r, i, i)) } : i;
    });
  }

  /** Every unit of the shop (exports, POS): variant id → rows. */
  async all(tenantId: string): Promise<Map<string, ItemUnitRow[]>> {
    const rows = await this.db
      .select()
      .from(catalogItemUnits)
      .where(eq(catalogItemUnits.tenantId, tenantId))
      .orderBy(asc(catalogItemUnits.variantId), asc(catalogItemUnits.position));
    const out = new Map<string, ItemUnitRow[]>();
    for (const r of rows) out.set(r.variantId, [...(out.get(r.variantId) ?? []), r]);
    return out;
  }

  private async variant(tenantId: string, variantId: string) {
    if (!z.string().uuid().safeParse(variantId).success) throw notFound("Item");
    const [found] = await this.db
      .select({ v: catalogVariants, p: catalogProducts })
      .from(catalogVariants)
      .innerJoin(catalogProducts, eq(catalogProducts.id, catalogVariants.productId))
      .where(
and(eq(catalogVariants.tenantId, tenantId), eq(catalogVariants.id, variantId), isNull(catalogVariants.deletedAt), isNull(catalogProducts.deletedAt)),
      )
      .limit(1);
    if (!found) throw notFound("Item");
    return found;
  }
}
