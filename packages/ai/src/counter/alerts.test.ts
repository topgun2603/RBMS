import { describe, expect, it } from "vitest";
import { addDays } from "../insights/calendar";
import { detectAlerts, type CounterFacts, type StaffDay, type TillClose } from "./alerts";
import { mad, median, percentile, spike, usualText } from "./stats";

const TODAY = "2026-10-24";
let seed = 7;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const jitter = (base: number, spread: number) => Math.max(0, Math.round(base + (rnd() - 0.5) * 2 * spread));

const day = (staff: string, name: string, date: string, over: Partial<StaffDay> = {}): StaffDay => ({
  staff,
  name,
  date,
  bills: jitter(80, 10),
  voids: jitter(1, 1),
  returns: jitter(1, 1),
  returnAmount: 120000,
  discountedBills: jitter(6, 2),
  discountAmount: jitter(30000, 8000),
  grossAmount: 1_200_000,
  lateDiscounts: 0,
  noSales: jitter(1, 1),
  priceEdits: jitter(1, 1),
  ...over,
});

/** 64 normal days for each person, ending yesterday; today is added by each test. */
function history(people: [string, string][], days = 64): StaffDay[] {
  seed = 7;
  const out: StaffDay[] = [];
  for (let i = days; i >= 1; i--) for (const [k, n] of people) out.push(day(k, n, addDays(TODAY, -i)));
  return out;
}
const facts = (days: StaffDay[], tills: TillClose[] = []): CounterFacts => ({ today: TODAY, days, tills });
const P: [string, string][] = [["u1", "Ravi"], ["u2", "Geetha"], ["u3", "Eswari"]];
const run = (f: CounterFacts, from = TODAY) => detectAlerts(f, { from, to: TODAY });

describe("robust statistics", () => {
  it("median, percentile and MAD", () => {
    expect(median([1, 2, 3, 4, 100])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([10, 20], 25)).toBe(12.5);
    expect(mad([1, 1, 1, 1, 50])).toBe(0);
  });
  it("an outlier day does not hide the next one: the median ignores it", () => {
    const h = [...Array(30).fill(1), 40];
    expect(spike(h, 9, { minToday: 3 }).fires).toBe(true);
  });
  it("needs history, a minimum and a real rise", () => {
    expect(spike(Array(5).fill(1), 9, { minToday: 3 }).fires).toBe(false); // too little history
    expect(spike(Array(30).fill(1), 2, { minToday: 3 }).fires).toBe(false); // below the minimum
    expect(spike(Array(30).fill(4), 6, { minToday: 3 }).fires).toBe(false); // a rise of 2 on 4 is ordinary
    expect(spike(Array(30).fill(1), 9, { minToday: 3 }).fires).toBe(true);
  });
  it("words the usual range", () => {
    expect(usualText({ usualLow: 1, usualHigh: 2 })).toBe("1 to 2");
    expect(usualText({ usualLow: 3, usualHigh: 3 })).toBe("3");
  });
});

