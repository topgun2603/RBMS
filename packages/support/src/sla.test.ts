import { describe, expect, it } from "vitest";
import {
  addSlaHours,
  isOverdue,
  missedSla,
  resolveSupportSettings,
  slaDueAt,
  SUPPORT_SETTINGS_DEFAULTS,
  SUPPORT_SETTINGS_SCHEMA,
  type BusinessHours,
} from "./sla";

/** IST wall clock → Date. */
const ist = (s: string) => new Date(`${s}+05:30`);
// 2026-10-15 is a Thursday; 2026-10-18 a Sunday.
const MON_SAT_9_18: BusinessHours = { days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "18:00" };

describe("addSlaHours", () => {
  it("is plain clock time without business hours (24×7)", () => {
    expect(addSlaHours(ist("2026-10-15T23:30:00"), 2)).toEqual(ist("2026-10-16T01:30:00"));
    expect(addSlaHours(ist("2026-10-15T10:00:00"), 0.5)).toEqual(ist("2026-10-15T10:30:00"));
    expect(addSlaHours(ist("2026-10-15T10:00:00"), 72)).toEqual(ist("2026-10-18T10:00:00"));
  });

  it("inside a window counts only working minutes", () => {
    expect(addSlaHours(ist("2026-10-15T10:00:00"), 2, MON_SAT_9_18)).toEqual(ist("2026-10-15T12:00:00"));
    // Ends exactly at closing time.
    expect(addSlaHours(ist("2026-10-15T16:00:00"), 2, MON_SAT_9_18)).toEqual(ist("2026-10-15T18:00:00"));
    // Thu 17:00 + 2 h → 1 h on Thu, 1 h on Fri.
    expect(addSlaHours(ist("2026-10-15T17:00:00"), 2, MON_SAT_9_18)).toEqual(ist("2026-10-16T10:00:00"));
  });

  it("a ticket raised at night starts its clock when the shop opens", () => {
    expect(addSlaHours(ist("2026-10-15T20:00:00"), 2, MON_SAT_9_18)).toEqual(ist("2026-10-16T11:00:00"));
    expect(addSlaHours(ist("2026-10-16T06:15:00"), 1, MON_SAT_9_18)).toEqual(ist("2026-10-16T10:00:00"));
  });

  it("skips closed days (Sunday)", () => {
    // Sat 17:00 + 2 h → 1 h Sat, Sunday closed, 1 h Mon.
    expect(addSlaHours(ist("2026-10-17T17:00:00"), 2, MON_SAT_9_18)).toEqual(ist("2026-10-19T10:00:00"));
    // Raised on Sunday.
    expect(addSlaHours(ist("2026-10-18T12:00:00"), 8, MON_SAT_9_18)).toEqual(ist("2026-10-19T17:00:00"));
  });

  it("spreads long SLAs over several working days", () => {
    // 24 working hours from Thu 10:00: Thu 8 h, Fri 9 h, Sat 7 h → Sat 16:00.
    expect(addSlaHours(ist("2026-10-15T10:00:00"), 24, MON_SAT_9_18)).toEqual(ist("2026-10-17T16:00:00"));
  });

  it("falls back to 24×7 for nonsense windows", () => {
    const bad = { days: [1], start: "18:00", end: "09:00" };
    expect(addSlaHours(ist("2026-10-15T10:00:00"), 2, bad)).toEqual(ist("2026-10-15T12:00:00"));
  });
});

