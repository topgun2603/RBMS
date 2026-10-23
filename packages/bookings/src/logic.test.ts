import { computeLine, exclusiveOf, taxableOfInclusive } from "@srirealtime/gst";
import { describe, expect, it } from "vitest";
import {
  addDays,
  appointmentBusy,
  canBill,
  canCustomerCancel,
  canMoveStatus,
  canReschedule,
  clipToDay,
  earliestStart,
  formatHHMM,
  freeStarts,
  hoursError,
  hoursWindows,
  intersect,
  istDateOf,
  istDayRange,
  istInstant,
  istMinuteOf,
  istWeekday,
  mergeAnyStaff,
  normalize,
  overlaps,
  overlapsAt,
  parseHHMM,
  pickLeastBusy,
  priceWithGst,
  servicePrice,
  bookedInclusive,
  bookedPrice,
  serviceTotals,
  staffDoes,
  subtract,
  workingWindows,
} from "./logic";

const h = (s: string) => parseHHMM(s)!;
const shop = { opens: "09:00", closes: "18:00", breaks: [{ from: "13:00", to: "14:00" }] };

describe("IST dates", () => {
  it("parses and formats HH:MM", () => {
    expect(parseHHMM("09:30")).toBe(570);
    expect(parseHHMM("24:00")).toBe(1440);
    expect(parseHHMM("24:01")).toBeNull();
    expect(parseHHMM("9:30")).toBeNull();
    expect(parseHHMM("10:60")).toBeNull();
    expect(formatHHMM(570)).toBe("09:30");
    expect(formatHHMM(0)).toBe("00:00");
  });

  it("puts instants on the IST day and minute (UTC+05:30)", () => {
    // 2026-10-20 18:45 UTC = 2026-10-21 00:15 IST
    const late = new Date("2026-10-20T18:45:00Z");
    expect(istDateOf(late)).toBe("2026-10-21");
    expect(istMinuteOf(late)).toBe(15);
    expect(istMinuteOf(new Date("2026-10-20T04:30:00Z"))).toBe(h("10:00"));
  });

  it("builds instants from an IST day and minute", () => {
    expect(istInstant("2026-10-21", h("10:00")).toISOString()).toBe("2026-10-21T04:30:00.000Z");
    expect(istInstant("2026-10-21", 0).toISOString()).toBe("2026-10-20T18:30:00.000Z");
    const r = istDayRange("2026-10-21");
    expect(r.end.getTime() - r.start.getTime()).toBe(86_400_000);
    expect(istMinuteOf(istInstant("2026-10-21", 935))).toBe(935);
  });

  it("knows weekdays and adds days across months", () => {
    expect(istWeekday("2026-10-18")).toBe(0); // Sunday
    expect(istWeekday("2026-10-24")).toBe(6);
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("clips a range to one IST day", () => {
    const from = istInstant("2026-10-20", h("22:00"));
    const to = istInstant("2026-10-21", h("02:00"));
    expect(clipToDay("2026-10-20", from, to)).toEqual({ from: h("22:00"), to: 1440 });
    expect(clipToDay("2026-10-21", from, to)).toEqual({ from: 0, to: h("02:00") });
    expect(clipToDay("2026-10-22", from, to)).toBeNull();
  });
});

describe("intervals", () => {
  it("merges, intersects and subtracts", () => {
    expect(normalize([{ from: 60, to: 120 }, { from: 0, to: 60 }, { from: 200, to: 200 }])).toEqual([{ from: 0, to: 120 }]);
    expect(intersect([{ from: 0, to: 100 }], [{ from: 50, to: 150 }, { from: 90, to: 95 }])).toEqual([{ from: 50, to: 100 }]);
    expect(subtract([{ from: 0, to: 100 }], [{ from: 20, to: 30 }, { from: 90, to: 200 }])).toEqual([
      { from: 0, to: 20 },
      { from: 30, to: 90 },
    ]);
  });

  it("treats touching intervals as free (half-open)", () => {
    expect(overlaps({ from: 0, to: 30 }, { from: 30, to: 60 })).toBe(false);
    expect(overlaps({ from: 0, to: 31 }, { from: 30, to: 60 })).toBe(true);
    const at = (a: string, b: string) => ({ start: new Date(a), end: new Date(b) });
    expect(overlapsAt(at("2026-10-20T05:00:00Z", "2026-10-20T05:30:00Z"), at("2026-10-20T05:30:00Z", "2026-10-20T06:00:00Z"))).toBe(false);
    expect(overlapsAt(at("2026-10-20T05:00:00Z", "2026-10-20T05:45:00Z"), at("2026-10-20T05:30:00Z", "2026-10-20T06:00:00Z"))).toBe(true);
  });
});

describe("hours", () => {
  it("validates opening hours and breaks", () => {
    expect(hoursError(shop)).toBeNull();
    expect(hoursError({ opens: "18:00", closes: "09:00", breaks: [] })).toMatch(/after opening/);
    expect(hoursError({ opens: "09:00", closes: "18:00", breaks: [{ from: "08:00", to: "10:00" }] })).toMatch(/inside/);
    expect(
      hoursError({
        opens: "09:00",
        closes: "18:00",
        breaks: [
          { from: "13:00", to: "14:00" },
          { from: "13:30", to: "14:30" },
        ],
      }),
    ).toMatch(/overlap/);
    expect(hoursError({ opens: "9", closes: "18:00", breaks: [] })).toMatch(/HH:MM/);
  });

  it("turns hours into working windows minus breaks", () => {
    expect(hoursWindows(shop)).toEqual([
      { from: h("09:00"), to: h("13:00") },
      { from: h("14:00"), to: h("18:00") },
    ]);
    expect(hoursWindows(null)).toEqual([]);
    expect(hoursWindows({ opens: "18:00", closes: "09:00", breaks: [] })).toEqual([]);
  });

  it("intersects shop and staff hours; no staff hours = follows the shop, null = off", () => {
    const late = { opens: "11:00", closes: "20:00", breaks: [] };
    expect(workingWindows(shop, late)).toEqual([
      { from: h("11:00"), to: h("13:00") },
      { from: h("14:00"), to: h("18:00") },
    ]);
    expect(workingWindows(shop, undefined)).toEqual(hoursWindows(shop));
    expect(workingWindows(shop, null)).toEqual([]);
    expect(workingWindows(null, late)).toEqual([]);
  });
});

describe("services and staff", () => {
  it("adds durations and keeps the longest buffer", () => {
    expect(
      serviceTotals([
        { durationMin: 30, bufferMin: 10 },
        { durationMin: 45, bufferMin: 5 },
      ]),
    ).toEqual({ durationMin: 75, bufferMin: 10 });
  });

  it("knows who does which services (empty = all)", () => {
    expect(staffDoes([], ["a", "b"])).toBe(true);
    expect(staffDoes(["a", "b", "c"], ["a", "b"])).toBe(true);
    expect(staffDoes(["a"], ["a", "b"])).toBe(false);
  });
});

describe("earliestStart", () => {
  const now = new Date("2026-10-20T04:40:00Z"); // 10:10 IST
  it("blocks the past and adds the notice today", () => {
    expect(earliestStart("2026-10-19", now)).toBe(Number.POSITIVE_INFINITY);
    expect(earliestStart("2026-10-20", now)).toBe(h("10:10"));
    expect(earliestStart("2026-10-20", now, 60)).toBe(h("11:10"));
    expect(earliestStart("2026-10-21", now, 60)).toBe(0);
  });
  it("carries a notice past midnight into tomorrow", () => {
    const lateNight = new Date("2026-10-20T18:00:00Z"); // 23:30 IST
    expect(earliestStart("2026-10-21", lateNight, 60)).toBe(30);
  });
});

describe("freeStarts", () => {
  const windows = hoursWindows(shop);

  it("steps on the clock grid inside the windows, around the break", () => {
    const s = freeStarts({ windows, busy: [], durationMin: 60, stepMin: 60 });
    expect(s.map(formatHHMM)).toEqual(["09:00", "10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "17:00"]);
  });

  it("aligns to the grid when the window starts off it", () => {
    const s = freeStarts({ windows: [{ from: h("09:10"), to: h("10:00") }], busy: [], durationMin: 30 });
    expect(s.map(formatHHMM)).toEqual(["09:15", "09:30"]);
  });

  it("skips starts that clash with appointments, including the new one's buffer", () => {
    const busy = [{ from: h("10:00"), to: h("10:45") }];
    const s = freeStarts({ windows: [{ from: h("09:00"), to: h("12:00") }], busy, durationMin: 30, bufferMin: 15 });
    // 09:15 + 30 + 15 = 10:00 touches → fine; 09:30 runs into 10:00 → taken; 10:45 is free again.
    expect(s.map(formatHHMM)).toEqual(["09:00", "09:15", "10:45", "11:00", "11:15", "11:30"]);
  });

  it("lets the buffer run past closing but not the service", () => {
    const s = freeStarts({ windows: [{ from: h("17:00"), to: h("18:00") }], busy: [], durationMin: 30, bufferMin: 30, stepMin: 30 });
    expect(s.map(formatHHMM)).toEqual(["17:00", "17:30"]);
  });

  it("honours the earliest start and time off", () => {
    const s = freeStarts({ windows: [{ from: h("09:00"), to: h("12:00") }], busy: [{ from: h("11:00"), to: h("12:00") }], durationMin: 30, earliest: h("10:05"), stepMin: 15 });
    expect(s.map(formatHHMM)).toEqual(["10:15", "10:30"]);
    expect(freeStarts({ windows, busy: [], durationMin: 30, earliest: Number.POSITIVE_INFINITY })).toEqual([]);
    expect(freeStarts({ windows, busy: [], durationMin: 0 })).toEqual([]);
  });

  it("counts an existing appointment's buffer as busy", () => {
    const busy = appointmentBusy("2026-10-20", {
      start: istInstant("2026-10-20", h("10:00")),
      end: istInstant("2026-10-20", h("10:30")),
      bufferMin: 15,
    })!;
    expect(busy).toEqual({ from: h("10:00"), to: h("10:45") });
    const s = freeStarts({ windows: [{ from: h("10:00"), to: h("11:30") }], busy: [busy], durationMin: 30 });
    expect(s.map(formatHHMM)).toEqual(["10:45", "11:00"]);
  });
});

describe("any staff", () => {
  it("unions everyone's slots and gives each to the least busy free person", () => {
    const merged = mergeAnyStaff([
      { staffId: "asha", starts: [540, 555, 600], bookedMin: 120 },
      { staffId: "ravi", starts: [555, 570], bookedMin: 30 },
      { staffId: "meena", starts: [600], bookedMin: 30 },
    ]);
    expect(merged.map((s) => [s.start, s.staffId])).toEqual([
      [540, "asha"],
      [555, "ravi"],
      [570, "ravi"],
      [600, "meena"],
    ]);
    expect(merged.find((s) => s.start === 600)!.staffIds).toEqual(["asha", "meena"]);
  });

  it("breaks ties by list order", () => {
    expect(pickLeastBusy([{ id: "a", bookedMin: 10 }, { id: "b", bookedMin: 10 }])?.id).toBe("a");
    expect(pickLeastBusy([])).toBeUndefined();
  });
});

describe("status flow", () => {
  it("moves forward and cancels only before service", () => {
    expect(canMoveStatus("booked", "confirmed")).toBe(true);
    expect(canMoveStatus("confirmed", "arrived")).toBe(true);
    expect(canMoveStatus("arrived", "in_service")).toBe(true);
    expect(canMoveStatus("in_service", "completed")).toBe(true);
    expect(canMoveStatus("booked", "arrived")).toBe(true);
    expect(canMoveStatus("arrived", "no_show")).toBe(true);
    expect(canMoveStatus("in_service", "cancelled")).toBe(false);
    expect(canMoveStatus("completed", "booked")).toBe(false);
    expect(canMoveStatus("cancelled", "booked")).toBe(false);
    expect(canMoveStatus("booked", "completed")).toBe(false);
    expect(canMoveStatus("confirmed", "booked")).toBe(false);
  });

  it("reschedules and bills at the right stages", () => {
    expect(canReschedule("confirmed")).toBe(true);
    expect(canReschedule("arrived")).toBe(false);
    expect(canBill("in_service")).toBe(true);
    expect(canBill("arrived")).toBe(false);
  });

  it("lets customers cancel until 2 h before", () => {
    const start = new Date("2026-10-20T10:00:00Z");
    expect(canCustomerCancel("booked", start, new Date("2026-10-20T08:00:00Z"))).toBe(true);
    expect(canCustomerCancel("booked", start, new Date("2026-10-20T08:00:01Z"))).toBe(false);
    expect(canCustomerCancel("arrived", start, new Date("2026-10-19T08:00:00Z"))).toBe(false);
  });
});

describe("priceWithGst", () => {
  it("adds GST to the exclusive rate", () => {
    expect(priceWithGst(50000, 18)).toBe(59000);
    expect(priceWithGst(33333, 5)).toBe(35000);
  });
});

describe("GST-inclusive service prices", () => {
  // As the catalogue stores them: the entered price and its exclusive rate (exclusiveOf).
  const item = (price: number, gstRate = 18) => ({ price, gstRate, taxInclusive: true, rate: exclusiveOf(price, gstRate, true) });

  it.each([650000, 10000, 59900])("shows the entered price %i exactly, not rate + GST", (price) => {
    const it = item(price);
    expect(servicePrice(it)).toBe(price);
    // The old path: ₹6,500 → 5,508.47 → ₹6,499.99; ₹100 → 84.75 → ₹100.01.
    if (price === 650000) expect(priceWithGst(it.rate, 18)).toBe(649999);
    if (price === 10000) expect(priceWithGst(it.rate, 18)).toBe(10001);
  });

  it("prices exclusive services with GST on top", () => {
    expect(servicePrice({ rate: 50000, gstRate: 18, price: 50000, taxInclusive: false })).toBe(59000);
    expect(servicePrice({ rate: 50000, gstRate: 18 })).toBe(59000);
  });

  it.each([650000, 10000, 59900])("bills a booked ₹%i service at the entered price with the GST split inside it", (price) => {
    const it = item(price);
    const line = { rate: it.rate, gstRate: 18 };
    const inclusiveTotal = bookedInclusive(line, it);
    expect(inclusiveTotal).toBe(price);
    const bill = computeLine({ description: "Facial", qty: 1, rate: line.rate, gstRate: 18, inclusiveTotal: inclusiveTotal! }, false);
    expect(bill.total).toBe(price);
    expect(bill.taxable + bill.cgst + bill.sgst).toBe(price);
    expect(bill.taxable).toBe(taxableOfInclusive(price, 18));
    expect(Math.abs(bill.cgst - bill.sgst)).toBeLessThanOrEqual(1);
    expect(bookedPrice(line, it)).toBe(price);
  });

  it("recovers the inclusive price from the saved rate when the catalogue price changed since booking", () => {
    const booked = item(650000);
    const now = item(700000);
    expect(bookedInclusive({ rate: booked.rate, gstRate: 18 }, now)).toBe(650000);
  });

  it("keeps exclusive services and items gone from the catalogue on rate + GST", () => {
    expect(bookedInclusive({ rate: 50000, gstRate: 18 }, { rate: 50000, gstRate: 18, price: 50000, taxInclusive: false })).toBeNull();
    expect(bookedInclusive({ rate: 50000, gstRate: 18 }, null)).toBeNull();
    expect(bookedPrice({ rate: 50000, gstRate: 18 }, null)).toBe(59000);
  });
});
