import { describe, expect, it } from "vitest";
import { addDays, daysBetween, festivalLift, istToday, pendingDays, weekday, windowDates } from "./calendar";
import { isTestPhone, testPhone, uniqueNames } from "./names";
import { planDay, planWindow, sampleBillTimes, topShare } from "./planner";
import { PROFILE_IDS, PROFILES, getProfile, profileForBusinessType } from "./profiles";
import { createRng, hashSeed } from "./rng";
import { isValidGstin } from "@rbms/gst";
import { creditBalanceAfter, planCustomers } from "./customers";

describe("rng", () => {
  it("is deterministic per seed and differs between seeds", () => {
    const a = createRng("kumar:90");
    const b = createRng("kumar:90");
    const c = createRng("raja:90");
    const seqA = Array.from({ length: 20 }, () => a.next());
    expect(Array.from({ length: 20 }, () => b.next())).toEqual(seqA);
    expect(Array.from({ length: 20 }, () => c.next())).not.toEqual(seqA);
    expect(seqA.every((x) => x >= 0 && x < 1)).toBe(true);
  });
  it("hashes near-identical text apart and keeps forks independent", () => {
    expect(hashSeed("a:2026-10-01")).not.toBe(hashSeed("a:2026-10-02"));
    const r = createRng(5);
    expect(r.fork("x").next()).toBe(createRng(5).fork("x").next());
    expect(r.fork("x").next()).not.toBe(r.fork("y").next());
  });
  it("draws within bounds, weights and Poisson means", () => {
    const r = createRng(1);
    for (let i = 0; i < 500; i++) {
      const n = r.int(3, 7);
      expect(n >= 3 && n <= 7).toBe(true);
    }
    const hits = [0, 0];
    for (let i = 0; i < 4000; i++) hits[r.weightedIndex([1, 3])]!++;
    expect(hits[1]! / 4000).toBeGreaterThan(0.7);
    expect(hits[1]! / 4000).toBeLessThan(0.8);
    const mean = Array.from({ length: 3000 }, () => r.poisson(4)).reduce((a, b) => a + b, 0) / 3000;
    expect(mean).toBeGreaterThan(3.8);
    expect(mean).toBeLessThan(4.2);
  });
});

describe("names", () => {
  it("makes distinct, Tamil-style names deterministically", () => {
    const a = uniqueNames(createRng("k"), 80).map((p) => p.name);
    const b = uniqueNames(createRng("k"), 80).map((p) => p.name);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(80);
    expect(a.every((n) => /^[A-Z][A-Za-z. ]+\d*$/.test(n))).toBe(true);
    expect(a.some((n) => /^[A-Z]\. /.test(n))).toBe(true);
  });
  it("keeps every phone in the fake test range", () => {
    for (const n of [0, 1, 123, 9999]) {
      const p = testPhone(n);
      expect(p).toMatch(/^\+91900000\d{4}$/);
      expect(p.startsWith("+9199990")).toBe(false); // never the e2e shops' block (cleanup:e2e-data deletes it)
      expect(isTestPhone(p)).toBe(true);
      expect(p.length).toBe(13);
    }
    expect(() => testPhone(10_000)).toThrow();
    expect(isTestPhone("+919876500001")).toBe(false);
  });
});

