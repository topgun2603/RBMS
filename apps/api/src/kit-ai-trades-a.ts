import { AI_PERMISSION_KEYS, PLAN_FESTIVALS, lastYearOf, tradesA, type AiService } from "@srirealtime/ai";
import { AppError, badRequest, hasPermission, requirePermission, requireRole, requireTenant, requireUser, type RequestContext, type SrModule } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { todayIST } from "@srirealtime/gst";
import type { RecipeService, RecipeView } from "@srirealtime/dining";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { loadBatches, loadSales, loadStock } from "./ai-trades-a/pharmacy";
import { loadCategoryNames, loadDishSales, loadDishes, loadItemRates, type DishPortion } from "./ai-trades-a/restaurant";
import { SCAN_BODY_LIMIT, parseScanBody } from "./kit-ai-vision";

/** Permissions of the modules whose screens the helpers sit on (the helper also needs `ai.use`). */
const MEDICINES_VIEW = ["medicines.manage", "medicines.dispense"];
const MEDICINES_MANAGE = ["medicines.manage"];
const DINING_MENU = ["dining.manage", "catalogue.manage"];
const DINING_MANAGE = ["dining.manage"];
const DINING_KITCHEN = ["dining.manage", "dining.kitchen"];

export interface TradesADeps {
  db: Db;
  ai: AiService;
  catalogue: {
    createProduct(tenantId: string, input: Record<string, unknown>): Promise<{ id: string; variants: { id: string }[] }>;
    createCategory(tenantId: string, input: { name: string }): Promise<{ id: string }>;
  };
  dining: { saveMenuItem(tenantId: string, itemId: string, input: unknown): Promise<unknown> };
  recipes: RecipeService;
  /** Settings namespace "kitchen": { targetFoodCostPct }. */
  kitchenSettings: { get(scope: { tenantId: string }): Promise<unknown> };
  now?: () => Date;
}

const lang = z.enum(["en", "ta"]).default("en");
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ITEM = "/:itemId([0-9a-fA-F-]{36})";

const UNREADABLE = "ai_unreadable_image";
const unreadable = (why?: string | null) =>
  new AppError(422, UNREADABLE, "The photo could not be read. Retake it in good light, flat and fully in the frame.", why ? { reason: String(why).slice(0, 200) } : undefined);

/**
 * Phase 3 part A wiring (docs/ai.md "Phase 3 part A"): the pharmacy and restaurant packs.
 *   /v1/ai/pharmacy   rx-scan, check, expiry-plan, lookup
 *   /v1/ai/restaurant menu-scan, menu-create, recipe-draft, food-cost-summary, prep
 *   /v1/dining/recipes ingredient price list and recipes with food cost (plain CRUD, no AI)
 * Every AI result is a DRAFT: these routes read, compute and draft; the only writes are the explicit confirm routes
 * (menu-create, recipes) that a person presses.
 */
