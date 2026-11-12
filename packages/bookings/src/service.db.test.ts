/**
 * Database test of the appointments service: services with catalogue prices, staff, weekly hours and time off, free
 * slots (worked by hand for a 10:00-18:00 shop with a lunch break), booking at the desk and online, double-booking
 * protection, moving and status changes, billing, the customer's cancel link, the reminder feed, and that one shop
 * never sees another's appointments. Runs only with `BOOKINGS_TEST_DATABASE_URL` set (a development Postgres with the
 * bookings tables migrated); it copies them into a throw-away schema and drops it afterwards. The clock is fixed at
 * 10:00 on Thursday 5 Nov 2026 in India; times are India times.
 *   PowerShell: $env:BOOKINGS_TEST_DATABASE_URL="postgres://srikit:srikit@localhost:5433/srikit"; pnpm test
 */
import { randomUUID } from "node:crypto";
import { AppError, emptyContext, type RequestContext, type TenantRef } from "@rbms/core";
import { createDb, type Db } from "@rbms/db";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import type { BillingPort, BookingNotice, ServicePriceItem } from "./ports";
import { bookingsRoutes } from "./routes";
import { BookingsService } from "./service";

const URL_ = process.env.BOOKINGS_TEST_DATABASE_URL;
const SCHEMA = `bookings_it_${Math.random().toString(36).slice(2, 10)}`;
const TABLES = ["booking_services", "booking_staff", "booking_hours", "booking_timeoff", "booking_appointments", "booking_appointment_items"];
const GHOST = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const HAIR = "aaaaaaaa-0000-4000-8000-000000000001"; // Rs 500 + 18% GST = 590.00
const BEARD = "aaaaaaaa-0000-4000-8000-000000000002"; // Rs 200 + 5% GST = 210.00
const BRIDAL = "aaaaaaaa-0000-4000-8000-000000000003"; // entered as Rs 6,500 including GST (rate 5,508.47 + 18%)
const PRICES: ServicePriceItem[] = [
  { id: HAIR, name: "Haircut", rate: 50_000, gstRate: 18, hsn: "9997", unit: "pcs" },
  { id: BEARD, name: "Beard trim", rate: 20_000, gstRate: 5, hsn: "9997", unit: "pcs" },
  { id: BRIDAL, name: "Bridal makeup", rate: 550_847, gstRate: 18, hsn: "9997", unit: "pcs", price: 650_000, taxInclusive: true },
];

const TODAY = "2026-11-05";
const TOMORROW = "2026-11-06";
const NOW = new Date("2026-11-05T04:30:00Z"); // 10:00 IST
const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);
const iso = (date: string, hhmm: string) => ist(date, hhmm).toISOString();

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof AppError ? `${e.status}:${e.code}` : e instanceof ZodError ? "zod" : String(e);
  }
  return "ok";
};