describe("calendar", () => {
  it("does date arithmetic without time zones", () => {
    expect(addDays("2026-10-23", -89)).toBe("2026-07-26");
    expect(daysBetween("2026-07-26", "2026-10-23")).toBe(89);
    expect(weekday("2026-11-08")).toBe(0);
    expect(istToday(new Date("2026-10-22T20:00:00Z"))).toBe("2026-10-23");
  });
  it("builds a window that ends today with no future dates", () => {
    const w = windowDates("2026-10-23", 90);
    expect(w).toHaveLength(90);
    expect(w[0]).toBe("2026-07-26");
    expect(w.at(-1)).toBe("2026-10-23");
    expect(w.every((d) => d <= "2026-10-23")).toBe(true);
    expect(() => windowDates("2026-10-23", 0)).toThrow();
  });
  it("tops up only the days not done", () => {
    const w = windowDates("2026-10-23", 10);
    const done = new Set(w.slice(0, 7));
    expect(pendingDays(w, done)).toEqual(w.slice(7));
    expect(pendingDays(w, new Set(w))).toEqual([]);
    // the next day: only the new day remains
    const next = windowDates("2026-10-24", 10);
    expect(pendingDays(next, new Set(w))).toEqual(["2026-10-24"]);
  });
  it("lifts demand before Deepavali and dips on the day, and honours trade affinity", () => {
    const eve = festivalLift("2026-11-07");
    expect(eve.factor).toBeGreaterThan(1.8);
    expect(eve.festival?.name).toBe("Deepavali");
    expect(festivalLift("2026-11-08").factor).toBeLessThan(1);
    expect(festivalLift("2026-10-30").factor).toBeGreaterThan(1.2);
    expect(festivalLift("2026-10-23").factor).toBeCloseTo(1.0, 0); // 16 days out: outside the 14-day build-up (Ayudha Pooja has passed)
    const navaratri = festivalLift("2026-10-18");
    expect(navaratri.festival?.name).toMatch(/Navaratri/);
    expect(navaratri.factor).toBeGreaterThan(1.2);
    const pharmacy = festivalLift("2026-11-07", undefined, PROFILES.pharmacy.festivalAffinity);
    expect(pharmacy.factor).toBeLessThan(eve.factor);
    expect(festivalLift("2026-04-18", undefined, PROFILES.jewellery.festivalAffinity).factor).toBeGreaterThan(1.5);
    expect(festivalLift("2026-04-18", undefined, PROFILES.kirana.festivalAffinity).factor).toBeCloseTo(1, 1);
  });
});

describe("profiles", () => {
  it("are complete", () => {
    expect(PROFILE_IDS).toEqual(expect.arrayContaining(["kirana", "pharmacy", "restaurant", "jewellery", "textiles", "hardware", "services", "repair"]));
    for (const id of PROFILE_IDS) {
      const p = getProfile(id);
      expect(p.billsByWeekday).toHaveLength(7);
      expect(p.hours.open).toBeLessThan(p.hours.close);
      const m = p.payments.cash + p.payments.upi + p.payments.card;
      expect(m).toBeCloseTo(1, 5);
      const names = p.catalogue.map((c) => c.name);
      expect(new Set(names).size).toBe(names.length);
      for (const c of p.catalogue) {
        expect([0, 0.25, 3, 5, 12, 18, 28]).toContain(c.gstRate);
        expect(c.rate).toBeGreaterThan(0);
        if (c.supplier) expect(p.suppliers.map((s) => s.name)).toContain(c.supplier);
      }
    }
    expect(() => getProfile("nope")).toThrow(/Unknown profile/);
    expect(profileForBusinessType("grocery")?.id).toBe("kirana");
    expect(profileForBusinessType("pharmacy")?.id).toBe("pharmacy");
    expect(profileForBusinessType("unknown")).toBeNull();
  });
  it("follow a Pareto popularity curve (top 20% of items take about 80% of lines)", () => {
    expect(topShare(PROFILES.kirana)).toBeGreaterThan(0.65);
    expect(topShare(PROFILES.kirana)).toBeLessThan(0.9);
    expect(topShare(PROFILES.pharmacy)).toBeGreaterThan(0.6);
  });
});

describe("day planner", () => {
  const kirana = PROFILES.kirana;
  const dates = windowDates("2026-10-23", 90);
  it("is deterministic and independent of the window length", () => {
    const a = planWindow(kirana, "kumar", dates);
    const b = planWindow(kirana, "kumar", dates);
    expect(a).toEqual(b);
    expect(planDay(kirana, "kumar", "2026-10-01")).toEqual(planWindow(kirana, "kumar", windowDates("2026-10-23", 30)).find((d) => d.date === "2026-10-01"));
    expect(planDay(kirana, "kumar", "2026-10-01")).not.toEqual(planDay(kirana, "raja", "2026-10-01"));
  });
  it("never plans a date after the window's end", () => {
    const plans = planWindow(kirana, "kumar", dates);
    expect(plans.every((p) => p.date <= "2026-10-23")).toBe(true);
    expect(plans.map((p) => p.date)).toEqual(dates);
  });
  it("gives roughly the profile's bills per day, busier weekends, and festival peaks", () => {
    const plans = planWindow(kirana, "kumar", dates);
    const avg = plans.reduce((a, p) => a + p.bills, 0) / plans.length;
    expect(avg).toBeGreaterThan(55);
    expect(avg).toBeLessThan(110);
    const sundays = plans.filter((p) => p.weekday === 0);
    const tuesdays = plans.filter((p) => p.weekday === 2);
    expect(sundays.reduce((a, p) => a + p.bills, 0) / sundays.length).toBeGreaterThan(tuesdays.reduce((a, p) => a + p.bills, 0) / tuesdays.length);
    const eve = planDay(kirana, "kumar", "2026-11-07");
    const ordinary = planDay(kirana, "kumar", "2026-09-22");
    expect(eve.factor).toBeGreaterThan(ordinary.factor * 1.5);
    expect(eve.festival).toBe("Deepavali");
    expect(plans.some((p) => p.festival?.includes("Navaratri"))).toBe(true);
  });
  it("places bill times inside opening hours, sorted", () => {
    const t = sampleBillTimes(kirana, createRng("t"), 200);
    expect(t).toHaveLength(200);
    expect(t.every((m) => m > kirana.hours.open && m < kirana.hours.close)).toBe(true);
    expect([...t].sort((a, b) => a - b)).toEqual(t);
    const morning = t.filter((m) => m < 10 * 60).length;
    const evening = t.filter((m) => m > 17 * 60 && m < 20 * 60).length;
    expect(morning + evening).toBeGreaterThan(t.length * 0.4);
  });
  it("respects closed weekdays", () => {
    const p = { ...kirana, closedWeekdays: [0] };
    expect(planDay(p, "x", "2026-10-18")).toMatchObject({ closed: true, bills: 0 });
  });
});

