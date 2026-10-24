import { daysBetween } from "../calendar";
import type { HistoryCtx, IndustryHook, IssuedBill } from "../context";
import { personName, testPhone } from "../names";
import { createRng, hashSeed, type Rng } from "../rng";

/**
 * Jewellery:
 * - every day gets the day's metal rates (gold 24K and silver 999 per gram, set through the jewellery service, which
 *   reprices the in-stock tagged pieces in the catalogue); the rate is a deterministic walk by date, so a re-run or a
 *   longer window gives the same rate for a date;
 * - a showroom of tagged pieces (chains, bangles, rings, necklaces, earrings, silver anklets and coins) is created with
 *   weights, wastage, making charges, stone charges and HUIDs, and topped up when it runs low (with a supplier bill);
 * - a bill sells one or two pieces at the piece's price of that day (metal value + making + GST at 3%); about one bill in
 *   eight brings old gold, valued at the buy-back rate and applied to the bill as a payment.
 */
const GOLD_BASE = 11_600_00; // paise per gram of 24K on the reference day
const SILVER_BASE = 148_00;
const REFERENCE_DAY = "2026-01-01";

export function dailyRates(date: string): { gold24: number; silver999: number } {
  const t = daysBetween(REFERENCE_DAY, date);
  const noise = (k: string) => (hashSeed(`${k}:${date}`) % 2001) / 1000 - 1; // -1 to 1
  const gold = GOLD_BASE * (1 + 0.0006 * t + 0.035 * Math.sin(t / 19) + 0.004 * noise("g"));
  const silver = SILVER_BASE * (1 + 0.0004 * t + 0.05 * Math.sin(t / 13 + 1) + 0.006 * noise("s"));
  return { gold24: Math.round(gold / 100) * 100, silver999: Math.round(silver / 100) * 100 };
}

interface PieceKind {
  label: string;
  metal: "gold" | "silver";
  purity: "22K" | "18K" | "999" | "925";
  weight: [number, number];
  making: { type: "percent" | "per_gram"; value: [number, number] };
  stone?: [number, number];
  weightShare: number;
}
const KINDS: PieceKind[] = [
  { label: "Gold chain", metal: "gold", purity: "22K", weight: [8, 32], making: { type: "percent", value: [600, 1000] }, weightShare: 4 },
  { label: "Gold bangle pair", metal: "gold", purity: "22K", weight: [16, 48], making: { type: "percent", value: [700, 1200] }, weightShare: 3 },
  { label: "Gold ring", metal: "gold", purity: "22K", weight: [2.5, 8], making: { type: "percent", value: [900, 1500] }, weightShare: 4 },
  { label: "Gold necklace", metal: "gold", purity: "22K", weight: [20, 60], making: { type: "percent", value: [800, 1400] }, weightShare: 2 },
  { label: "Gold earrings", metal: "gold", purity: "22K", weight: [3, 12], making: { type: "percent", value: [900, 1500] }, weightShare: 4 },
  { label: "Gold pendant", metal: "gold", purity: "22K", weight: [1.5, 6], making: { type: "percent", value: [900, 1600] }, weightShare: 3 },
  { label: "Diamond ring 18K", metal: "gold", purity: "18K", weight: [3, 7], making: { type: "percent", value: [1200, 1800] }, stone: [800_000, 4_500_000], weightShare: 1 },
  { label: "Gold mangalsutra chain", metal: "gold", purity: "22K", weight: [10, 40], making: { type: "percent", value: [800, 1300] }, weightShare: 3 },
  { label: "Gold thali chain", metal: "gold", purity: "22K", weight: [8, 24], making: { type: "percent", value: [700, 1100] }, weightShare: 2 },
  { label: "Gold jimikki earrings", metal: "gold", purity: "22K", weight: [4, 14], making: { type: "percent", value: [900, 1500] }, weightShare: 3 },
  { label: "Gold coin", metal: "gold", purity: "22K", weight: [2, 8], making: { type: "percent", value: [300, 500] }, weightShare: 2 },
  { label: "Diamond earrings 18K", metal: "gold", purity: "18K", weight: [3, 8], making: { type: "percent", value: [1200, 1800] }, stone: [1_500_000, 6_000_000], weightShare: 1 },
  { label: "Silver kolusu (anklet) pair", metal: "silver", purity: "925", weight: [60, 160], making: { type: "per_gram", value: [600, 1000] }, weightShare: 3 },
  { label: "Silver anklet pair", metal: "silver", purity: "925", weight: [40, 120], making: { type: "per_gram", value: [600, 1000] }, weightShare: 3 },
  { label: "Silver coin", metal: "silver", purity: "999", weight: [10, 50], making: { type: "per_gram", value: [300, 600] }, weightShare: 2 },
  { label: "Silver pooja set", metal: "silver", purity: "925", weight: [150, 400], making: { type: "per_gram", value: [500, 900] }, weightShare: 1 },
];

