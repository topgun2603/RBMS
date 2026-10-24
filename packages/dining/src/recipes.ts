import { badRequest, notFound } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { diningIngredients, diningRecipeLines, diningRecipes, type DiningIngredientRow } from "./schema";

/** Units a recipe line can use, and the units an ingredient price can be quoted in. */
export const RECIPE_LINE_UNITS = ["g", "kg", "ml", "l", "tsp", "tbsp", "cup", "pcs"] as const;
export const INGREDIENT_PRICE_UNITS = ["kg", "g", "l", "ml", "pcs", "dozen"] as const;
const FAMILY: Record<string, (typeof INGREDIENT_PRICE_UNITS)[number]> = { g: "kg", kg: "kg", ml: "l", l: "l", tsp: "l", tbsp: "l", cup: "l", pcs: "pcs" };

const MAX_PAISE = 100_000_000;
const name = z.string().trim().min(1).max(60);

export const ingredientInput = z
  .object({
    name,
    unit: z.enum(INGREDIENT_PRICE_UNITS).default("kg"),
    price: z.number().int().min(0).max(MAX_PAISE).nullish(),
    itemId: z.string().uuid().nullish(),
  })
  .strict();
export type IngredientInput = z.input<typeof ingredientInput>;

const lineInput = z
  .object({
    ingredientId: z.string().uuid().optional(),
    /** A new (or existing) ingredient by name when there is no id. */
    name: name.optional(),
    qty: z.number().positive().max(100_000),
    unit: z.enum(RECIPE_LINE_UNITS),
  })
  .strict()
  .refine((l) => l.ingredientId || l.name, { message: "Pick an ingredient or give its name" });

export const recipeInput = z
  .object({
    note: z.string().trim().max(500).nullish(),
    source: z.enum(["manual", "ai"]).default("manual"),
    lines: z.array(lineInput).max(40),
  })
  .strict();
export type RecipeInput = z.input<typeof recipeInput>;

export interface RecipeLineView {
  ingredientId: string;
  name: string;
  qty: number;
  unit: string;
  ingredient: { unit: string; price: number | null; itemId: string | null };
}

export interface RecipeView {
  itemId: string;
  note: string | null;
  source: string;
  updatedAt: Date;
  lines: RecipeLineView[];
}

/** Recipes (what one portion of a dish is made of) and the ingredient price list. No AI in here: the AI helpers draft input for it. */
export class RecipeService {
  constructor(private readonly db: Db) {}

  async ingredients(tenantId: string) {
    return this.db.select().from(diningIngredients).where(eq(diningIngredients.tenantId, tenantId)).orderBy(asc(sql`lower(${diningIngredients.name})`));
  }

  async saveIngredient(tenantId: string, id: string | null, input: unknown): Promise<DiningIngredientRow> {
    const b = ingredientInput.parse(input);
    if (id) {
      const [row] = await this.db
        .update(diningIngredients)
        .set({ name: b.name, unit: b.unit, price: b.price ?? null, itemId: b.itemId ?? null, updatedAt: new Date() })
        .where(and(eq(diningIngredients.tenantId, tenantId), eq(diningIngredients.id, id)))
        .returning();
      if (!row) throw notFound("Ingredient");
      return row;
    }
    const [found] = await this.db.select().from(diningIngredients).where(and(eq(diningIngredients.tenantId, tenantId), sql`lower(${diningIngredients.name}) = lower(${b.name})`)).limit(1);
    if (found) return this.saveIngredient(tenantId, found.id, input);
    const [row] = await this.db.insert(diningIngredients).values({ tenantId, name: b.name, unit: b.unit, price: b.price ?? null, itemId: b.itemId ?? null }).returning();
    return row!;
  }

  async deleteIngredient(tenantId: string, id: string): Promise<void> {
    const [used] = await this.db.select({ id: diningRecipeLines.id }).from(diningRecipeLines).where(and(eq(diningRecipeLines.tenantId, tenantId), eq(diningRecipeLines.ingredientId, id))).limit(1);
    if (used) throw badRequest("This ingredient is used in a recipe. Remove it from the recipes first.");
    await this.db.delete(diningIngredients).where(and(eq(diningIngredients.tenantId, tenantId), eq(diningIngredients.id, id)));
  }

