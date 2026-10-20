import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BOOKINGS_FEATURES, BOOKINGS_PERMISSIONS } from "./lib/access";
import { bookingsConfig } from "./lib/config";
import { addDays, gridRange, hhmm, istIso, istMinute, layoutLanes, parseHHMM, time12, weekdayOf } from "./lib/format";
import { bookingsMessages } from "./lib/messages";
import { APPOINTMENT_STATUSES } from "./lib/types";
import { bookingsModule } from "./module";

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !f.endsWith(".test.ts") ? [p] : [];
  });

describe("bookings messages", () => {
  const en = Object.keys(bookingsMessages.en).sort();
  const ta = Object.keys(bookingsMessages.ta).sort();

  it("has the same keys in English and Tamil", () => {
    expect(ta).toEqual(en);
  });

  it("covers every key the module uses", () => {
    const src = files(__dirname).map((f) => readFileSync(f, "utf8")).join("\n");
    // Feature and permission keys share the prefix but aren't messages.
    const notMessages = new Set<string>([...Object.values(BOOKINGS_FEATURES), ...Object.values(BOOKINGS_PERMISSIONS)]);
    const used = new Set([...src.matchAll(/["`](bookings\.[A-Za-z0-9_.]+)["`]/g)].map((m) => m[1]!).filter((k) => !notMessages.has(k)));
    for (const s of APPOINTMENT_STATUSES) used.add(`bookings.status.${s}`);
    for (const s of ["confirmed", "arrived", "in_service", "completed"]) used.add(`bookings.to.${s}`).add(`bookings.to.${s}Done`);
    for (const s of ["staff", "online"]) used.add(`bookings.source.${s}`);
    for (const w of ["upcoming", "past", "all"]) used.add(`bookings.list.${w}`);
    for (let d = 0; d < 7; d++) used.add(`bookings.weekday.${d}`);
    for (const e of ["slot_taken", "status_move", "not_movable", "already_billed", "not_billable", "too_late", "staff_has_appointments"]) used.add(`bookings.errors.${e}`);
    expect([...used].filter((k) => !(k in bookingsMessages.en))).toEqual([]);
  });
});

describe("bookingsModule", () => {
  it("mounts at /appointments and gates everything by a bookings feature", () => {
    const m = bookingsModule();
    expect(m.id).toBe("bookings");
    expect(m.basePath).toBe("/appointments");
    for (const r of m.routes) expect(String(r.feature)).toMatch(/^bookings/);
    for (const i of m.nav.flatMap((s) => s.items)) expect(String(i.feature)).toMatch(/^bookings/);
    expect(m.settings?.map((s) => s.path)).toEqual(["appointments"]);
    expect(m.widgets?.map((w) => w.zone)).toEqual(["kpi", "side"]);
    expect(m.actions?.[0]?.href).toBe("?new=1");
    expect(bookingsModule({ widgets: false, basePath: "/book" }).widgets).toEqual([]);
  });

  it("takes the bill link from the host", () => {
    bookingsModule();
    expect(bookingsConfig().invoiceHref("x")).toBe("/invoices/x");
    bookingsModule({ invoiceHref: (id) => `/billing/invoices/${id}` });
    expect(bookingsConfig().invoiceHref("x")).toBe("/billing/invoices/x");
  });
});

describe("IST time helpers", () => {
  it("converts between IST day + minute and instants whatever the browser zone", () => {
    expect(istIso("2026-10-21", 600)).toBe("2026-10-21T04:30:00.000Z");
    expect(istMinute("2026-10-21T04:30:00.000Z")).toBe(600);
    expect(istMinute("2026-10-20T18:45:00Z")).toBe(15);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekdayOf("2026-10-18")).toBe(0);
  });

  it("formats and parses times", () => {
    expect(hhmm(570)).toBe("09:30");
    expect(parseHHMM("9:30")).toBe(570);
    expect(parseHHMM("25:00")).toBeNull();
    expect(time12(0)).toBe("12:00 am");
    expect(time12(12 * 60 + 5)).toBe("12:05 pm");
    expect(time12(17 * 60 + 30)).toBe("5:30 pm");
  });
});

describe("calendar layout", () => {
  it("keeps 08:00–21:00 and widens to whole hours around anything outside", () => {
    expect(gridRange([])).toEqual({ from: 480, to: 1260 });
    expect(gridRange([{ from: 7 * 60 + 30, to: 9 * 60 }, { from: 20 * 60, to: 21 * 60 + 15 }])).toEqual({ from: 420, to: 1320 });
  });

  it("puts overlapping blocks side by side and reuses free lanes", () => {
    const out = layoutLanes([
      { id: "a", from: 600, to: 660 },
      { id: "b", from: 615, to: 645 },
      { id: "c", from: 650, to: 700 },
      { id: "d", from: 720, to: 750 },
    ]);
    const by = Object.fromEntries(out.map((o) => [o.block.id, [o.lane, o.lanes]]));
    expect(by.a).toEqual([0, 2]);
    expect(by.b).toEqual([1, 2]);
    expect(by.c).toEqual([1, 2]);
    expect(by.d).toEqual([0, 1]);
  });
});
