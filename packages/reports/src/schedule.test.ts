import { describe, expect, it } from "vitest";
import { addDaysISO, displayDate, fyStartYear, isIsoDate, istDate, istStart, resolvePreset } from "./dates";
import { cronTiming, nextRunAt, parseCron, presetCron } from "./schedule";

const at = (iso: string) => new Date(iso);

describe("presetCron", () => {
  it("defaults: daily 8am, weekly Monday 8am, monthly 1st 8am (IST)", () => {
    expect(presetCron({ preset: "daily" })).toBe("0 8 * * *");
    expect(presetCron({ preset: "weekly" })).toBe("0 8 * * 1");
    expect(presetCron({ preset: "monthly" })).toBe("0 8 1 * *");
  });
  it("custom time, weekday and day of month; rejects out of range", () => {
    expect(presetCron({ preset: "daily", hour: 19, minute: 30 })).toBe("30 19 * * *");
    expect(presetCron({ preset: "weekly", weekday: 6 })).toBe("0 8 * * 6");
    expect(presetCron({ preset: "monthly", dayOfMonth: 28, hour: 6 })).toBe("0 6 28 * *");
    expect(() => presetCron({ preset: "monthly", dayOfMonth: 31 })).toThrow();
    expect(() => presetCron({ preset: "daily", hour: 24 })).toThrow();
  });
});

describe("parseCron / cronTiming", () => {
  it("parses the preset grammar and refuses anything else", () => {
    expect(parseCron("0 8 * * 1")).toEqual({ minute: 0, hour: 8, dayOfMonth: null, weekday: 1 });
    for (const bad of ["*/5 * * * *", "0 8 * 1 *", "0 8 1 * 1", "0 25 * * *", "0 8 * *", "a b c d e"]) expect(() => parseCron(bad)).toThrow();
  });
  it("round-trips preset timing", () => {
    expect(cronTiming("0 8 * * 1")).toEqual({ preset: "weekly", hour: 8, minute: 0, weekday: 1, dayOfMonth: 1 });
    expect(cronTiming("30 19 * * *")).toMatchObject({ preset: "daily", hour: 19, minute: 30 });
    expect(cronTiming("0 6 15 * *")).toMatchObject({ preset: "monthly", dayOfMonth: 15 });
    expect(cronTiming("0 6 31 * *")).toBeNull();
    expect(cronTiming("junk")).toBeNull();
  });
});

describe("nextRunAt (IST)", () => {
  it("daily 8am: later today when before 8 IST, else tomorrow", () => {
    // 07:00 IST = 01:30Z → 08:00 IST today = 02:30Z
    expect(nextRunAt("0 8 * * *", at("2026-10-15T01:30:00Z")).toISOString()).toBe("2026-10-15T02:30:00.000Z");
    // exactly 08:00 IST → strictly after → tomorrow
    expect(nextRunAt("0 8 * * *", at("2026-10-15T02:30:00Z")).toISOString()).toBe("2026-10-16T02:30:00.000Z");
    // 23:00Z on the 15th is 04:30 IST on the 16th → 08:00 IST on the 16th
    expect(nextRunAt("0 8 * * *", at("2026-10-15T23:00:00Z")).toISOString()).toBe("2026-10-16T02:30:00.000Z");
  });

  it("weekly Monday 8am", () => {
    // Thu 15 Oct 2026 → Mon 19 Oct
    expect(nextRunAt("0 8 * * 1", at("2026-10-15T06:30:00Z")).toISOString()).toBe("2026-10-19T02:30:00.000Z");
    // Monday 07:59 IST → same day
    expect(nextRunAt("0 8 * * 1", at("2026-10-19T02:29:00Z")).toISOString()).toBe("2026-10-19T02:30:00.000Z");
    // Sunday 22:00Z = Monday 03:30 IST → that Monday
    expect(nextRunAt("0 8 * * 1", at("2026-10-18T22:00:00Z")).toISOString()).toBe("2026-10-19T02:30:00.000Z");
  });

  it("monthly 1st 8am, across month and year ends", () => {
    expect(nextRunAt("0 8 1 * *", at("2026-10-15T06:30:00Z")).toISOString()).toBe("2026-11-01T02:30:00.000Z");
    expect(nextRunAt("0 8 1 * *", at("2026-12-01T03:00:00Z")).toISOString()).toBe("2027-01-01T02:30:00.000Z");
    // 31 Oct 20:00Z = 1 Nov 01:30 IST → 1 Nov 08:00 IST
    expect(nextRunAt("0 8 1 * *", at("2026-10-31T20:00:00Z")).toISOString()).toBe("2026-11-01T02:30:00.000Z");
  });

  it("odd minutes and late evening", () => {
    expect(nextRunAt("45 23 * * *", at("2026-10-15T18:00:00Z")).toISOString()).toBe("2026-10-15T18:15:00.000Z");
  });
});

describe("dates", () => {
  it("IST conversions", () => {
    expect(istDate(at("2026-03-31T18:29:59Z"))).toBe("2026-03-31");
    expect(istDate(at("2026-03-31T18:30:00Z"))).toBe("2026-04-01");
    expect(istStart("2026-04-01").toISOString()).toBe("2026-03-31T18:30:00.000Z");
    expect(addDaysISO("2024-02-28", 1)).toBe("2024-02-29");
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate(20240229)).toBe(false);
    expect(fyStartYear("2026-03-31")).toBe(2025);
    expect(fyStartYear("2026-04-01")).toBe(2026);
    expect(displayDate("2026-04-01")).toBe("01-04-2026");
  });

  it("presets as of Thursday 15 Oct 2026 IST", () => {
    const now = at("2026-10-15T06:30:00Z");
    expect(resolvePreset("today", now)).toEqual({ from: "2026-10-15", to: "2026-10-15" });
    expect(resolvePreset("yesterday", now)).toEqual({ from: "2026-10-14", to: "2026-10-14" });
    expect(resolvePreset("last_7_days", now)).toEqual({ from: "2026-10-09", to: "2026-10-15" });
    expect(resolvePreset("last_30_days", now)).toEqual({ from: "2026-09-16", to: "2026-10-15" });
    expect(resolvePreset("this_week", now)).toEqual({ from: "2026-10-12", to: "2026-10-15" });
    expect(resolvePreset("last_week", now)).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(resolvePreset("this_month", now)).toEqual({ from: "2026-10-01", to: "2026-10-15" });
    expect(resolvePreset("last_month", now)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(resolvePreset("this_quarter", now)).toEqual({ from: "2026-10-01", to: "2026-10-15" });
    expect(resolvePreset("this_fy", now)).toEqual({ from: "2026-04-01", to: "2026-10-15" });
    expect(resolvePreset("last_fy", now)).toEqual({ from: "2025-04-01", to: "2026-03-31" });
  });

  it("presets at month/year edges", () => {
    // 1 Jan 2027 IST: last month = December 2026; this_fy started April 2026.
    const jan1 = at("2026-12-31T19:00:00Z");
    expect(resolvePreset("last_month", jan1)).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(resolvePreset("this_fy", jan1)).toEqual({ from: "2026-04-01", to: "2027-01-01" });
    // Sunday: this week started Monday 6 days back.
    expect(resolvePreset("this_week", at("2026-10-18T06:00:00Z"))).toEqual({ from: "2026-10-12", to: "2026-10-18" });
  });
});