describe("customers", () => {
  it("plans a deterministic pool with credit customers inside their limits", () => {
    const a = planCustomers(PROFILES.kirana, "kumar");
    const b = planCustomers(PROFILES.kirana, "kumar");
    expect(a).toEqual(b);
    expect(a).toHaveLength(PROFILES.kirana.customers.count);
    expect(new Set(a.map((c) => c.phone)).size).toBe(a.length);
    expect(a.every((c) => isTestPhone(c.phone))).toBe(true);
    const business = a.filter((c) => c.gstin);
    expect(business.length).toBeGreaterThanOrEqual(3);
    expect(business.every((c) => isValidGstin(c.gstin) && c.creditLimit !== null)).toBe(true);
    const credit = a.filter((c) => c.creditLimit !== null);
    expect(credit.length).toBeGreaterThan(8);
    expect(credit.every((c) => c.creditLimit! >= PROFILES.kirana.customers.creditLimit[0] && c.creditLimit! <= PROFILES.kirana.customers.creditLimit[1])).toBe(true);
    expect(credit.some((c) => c.payer === "slow") || credit.some((c) => c.payer === "late")).toBe(true);
  });
  it("only puts a bill on credit when it stays within the limit", () => {
    expect(creditBalanceAfter({ balance: 1000, limit: 5000 }, 3000)).toEqual({ onCredit: 3000, balance: 4000 });
    // would exceed the limit: the customer pays the part that doesn't fit
    expect(creditBalanceAfter({ balance: 4000, limit: 5000 }, 3000)).toEqual({ onCredit: 1000, balance: 5000 });
    expect(creditBalanceAfter({ balance: 5000, limit: 5000 }, 3000)).toEqual({ onCredit: 0, balance: 5000 });
    expect(creditBalanceAfter({ balance: 0, limit: null }, 3000)).toEqual({ onCredit: 0, balance: 0 });
  });
});

describe("simulated clock", () => {
  it("serves a past instant, never the future, and resets to real time", async () => {
    const { SimClock } = await import("./context");
    const { istInstant, istMinutes } = await import("./calendar");
    const c = new SimClock();
    c.set("2026-08-01", 7 * 60 + 30);
    expect(c.now().toISOString()).toBe("2026-08-01T02:00:00.000Z");
    expect(istMinutes(c.now())).toBe(450);
    c.set("2999-01-01", 60);
    expect(c.now().getTime()).toBeLessThanOrEqual(Date.now() + 5);
    c.reset();
    expect(Math.abs(c.now().getTime() - Date.now())).toBeLessThan(1000);
    expect(istInstant("2026-10-23", 0).toISOString()).toBe("2026-10-22T18:30:00.000Z");
  });
});

describe("expense days and rates", () => {
  it("clamps a month day to the month's length", async () => {
    const { expenseDay } = await import("./planner");
    expect(expenseDay("2027-02-28", 31)).toBe(true);
    expect(expenseDay("2026-10-30", 31)).toBe(false);
    expect(expenseDay("2026-10-31", 31)).toBe(true);
  });
  it("gives the same gold rate for a date every time and moves day to day", async () => {
    const { dailyRates } = await import("./hooks/jewellery");
    expect(dailyRates("2026-09-01")).toEqual(dailyRates("2026-09-01"));
    expect(dailyRates("2026-09-01").gold24).not.toBe(dailyRates("2026-09-02").gold24);
    const r = dailyRates("2026-10-23");
    expect(r.gold24).toBeGreaterThan(1_000_000);
    expect(r.silver999).toBeGreaterThan(10_000);
  });
});

