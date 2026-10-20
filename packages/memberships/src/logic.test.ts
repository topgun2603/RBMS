import { describe, expect, it } from "vitest";
import {
  addDays,
  canFreeze,
  checkinDecision,
  currentSubscription,
  daysLeft,
  endDateFor,
  fillDays,
  formatMemberCode,
  isExpiringWithin,
  memberStatus,
  parseLookup,
  renewalStart,
  resolveMembershipsSettings,
  sessionsLeft,
  subscriptionState,
  toIndianE164,
  unfreezeResult,
} from "./logic";

type Status = "active" | "frozen" | "cancelled";
const sub = (o: Partial<{ status: Status; startDate: string; endDate: string }> = {}) => ({
  status: "active" as Status,
  startDate: "2026-10-01",
  endDate: "2026-10-30",
  ...o,
});

describe("dates", () => {
  it("ends a plan duration − 1 days after the start, across months and leap years", () => {
    expect(endDateFor("2026-10-01", 30)).toBe("2026-10-30");
    expect(endDateFor("2026-10-20", 1)).toBe("2026-10-20");
    expect(endDateFor("2028-02-01", 365)).toBe("2029-01-30");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("renews from the day after the end, or today once it has ended", () => {
    expect(renewalStart("2026-10-30", "2026-10-20")).toBe("2026-10-31");
    expect(renewalStart("2026-10-19", "2026-10-20")).toBe("2026-10-20");
    expect(renewalStart("2026-09-01", "2026-10-20")).toBe("2026-10-20");
  });

  it("counts days left and the expiring window", () => {
    expect(daysLeft("2026-10-20", "2026-10-20")).toBe(0);
    expect(daysLeft("2026-10-27", "2026-10-20")).toBe(7);
    expect(daysLeft("2026-10-18", "2026-10-20")).toBe(-2);
    expect(isExpiringWithin("2026-10-27", "2026-10-20", 7)).toBe(true);
    expect(isExpiringWithin("2026-10-28", "2026-10-20", 7)).toBe(false);
    expect(isExpiringWithin("2026-10-19", "2026-10-20", 7)).toBe(false);
  });
});

describe("subscriptionState", () => {
  it("derives expired and upcoming from the dates", () => {
    expect(subscriptionState(sub(), "2026-10-20")).toBe("active");
    expect(subscriptionState(sub(), "2026-10-30")).toBe("active");
    expect(subscriptionState(sub(), "2026-10-31")).toBe("expired");
    expect(subscriptionState(sub(), "2026-09-30")).toBe("upcoming");
    expect(subscriptionState(sub({ status: "frozen" }), "2026-11-15")).toBe("frozen");
    expect(subscriptionState(sub({ status: "cancelled" }), "2026-10-20")).toBe("cancelled");
  });

  it("counts sessions left (null = unlimited)", () => {
    expect(sessionsLeft(null, 40)).toBeNull();
    expect(sessionsLeft(6, 4)).toBe(2);
    expect(sessionsLeft(6, 9)).toBe(0);
  });
});

describe("freeze", () => {
  const s = { ...sub(), freezeDaysAllowed: 10, freezeDaysUsed: 0 };
  it("allows a running plan with freeze days left", () => {
    expect(canFreeze(s, "2026-10-20")).toBeNull();
    expect(canFreeze({ ...s, freezeDaysUsed: 10 }, "2026-10-20")).toBe("no_freeze_days");
    expect(canFreeze({ ...s, freezeDaysAllowed: 0 }, "2026-10-20")).toBe("no_freeze_days");
    expect(canFreeze(s, "2026-11-01")).toBe("not_active");
    expect(canFreeze({ ...s, status: "frozen" }, "2026-10-20")).toBe("already_frozen");
  });

  it("extends the end by the days frozen, capped at the allowance left", () => {
    expect(unfreezeResult({ endDate: "2026-10-30", frozenFrom: "2026-10-10", freezeDaysAllowed: 10, freezeDaysUsed: 0 }, "2026-10-15")).toEqual({
      frozenDays: 5,
      credited: 5,
      endDate: "2026-11-04",
      freezeDaysUsed: 5,
    });
    const capped = unfreezeResult({ endDate: "2026-10-30", frozenFrom: "2026-10-01", freezeDaysAllowed: 10, freezeDaysUsed: 6 }, "2026-10-20");
    expect(capped).toMatchObject({ frozenDays: 19, credited: 4, endDate: "2026-11-03", freezeDaysUsed: 10 });
    expect(unfreezeResult({ endDate: "2026-10-30", frozenFrom: "2026-10-20", freezeDaysAllowed: 10, freezeDaysUsed: 0 }, "2026-10-20").credited).toBe(0);
  });
});

describe("checkinDecision", () => {
  const base = { state: "active" as const, sessionsTotal: null, sessionsUsed: 0, checkedInToday: false, allowMultiple: false };
  it("lets an active member in", () => {
    expect(checkinDecision(base)).toEqual({ ok: true });
    expect(checkinDecision({ ...base, sessionsTotal: 6, sessionsUsed: 5 })).toEqual({ ok: true });
  });
  it("refuses with a clear reason", () => {
    expect(checkinDecision({ ...base, state: null })).toEqual({ ok: false, reason: "no_active_plan" });
    expect(checkinDecision({ ...base, state: "expired" })).toEqual({ ok: false, reason: "no_active_plan" });
    expect(checkinDecision({ ...base, state: "upcoming" })).toEqual({ ok: false, reason: "no_active_plan" });
    expect(checkinDecision({ ...base, state: "frozen" })).toEqual({ ok: false, reason: "frozen" });
    expect(checkinDecision({ ...base, sessionsTotal: 6, sessionsUsed: 6 })).toEqual({ ok: false, reason: "no_sessions_left" });
    expect(checkinDecision({ ...base, checkedInToday: true })).toEqual({ ok: false, reason: "already_checked_in" });
  });
  it("allows a second visit a day when the shop says so", () => {
    expect(checkinDecision({ ...base, checkedInToday: true, allowMultiple: true })).toEqual({ ok: true });
  });
});

describe("currentSubscription", () => {
  const old = sub({ startDate: "2026-08-01", endDate: "2026-08-30" });
  const now = sub({ startDate: "2026-10-01", endDate: "2026-10-30" });
  const next = sub({ startDate: "2026-10-31", endDate: "2026-11-29" });
  it("prefers the plan covering today, then the next one, then the last ended", () => {
    expect(currentSubscription([old, next, now], "2026-10-20")).toBe(now);
    expect(currentSubscription([old, next], "2026-10-20")).toBe(next);
    expect(currentSubscription([old], "2026-10-20")).toBe(old);
    expect(currentSubscription([sub({ status: "cancelled" })], "2026-10-20")).toBeNull();
    const frozen = sub({ status: "frozen", startDate: "2026-09-01", endDate: "2026-09-30" });
    expect(currentSubscription([old, frozen], "2026-10-20")).toBe(frozen);
  });
});

describe("members", () => {
  it("derives the list status from the last end date", () => {
    expect(memberStatus(null, "2026-10-20", 7)).toBe("none");
    expect(memberStatus("2026-10-19", "2026-10-20", 7)).toBe("expired");
    expect(memberStatus("2026-10-25", "2026-10-20", 7)).toBe("expiring");
    expect(memberStatus("2026-12-25", "2026-10-20", 7)).toBe("active");
  });

  it("formats member codes and reads what the desk typed", () => {
    expect(formatMemberCode("m", 42)).toBe("M-0042");
    expect(formatMemberCode("GYM", 12345)).toBe("GYM-12345");
    expect(parseLookup("98765 43210")).toEqual({ kind: "phone", phone: "+919876543210" });
    expect(parseLookup("m-0042")).toEqual({ kind: "code", code: "M-0042" });
    expect(parseLookup("M42")).toEqual({ kind: "code", code: "M-0042" });
    expect(parseLookup("42")).toEqual({ kind: "number", n: 42 });
    expect(parseLookup("  ")).toBeNull();
    expect(parseLookup("a b c")).toBeNull();
  });

  it("normalises Indian mobiles to E.164", () => {
    expect(toIndianE164("+91 98765-43210")).toBe("+919876543210");
    expect(toIndianE164("09876543210")).toBe("+919876543210");
    expect(toIndianE164("12345")).toBeNull();
    expect(toIndianE164("+1 2025550123")).toBeNull();
  });
});

describe("settings and reports", () => {
  it("falls back to defaults key by key", () => {
    expect(resolveMembershipsSettings(null)).toEqual({ allowMultipleCheckins: false, expiringDays: 7, memberCodePrefix: "M" });
    expect(resolveMembershipsSettings({ expiringDays: 14, memberCodePrefix: "bad prefix!" })).toEqual({ allowMultipleCheckins: false, expiringDays: 14, memberCodePrefix: "M" });
  });

  it("fills days without visits with zero", () => {
    expect(fillDays("2026-10-18", "2026-10-20", [{ date: "2026-10-19", count: 4 }])).toEqual([
      { date: "2026-10-18", count: 0 },
      { date: "2026-10-19", count: 4 },
      { date: "2026-10-20", count: 0 },
    ]);
  });
});