describe("slaDueAt / isOverdue", () => {
  const created = ist("2026-10-15T10:00:00");

  it("uses first response hours per priority", () => {
    const s = SUPPORT_SETTINGS_DEFAULTS;
    expect(slaDueAt(created, "urgent", s)).toEqual(ist("2026-10-15T12:00:00"));
    expect(slaDueAt(created, "high", s)).toEqual(ist("2026-10-15T18:00:00"));
    expect(slaDueAt(created, "normal", s)).toEqual(ist("2026-10-16T10:00:00"));
    expect(slaDueAt(created, "low", s)).toEqual(ist("2026-10-18T10:00:00"));
    expect(slaDueAt(created, "high", { ...s, businessHours: MON_SAT_9_18 })).toEqual(ist("2026-10-15T18:00:00"));
    expect(slaDueAt(created, "normal", { ...s, businessHours: MON_SAT_9_18 })).toEqual(ist("2026-10-17T16:00:00"));
  });

  it("is overdue only past the deadline, unanswered, open/pending and not merged", () => {
    const due = ist("2026-10-15T12:00:00");
    const t = { status: "open" as const, firstResponseAt: null, slaDueAt: due, mergedIntoId: null };
    expect(isOverdue(t, ist("2026-10-15T11:59:00"))).toBe(false);
    expect(isOverdue(t, ist("2026-10-15T12:00:00"))).toBe(false);
    expect(isOverdue(t, ist("2026-10-15T12:01:00"))).toBe(true);
    expect(isOverdue({ ...t, status: "pending" }, ist("2026-10-16T00:00:00"))).toBe(true);
    expect(isOverdue({ ...t, status: "resolved" }, ist("2026-10-16T00:00:00"))).toBe(false);
    expect(isOverdue({ ...t, status: "closed" }, ist("2026-10-16T00:00:00"))).toBe(false);
    expect(isOverdue({ ...t, firstResponseAt: ist("2026-10-15T13:00:00") }, ist("2026-10-16T00:00:00"))).toBe(false);
    expect(isOverdue({ ...t, mergedIntoId: "x" }, ist("2026-10-16T00:00:00"))).toBe(false);
    expect(isOverdue({ ...t, slaDueAt: null }, ist("2026-10-16T00:00:00"))).toBe(false);
  });

  it("missedSla compares the first reply with the deadline", () => {
    const due = ist("2026-10-15T12:00:00");
    expect(missedSla(due, ist("2026-10-15T12:00:00"))).toBe(false);
    expect(missedSla(due, ist("2026-10-15T12:00:01"))).toBe(true);
    expect(missedSla(null, ist("2030-01-01T00:00:00"))).toBe(false);
  });
});

describe("settings", () => {
  it("defaults are valid and 24×7", () => {
    expect(SUPPORT_SETTINGS_SCHEMA.parse(SUPPORT_SETTINGS_DEFAULTS)).toEqual(SUPPORT_SETTINGS_DEFAULTS);
    expect(SUPPORT_SETTINGS_DEFAULTS.businessHours).toBeNull();
    expect(SUPPORT_SETTINGS_DEFAULTS.prefix).toBe("TKT");
  });

  it("resolve fills gaps field by field and drops bad values", () => {
    expect(resolveSupportSettings(null)).toEqual(SUPPORT_SETTINGS_DEFAULTS);
    expect(resolveSupportSettings({ firstResponseHours: { urgent: 1, low: -3, high: "x" } }).firstResponseHours).toEqual({ low: 72, normal: 24, high: 8, urgent: 1 });
    expect(resolveSupportSettings({ prefix: "help" }).prefix).toBe("TKT");
    expect(resolveSupportSettings({ prefix: "HD" }).prefix).toBe("HD");
    expect(resolveSupportSettings({ businessHours: MON_SAT_9_18 }).businessHours).toEqual(MON_SAT_9_18);
    expect(resolveSupportSettings({ businessHours: { days: [], start: "09:00", end: "18:00" } }).businessHours).toBeNull();
    expect(resolveSupportSettings({ allowGuests: false }).allowGuests).toBe(false);
    expect(() => SUPPORT_SETTINGS_SCHEMA.parse({ ...SUPPORT_SETTINGS_DEFAULTS, businessHours: { days: [1], start: "18:00", end: "09:00" } })).toThrow();
  });
});