interface ShopState {
  /** In-stock pieces by id with their latest price (GST-exclusive paise). */
  stock: Map<string, { itemId: string; name: string; price: number }>;
  nextTag: number;
  pricesFor: string | null;
}
const states = new WeakMap<HistoryCtx, ShopState>();

async function addPieces(ctx: HistoryCtx, state: ShopState, count: number, rng: Rng, date: string) {
  const t = ctx.tenant.id;
  const prefix = ctx.slug.slice(0, 2).toUpperCase();
  let cost = 0;
  let grams = 0;
  for (let i = 0; i < count; i++) {
    const kind = rng.weighted(KINDS, (k) => k.weightShare);
    const gross = Math.round(rng.float(...kind.weight) * 100) / 100;
    const stone = kind.stone ? Math.round(rng.float(0.1, 0.4) * 100) / 100 : 0;
    const tag = `${prefix}-${String(state.nextTag++).padStart(4, "0")}`;
    const name = `${kind.label} ${kind.purity} ${gross.toFixed(2)} g (${tag})`;
    const item = await ctx.kit.invoices.service.createItem(t, { name, hsn: "7113", unit: "pcs", rate: 100_000, gstRate: 3 } as never);
    if (ctx.features.inventory) await ctx.kit.inventory.service.updateStock(t, item.id, { track: false } as never).catch(() => undefined);
    await ctx.kit.jewellery.service.createPiece(t, {
      itemId: item.id,
      name,
      metal: kind.metal,
      purity: kind.purity,
      grossWeight: gross,
      stoneWeight: stone,
      wastagePct: kind.metal === "gold" ? rng.pick([0, 0.5, 1, 2]) : 0,
      makingType: kind.making.type,
      makingValue: rng.int(...kind.making.value),
      stoneCharges: kind.stone ? Math.round(rng.int(...kind.stone) / 10_000) * 10_000 : 0,
      huid: kind.metal === "gold" ? Array.from({ length: 6 }, () => "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"[rng.int(0, 33)]).join("") : undefined,
      tagNo: tag,
    });
    const rates = dailyRates(date);
    const per = kind.metal === "gold" ? rates.gold24 * (kind.purity === "22K" ? 0.916 : 0.75) : rates.silver999 * (kind.purity === "925" ? 0.925 : 1);
    cost += (gross - stone) * per * 0.94;
    grams += gross;
  }
  return { cost: Math.round(cost), grams };
}

async function refresh(ctx: HistoryCtx, state: ShopState) {
  state.stock.clear();
  for (let offset = 0; ; offset += 100) {
    const list = await ctx.kit.jewellery.service.listPieces(ctx.tenant.id, { status: "in_stock", limit: 100, offset } as never);
    for (const p of list.items) state.stock.set(p.id, { itemId: p.itemId, name: p.name, price: p.lastPrice ?? 0 });
    if (offset + 100 >= list.total || list.items.length === 0) break;
  }
}

