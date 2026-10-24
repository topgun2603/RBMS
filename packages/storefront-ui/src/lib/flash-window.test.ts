import { describe, expect, it } from "vitest";
import { flashState, formatShopTime, hhmm } from "./flash-window";
import { translatorFor } from "./messages";

// 2026-10-23 in IST: midnight IST = 2026-10-22T18:30Z.
const ist = (hm: string, day = 23) => Date.parse(`2026-10-${String(day).padStart(2, "0")}T${hm}:00+05:30`);
const sale = { startsAt: "2026-10-20T00:00:00+05:30", endsAt: "2026-11-01T00:00:00+05:30" };

describe("flash sale window", () => {
  it("reads HH:MM (24:00 = end of day)", () => {
    expect(hhmm("18:30")).toBe(1110);
    expect(hhmm("24:00")).toBe(1440);
    expect(hhmm("24:30")).toBeNull();
    expect(hhmm("6pm")).toBeNull();
  });

  it("without a daily window: live from start to end, counting down to the end", () => {
    expect(flashState(sale, ist("12:00"))).toEqual({ live: true, endsAt: Date.parse(sale.endsAt) });
    expect(flashState(sale, Date.parse("2026-10-19T12:00:00+05:30")).live).toBe(false);
    expect(flashState(sale, Date.parse("2026-11-01T00:00:00+05:30")).live).toBe(false);
  });

  it("every day 18:00–21:00 (shop time): live only inside, counting down to 21:00 today", () => {
    const s = { ...sale, daily: { from: "18:00", to: "21:00" } };
    expect(flashState(s, ist("17:59")).live).toBe(false);
    expect(flashState(s, ist("18:00"))).toEqual({ live: true, endsAt: ist("21:00") });
    expect(flashState(s, ist("20:59")).endsAt).toBe(ist("21:00"));
    expect(flashState(s, ist("21:00")).live).toBe(false);
  });

  it("until midnight (18:00–24:00) and past midnight (22:00–02:00)", () => {
    expect(flashState({ ...sale, daily: { from: "18:00", to: "24:00" } }, ist("23:30")).endsAt).toBe(ist("00:00", 24));
    const night = { ...sale, daily: { from: "22:00", to: "02:00" } };
    expect(flashState(night, ist("23:00")).endsAt).toBe(ist("02:00", 24));
    expect(flashState(night, ist("01:00")).endsAt).toBe(ist("02:00"));
    expect(flashState(night, ist("03:00")).live).toBe(false);
  });

  it("the window never counts past the sale's end", () => {
    const s = { startsAt: undefined, endsAt: "2026-10-23T19:00:00+05:30", daily: { from: "18:00", to: "21:00" } };
    expect(flashState(s, ist("18:30")).endsAt).toBe(ist("19:00"));
  });

  it("formats the times for the band, in English and Tamil", () => {
    expect(formatShopTime("18:00", "en").toLowerCase()).toMatch(/6:00\s?pm/);
    expect(formatShopTime("18:00", "ta")).toMatch(/6:00/);
    expect(translatorFor("ta")("layouts.flashDaily", { from: "a", to: "b" })).toBe("தினமும் a – b");
  });
});