describe("unusual-activity alerts", () => {
  it("nine cancelled bills against a usual one or two: the example alert", () => {
    const f = facts([...history(P), day("u1", "Ravi", TODAY, { voids: 9 }), day("u2", "Geetha", TODAY), day("u3", "Eswari", TODAY)]);
    const a = run(f);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ type: "voids", staff: { key: "u1", name: "Ravi" }, date: TODAY, key: `voids:u1:${TODAY}`, drill: { kind: "voids", staff: "u1", date: TODAY } });
    expect(a[0]!.title.en).toMatch(/^Ravi: 9 cancelled bills on 10\/24 \(usual [0-2]( to [1-2])?\)$/);
    expect(a[0]!.title.ta).toContain("Ravi");
    expect(["watch", "high"]).toContain(a[0]!.severity);
  });
  it("an ordinary day raises nothing for anyone", () => {
    const f = facts([...history(P), ...P.map(([k, n]) => day(k, n, TODAY))]);
    expect(run(f)).toEqual([]);
    // and none over the whole last 30 days either (no noisy false alarms)
    expect(run(f, addDays(TODAY, -29))).toEqual([]);
  });
  it("no alert on low volume, whatever the ratio", () => {
    const quiet = [...history(P), day("u1", "Ravi", TODAY, { bills: 2, voids: 2, discountedBills: 2, discountAmount: 50000, grossAmount: 80000, returns: 2 })];
    expect(run(facts(quiet))).toEqual([]);
    const small = [...history(P), day("u1", "Ravi", TODAY, { voids: 2 })];
    expect(run(facts(small))).toEqual([]);
  });
  it("a new person is judged against the shop's own pooled days, and not at all with too little history", () => {
    const newcomer = [...history(P), day("u9", "Kumar", TODAY, { voids: 9 })];
    expect(run(facts(newcomer)).map((a) => a.key)).toEqual([`voids:u9:${TODAY}`]);
    const tiny = [...history(P, 3), day("u9", "Kumar", TODAY, { voids: 9 })];
    expect(run(facts(tiny))).toEqual([]);
  });
  it("heavy discounts as a share of sales, and discounts after 9 pm", () => {
    const heavy = facts([...history(P), day("u2", "Geetha", TODAY, { discountedBills: 25, discountAmount: 240000, grossAmount: 1_200_000 })]);
    const a = run(heavy);
    expect(a.map((x) => x.type)).toContain("discounts");
    expect(a.find((x) => x.type === "discounts")!.title.en).toMatch(/Geetha: discounts were 20% of sales/);
    const late = facts([...history(P), day("u3", "Eswari", TODAY, { lateDiscounts: 7, discountedBills: 7 })]);
    const l = run(late).find((x) => x.type === "late_discounts");
    expect(l?.title.en).toMatch(/Eswari: 7 discounted bills after 9 pm/);
    expect(l?.drill?.kind).toBe("late_discounts");
  });
  it("returns above the person's usual, with the amount", () => {
    const a = run(facts([...history(P), day("u1", "Ravi", TODAY, { returns: 8, returnAmount: 640000 })])).find((x) => x.type === "returns");
    expect(a?.title.en).toMatch(/Ravi: 8 returns on 10\/24 worth ₹6,400/);
  });
  it("price changes at the counter and drawer opens without a sale", () => {
    const a = run(facts([...history(P), day("u1", "Ravi", TODAY, { priceEdits: 25, noSales: 12 })]));
    expect(a.map((x) => x.type).sort()).toEqual(["no_sale", "price_edits"]);
    expect(a.find((x) => x.type === "price_edits")!.severity).toBe("info");
  });
  it("a plainly large number of no-sale opens counts even before the shop has history for them", () => {
    seed = 3;
    const days = history(P).map((d) => ({ ...d, noSales: 0 }));
    expect(run(facts([...days, day("u1", "Ravi", TODAY, { noSales: 9 })])).map((x) => x.type)).toEqual(["no_sale"]);
    expect(run(facts([...days, day("u1", "Ravi", TODAY, { noSales: 3 })]))).toEqual([]);
  });
  describe("till counts", () => {
    const closes = (staff: string, name: string, diffs: number[]): TillClose[] => diffs.map((difference, i) => ({ sessionId: `${staff}-${i}`, staff, name, register: "Till 2", date: addDays(TODAY, -(diffs.length - 1 - i)), difference }));
    const quiet = [...closes("u1", "Ravi", [0, 0, 1000, 0, -500, 0, 0, 1500, 0, 0, -1000, 0]), ...closes("u2", "Geetha", [0, 0, 0, 500, 0, 0, -800, 0, 0, 0, 0, 0])];
    it("short ₹640 at close when it is plainly more than the usual gap", () => {
      const base = closes("u1", "Ravi", [0, 0, 1000, 0, -500, 0, 0, 1500, 0, 0, -1000, 0, 0]);
      const t = [...base.slice(0, -1), { ...base.at(-1)!, difference: -64000 }];
      const a = run(facts(history(P), t)).filter((x) => x.type === "till_variance");
      expect(a).toHaveLength(1);
      expect(a[0]!.title.en).toBe("Till 2: short ₹640 at close on 10/24 (Ravi)");
      expect(a[0]!.drill).toMatchObject({ kind: "till", sessionId: "u1-12" });
    });
    it("ordinary small differences are not alerts", () => {
      expect(run(facts(history(P), quiet), addDays(TODAY, -11))).toEqual([]);
    });
    it("short in three of the last five closes", () => {
      const t = closes("u1", "Ravi", [0, 0, 0, -3000, 0, -4000, -2500, 0, -3500]);
      const a = run(facts(history(P), t)).filter((x) => x.type === "till_pattern");
      expect(a).toHaveLength(1);
      expect(a[0]!.title.en).toMatch(/Ravi: till short in 3 of the last 5 closes/);
    });
  });
  it("returns all handled by one cashier, only when others also bill", () => {
    const days = history(P).map((d) => ({ ...d, returns: d.staff === "u1" ? 1 : 0 }));
    const a = run(facts([...days, ...P.map(([k, n]) => day(k, n, TODAY, { returns: k === "u1" ? 1 : 0 }))]));
    expect(a.find((x) => x.type === "returns_concentration")?.staff?.name).toBe("Ravi");
    const alone = history([["u1", "Ravi"]]).map((d) => ({ ...d, returns: 1 }));
    expect(run(facts([...alone, day("u1", "Ravi", TODAY, { returns: 1 })])).find((x) => x.type === "returns_concentration")).toBeUndefined();
    const shared = history(P).map((d) => ({ ...d, returns: 1 }));
    expect(run(facts(shared)).find((x) => x.type === "returns_concentration")).toBeUndefined();
  });
  it("keys are stable, so a reviewed alert stays reviewed", () => {
    const f = facts([...history(P), day("u1", "Ravi", TODAY, { voids: 9 })]);
    expect(run(f)[0]!.key).toBe(run(f)[0]!.key);
    expect(run(f)[0]!.key).toBe(`voids:u1:${TODAY}`);
  });
  it("never accuses: the words say worth a look, not wrongdoing", () => {
    const f = facts([...history(P), day("u1", "Ravi", TODAY, { voids: 9, returns: 8, discountedBills: 25, discountAmount: 300000, lateDiscounts: 7, priceEdits: 25, noSales: 12 })], [{ sessionId: "s", staff: "u1", name: "Ravi", register: "Till 1", date: TODAY, difference: -90000 }]);
    const all = run(f);
    expect(all.length).toBeGreaterThanOrEqual(6);
    for (const a of all) {
      const text = `${a.title.en} ${a.detail.en}`;
      expect(text, a.key).not.toMatch(/theft|steal|stole|fraud|cheat|dishonest|suspicious|guilty|misuse|wrong ?doing/i);
      expect(a.detail.en).toMatch(/Worth a look/);
      expect(a.detail.ta).toContain("பார்க்கலாம்");
      expect(a.title.ta.length).toBeGreaterThan(10);
    }
  });
  it("only alerts in the asked date range", () => {
    const old = day("u1", "Ravi", addDays(TODAY, -3), { voids: 9 });
    const f = facts([...history(P).filter((d) => !(d.staff === "u1" && d.date === old.date)), old]);
    expect(run(f)).toEqual([]);
    expect(run(f, addDays(TODAY, -3)).map((a) => a.date)).toEqual([old.date]);
  });
});