export const jewelleryHook: IndustryHook = {
  id: "jewellery",

  async prepare(ctx) {
    if (!ctx.features.jewellery) {
      ctx.say("jewellery: the jewellery feature is off for this shop, so pieces and rates are skipped (plain billing)");
      return;
    }
    const svc = ctx.kit.jewellery.service;
    const state: ShopState = { stock: new Map(), nextTag: 1, pricesFor: null };
    states.set(ctx, state);
    // Rates first (today's), so new pieces are priced.
    const r = dailyRates(ctx.today);
    await svc.setRates(ctx.tenant.id, { rates: [{ metal: "gold", purity: "24K", ratePerGram: r.gold24 }, { metal: "silver", purity: "999", ratePerGram: r.silver999 }] });
    const all = await svc.listPieces(ctx.tenant.id, { limit: 1 } as never);
    state.nextTag = all.total + 1;
    await refresh(ctx, state);
    if (state.stock.size < 40) {
      await addPieces(ctx, state, 70 - state.stock.size, ctx.rng("pieces:initial"), ctx.today);
      await refresh(ctx, state);
      ctx.say(`jewellery: ${state.stock.size} tagged pieces in the showroom`);
    }
  },

  async beginDay(ctx, day) {
    const state = states.get(ctx);
    if (!state) return;
    const svc = ctx.kit.jewellery.service;
    const r = dailyRates(day.date);
    await svc.setRates(ctx.tenant.id, { rates: [{ metal: "gold", purity: "24K", ratePerGram: r.gold24 }, { metal: "silver", purity: "999", ratePerGram: r.silver999 }] });
    // New stock from the manufacturer when the showroom runs low.
    if (state.stock.size < 28) {
      ctx.clock.set(day.date, day.open - 20);
      const rng = createRng(`${ctx.slug}:restock:${day.date}`);
      const { cost, grams } = await addPieces(ctx, state, 30, rng, day.date);
      await ctx.recordPurchase(day.date, ctx.profile.suppliers[0]?.name ?? "", [
        { description: `Gold and silver ornaments, ${grams.toFixed(1)} g (wholesale)`, hsn: "7113", qty: 1, unit: "lot", rate: cost, gstRate: 3 },
      ]);
    }
    await refresh(ctx, state);
  },

  async issueBill(ctx, draft, session) {
    const state = states.get(ctx);
    if (!state || !session) return null;
    const r = draft.rng;
    const pool = [...state.stock.entries()].filter(([, p]) => p.price > 0);
    if (!pool.length) return null;
    // Cheaper pieces sell more often than the big sets.
    const picks: [string, { itemId: string; name: string; price: number }][] = [];
    const n = r.chance(0.18) ? 2 : 1;
    for (let i = 0; i < n && pool.length; i++) {
      const [id, p] = r.weighted(pool, ([, x]) => 1 / Math.sqrt(x.price / 100_000 + 1));
      picks.push([id, p]);
      pool.splice(pool.findIndex(([x]) => x === id), 1);
    }
    const svc = ctx.kit.invoices.service;
    const t = ctx.tenant.id;
    const c = draft.customer;
    const invoice = await svc.create(
      ctx.tenant,
      {
        date: draft.date,
        issue: true,
        ...(c ? { customerId: c.id } : { customer: { name: personName(r).name, phone: testPhone(r.int(8000, 8999)) } }),
        tillSessionId: session.id,
        lines: picks.map(([, p]) => ({ description: p.name, itemId: p.itemId, qty: 1, unit: "pcs", rate: p.price, gstRate: 3, hsn: "7113" })),
      } as never,
      { branchId: null },
    );
    for (const [id] of picks) state.stock.delete(id);

    // Old gold brought in, valued and applied as a payment (never more than 60% of the bill).
    let paid = invoice.paid;
    if (ctx.features["jewellery.exchange"] && r.chance(0.2)) {
      try {
        const name = c?.planned.name ?? personName(r).name;
        // Sized from the bill: old gold worth 15-50% of it (at ~22K buying value), so the 60% cap does not cancel it.
        const unit = Math.max(1, dailyRates(draft.date).gold24 * 0.916 * 0.95);
        const oldGoldGrams = Math.max(1, Math.round(((invoice.total * r.float(0.15, 0.5)) / unit) * 100) / 100);
        const ex = await ctx.kit.jewellery.service.createExchange(t, {
          date: draft.date,
          customer: { name, phone: c?.planned.phone ?? testPhone(r.int(8000, 8999)) },
          lines: [{ description: "Old gold ornaments", metal: "gold", purity: "22K", grossWeight: oldGoldGrams, deductionPct: r.pick([2, 3, 4]) }],
          note: "Exchange against new purchase",
        });
        if (ex.total > 0 && ex.total <= invoice.total * 0.6) {
          await ctx.kit.jewellery.service.applyExchange(t, ex.id, invoice.id);
          paid += ex.total;
        } else await ctx.kit.jewellery.service.cancelExchange(t, ex.id);
      } catch (err) {
        ctx.log.warn({ err: err instanceof Error ? err.message : err }, "jewellery: old-gold exchange failed");
      }
    }
    const lines: IssuedBill["lines"] = [];
    return [{ id: invoice.id, number: invoice.number, total: invoice.total, paid, lines }];
  },
};