export function createAiTradesA(d: TradesADeps): { modules: SrModule[]; costing: ReturnType<typeof makeCosting> } {
  const now = d.now ?? (() => new Date());
  const today = () => todayIST(now());

  const ctxOf = (req: { ctx: RequestContext }, perms: string[], opts: { ai?: boolean } = {}) => {
    requireUser(req.ctx);
    requireRole(req.ctx, "owner", "admin", "staff");
    const tenant = requireTenant(req.ctx);
    if (opts.ai) requirePermission(req.ctx, AI_PERMISSION_KEYS.use);
    if (perms.length && !perms.some((p) => hasPermission(req.ctx, p))) requirePermission(req.ctx, perms[0]!);
    return { tenantId: tenant.id, userId: req.ctx.user?.id ?? null };
  };
  const parse = <T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> => {
    const r = schema.safeParse(body ?? {});
    if (!r.success) throw badRequest(r.error.issues[0]?.message ?? "Invalid request");
    return r.data;
  };
  const gate = (feature: string, perms: string[]) => ({ config: { feature, permission: perms } });
  const hasAi = (req: { ctx: RequestContext }) => hasPermission(req.ctx, AI_PERMISSION_KEYS.use);

  // ------------------------------------------------------------------ pharmacy

  const pharmacy: SrModule = {
    id: "ai/pharmacy",
    routes: async (app: FastifyInstance) => {
      app.post("/rx-scan", { bodyLimit: SCAN_BODY_LIMIT, config: { feature: "medicines", permission: MEDICINES_VIEW, audit: false as const } }, async (req) => {
        const { tenantId, userId } = ctxOf(req, MEDICINES_VIEW, { ai: true });
        const input = parseScanBody(req.body);
        const r = await d.ai.run({
          tenantId,
          userId,
          feature: tradesA.RX_FEATURE,
          tier: "vision",
          system: tradesA.RX_SYSTEM,
          input: { text: "Read the attached prescription. Return the JSON structure only.", ...input, pdfs: input.pdfs.map((p) => ({ ...p, title: "prescription.pdf" })) },
          schema: tradesA.RX_SCHEMA,
          maxTokens: 10_000,
          effort: "low",
        });
        if (!r.output.readable) throw unreadable(r.output.notes);
        const meds = await loadStock(d.db, tenantId, today());
        const draft = tradesA.processRx(r.output, { today: today(), meds });
        return { draft, runId: r.runId, credits: r.credits, provider: r.provider };
      });

      app.get("/lookup", gate("medicines", MEDICINES_VIEW), async (req) => {
        const { tenantId } = ctxOf(req, MEDICINES_VIEW);
        const q = String((req.query as { q?: string } | undefined)?.q ?? "").trim();
        if (q.length < 2) return { items: [] };
        return { items: (await loadStock(d.db, tenantId, today(), { q, limit: 15 })).map((m) => ({ ...m })) };
      });

      const checkBody = z.object({ itemIds: z.array(z.string().uuid()).min(2).max(40), lang, explain: z.boolean().default(true) });
      app.post("/check", gate("medicines", MEDICINES_VIEW), async (req) => {
        const { tenantId, userId } = ctxOf(req, MEDICINES_VIEW);
        const b = parse(checkBody, req.body);
        const meds = await loadStock(d.db, tenantId, today(), { itemIds: [...new Set(b.itemIds)] });
        const check = tradesA.checkBill(meds.map((m) => ({ id: m.itemId, name: m.name, composition: m.composition })));
        // Warnings come from code and show with AI off; the model only explains a found pair, with the table's note as the fallback.
        const ex = b.explain && check.interactions.length && hasAi(req) ? await tradesA.explainPairs(d.ai, { tenantId, userId, pairs: check.interactions, lang: b.lang }) : null;
        const textOf = new Map((ex?.items ?? []).map((i) => [i.key, i]));
        return {
          duplicates: check.duplicates,
          interactions: check.interactions.map((p) => {
            const t = textOf.get(tradesA.pairKey(p));
            return { ...p, text: t?.text ?? tradesA.tableText(p, b.lang), source: t?.source ?? "table" };
          }),
          unchecked: check.unchecked,
          advisory: tradesA.ADVISORY,
          review: tradesA.INTERACTION_TABLE_REVIEW,
          runId: ex?.runId ?? null,
          credits: ex?.credits ?? 0,
          aiNote: ex?.aiNote ?? null,
        };
      });

      const planBody = z.object({
        within: z.number().int().min(7).max(365).default(90),
        returnMinDays: z.number().int().min(0).max(365).nullish(),
        lang,
        explain: z.boolean().default(true),
      });
      app.post("/expiry-plan", gate("medicines", MEDICINES_MANAGE), async (req) => {
        const { tenantId, userId } = ctxOf(req, MEDICINES_MANAGE);
        const b = parse(planBody, req.body);
        const t = today();
        const batches = await loadBatches(d.db, tenantId, tradesA.addDays(t, b.within));
        const sales = await loadSales(d.db, tenantId, t, [...new Set(batches.map((x) => x.itemId))]);
        const rows = tradesA.buildPlan(batches, sales, { today: t, withinDays: b.within, returnMinDays: b.returnMinDays ?? null });
        const groups = tradesA.groupPlan(rows);
        const ex = b.explain && hasAi(req) ? await tradesA.explainPlan(d.ai, { tenantId, userId, groups, lang: b.lang }) : null;
        const lineOf = new Map((ex?.lines ?? []).map((l) => [l.action, l]));
        return {
          today: t,
          within: b.within,
          returnMinDays: b.returnMinDays ?? null,
          totals: { batches: rows.length, qty: rows.reduce((s, r) => s + r.qty, 0), value: rows.reduce((s, r) => s + r.value, 0), atRiskValue: rows.reduce((s, r) => s + r.atRiskValue, 0) },
          groups: groups.map((g) => ({ ...g, reason: lineOf.get(g.action)?.text ?? tradesA.templateLine(g, b.lang), reasonSource: lineOf.get(g.action)?.source ?? "template" })),
          rows,
          returnList: tradesA.returnList(rows),
          runId: ex?.runId ?? null,
          credits: ex?.credits ?? 0,
          aiNote: ex ? ex.aiNote : hasAi(req) || !b.explain ? null : "no_permission",
        };
      });
    },
  };

  // ------------------------------------------------------------------ restaurant

  const targetOf = async (tenantId: string) => {
    const s = (await d.kitchenSettings.get({ tenantId }).catch(() => null)) as { targetFoodCostPct?: number } | null;
    const t = Number(s?.targetFoodCostPct);
    return Number.isFinite(t) && t > 0 && t < 100 ? t : tradesA.DEFAULT_TARGET_PCT;
  };

  const makeCosting = () => {
    const priceOf = (ing: RecipeView["lines"][number]["ingredient"], rates: Map<string, tradesA.IngredientPrice>): tradesA.IngredientPrice | null => {
      const linked = ing.itemId ? rates.get(ing.itemId) : undefined;
      if (linked) return linked;
      return ing.price !== null ? { price: ing.price, unit: ing.unit, source: "manual" } : null;
    };
    return {
      /** Every dish portion with its recipe cost (null cost = no recipe yet). */
      async list(tenantId: string) {
        const [dishes, recipes, target] = await Promise.all([loadDishes(d.db, tenantId), d.recipes.all(tenantId), targetOf(tenantId)]);
        const linked = [...new Set(recipes.flatMap((r) => r.lines.map((l) => l.ingredient.itemId)).filter((x): x is string => !!x))];
        const rates = await loadItemRates(d.db, tenantId, linked);
        const recipeOf = new Map(recipes.map((r) => [r.itemId, r]));
        const items = dishes.map((x) => {
          const r = recipeOf.get(x.itemId);
          const cost = r ? tradesA.costDish(r.lines.map((l) => ({ name: l.name, qty: l.qty, unit: l.unit, price: priceOf(l.ingredient, rates) })), x.rate, target) : null;
          return { ...x, hasRecipe: !!r, source: r?.source ?? null, lineCount: r?.lines.length ?? 0, cost: cost?.cost ?? null, foodCostPct: cost?.foodCostPct ?? null, overTarget: cost?.overTarget ?? false, incomplete: cost?.incomplete ?? false };
        });
        return { target, items, rates };
      },
      async detail(tenantId: string, itemId: string) {
        const [dishes, recipe, target] = await Promise.all([loadDishes(d.db, tenantId), d.recipes.get(tenantId, itemId), targetOf(tenantId)]);
        const dish = dishes.find((x) => x.itemId === itemId);
        if (!dish) throw new AppError(404, "not_found", "Dish not found");
        const rates = await loadItemRates(d.db, tenantId, (recipe?.lines ?? []).map((l) => l.ingredient.itemId).filter((x): x is string => !!x));
        const cost = recipe ? tradesA.costDish(recipe.lines.map((l) => ({ name: l.name, qty: l.qty, unit: l.unit, price: priceOf(l.ingredient, rates) })), dish.rate, target) : null;
        return { dish, recipe, cost, target };
      },
    };
  };
  const costing = makeCosting();

  const dishLabel = (x: DishPortion) => (x.portion ? `${x.name} – ${x.portion}` : x.name);

  const restaurant: SrModule = {
    id: "ai/restaurant",
    routes: async (app: FastifyInstance) => {
      // ---- menu from a photo
      app.post("/menu-scan", { bodyLimit: SCAN_BODY_LIMIT, config: { feature: "dining", permission: DINING_MENU, audit: false as const } }, async (req) => {
        const { tenantId, userId } = ctxOf(req, DINING_MENU, { ai: true });
        const input = parseScanBody(req.body);
        const r = await d.ai.run({
          tenantId,
          userId,
          feature: tradesA.MENU_FEATURE,
          tier: "vision",
          system: tradesA.MENU_SYSTEM,
          input: { text: "Read the attached menu. Return the JSON structure only.", ...input, pdfs: input.pdfs.map((p) => ({ ...p, title: "menu.pdf" })) },
          schema: tradesA.MENU_SCHEMA,
          maxTokens: 24_000,
          effort: "low",
        });
        if (!r.output.readable) throw unreadable(r.output.notes);
        const [dishes, cats] = await Promise.all([loadDishes(d.db, tenantId), loadCategoryNames(d.db, tenantId)]);
        const byProduct = new Map<string, tradesA.ExistingDish>();
        for (const x of dishes) if (!byProduct.has(x.productId)) byProduct.set(x.productId, { id: x.productId, name: x.name, hsn: x.hsn, gstRate: x.gstRate });
        const draft = tradesA.processMenu(r.output, { existing: [...byProduct.values()], categories: cats.map((c) => c.name) });
        return { draft, runId: r.runId, credits: r.credits, provider: r.provider };
      });

      const createBody = z.object({
        dishes: z
          .array(
            z.object({
              name: z.string().trim().min(1).max(100),
              nameTa: z.string().trim().max(100).nullish(),
              category: z.string().trim().max(60).nullish(),
              description: z.string().trim().max(300).nullish(),
              veg: z.boolean().nullable(),
              egg: z.boolean().default(false),
              portions: z.array(z.object({ label: z.string().trim().max(30), price: z.number().int().min(100).max(5_000_000) })).min(1).max(8),
            }),
          )
          .min(1)
          .max(150),
      });
      app.post("/menu-create", gate("dining", DINING_MENU), async (req) => {
        const { tenantId } = ctxOf(req, DINING_MENU);
        const b = parse(createBody, req.body);
        const [dishes, cats] = await Promise.all([loadDishes(d.db, tenantId), loadCategoryNames(d.db, tenantId)]);
        const byProduct = new Map<string, tradesA.ExistingDish>();
        for (const x of dishes) if (!byProduct.has(x.productId)) byProduct.set(x.productId, { id: x.productId, name: x.name, hsn: x.hsn, gstRate: x.gstRate });
        const existing = [...byProduct.values()];
        const defaults = tradesA.shopDefaults(existing);
        const catId = new Map(cats.map((c) => [tradesA.normDish(c.name), c.id]));
        const results: { name: string; status: "created" | "duplicate" | "failed"; productId?: string; error?: string }[] = [];
        for (const raw of b.dishes) {
          try {
            if (existing.some((e) => tradesA.dishSimilarity(raw.name, e.name) >= 0.98)) {
              results.push({ name: raw.name, status: "duplicate" });
              continue;
            }
            let categoryId: string | null = null;
            const cname = raw.category?.trim();
            if (cname) {
              categoryId = catId.get(tradesA.normDish(cname)) ?? null;
              if (!categoryId) {
                categoryId = (await d.catalogue.createCategory(tenantId, { name: cname })).id;
                catId.set(tradesA.normDish(cname), categoryId);
              }
            }
            const draftDish: tradesA.DraftDish = {
              n: 0,
              name: raw.name,
              nameTa: raw.nameTa ?? null,
              category: cname ?? null,
              description: raw.description ?? null,
              veg: raw.veg,
              egg: raw.egg,
              mark: raw.veg === true ? "veg" : raw.egg ? "egg" : raw.veg === false ? "nonveg" : "unknown",
              portions: raw.portions,
              confidence: "high",
              duplicateOf: null,
              select: true,
              why: null,
              newCategory: false,
            };
            const product = await d.catalogue.createProduct(tenantId, tradesA.productFor(draftDish, defaults, categoryId));
            if (raw.veg !== null) for (const v of product.variants) await d.dining.saveMenuItem(tenantId, v.id, { veg: raw.veg });
            existing.push({ id: product.id, name: raw.name, hsn: defaults.hsn, gstRate: defaults.gstRate });
            results.push({ name: raw.name, status: "created", productId: product.id });
          } catch (e) {
            results.push({ name: raw.name, status: "failed", error: e instanceof Error ? e.message.slice(0, 160) : "failed" });
          }
        }
        return { results, created: results.filter((r) => r.status === "created").length };
      });

      // ---- recipe draft and food cost
      const draftBody = z.object({ itemId: z.string().uuid() });
      app.post("/recipe-draft", gate("dining", DINING_MANAGE), async (req) => {
        const { tenantId, userId } = ctxOf(req, DINING_MANAGE, { ai: true });
        const b = parse(draftBody, req.body);
        const dish = (await loadDishes(d.db, tenantId)).find((x) => x.itemId === b.itemId);
        if (!dish) throw new AppError(404, "not_found", "Dish not found");
        const draft = await tradesA.draftRecipe(d.ai, { tenantId, userId, input: { dish: dish.name, portion: dish.portion, category: dish.category, veg: dish.veg } });
        return { draft, dish: { itemId: dish.itemId, name: dishLabel(dish) } };
      });

      app.post("/food-cost-summary", gate("dining", DINING_MANAGE), async (req) => {
        const { tenantId, userId } = ctxOf(req, DINING_MANAGE, { ai: true });
        const b = parse(z.object({ lang }), req.body);
        const list = await costing.list(tenantId);
        const rows: tradesA.DishRow[] = list.items
          .filter((x) => x.hasRecipe && x.cost !== null)
          .map((x) => ({ name: dishLabel(x), foodCostPct: x.foodCostPct, cost: x.cost!, sellingPrice: x.rate, incomplete: x.incomplete, overTarget: x.overTarget }));
        const facts = tradesA.summaryFacts(rows, list.items.length, list.target);
        const s = await tradesA.writeCostSummary(d.ai, { tenantId, userId, facts, lang: b.lang });
        return { text: s.text, source: s.source, facts, runId: s.runId, credits: s.credits, aiNote: s.aiNote };
      });

      // ---- prep forecast
      const prepBody = z.object({
        date: dateStr.optional(),
        rain: z.boolean().default(false),
        rainPct: z.number().int().min(-50).max(50).default(-10),
        festivalPct: z.number().int().min(0).max(100).default(0),
        lang: z.enum(["en", "ta"]).default("ta"),
        note: z.boolean().default(true),
      });
      app.post("/prep", gate("dining", DINING_KITCHEN), async (req) => {
        const { tenantId, userId } = ctxOf(req, DINING_KITCHEN);
        const b = parse(prepBody, req.body);
        const t = today();
        const forDate = b.date ?? tradesA.addDays(t, 1);
        if (!tradesA.isRealDate(forDate) || forDate < t || forDate > tradesA.addDays(t, 14)) throw badRequest("Pick today or a day in the next two weeks");
        const weeks = Array.from({ length: tradesA.WEEKS }, (_, k) => tradesA.addDays(forDate, -7 * (k + 1)));
        const fest = tradesA.festivalAround(forDate);
        // Last year's festival day against the 8 same weekdays before it, for the whole shop (portions), when the shop has that history.
        let lastYearDay: string | null = null;
        let lastYearWeeks: string[] = [];
        if (fest) {
          const f = PLAN_FESTIVALS.find((x) => x.id === fest.id && x.date === fest.date);
          const prev = f ? lastYearOf(f) : null;
          if (prev) {
            lastYearDay = fest.when === "day" ? prev.date : tradesA.addDays(prev.date, -1);
            lastYearWeeks = Array.from({ length: tradesA.WEEKS }, (_, k) => tradesA.addDays(lastYearDay!, -7 * (k + 1)));
          }
        }
        const [sales, dishes, recipes] = await Promise.all([loadDishSales(d.db, tenantId, [...weeks, ...(lastYearDay ? [lastYearDay, ...lastYearWeeks] : [])]), loadDishes(d.db, tenantId), d.recipes.all(tenantId)]);
        let festivalHistory: { baseline: number; onDay: number } | null = null;
        if (lastYearDay) {
          const base = lastYearWeeks.filter((w) => sales.openDates.has(w)).map((w) => sales.dayTotals.get(w) ?? 0);
          festivalHistory = base.length >= 3 && sales.openDates.has(lastYearDay) ? { baseline: base.reduce((a, c) => a + c, 0) / base.length, onDay: sales.dayTotals.get(lastYearDay) ?? 0 } : null;
        }
        const nameOf = new Map(dishes.map((x) => [x.itemId, dishLabel(x)]));
        const history: tradesA.DishHistory[] = [...sales.byItem.entries()].filter(([id]) => nameOf.has(id)).map(([itemId, byDate]) => ({ itemId, name: nameOf.get(itemId)!, byDate }));
        const f = tradesA.forecast({ today: t, forDate, dishes: history, openDates: sales.openDates, festivalPct: b.festivalPct, festivalHistory, rain: b.rain, rainPct: b.rainPct });
        const ing = tradesA.ingredientTotals(
          f,
          recipes.map((r) => ({ itemId: r.itemId, lines: r.lines.map((l) => ({ ingredient: l.name, qty: l.qty, unit: l.unit })) })),
        );
        const note =
          b.note && hasAi(req)
            ? await tradesA.writeKitchenNote(d.ai, { tenantId, userId, forecast: f, totals: ing.totals, lang: b.lang })
            : { note: tradesA.templateNote(f, b.lang), source: "template" as const, runId: null, credits: 0, aiNote: b.note ? "no_permission" : null };
        return { forecast: f, totals: ing.totals, withoutRecipe: ing.withoutRecipe, note: note.note, noteSource: note.source, runId: note.runId, credits: note.credits, aiNote: note.aiNote, weeksChecked: f.weeksChecked.length };
      });
    },
  };

  // ------------------------------------------------------------------ recipes (no AI)

  const recipesModule: SrModule = {
    id: "dining/recipes",
    routes: async (app: FastifyInstance) => {
      const route = gate("dining", DINING_MANAGE);
      app.get("/", route, async (req) => {
        const { tenantId } = ctxOf(req, DINING_MANAGE);
        const l = await costing.list(tenantId);
        return { target: l.target, items: l.items };
      });
      app.get("/ingredients", route, async (req) => ({ items: await d.recipes.ingredients(ctxOf(req, DINING_MANAGE).tenantId) }));
      app.put("/ingredients", route, async (req) => d.recipes.saveIngredient(ctxOf(req, DINING_MANAGE).tenantId, null, req.body ?? {}));
      app.put("/ingredients/:id([0-9a-fA-F-]{36})", route, async (req) => d.recipes.saveIngredient(ctxOf(req, DINING_MANAGE).tenantId, z.object({ id: z.string().uuid() }).parse(req.params).id, req.body ?? {}));
      app.delete("/ingredients/:id([0-9a-fA-F-]{36})", route, async (req) => {
        await d.recipes.deleteIngredient(ctxOf(req, DINING_MANAGE).tenantId, z.object({ id: z.string().uuid() }).parse(req.params).id);
        return { ok: true };
      });
      app.get(ITEM, route, async (req) => costing.detail(ctxOf(req, DINING_MANAGE).tenantId, z.object({ itemId: z.string().uuid() }).parse(req.params).itemId));
      app.put(ITEM, route, async (req) => {
        const { tenantId } = ctxOf(req, DINING_MANAGE);
        const { itemId } = z.object({ itemId: z.string().uuid() }).parse(req.params);
        await d.recipes.save(tenantId, itemId, req.body ?? {});
        return costing.detail(tenantId, itemId);
      });
      app.delete(ITEM, route, async (req) => {
        await d.recipes.remove(ctxOf(req, DINING_MANAGE).tenantId, z.object({ itemId: z.string().uuid() }).parse(req.params).itemId);
        return { ok: true };
      });
    },
  };

  return { modules: [pharmacy, restaurant, recipesModule], costing };
}
