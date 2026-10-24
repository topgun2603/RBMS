import type { IndustryHook } from "../context";

/**
 * Kirana: loose goods are weighed (to the gram on shops with scales, 0.25 kg steps otherwise), scale PLUs are set up
 * for the loose items when the shop has the scales feature, and the first ten days of a month bring more credit-book
 * settlements (salary week).
 */
export const kiranaHook: IndustryHook = {
  id: "kirana",

  async prepare(ctx) {
    if (!ctx.features.scales) return;
    const scales = ctx.kit.scales.service;
    const have = new Set((await scales.listItems(ctx.tenant.id, { limit: 500 } as never)).items.map((i) => i.itemId));
    let added = 0;
    for (const item of ctx.items) {
      if (!item.entry.loose || have.has(item.id)) continue;
      await scales.saveItem(ctx.tenant.id, item.id, { soldBy: "weight", unitLabel: "kg" });
      added++;
    }
    if (added) ctx.say(`kirana: ${added} scale PLU(s) created for loose items`);
  },

  async beginDay(ctx, day) {
    ctx.repayBoost = Number(day.date.slice(8)) <= 10 ? 1.8 : 1;
  },

  shapeBill(ctx, draft) {
    if (!ctx.features.scales) return;
    for (const l of draft.lines) {
      if (!l.item.entry.loose) continue;
      // A scale label carries the exact weight: 1.235 kg, not 1.25.
      let q = Math.round((l.qty + draft.rng.float(-0.04, 0.04)) * 1000) / 1000;
      if (l.item.tracked) q = Math.min(q, Math.floor(l.item.stock * 1000) / 1000);
      l.qty = Math.max(q, 0.05);
    }
    draft.lines = draft.lines.filter((l) => !l.item.tracked || l.qty <= l.item.stock);
  },
};