describe.skipIf(!URL_)("bookings service against Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  let svc: BookingsService;
  let clock = NOW;
  const bills: { tenant: string; lines: { description: string; rate: number; gstRate: number; inclusiveTotal?: number | null }[]; customer: unknown; notes: string | null }[] = [];
  let billingFails = false;
  const notices: string[] = [];
  const rescheduled: { previous: Date; start: Date }[] = [];
  const cancelled: { by: string; reason: string | null }[] = [];
  const warns: string[] = [];
  let notifyFails = false;

  const week = Array.from({ length: 7 }, (_, weekday) => ({ weekday, opens: "10:00", closes: "18:00", breaks: [{ from: "13:00", to: "14:00" }] }));

  /** A fresh shop: Haircut (30 min + 10 clean-up) and Beard trim (15 min), staff Asha (all) and Bala (haircuts only), 10:00-18:00 with lunch 13:00-14:00 every day. */
  const newShop = async () => {
    const t = randomUUID();
    const haircut = await svc.createService(t, { itemId: HAIR, durationMin: 30, bufferMin: 10 });
    const beard = await svc.createService(t, { itemId: BEARD, durationMin: 15 });
    const asha = await svc.createStaff(t, { name: "Asha" });
    const bala = await svc.createStaff(t, { name: "Bala", serviceItemIds: [HAIR] });
    await svc.putHours(t, { days: week });
    const tenant: TenantRef = { id: t, slug: "t", planId: "pro", appId: "BL" };
    return { t, tenant, haircut, beard, asha, bala };
  };
  const slotTimes = async (t: string, q: Record<string, unknown>, online = false) => (await svc.availability(t, q, { online })).slots.map((s) => s.time);

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 8 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    const billing: BillingPort = {
      createBill: async (tenant, input) => {
        if (billingFails) throw new Error("invoices down");
        bills.push({ tenant: tenant.id, lines: input.lines, customer: input.customer, notes: input.notes });
        return { id: randomUUID(), number: `INV-${bills.length}`, total: 0 };
      },
    };
    const note = (kind: string) => (n: BookingNotice) => {
      if (notifyFails) throw new Error("sms down");
      notices.push(`${kind}:${n.number}`);
    };
    svc = new BookingsService({
      db,
      billing,
      now: () => clock,
      prices: { items: async (_t, ids) => PRICES.filter((p) => ids.includes(p.id)) },
      log: { info() {}, error() {}, warn: (_o, m) => void warns.push(m ?? "") },
      notify: {
        booked: (_t, n) => note("booked")(n),
        cancelled: (_t, n) => {
          cancelled.push({ by: n.by, reason: n.reason });
          note("cancelled")(n);
        },
        rescheduled: (_t, n) => {
          rescheduled.push({ previous: n.previousStart, start: n.start });
          note("rescheduled")(n);
        },
      },
    });
  });
  afterAll(async () => {
    if (db) await db.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close?.();
  });

  it("services: named from the catalogue, shown with the price customers pay (a tax-inclusive price stays exact)", async () => {
    const t = randomUUID();
    const h = await svc.createService(t, { itemId: HAIR, durationMin: 30, bufferMin: 10 });
    expect(h).toMatchObject({ name: "Haircut", durationMin: 30, bufferMin: 10, active: true, onlineBookable: true });
    expect(await code(svc.createService(t, { itemId: HAIR, durationMin: 30 }))).toBe("409:conflict");
    expect(await code(svc.createService(t, { itemId: GHOST, durationMin: 30 }))).toBe("400:bad_request");
    expect(await code(svc.createService(t, { itemId: BEARD, durationMin: 4 }))).toBe("zod");
    expect(await code(svc.createService(t, { itemId: BEARD, durationMin: 15, bufferMin: 300 }))).toBe("zod");
    expect(await code(svc.createService(t, { itemId: BEARD, durationMin: 15, colour: "red" }))).toBe("zod");
    const bridal = await svc.createService(t, { itemId: BRIDAL, name: "Bridal", durationMin: 120, sort: 2 });
    expect(bridal.name).toBe("Bridal");
    await svc.createService(t, { itemId: BEARD, durationMin: 15, sort: 1 });

    const list = await svc.services(t);
    expect(list.map((s) => [s.name, s.rate, s.gstRate, s.price])).toEqual([
      ["Haircut", 50_000, 18, 59_000],
      ["Beard trim", 20_000, 5, 21_000],
      // 5,508.47 + 18% would be 6,499.99: the price entered, 6,500.00, is what is shown.
      ["Bridal", 550_847, 18, 650_000],
    ]);
    expect((await svc.updateService(t, h.id, { active: false, durationMin: 45 })).durationMin).toBe(45);
    expect((await svc.services(t)).map((s) => s.name)).toEqual(["Beard trim", "Bridal"]);
    expect((await svc.services(t, { includeInactive: true })).map((s) => s.name)).toEqual(["Haircut", "Beard trim", "Bridal"]);
    expect(await code(svc.updateService(randomUUID(), h.id, { durationMin: 10 }))).toBe("404:not_found");
    expect(await code(svc.updateService(t, h.id, { itemId: BEARD }))).toBe("zod");
    expect(await svc.services(randomUUID())).toEqual([]);
    await svc.deleteService(t, h.id);
    expect(await code(svc.deleteService(t, h.id))).toBe("404:not_found");
    expect(await code(svc.deleteService(randomUUID(), bridal.id))).toBe("404:not_found");
  });

  it("without a price source services still need a name, and are booked at zero", async () => {
    const bare = new BookingsService({ db, now: () => clock });
    const t = randomUUID();
    expect(await code(bare.createService(t, { itemId: HAIR, durationMin: 30 }))).toBe("400:bad_request");
    const s = await bare.createService(t, { itemId: HAIR, name: "Cut", durationMin: 30 });
    expect((await bare.services(t))[0]).toMatchObject({ rate: null, price: null });
    await bare.createStaff(t, { name: "Solo" });
    await bare.putHours(t, { days: week });
    const a = await bare.create(t, { serviceIds: [s.id], staffId: "any", start: iso(TOMORROW, "11:00"), customerName: "Guest" });
    expect(a.items[0]).toMatchObject({ rate: 0, gstRate: 18 });
    // The same service can't be booked once a price source says the item is gone from the catalogue.
    const strict = new BookingsService({ db, now: () => clock, prices: { items: async () => [] } });
    expect(await code(strict.create(t, { serviceIds: [s.id], staffId: "any", start: iso(TOMORROW, "12:00"), customerName: "Guest" }))).toBe("400:bad_request");
  });

  it("staff and weekly hours: validated, replaced as a whole, a person's own hours narrow the shop's", async () => {
    const { t, asha, bala } = await newShop();
    expect(asha).toMatchObject({ color: "#6366f1", serviceItemIds: [], active: true });
    expect(bala.serviceItemIds).toEqual([HAIR]);
    const dup = await svc.createStaff(t, { name: "Chitra", color: "#AABBCC", serviceItemIds: [HAIR, HAIR, BEARD] });
    expect(dup).toMatchObject({ color: "#aabbcc", serviceItemIds: [HAIR, BEARD] });
    expect(await code(svc.createStaff(t, { name: "Bad", color: "red" }))).toBe("zod");
    expect(await code(svc.createStaff(t, { name: "" }))).toBe("zod");
    expect((await svc.updateStaff(t, dup.id, { active: false, serviceItemIds: [BEARD, BEARD] })).serviceItemIds).toEqual([BEARD]);
    expect((await svc.staff(t)).map((s) => s.name)).toEqual(["Asha", "Bala"]);
    expect((await svc.staff(t, { includeInactive: true })).map((s) => s.name)).toEqual(["Asha", "Bala", "Chitra"]);
    expect(await code(svc.updateStaff(randomUUID(), asha.id, { name: "X" }))).toBe("404:not_found");
    expect(await svc.staff(randomUUID())).toEqual([]);

    const h = await svc.hours(t);
    expect(h.shop).toHaveLength(7);
    expect(h.shop[1]).toEqual({ weekday: 1, opens: "10:00", closes: "18:00", breaks: [{ from: "13:00", to: "14:00" }] });
    expect(h.staff).toEqual({});
    expect(await code(svc.putHours(t, { days: [{ weekday: 1, opens: "18:00", closes: "10:00" }] }))).toBe("zod");
    expect(await code(svc.putHours(t, { days: [{ weekday: 1, opens: "10:00", closes: "18:00" }, { weekday: 1, opens: "10:00", closes: "12:00" }] }))).toBe("zod");
    expect(await code(svc.putHours(t, { days: [{ weekday: 1, opens: "10:00", closes: "18:00", breaks: [{ from: "09:00", to: "10:30" }] }] }))).toBe("zod");
    expect(await code(svc.putHours(t, { days: [{ weekday: 1, opens: "10:00", closes: "18:00", breaks: [{ from: "12:00", to: "13:00" }, { from: "12:30", to: "13:30" }] }] }))).toBe("zod");
    expect(await code(svc.putHours(t, { days: [{ weekday: 7, opens: "10:00", closes: "18:00" }] }))).toBe("zod");
    expect(await code(svc.putHours(t, { staffId: GHOST, days: [] }))).toBe("404:not_found");
    expect((await svc.hours(t)).shop).toHaveLength(7); // refused edits changed nothing

    // Bala works Fridays 12:00-16:00 only: 6 Nov 2026 is a Friday.
    const friday = new Date(`${TOMORROW}T00:00:00Z`).getUTCDay();
    expect(friday).toBe(5);
    await svc.putHours(t, { staffId: bala.id, days: [{ weekday: 5, opens: "12:00", closes: "16:00" }] });
    const day = await svc.day(t, { date: TOMORROW });
    expect(day.windows.shop).toEqual([{ from: 600, to: 780 }, { from: 840, to: 1080 }]);
    // His own hours (12:00-16:00) cut the shop's day (10-13, 14-18) to 12:00-13:00 and 14:00-16:00.
    expect(day.windows.staff[bala.id]).toEqual([{ from: 720, to: 780 }, { from: 840, to: 960 }]);
    expect(day.windows.staff[asha.id]).toEqual([{ from: 600, to: 780 }, { from: 840, to: 1080 }]);
    // The next day he has no hours of his own listed for it: off.
    expect((await svc.day(t, { date: "2026-11-07" })).windows.staff[bala.id]).toEqual([]);
    // Clearing his hours puts him back on the shop's.
    await svc.putHours(t, { staffId: bala.id, days: [] });
    expect((await svc.day(t, { date: TOMORROW })).windows.staff[bala.id]).toEqual([{ from: 600, to: 780 }, { from: 840, to: 1080 }]);
    expect((await svc.hours(t)).staff).toEqual({});
    expect((await svc.hours(randomUUID())).shop).toEqual([]);
  });

  it("free slots: on the 15-minute grid, inside the hours, around lunch, for people who do the services", async () => {
    const { t, haircut, beard, asha, bala } = await newShop();
    // Haircut 30 min + 10 clean-up: starts 10:00..12:30 (11 slots) and 14:00..17:30 (15 slots).
    const times = await slotTimes(t, { date: TOMORROW, serviceIds: haircut.id });
    expect(times).toHaveLength(26);
    expect(times.slice(0, 3)).toEqual(["10:00", "10:15", "10:30"]);
    expect(times).toContain("12:30");
    for (const t_ of ["12:45", "13:00", "13:15", "13:30", "13:45"]) expect(times).not.toContain(t_);
    expect(times.slice(11, 13)).toEqual(["14:00", "14:15"]);
    expect(times.at(-1)).toBe("17:30");
    const first = (await svc.availability(t, { date: TOMORROW, serviceIds: haircut.id })).slots[0]!;
    expect(first.start).toEqual(ist(TOMORROW, "10:00"));
    expect(first.end).toEqual(ist(TOMORROW, "10:30"));
    expect(first.staffIds.sort()).toEqual([asha.id, bala.id].sort());
    const a = await svc.availability(t, { date: TOMORROW, serviceIds: haircut.id });
    expect(a).toMatchObject({ durationMin: 30, bufferMin: 10, date: TOMORROW });

    // Haircut + beard = 45 minutes, and only Asha does beards: 10:00..12:15 (10) + 14:00..17:15 (14).
    const both = await svc.availability(t, { date: TOMORROW, serviceIds: `${haircut.id},${beard.id}` });
    expect(both.durationMin).toBe(45);
    expect(both.bufferMin).toBe(10);
    expect(both.slots).toHaveLength(24);
    expect(both.slots.every((s) => s.staffId === asha.id)).toBe(true);
    // Choosing Bala for it gives nothing; choosing him for a haircut gives all 26.
    expect(await slotTimes(t, { date: TOMORROW, serviceIds: `${haircut.id},${beard.id}`, staffId: bala.id })).toEqual([]);
    expect(await slotTimes(t, { date: TOMORROW, serviceIds: haircut.id, staffId: bala.id })).toHaveLength(26);

    // Today at 10:00 the desk can book from now (10:00); online needs an hour's notice (11:00).
    expect((await slotTimes(t, { date: TODAY, serviceIds: haircut.id }))[0]).toBe("10:00");
    expect((await slotTimes(t, { date: TODAY, serviceIds: haircut.id }, true))[0]).toBe("11:00");
    clock = new Date("2026-11-05T05:05:00Z"); // 10:35
    expect((await slotTimes(t, { date: TODAY, serviceIds: haircut.id }))[0]).toBe("10:45");
    clock = new Date("2026-11-05T13:00:00Z"); // 18:30: the shop has closed
    expect(await slotTimes(t, { date: TODAY, serviceIds: haircut.id })).toEqual([]);
    clock = NOW;
    expect(await slotTimes(t, { date: "2026-11-04", serviceIds: haircut.id })).toEqual([]); // yesterday
    // Online booking only reaches 60 days ahead.
    expect(await slotTimes(t, { date: "2027-01-04", serviceIds: haircut.id }, true)).toHaveLength(26); // 60 days
    expect(await slotTimes(t, { date: "2027-01-05", serviceIds: haircut.id }, true)).toEqual([]); // 61 days
    expect(await slotTimes(t, { date: "2027-01-05", serviceIds: haircut.id })).toHaveLength(26); // the desk is not limited

    expect(await code(svc.availability(t, { serviceIds: haircut.id }))).toBe("zod");
    expect(await code(svc.availability(t, { date: TOMORROW }))).toBe("zod");
    expect(await code(svc.availability(t, { date: "2026-02-30", serviceIds: haircut.id }))).toBe("zod");
    expect(await code(svc.availability(t, { date: TOMORROW, serviceIds: GHOST }))).toBe("400:bad_request");
    expect(await code(svc.availability(randomUUID(), { date: TOMORROW, serviceIds: haircut.id }))).toBe("400:bad_request");
    // A switched-off service, and (online) one not for online booking, are unknown.
    await svc.updateService(t, beard.id, { onlineBookable: false });
    expect(await code(svc.availability(t, { date: TOMORROW, serviceIds: beard.id }, { online: true }))).toBe("400:bad_request");
    expect((await svc.availability(t, { date: TOMORROW, serviceIds: beard.id })).slots.length).toBeGreaterThan(0);
    await svc.updateService(t, beard.id, { active: false });
    expect(await code(svc.availability(t, { date: TOMORROW, serviceIds: beard.id }))).toBe("400:bad_request");
  });

  it("a shop with no staff is one chair; a shop with no hours is closed", async () => {
    const t = randomUUID();
    const cut = await svc.createService(t, { itemId: HAIR, durationMin: 30 });
    expect(await slotTimes(t, { date: TOMORROW, serviceIds: cut.id })).toEqual([]);
    await svc.putHours(t, { days: [{ weekday: 5, opens: "09:00", closes: "10:00" }] });
    expect(await slotTimes(t, { date: TOMORROW, serviceIds: cut.id })).toEqual(["09:00", "09:15", "09:30"]);
    const a = await svc.create(t, { serviceIds: [cut.id], staffId: "any", start: iso(TOMORROW, "09:15"), customerName: "Walk-in" });
    expect(a.staffId).toBeNull();
    // 09:15-09:45 taken: only 09:00 would clash by overlap? No: 09:00-09:30 overlaps, 09:30-10:00 overlaps; nothing is left.
    expect(await slotTimes(t, { date: TOMORROW, serviceIds: cut.id })).toEqual([]);
    expect(await code(svc.create(t, { serviceIds: [cut.id], staffId: "any", start: iso(TOMORROW, "09:30"), customerName: "Late" }))).toBe("409:slot_taken");
    // Naming a person who does not exist is refused.
    expect(await code(svc.create(t, { serviceIds: [cut.id], staffId: GHOST, start: iso(TOMORROW, "09:00"), customerName: "X" }))).toBe("400:bad_request");
  });

  it("books at the desk: numbered per day, priced from the catalogue, least-busy staff for 'any', no double booking", async () => {
    const { t, tenant, haircut, beard, asha, bala } = await newShop();
    void tenant;
    const first = await svc.create(t, { serviceIds: [haircut.id, beard.id], staffId: asha.id, start: iso(TOMORROW, "10:00"), customerName: "Meena", customerPhone: "98765 43210", notes: "  window seat " }, "22222222-2222-4222-8222-222222222222");
    // Haircut 500.00 + beard 200.00, GST-exclusive; 45 minutes; the 10-minute clean-up follows.
    expect(first).toMatchObject({
      number: 1, businessDate: TOMORROW, status: "booked", source: "staff", staffName: "Asha", durationMin: 45, bufferMin: 10, amount: 70_000,
      customerName: "Meena", customerPhone: "98765 43210", notes: "window seat", createdBy: "22222222-2222-4222-8222-222222222222",
    });
    expect(first.start).toEqual(ist(TOMORROW, "10:00"));
    expect(first.end).toEqual(ist(TOMORROW, "10:45"));
    expect(first.items.map((i) => [i.name, i.durationMin, i.rate, i.gstRate])).toEqual([["Haircut", 30, 50_000, 18], ["Beard trim", 15, 20_000, 5]]);
    expect(first.nextStatuses).toEqual(["confirmed", "arrived", "in_service", "cancelled", "no_show"]);
    expect(first.manageToken.length).toBeGreaterThanOrEqual(16);

    // Asha is busy until 10:55 (10:45 plus 10 minutes); her first free haircut start is 11:00.
    expect((await slotTimes(t, { date: TOMORROW, serviceIds: haircut.id, staffId: asha.id }))[0]).toBe("11:00");
    // "Any" at 10:00 goes to Bala, the only free person; the next "any" at 10:00 finds nobody.
    const second = await svc.create(t, { serviceIds: [haircut.id], staffId: "any", start: iso(TOMORROW, "10:00"), customerName: "Nitin" });
    expect(second).toMatchObject({ number: 2, staffId: bala.id, staffName: "Bala" });
    expect(await code(svc.create(t, { serviceIds: [haircut.id], staffId: "any", start: iso(TOMORROW, "10:00"), customerName: "Late" }))).toBe("409:slot_taken");
    // Naming a busy person clashes; a start inside the lunch break or outside hours is allowed for a named person (the desk squeezes people in).
    expect(await code(svc.create(t, { serviceIds: [haircut.id], staffId: asha.id, start: iso(TOMORROW, "10:30"), customerName: "Clash" }))).toBe("409:slot_taken");
    expect((await svc.create(t, { serviceIds: [haircut.id], staffId: asha.id, start: iso(TOMORROW, "13:00"), customerName: "Lunch squeeze" })).number).toBe(3);
    expect((await svc.create(t, { serviceIds: [haircut.id], staffId: asha.id, start: iso(TOMORROW, "08:00"), customerName: "Early" })).number).toBe(4);
    // Unassigned bookings take no slot check, and later "any" bookings go to the less busy person.
    const un = await svc.create(t, { serviceIds: [haircut.id], staffId: null, start: iso(TOMORROW, "10:00"), customerName: "Unassigned" });
    expect(un).toMatchObject({ staffId: null, staffName: null });
    // The first free 10:00-ish "any" slot at 14:00: Asha has 70+30+30 minutes booked, Bala 30: Bala gets it.
    expect((await svc.create(t, { serviceIds: [haircut.id], staffId: "any", start: iso(TOMORROW, "15:00"), customerName: "Fair" })).staffId).toBe(bala.id);
    // A cancelled appointment frees its time.
    await svc.setStatus(t, second.id, { status: "cancelled", reason: "no call back" });
    expect((await svc.create(t, { serviceIds: [haircut.id], staffId: "any", start: iso(TOMORROW, "10:00"), customerName: "Reuse" })).staffId).toBe(bala.id);
    // The next day numbering starts again.
    expect((await svc.create(t, { serviceIds: [haircut.id], staffId: "any", start: iso("2026-11-07", "10:00"), customerName: "Next day" })).number).toBe(1);

    // Bad input.
    const base = { serviceIds: [haircut.id], staffId: "any", start: iso(TOMORROW, "16:00"), customerName: "X" };
    expect(await code(svc.create(t, { ...base, customerName: " " }))).toBe("zod");
    expect(await code(svc.create(t, { ...base, customerPhone: "abc" }))).toBe("zod");
    expect(await code(svc.create(t, { ...base, serviceIds: [] }))).toBe("zod");
    expect(await code(svc.create(t, { ...base, start: "tomorrow" }))).toBe("zod");
    expect(await code(svc.create(t, { ...base, start: `${TOMORROW}T16:00:30+05:30` }))).toBe("400:bad_request");
    expect(await code(svc.create(t, { ...base, start: iso(TOMORROW, "23:45"), staffId: asha.id }))).toBe("400:bad_request"); // would end after midnight
    expect(await code(svc.create(t, { ...base, serviceIds: [GHOST] }))).toBe("400:bad_request");
    expect(await code(svc.create(randomUUID(), base))).toBe("400:bad_request");
    expect(await code(svc.create(t, { ...base, staffId: GHOST }))).toBe("400:bad_request");
  });

  it("two people booking the same last slot at once: one wins, the other is told it was taken", async () => {
    const { t, haircut, asha, bala } = await newShop();
    void asha;
    void bala;
    const attempt = (n: number) => svc.create(t, { serviceIds: [haircut.id], staffId: "any", start: iso(TOMORROW, "16:00"), customerName: `Guest ${n}` });
    const results = await Promise.allSettled([attempt(1), attempt(2), attempt(3), attempt(4)]);
    // Two staff are free at 16:00, so exactly two bookings succeed.
    const ok = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof attempt>>>[];
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(2);
    expect(failed).toHaveLength(2);
    for (const f of failed) expect(f.reason).toMatchObject({ status: 409, code: "slot_taken" });
    expect(ok.map((r) => r.value.number).sort()).toEqual([1, 2]);
    expect(new Set(ok.map((r) => r.value.staffId)).size).toBe(2);
  });

  it("time off removes slots: one person's, or the whole shop's; ranges, edits and clean-up", async () => {
    const { t, haircut, asha, bala } = await newShop();
    // Bala is off 14:00-16:00 tomorrow; with the clean-up his first free afternoon start is 16:00.
    const off = await svc.createTimeoff(t, { staffId: bala.id, from: iso(TOMORROW, "14:00"), to: iso(TOMORROW, "16:00"), reason: "  Dentist " });
    expect(off.reason).toBe("Dentist");
    const bt = await slotTimes(t, { date: TOMORROW, serviceIds: haircut.id, staffId: bala.id });
    expect(bt).not.toContain("14:00");
    expect(bt).not.toContain("15:45");
    expect(bt).toContain("16:00");
    // 13:xx is lunch anyway; 12:30 haircut ends 13:00 and its clean-up ends 13:10: before the time off.
    expect(bt).toContain("12:30");
    // Anyone can still book 14:00, through Asha.
    expect((await svc.availability(t, { date: TOMORROW, serviceIds: haircut.id })).slots.find((s) => s.time === "14:00")!.staffIds).toEqual([asha.id]);
    // The whole shop closed 16:00-17:00 (nobody's id): no slot starting from 15:30 (the clean-up would reach it) until 17:00.
    const shopOff = await svc.createTimeoff(t, { from: iso(TOMORROW, "16:00"), to: iso(TOMORROW, "17:00") });
    const all = await slotTimes(t, { date: TOMORROW, serviceIds: haircut.id });
    expect(all).toContain("15:15");
    expect(all).not.toContain("15:30");
    expect(all).not.toContain("16:45");
    expect(all).toContain("17:00");

    expect((await svc.timeoff(t, { from: TOMORROW, to: TOMORROW })).map((x) => x.id)).toEqual([off.id, shopOff.id]);
    expect((await svc.timeoff(t, { staffId: bala.id })).map((x) => x.id)).toEqual([off.id]);
    expect((await svc.timeoff(t, { from: "2026-11-07" })).map((x) => x.id)).toEqual([]);
    expect(await code(svc.timeoff(t, { from: "2026-11-08", to: "2026-11-07" }))).toBe("zod");
    expect((await svc.timeoff(randomUUID(), {}))).toEqual([]);
    // Time off that is already over isn't listed by default.
    clock = new Date("2026-11-06T11:00:00Z");
    expect((await svc.timeoff(t)).map((x) => x.id)).toEqual([shopOff.id]);
    clock = NOW;

    expect((await svc.updateTimeoff(t, off.id, { to: iso(TOMORROW, "15:00") })).to).toEqual(ist(TOMORROW, "15:00"));
    expect(await code(svc.updateTimeoff(t, off.id, { to: iso(TOMORROW, "13:00") }))).toBe("zod");
    expect((await svc.updateTimeoff(t, off.id, { staffId: null, reason: null })).staffId).toBeNull();
    expect(await code(svc.updateTimeoff(randomUUID(), off.id, { reason: "x" }))).toBe("404:not_found");
    expect(await code(svc.updateTimeoff(t, off.id, { staffId: GHOST }))).toBe("404:not_found");
    expect(await code(svc.createTimeoff(t, { staffId: GHOST, from: iso(TOMORROW, "10:00"), to: iso(TOMORROW, "11:00") }))).toBe("404:not_found");
    expect(await code(svc.createTimeoff(t, { from: iso(TOMORROW, "11:00"), to: iso(TOMORROW, "11:00") }))).toBe("zod");
    expect(await code(svc.createTimeoff(t, { from: iso(TOMORROW, "11:00"), to: iso("2028-01-01", "11:00") }))).toBe("zod");
    await svc.deleteTimeoff(t, shopOff.id);
    expect(await code(svc.deleteTimeoff(t, shopOff.id))).toBe("404:not_found");
    expect(await code(svc.deleteTimeoff(randomUUID(), off.id))).toBe("404:not_found");

    // Removing a person removes their hours and time off with them.
    await svc.putHours(t, { staffId: bala.id, days: [{ weekday: 5, opens: "10:00", closes: "12:00" }] });
    await svc.createTimeoff(t, { staffId: bala.id, from: iso(TOMORROW, "10:00"), to: iso(TOMORROW, "11:00") });
    await svc.deleteStaff(t, bala.id);
    expect((await svc.hours(t)).staff).toEqual({});
    expect((await svc.timeoff(t, { staffId: bala.id }))).toEqual([]);
    expect(await code(svc.deleteStaff(t, bala.id))).toBe("404:not_found");
  });

  it("a person with appointments still to come can't be removed", async () => {
    const { t, haircut, asha } = await newShop();
    const a = await svc.create(t, { serviceIds: [haircut.id], staffId: asha.id, start: iso(TOMORROW, "11:00"), customerName: "Future" });
    expect(await code(svc.deleteStaff(t, asha.id))).toBe("409:staff_has_appointments");
    await svc.setStatus(t, a.id, { status: "cancelled", reason: "moved" });
    await svc.deleteStaff(t, asha.id);
    // A finished appointment from the past does not block removal either.
    const { t: t2, haircut: h2, asha: a2 } = await newShop();
    clock = new Date("2026-11-04T04:30:00Z");
    const past = await svc.create(t2, { serviceIds: [h2.id], staffId: a2.id, start: iso("2026-11-04", "11:00"), customerName: "Past" });
    await svc.setStatus(t2, past.id, { status: "no_show" });
    clock = NOW;
    await svc.deleteStaff(t2, a2.id);
    expect((await svc.get(t2, past.id)).staffName).toBeNull();
  });

  it("moves an appointment: clashes are refused, another day takes that day's next number, and the shop is told", async () => {
    const { t, haircut, asha, bala } = await newShop();
    const a = await svc.create(t, { serviceIds: [haircut.id], staffId: asha.id, start: iso(TOMORROW, "10:00"), customerName: "Movable" });
    const b = await svc.create(t, { serviceIds: [haircut.id], staffId: asha.id, start: iso(TOMORROW, "11:00"), customerName: "Blocker" });
    rescheduled.length = 0;
    expect(await code(svc.move(t, a.id, { start: iso(TOMORROW, "11:15") }))).toBe("409:slot_taken");
    // A move onto its own old time is not a clash with itself.
    const same = await svc.move(t, a.id, { start: iso(TOMORROW, "10:15") });
    expect(same.start).toEqual(ist(TOMORROW, "10:15"));
    expect(same.end).toEqual(ist(TOMORROW, "10:45"));
    expect(same.number).toBe(1);
    expect(rescheduled).toHaveLength(1);
    expect(rescheduled[0]!.previous).toEqual(ist(TOMORROW, "10:00"));
    // To another person (free) and another day (that day's first number).
    const moved = await svc.move(t, a.id, { start: iso("2026-11-07", "12:00"), staffId: bala.id });
    expect(moved).toMatchObject({ businessDate: "2026-11-07", number: 1, staffId: bala.id });
    expect((await svc.create(t, { serviceIds: [haircut.id], staffId: asha.id, start: iso("2026-11-07", "15:00"), customerName: "Next" })).number).toBe(2);
    // Unassign.
    expect((await svc.move(t, a.id, { start: iso("2026-11-07", "12:00"), staffId: null })).staffId).toBeNull();
    expect(await code(svc.move(t, a.id, { start: iso("2026-11-07", "12:00"), staffId: GHOST }))).toBe("400:bad_request");
    expect(await code(svc.move(t, a.id, { start: `2026-11-07T12:00:30+05:30` }))).toBe("400:bad_request");
    expect(await code(svc.move(t, a.id, { start: iso("2026-11-07", "23:45") }))).toBe("400:bad_request");
    expect(await code(svc.move(randomUUID(), a.id, { start: iso("2026-11-07", "12:00") }))).toBe("404:not_found");
    // Only booked or confirmed ones move.
    await svc.setStatus(t, b.id, { status: "in_service" });
    expect(await code(svc.move(t, b.id, { start: iso(TOMORROW, "16:00") }))).toBe("409:not_movable");
    await svc.setStatus(t, b.id, { status: "completed" });
    expect(await code(svc.move(t, b.id, { start: iso(TOMORROW, "16:00") }))).toBe("409:not_movable");
  });

  it("status follows the desk's flow; cancelling keeps the reason; nothing leaves a final status", async () => {
    const { t, haircut, asha } = await newShop();
    cancelled.length = 0;
    const a = await svc.create(t, { serviceIds: [haircut.id], staffId: asha.id, start: iso(TOMORROW, "10:00"), customerName: "Flow" });
    expect(await code(svc.setStatus(t, a.id, { status: "completed" }))).toBe("409:status_move");
    expect((await svc.setStatus(t, a.id, { status: "confirmed" })).status).toBe("confirmed");
    expect((await svc.setStatus(t, a.id, { status: "confirmed" })).status).toBe("confirmed"); // same again: fine
    expect((await svc.setStatus(t, a.id, { status: "arrived" })).nextStatuses).toEqual(["in_service", "cancelled", "no_show"]);
    expect((await svc.setStatus(t, a.id, { status: "in_service" })).nextStatuses).toEqual(["completed"]);
    expect(await code(svc.setStatus(t, a.id, { status: "cancelled" }))).toBe("409:status_move");
    expect(await code(svc.setStatus(t, a.id, { status: "nonsense" }))).toBe("zod");
    expect(await code(svc.setStatus(randomUUID(), a.id, { status: "completed" }))).toBe("404:not_found");
    expect((await svc.setStatus(t, a.id, { status: "completed" })).nextStatuses).toEqual([]);
    expect(await code(svc.setStatus(t, a.id, { status: "booked" }))).toBe("409:status_move");

    const c = await svc.create(t, { serviceIds: [haircut.id], staffId: asha.id, start: iso(TOMORROW, "12:00"), customerName: "Gone" });
    const done = await svc.setStatus(t, c.id, { status: "cancelled", reason: "  felt unwell " });
    expect(done).toMatchObject({ status: "cancelled", cancelReason: "felt unwell" });
    expect(cancelled).toEqual([{ by: "shop", reason: "felt unwell" }]);
    await svc.setStatus(t, c.id, { status: "cancelled" }); // repeating tells nobody twice
    expect(cancelled).toHaveLength(1);
    expect(await code(svc.setStatus(t, c.id, { status: "booked" }))).toBe("409:status_move");

    // Details can still be edited.
    const edited = await svc.update(t, a.id, { customerName: "Flow Two", customerPhone: "+91 98765 43210", notes: null });
    expect(edited).toMatchObject({ customerName: "Flow Two", customerPhone: "+91 98765 43210", notes: null });
    expect((await svc.update(t, a.id, {})).customerName).toBe("Flow Two");
    expect(await code(svc.update(t, a.id, { customerName: "" }))).toBe("zod");
    expect(await code(svc.update(randomUUID(), a.id, { notes: "x" }))).toBe("404:not_found");
    expect(await code(svc.get(randomUUID(), a.id))).toBe("404:not_found");
  });

  it("bills a started service: GST lines from the booking, tax-inclusive price kept exact, billed once", async () => {
    const { t, tenant, haircut, asha } = await newShop();
    const bridal = await svc.createService(t, { itemId: BRIDAL, durationMin: 120 });
    const a = await svc.create(t, { serviceIds: [haircut.id, bridal.id], staffId: asha.id, start: iso(TOMORROW, "10:00"), customerName: "Bride", customerPhone: "9876543210" });
    expect(await code(svc.bill(tenant, a.id, {}))).toBe("409:not_billable");
    await svc.setStatus(t, a.id, { status: "in_service" });
    bills.length = 0;
    const r = await svc.bill(tenant, a.id, {}, { branchId: null });
    expect(r.appointment).toMatchObject({ status: "completed", invoiceId: r.bill.id });
    expect(bills).toHaveLength(1);
    expect(bills[0]!.lines.map((l) => [l.description, l.rate, l.gstRate, l.inclusiveTotal])).toEqual([
      ["Haircut", 50_000, 18, null], // priced before GST: the bill adds it
      ["Bridal makeup", 550_847, 18, 650_000], // priced with GST included: the bill takes it out of 6,500.00 exactly
    ]);
    expect(bills[0]!.customer).toEqual({ name: "Bride", phone: "9876543210" });
    expect(bills[0]!.notes).toBe(`Appointment #1 · ${TOMORROW} 10:00 · Asha`);
    expect(await svc.bill(tenant, a.id, {}).catch((e) => e)).toMatchObject({ status: 409, code: "already_billed", details: { invoiceId: r.bill.id } });
    expect(await code(svc.bill({ ...tenant, id: randomUUID() }, a.id, {}))).toBe("404:not_found");

    // A different billing customer, and a failing bill leaves the appointment as it was.
    const b = await svc.create(t, { serviceIds: [haircut.id], staffId: asha.id, start: iso(TOMORROW, "13:30"), customerName: "Walk" });
    await svc.setStatus(t, b.id, { status: "in_service" });
    billingFails = true;
    expect(await code(svc.bill(tenant, b.id, { customer: { name: "Company" } }))).toContain("invoices down");
    billingFails = false;
    expect(await svc.get(t, b.id)).toMatchObject({ status: "in_service", invoiceId: null });
    await svc.bill(tenant, b.id, { customer: { name: "Company", phone: "98765" } });
    expect(bills.at(-1)!.customer).toEqual({ name: "Company", phone: "98765" });
    const bare = new BookingsService({ db, now: () => clock });
    expect(await code(bare.bill(tenant, b.id, {}))).toBe("501:billing_unavailable");
  });

  it("day calendar, list and summary: staff columns, working windows, time off, facets, filters and today's counts", async () => {
    const { t, haircut, beard, asha, bala } = await newShop();
    await svc.updateStaff(t, bala.id, { color: "#00ff00" });
    const mk = (date: string, hhmm: string, name: string, staff: string | null, phone = "9000000001", ids: string[] = [haircut.id]) =>
      svc.create(t, { serviceIds: ids, staffId: staff, start: iso(date, hhmm), customerName: name, customerPhone: phone });
    const a1 = await mk(TODAY, "15:00", "Today One", asha.id);
    const a2 = await mk(TODAY, "16:00", "Today Two", bala.id, "9000000002", [haircut.id, beard.id]);
    const a3 = await mk(TODAY, "17:00", "Today Three", asha.id, "9000000003");
    await svc.setStatus(t, a3.id, { status: "cancelled", reason: "x1" });
    const a4 = await mk(TOMORROW, "11:00", "Tomorrow", bala.id, "9000000004");
    await svc.createTimeoff(t, { staffId: bala.id, from: iso(TODAY, "10:00"), to: iso(TODAY, "12:00") });
    await svc.createTimeoff(t, { from: iso(TODAY, "17:30"), to: iso(TODAY, "20:00") });

    const day = await svc.day(t, {});
    expect(day).toMatchObject({ date: TODAY, weekday: 4 });
    expect(day.staff.map((s) => s.name)).toEqual(["Asha", "Bala"]);
    expect(day.appointments.map((a) => a.customerName)).toEqual(["Today One", "Today Two", "Today Three"]); // cancelled ones stay on the calendar
    expect(day.windows.shop).toEqual([{ from: 600, to: 780 }, { from: 840, to: 1080 }]);
    expect(day.timeoff).toEqual({ [bala.id]: [{ from: 600, to: 720 }], shop: [{ from: 1050, to: 1200 }] });
    expect(day.appointments[1]!.items.map((i) => i.name)).toEqual(["Haircut", "Beard trim"]);
    expect((await svc.day(t, { date: TOMORROW })).appointments.map((a) => a.id)).toEqual([a4.id]);
    expect(await code(svc.day(t, { date: "nope" }))).toBe("zod");
    expect((await svc.day(randomUUID(), {})).appointments).toEqual([]);
    // A switched-off person with an appointment that day stays on the calendar, with no working hours.
    await svc.updateStaff(t, bala.id, { active: false });
    const d2 = await svc.day(t, {});
    expect(d2.staff.map((s) => s.name)).toEqual(["Asha", "Bala"]);
    expect(d2.windows.staff[bala.id]).toEqual([]);
    expect((await svc.day(t, { date: "2026-11-07" })).staff.map((s) => s.name)).toEqual(["Asha"]);
    await svc.updateStaff(t, bala.id, { active: true });

    const all = await svc.list(t, { limit: "10" });
    expect(all.total).toBe(4);
    expect(all.items.map((a) => a.customerName)).toEqual(["Today One", "Today Two", "Today Three", "Tomorrow"]);
    expect(all.items[1]).toMatchObject({ services: "Haircut, Beard trim", amount: 70_000, staffName: "Bala", staffColor: "#00ff00" });
    expect(all.items[0]).not.toHaveProperty("manageToken");
    expect(all.facets.status).toEqual({ booked: 3, cancelled: 1 });
    const booked = await svc.list(t, { status: "booked", staffId: bala.id });
    expect(booked.items.map((a) => a.id).sort()).toEqual([a2.id, a4.id].sort());
    expect(booked.facets.status).toEqual({ booked: 2 }); // facets ignore the status filter but keep the person filter
    expect((await svc.list(t, { q: "9000000003" })).items.map((a) => a.customerName)).toEqual(["Today Three"]);
    expect((await svc.list(t, { q: "tomorrow" })).total).toBe(1);
    expect((await svc.list(t, { from: TOMORROW })).items.map((a) => a.id)).toEqual([a4.id]);
    expect((await svc.list(t, { to: TODAY })).total).toBe(3);
    expect((await svc.list(t, { source: "online" })).total).toBe(0);
    expect((await svc.list(t, { when: "upcoming" })).total).toBe(4);
    expect((await svc.list(t, { when: "" })).total).toBe(4);
    expect(await code(svc.list(t, { when: "sometime" }))).toBe("zod");
    expect((await svc.list(t, { limit: "2", offset: "3" })).items.map((a) => a.customerName)).toEqual(["Tomorrow"]);
    expect((await svc.list(randomUUID(), {})).total).toBe(0);
    // After the day is over, the afternoon ones are "past".
    clock = new Date("2026-11-05T13:00:00Z"); // 18:30
    expect((await svc.list(t, { when: "past" })).total).toBe(3);
    expect((await svc.list(t, { when: "upcoming" })).items.map((a) => a.id)).toEqual([a4.id]);
    clock = NOW;

    // Today's count leaves out cancelled and no-shows; the next few to come are the ones still ahead.
    const sum = await svc.summary(t);
    expect(sum).toMatchObject({ date: TODAY, today: 2, byStatus: { booked: 2, cancelled: 1 } });
    expect(sum.upcoming.map((a) => a.id)).toEqual([a1.id, a2.id, a4.id]);
    expect((await svc.summary(randomUUID())).today).toBe(0);
  });

  it("online booking: the customer sees services with prices, books a free slot, and cancels from their own link", async () => {
    const { t, haircut, beard, bala } = await newShop();
    const bridal = await svc.createService(t, { itemId: BRIDAL, durationMin: 120, onlineBookable: false });
    void bridal;
    await svc.updateService(t, beard.id, { sort: 1 });
    expect((await svc.publicServices(t)).map((s) => [s.name, s.price])).toEqual([["Haircut", 59_000], ["Beard trim", 21_000]]);
    const staff = await svc.publicStaff(t);
    expect(staff.map((s) => [s.name, s.serviceIds.length])).toEqual([["Asha", 2], ["Bala", 1]]);
    expect(staff[1]!.serviceIds).toEqual([haircut.id]);
    expect((await svc.publicSlots(t, { date: TOMORROW, serviceIds: haircut.id })).slots.map((s) => s.time).slice(0, 2)).toEqual(["10:00", "10:15"]);
    expect(await svc.publicServices(randomUUID())).toEqual([]);

    notices.length = 0;
    const booked = await svc.publicBook(t, { serviceIds: [haircut.id, beard.id], staffId: null, start: iso(TOMORROW, "11:00"), name: "Karthik", phone: "9876543210" });
    expect(booked.number).toBe(1);
    // Haircut 590.00 + beard trim 210.00 = 800.00, GST included.
    expect(booked.appointment).toMatchObject({ status: "booked", customerName: "Karthik", total: 80_000, canCancel: true, staffName: "Asha" });
    expect(booked.appointment.services).toEqual([{ name: "Haircut", durationMin: 30, price: 59_000 }, { name: "Beard trim", durationMin: 15, price: 21_000 }]);
    expect(booked.appointment.cancelUntil).toEqual(ist(TOMORROW, "09:00")); // 2 hours before the start
    expect(notices).toContain("booked:1");
    const row = (await svc.list(t, {})).items[0]!;
    expect(row.source).toBe("online");

    // Not for online: the Bridal service, a too-near start, a too-far day, a taken slot, bad input.
    expect(await code(svc.publicBook(t, { serviceIds: [bridal.id], start: iso(TOMORROW, "12:00"), name: "X", phone: "9876543210" }))).toBe("400:bad_request");
    expect(await code(svc.publicBook(t, { serviceIds: [haircut.id], start: iso(TODAY, "10:30"), name: "X", phone: "9876543210" }))).toBe("409:slot_taken"); // under an hour's notice
    expect(await code(svc.publicBook(t, { serviceIds: [haircut.id], start: iso("2027-01-05", "11:00"), name: "X", phone: "9876543210" }))).toBe("400:bad_request");
    expect(await code(svc.publicBook(t, { serviceIds: [haircut.id], start: iso(TOMORROW, "11:05"), name: "X", phone: "9876543210" }))).toBe("409:slot_taken"); // off the 15-minute grid
    expect(await code(svc.publicBook(t, { serviceIds: [haircut.id], start: iso(TOMORROW, "13:00"), name: "X", phone: "9876543210" }))).toBe("409:slot_taken"); // lunch
    expect(await code(svc.publicBook(t, { serviceIds: [haircut.id], start: iso(TOMORROW, "12:00"), name: "X", phone: "12" }))).toBe("zod");
    // Choosing Bala for a haircut at 11:00 works (he is free); choosing him again does not.
    expect((await svc.publicBook(t, { serviceIds: [haircut.id], staffId: bala.id, start: iso(TOMORROW, "11:00"), name: "Lata", phone: "9876543211" })).appointment.staffName).toBe("Bala");
    expect(await code(svc.publicBook(t, { serviceIds: [haircut.id], staffId: bala.id, start: iso(TOMORROW, "11:00"), name: "Late", phone: "9876543212" }))).toBe("409:slot_taken");

    // The customer's own link.
    const token = booked.manageToken;
    expect((await svc.publicAppointment(t, token)).customerName).toBe("Karthik");
    expect(await code(svc.publicAppointment(randomUUID(), token))).toBe("404:not_found"); // another shop's host
    expect(await code(svc.publicAppointment(t, "short"))).toBe("404:not_found");
    expect(await code(svc.publicAppointment(t, "x".repeat(24)))).toBe("404:not_found");
    expect(await code(svc.publicAppointment(t, "bad token with spaces!"))).toBe("404:not_found");
    cancelled.length = 0;
    const gone = await svc.publicCancel(t, token);
    expect(gone).toMatchObject({ status: "cancelled", canCancel: false });
    expect(cancelled).toEqual([{ by: "customer", reason: null }]);
    expect((await svc.publicCancel(t, token)).status).toBe("cancelled"); // repeating is harmless
    expect(cancelled).toHaveLength(1);
    expect(await code(svc.publicCancel(randomUUID(), token))).toBe("404:not_found");
    // The freed slot can be booked again.
    expect((await svc.publicBook(t, { serviceIds: [haircut.id, beard.id], start: iso(TOMORROW, "11:00"), name: "Again", phone: "9876543213" })).number).toBeGreaterThan(2);
  });

  it("a customer can't cancel online close to the start; the shop can still do it", async () => {
    const { t, haircut } = await newShop();
    // 11:00 today is 90 minutes away (less than the 2 hours' notice).
    const near = await svc.publicBook(t, { serviceIds: [haircut.id], start: iso(TODAY, "11:30"), name: "Near", phone: "9876543210" });
    expect(near.appointment.canCancel).toBe(false);
    expect(await svc.publicCancel(t, near.manageToken).catch((e) => e)).toMatchObject({ status: 409, code: "too_late" });
    expect((await svc.publicAppointment(t, near.manageToken)).status).toBe("booked");
    // Exactly two hours before is still allowed.
    const edge = await svc.publicBook(t, { serviceIds: [haircut.id], start: iso(TODAY, "12:00"), name: "Edge", phone: "9876543211" });
    expect(edge.appointment.canCancel).toBe(true);
    expect((await svc.publicCancel(t, edge.manageToken)).status).toBe("cancelled");
    // Once the service has started, the link no longer cancels.
    const started = await svc.publicBook(t, { serviceIds: [haircut.id], start: iso(TOMORROW, "12:00"), name: "Started", phone: "9876543212" });
    await svc.setStatus(t, (await svc.list(t, { q: "Started" })).items[0]!.id, { status: "in_service" });
    expect(await code(svc.publicCancel(t, started.manageToken))).toBe("409:too_late");
  });

  it("a notifier that fails never stops a booking; the failure is logged", async () => {
    const { t, haircut } = await newShop();
    notifyFails = true;
    warns.length = 0;
    const a = await svc.create(t, { serviceIds: [haircut.id], staffId: "any", start: iso(TOMORROW, "11:00"), customerName: "Quiet" });
    notifyFails = false;
    expect(a.number).toBe(1);
    expect(warns).toContain("bookings: booked notice failed");
    // A shop without any notifier is fine too.
    const silent = new BookingsService({ db, now: () => clock, prices: { items: async (_t, ids) => PRICES.filter((p) => ids.includes(p.id)) } });
    expect((await silent.create(t, { serviceIds: [haircut.id], staffId: "any", start: iso(TOMORROW, "12:00"), customerName: "Silent" })).number).toBe(2);
  });

  it("the reminder feed lists booked and confirmed appointments starting in a window, across shops, soonest first", async () => {
    const one = await newShop();
    const two = await newShop();
    const mk = (s: typeof one, hhmm: string, name: string) => svc.create(s.t, { serviceIds: [s.haircut.id], staffId: "any", start: iso("2026-12-01", hhmm), customerName: name, customerPhone: "9000000009" });
    const a = await mk(one, "11:00", "Later One");
    const b = await mk(two, "10:30", "Earlier Two");
    const c = await mk(one, "12:00", "Cancelled");
    await svc.setStatus(one.t, c.id, { status: "cancelled" });
    const d = await mk(two, "14:00", "Confirmed");
    await svc.setStatus(two.t, d.id, { status: "confirmed" });
    const e = await mk(two, "15:00", "Started");
    await svc.setStatus(two.t, e.id, { status: "in_service" });

    const list = await svc.remindable(ist("2026-12-01", "00:00"), ist("2026-12-01", "23:59"));
    expect(list.map((x) => [x.customer.name, x.tenantId === one.t ? "one" : "two"])).toEqual([["Earlier Two", "two"], ["Later One", "one"], ["Confirmed", "two"]]);
    expect(list[0]).toMatchObject({ number: 1, status: "booked", source: "staff", services: ["Haircut"], customer: { name: "Earlier Two", phone: "9000000009" }, manageToken: b.manageToken });
    expect(list[0]!.createdAt).toBeInstanceOf(Date);
    // The window is (from, to]: an appointment starting exactly at `from` is left out, one exactly at `to` is in.
    expect((await svc.remindable(ist("2026-12-01", "10:30"), ist("2026-12-01", "11:00"))).map((x) => x.customer.name)).toEqual(["Later One"]);
    expect((await svc.remindable(ist("2026-12-01", "00:00"), ist("2026-12-01", "23:59"), 1)).map((x) => x.customer.name)).toEqual(["Earlier Two"]);
    expect(await svc.remindable(ist("2026-12-02", "00:00"), ist("2026-12-03", "00:00"))).toEqual([]);
    void a;
  });

  describe("routes", () => {
    let app: FastifyInstance;
    let ctx: RequestContext;
    const who = (roles: string[], tenant: string | null): RequestContext =>
      ({ ...emptyContext(), tenant: tenant ? { id: tenant, slug: "t", planId: "pro", appId: "BL" } : null, user: roles.length ? { id: "22222222-2222-4222-8222-222222222222", sessionId: "s", platformRoles: [], tenantRoles: roles } : null }) as RequestContext;
    beforeAll(async () => {
      app = Fastify();
      app.decorateRequest("ctx", null as never);
      app.addHook("onRequest", async (req) => {
        req.ctx = ctx;
      });
      app.setErrorHandler((err: { status?: number; statusCode?: number; message: string }, _req, reply) => {
        reply.status(err.status ?? (err instanceof ZodError ? 400 : (err.statusCode ?? 500))).send({ error: err.message });
      });
      await app.register(bookingsRoutes(svc), { prefix: "/v1/bookings" });
    });
    afterAll(() => app?.close());
    const call = (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, payload?: object) => app.inject({ method, url: `/v1/bookings${url}`, ...(payload ? { payload } : {}) });

    it("staff run the desk over HTTP; guests use the booking page with no sign-in; one shop's links don't work in another", async () => {
      const t = randomUUID();
      ctx = who(["owner"], t);
      const cut = (await call("POST", "/services", { itemId: HAIR, durationMin: 30 })).json();
      expect(cut).toMatchObject({ name: "Haircut" });
      const staff = (await call("POST", "/staff", { name: "Asha" })).json();
      expect((await call("PUT", "/hours", { days: week })).json().shop).toHaveLength(7);
      expect((await call("GET", "/hours")).json().shop).toHaveLength(7);
      expect((await call("GET", `/availability?date=${TOMORROW}&serviceIds=${cut.id}&staffId=${staff.id}`)).json().slots).toHaveLength(26); // 30-minute service, no clean-up: 10:00-12:30 (11) + 14:00-17:30 (15)
      const made = await call("POST", "/appointments", { serviceIds: [cut.id], staffId: staff.id, start: iso(TOMORROW, "10:00"), customerName: "Route Guest" });
      expect(made.statusCode).toBe(200);
      const appt = made.json();
      expect(appt).toMatchObject({ number: 1, createdBy: "22222222-2222-4222-8222-222222222222", amount: 50_000 });
      expect((await call("POST", "/appointments", { serviceIds: [cut.id], staffId: staff.id, start: iso(TOMORROW, "10:00"), customerName: "Clash" })).statusCode).toBe(409);
      expect((await call("GET", `/appointments/${appt.id}`)).json().customerName).toBe("Route Guest");
      expect((await call("GET", "/appointments/not-a-uuid")).statusCode).toBe(404);
      expect((await call("PATCH", `/appointments/${appt.id}`, { notes: "ring first" })).json().notes).toBe("ring first");
      expect((await call("POST", `/appointments/${appt.id}/move`, { start: iso(TOMORROW, "11:00") })).json().start).toBe(ist(TOMORROW, "11:00").toISOString());
      expect((await call("POST", `/appointments/${appt.id}/status`, { status: "in_service" })).json().status).toBe("in_service");
      expect((await call("POST", `/appointments/${appt.id}/bill`, {})).json().appointment.status).toBe("completed");
      expect((await call("GET", "/appointments?status=completed")).json().total).toBe(1);
      expect((await call("GET", `/day?date=${TOMORROW}`)).json().appointments).toHaveLength(1);
      expect((await call("GET", "/summary")).json()).toMatchObject({ date: TODAY });
      expect((await call("GET", "/services?all=1")).json().items).toHaveLength(1);
      expect((await call("GET", "/staff")).json().items).toHaveLength(1);
      const off = (await call("POST", "/timeoff", { from: iso(TOMORROW, "14:00"), to: iso(TOMORROW, "15:00") })).json();
      expect((await call("GET", `/timeoff?from=${TOMORROW}&to=${TOMORROW}`)).json().items).toHaveLength(1);
      expect((await call("PATCH", `/timeoff/${off.id}`, { reason: "Meeting" })).json().reason).toBe("Meeting");
      expect((await call("DELETE", `/timeoff/${off.id}`)).json()).toEqual({ ok: true });
      expect((await call("PATCH", `/staff/${staff.id}`, { color: "#112233" })).json().color).toBe("#112233");
      expect((await call("PATCH", `/services/${cut.id}`, { bufferMin: 5 })).json().bufferMin).toBe(5);

      // Guests: tenant from the host, no user.
      ctx = who([], t);
      expect((await call("GET", "/public/services")).json().items[0]).toMatchObject({ name: "Haircut", price: 59_000 });
      expect((await call("GET", "/public/staff")).json().items[0].name).toBe("Asha");
      expect((await call("GET", `/public/slots?date=${TOMORROW}&serviceIds=${cut.id}`)).json().slots.length).toBeGreaterThan(0);
      const pb = await call("POST", "/public/appointments", { serviceIds: [cut.id], start: iso(TOMORROW, "16:00"), name: "Online Guest", phone: "9876500000" });
      expect(pb.statusCode).toBe(200);
      const token = pb.json().manageToken;
      expect((await call("GET", `/public/appointments/${token}`)).json()).toMatchObject({ customerName: "Online Guest", canCancel: true });
      // The same link on another shop's host finds nothing.
      ctx = who([], randomUUID());
      expect((await call("GET", `/public/appointments/${token}`)).statusCode).toBe(404);
      expect((await call("POST", `/public/appointments/${token}/cancel`)).statusCode).toBe(404);
      ctx = who([], t);
      expect((await call("GET", `/public/appointments/short`)).statusCode).toBe(400);
      expect((await call("POST", `/public/appointments/${token}/cancel`)).json().status).toBe("cancelled");
      // Guests cannot reach the desk.
      expect((await call("GET", "/appointments")).statusCode).toBe(401);
      // A customer role (no staff role) cannot either; another shop's staff sees nothing of this shop.
      ctx = who(["customer"], t);
      expect((await call("GET", "/appointments")).statusCode).toBe(403);
      ctx = who(["staff"], randomUUID());
      expect((await call("GET", "/appointments")).json().total).toBe(0);
      expect((await call("GET", `/appointments/${appt.id}`)).statusCode).toBe(404);
    });
  });
});
