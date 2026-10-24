import { paymentRequired, type TenantRef } from "@srirealtime/core";
import { periodFor } from "@srirealtime/plans";
import { describe, expect, it } from "vitest";
import { planCredits, type PlansCredits } from "./kit-ai";

const T = "11111111-1111-4111-8111-111111111111";
const ref: TenantRef = { id: T, slug: "kumar", planId: "bl-starter", appId: "BL" };

/** The plans module's rules for a monthly key: the allowance resets with the IST month, packs come after it and never reset. */
function fakePlans(limit: number, packs = 0) {
  const counters = new Map<string, number>();
  let pack = packs;
  let clock = new Date("2026-10-24T06:00:00Z");
  const key = (k: string) => `${k}:${periodFor(k, clock)}`;
  const plans: PlansCredits = {
    limit: async () => limit,
    usage: async (_t, k) => counters.get(key(k)) ?? 0,
    credits: async () => ({ ai_credits_per_month: pack }),
    consume: async (_t, k, amount = 1) => {
      const used = counters.get(key(k)) ?? 0;
      const inAllowance = limit < 0 ? amount : Math.max(0, Math.min(amount, limit - used));
      const fromPack = amount - inAllowance;
      if (fromPack > pack) throw paymentRequired("limit reached");
      pack -= fromPack;
      counters.set(key(k), used + inAllowance);
      return used + inAllowance;
    },
  };
  return { plans, setClock: (d: Date) => (clock = d), get pack() { return pack; } };
}
const credits = (p: PlansCredits, now?: () => Date) => planCredits(p, async (id) => (id === T ? ref : null), now);

describe("AI credits on the plans module", () => {
  it("reads the monthly allowance, what was used and the packs", async () => {
    const f = fakePlans(2000, 500);
    const c = credits(f.plans, () => new Date("2026-10-24T06:00:00Z"));
    expect(await c.balance(T)).toEqual({ period: "2026-10", unlimited: false, allowance: 2000, allowanceUsed: 0, topUp: 500, remaining: 2500 });
  });

  it("takes the allowance first, then the top-up", async () => {
    const f = fakePlans(10, 100);
    const c = credits(f.plans);
    expect(await c.charge(T, 7)).toBe(7);
    expect(await c.charge(T, 7)).toBe(7);
    const b = await c.balance(T);
    expect(b).toMatchObject({ allowanceUsed: 10, topUp: 96, remaining: 96 });
  });

  it("never takes more than is left, and nothing when nothing is left", async () => {
    const f = fakePlans(5, 0);
    const c = credits(f.plans);
    expect(await c.charge(T, 8)).toBe(5);
    expect(await c.charge(T, 3)).toBe(0);
    expect((await c.balance(T)).remaining).toBe(0);
  });

  it("the allowance comes back next month by itself, the packs stay", async () => {
    const f = fakePlans(10, 4);
    const c = credits(f.plans, () => new Date("2026-10-24T06:00:00Z"));
    await c.charge(T, 14);
    expect((await c.balance(T)).remaining).toBe(0);
    f.setClock(new Date("2026-11-02T06:00:00Z"));
    expect(await c.balance(T)).toMatchObject({ allowanceUsed: 0, remaining: 10 });
  });

  it("free plan with 50 credits, unlimited plans, and plans without AI (0)", async () => {
    expect((await credits(fakePlans(50).plans).balance(T)).remaining).toBe(50);
    const unl = await credits(fakePlans(-1).plans).balance(T);
    expect(unl).toMatchObject({ unlimited: true, remaining: null });
    expect((await credits(fakePlans(0).plans).balance(T)).remaining).toBe(0);
    expect(await credits(fakePlans(-1).plans).charge(T, 9)).toBe(9);
  });

  it("an unknown shop is a 404", async () => {
    await expect(credits(fakePlans(10).plans).balance("33333333-3333-4333-8333-333333333333")).rejects.toMatchObject({ status: 404 });
  });
});