  /** Every recipe of the shop with its lines (the food-cost list and the prep forecast read this). */
  async all(tenantId: string): Promise<RecipeView[]> {
    const recipes = await this.db.select().from(diningRecipes).where(eq(diningRecipes.tenantId, tenantId));
    if (recipes.length === 0) return [];
    const [lines, ings] = await Promise.all([
      this.db.select().from(diningRecipeLines).where(eq(diningRecipeLines.tenantId, tenantId)).orderBy(asc(diningRecipeLines.position)),
      this.ingredients(tenantId),
    ]);
    const ingOf = new Map(ings.map((i) => [i.id, i]));
    return recipes.map((r) => ({
      itemId: r.itemId,
      note: r.note,
      source: r.source,
      updatedAt: r.updatedAt,
      lines: lines
        .filter((l) => l.recipeId === r.id)
        .flatMap((l) => {
          const i = ingOf.get(l.ingredientId);
          return i ? [{ ingredientId: i.id, name: i.name, qty: Number(l.qty), unit: l.unit, ingredient: { unit: i.unit, price: i.price, itemId: i.itemId } }] : [];
        }),
    }));
  }

  async get(tenantId: string, itemId: string): Promise<RecipeView | null> {
    const [r] = await this.db.select().from(diningRecipes).where(and(eq(diningRecipes.tenantId, tenantId), eq(diningRecipes.itemId, itemId))).limit(1);
    if (!r) return null;
    return (await this.all(tenantId)).find((x) => x.itemId === itemId) ?? null;
  }

  /** Replaces the recipe of a dish portion. Ingredients named but not yet known are created (priced later). */
  async save(tenantId: string, itemId: string, input: unknown): Promise<RecipeView> {
    const b = recipeInput.parse(input);
    await this.db.transaction(async (tx) => {
      const ids: string[] = [];
      for (const l of b.lines) {
        if (l.ingredientId) {
          ids.push(l.ingredientId);
          continue;
        }
        const nm = l.name!.trim();
        const [found] = await tx.select().from(diningIngredients).where(and(eq(diningIngredients.tenantId, tenantId), sql`lower(${diningIngredients.name}) = lower(${nm})`)).limit(1);
        if (found) ids.push(found.id);
        else {
          const [made] = await tx.insert(diningIngredients).values({ tenantId, name: nm, unit: FAMILY[l.unit] ?? "kg" }).returning();
          ids.push(made!.id);
        }
      }
      const known = ids.length ? await tx.select({ id: diningIngredients.id }).from(diningIngredients).where(and(eq(diningIngredients.tenantId, tenantId), inArray(diningIngredients.id, ids))) : [];
      if (known.length !== new Set(ids).size) throw badRequest("An ingredient in the recipe does not exist");
      const [recipe] = await tx
        .insert(diningRecipes)
        .values({ tenantId, itemId, note: b.note ?? null, source: b.source })
        .onConflictDoUpdate({ target: [diningRecipes.tenantId, diningRecipes.itemId], set: { note: b.note ?? null, source: b.source, updatedAt: new Date() } })
        .returning();
      await tx.delete(diningRecipeLines).where(and(eq(diningRecipeLines.tenantId, tenantId), eq(diningRecipeLines.recipeId, recipe!.id)));
      if (b.lines.length) {
        await tx.insert(diningRecipeLines).values(b.lines.map((l, i) => ({ tenantId, recipeId: recipe!.id, ingredientId: ids[i]!, qty: String(l.qty), unit: l.unit, position: i })));
      }
    });
    return (await this.get(tenantId, itemId))!;
  }

  async remove(tenantId: string, itemId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [r] = await tx.select().from(diningRecipes).where(and(eq(diningRecipes.tenantId, tenantId), eq(diningRecipes.itemId, itemId))).limit(1);
      if (!r) return;
      await tx.delete(diningRecipeLines).where(and(eq(diningRecipeLines.tenantId, tenantId), eq(diningRecipeLines.recipeId, r.id)));
      await tx.delete(diningRecipes).where(eq(diningRecipes.id, r.id));
    });
  }
}