describe("electronics profile (TechZone)", () => {
  const p = getProfile("electronics");
  it("is chosen for the electronics trade and sells the demo store's own catalogue, one entry per variant", () => {
    expect(profileForBusinessType("electronics")?.id).toBe("electronics");
    expect(p.hook).toBe("electronics");
    expect(new Set(p.catalogue.map((c) => c.name)).size).toBe(p.catalogue.length);
    expect(p.catalogue.length).toBeGreaterThan(120);
    expect(p.catalogue.find((c) => c.name === "AMOLED 5G smartphone, 6.67-inch 120 Hz – 8 GB + 128 GB / Graphite")).toBeDefined();
    // Services are untracked; every tracked item has a supplier of the profile.
    const suppliers = new Set(p.suppliers.map((s) => s.name));
    for (const c of p.catalogue) if (c.reorder !== undefined) expect(suppliers.has(c.supplier ?? ""), c.name).toBe(true);
  });
  it("tracks phones with two IMEIs and big appliances with a prefixed serial", () => {
    const phone = p.catalogue.find((c) => c.name.startsWith("Everyday 5G smartphone"))!;
    expect(phone.serial).toMatchObject({ months: 12, dual: true, prefix: "IMEI" });
    const tv = p.catalogue.find((c) => c.name.startsWith("4K smart TV"))!;
    expect(tv.serial).toMatchObject({ dual: false, prefix: "TV" });
    expect(p.catalogue.find((c) => c.name.startsWith("Split AC installation"))?.serial).toBeUndefined();
  });
});

describe("tailoring profile (Thaiyal)", () => {
  it("is chosen for the tailoring trade, uses the jobcards hook and builds one entry per service variant", async () => {
    const p = getProfile("tailoring");
    expect(profileForBusinessType("tailoring")?.id).toBe("tailoring");
    expect(p.hook).toBe("jobcards");
    expect(p.catalogue.every((c) => c.unit === "service" && c.gstRate === 5 && c.hsn === "998821")).toBe(true);
    expect(new Set(p.catalogue.map((c) => c.name)).size).toBe(p.catalogue.length);
    expect(p.catalogue.length).toBeGreaterThan(60);
  });

  it("has a garment recipe for every line it bills, all resolving to catalogue names", async () => {
    const { GARMENT_RECIPES, GARMENT_STAFF, measurementsFor, bulkQty } = await import("./hooks/jobcards-garments");
    const names = new Set(getProfile("tailoring").catalogue.map((c) => c.name));
    for (const r of GARMENT_RECIPES) {
      expect(r.device, r.id).toBe("garment");
      expect(r.garment, r.id).toBeTruthy();
      for (const group of r.labour) for (const n of group) expect(names.has(n), `${r.id}: ${n}`).toBe(true);
      for (const n of r.addons ?? []) expect(names.has(n), `${r.id}: ${n}`).toBe(true);
      expect(GARMENT_STAFF.some((s) => s.name === r.tailor), r.id).toBe(true);
    }
    // Measurements are keyed like the garment template and stay inside its limits.
    const { GARMENT_MEASUREMENTS } = await import("@rbms/jobcards");
    const rng = createRng("m");
    for (const type of ["blouse", "salwar", "shirt", "pant"] as const) {
      const m = measurementsFor(type, rng);
      expect(Object.keys(m).sort(), type).toEqual([...GARMENT_MEASUREMENTS[type]].sort());
      for (const v of Object.values(m)) expect(v > 0 && v < 100).toBe(true);
    }
    expect(measurementsFor("other", rng)).toEqual({});
    expect(bulkQty("School uniform set – 100 sets and above", rng)).toBeGreaterThanOrEqual(100);
    expect(bulkQty("School uniform set – 25 to 99 sets", rng)).toBeLessThanOrEqual(90);
  });

  it("keeps schools as business credit customers with dues room", () => {
    const planned = planCustomers(getProfile("tailoring"), "thaiyal", "Madurai");
    const schools = planned.filter((c) => c.gstin !== null);
    expect(schools.length).toBeGreaterThanOrEqual(5);
    expect(schools.every((c) => c.creditLimit !== null && /School|Hostel|Balwadi|Boutique/.test(c.name))).toBe(true);
  });
});
