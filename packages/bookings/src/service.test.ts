import { AppError } from "@srirealtime/core";
import { createDb } from "@srirealtime/db";
import { afterAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { bookingAppointments } from "./schema";
import { APPOINTMENT_SORT, appointmentInput, appointmentListQuery, availabilityQuery, BookingsService, hoursInput, publicBookingInput, timeoffInput } from "./service";

// Never connects: only renders SQL.
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const T = "11111111-1111-4111-8111-111111111111";
const S1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const S2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const svc = new BookingsService({ db, now: () => new Date("2026-10-20T04:30:00Z") });
const where = (q: Record<string, unknown>, withStatus = true) =>
  db.select().from(bookingAppointments).where(svc.listConditions(T, appointmentListQuery.parse(q), withStatus)).toSQL();

describe("appointment list query", () => {
  it("pages, splits comma lists and rejects bad values", () => {
    expect(appointmentListQuery.parse({}).limit).toBe(25);
    expect(() => appointmentListQuery.parse({ limit: "101" })).toThrow(ZodError);
    const p = appointmentListQuery.parse({ status: "booked,confirmed", staffId: `${S1},${S2}`, when: "upcoming" });
    expect(p.status).toEqual(["booked", "confirmed"]);
    expect(p.staffId).toEqual([S1, S2]);
    expect(appointmentListQuery.parse({ when: "" }).when).toBeUndefined();
    expect(() => appointmentListQuery.parse({ status: "lost" })).toThrow(ZodError);
    expect(() => appointmentListQuery.parse({ from: "2026-10-02", to: "2026-10-01" })).toThrow(ZodError);
  });

  it("always filters by tenant and drops status for the facet counts", () => {
    const q = where({ status: "booked", when: "upcoming", q: "meena" });
    expect(q.sql).toContain('"booking_appointments"."tenant_id" = $');
    expect(q.sql).toContain('"booking_appointments"."status" in ($');
    expect(q.sql).toContain('"booking_appointments"."end" >= $');
    expect(q.sql).toContain("ilike");
    expect(q.params).toContain(T);
    expect(where({ status: "booked" }, false).sql).not.toContain('"status" in');
  });

  it("sorts by known keys only", () => {
    expect(APPOINTMENT_SORT.keys).toEqual(expect.arrayContaining(["start", "number", "customer", "status", "created"]));
    expect(() => APPOINTMENT_SORT.orderBy("price")).toThrow(AppError);
    expect(APPOINTMENT_SORT.orderBy("-start").length).toBe(2);
  });
});

describe("inputs", () => {
  it("reads availability params", () => {
    const q = availabilityQuery.parse({ date: "2026-10-21", serviceIds: `${S1},${S2}` });
    expect(q.serviceIds).toEqual([S1, S2]);
    expect(q.staffId).toBe("any");
    expect(() => availabilityQuery.parse({ date: "2026-02-30", serviceIds: S1 })).toThrow(ZodError);
    expect(() => availabilityQuery.parse({ date: "2026-10-21" })).toThrow(ZodError);
  });

  it("validates bookings", () => {
    const a = appointmentInput.parse({ serviceIds: [S1], start: "2026-10-21T10:00:00+05:30", customerName: " Meena " });
    expect(a.start.toISOString()).toBe("2026-10-21T04:30:00.000Z");
    expect(a.staffId).toBe("any");
    expect(a.customerName).toBe("Meena");
    expect(appointmentInput.parse({ serviceIds: [S1], staffId: null, start: "2026-10-21T04:30:00Z", customerName: "M" }).staffId).toBeNull();
    expect(() => appointmentInput.parse({ serviceIds: [], start: "2026-10-21T04:30:00Z", customerName: "M" })).toThrow(ZodError);
    expect(() => publicBookingInput.parse({ serviceIds: [S1], start: "2026-10-21T04:30:00Z", name: "M", phone: "abc" })).toThrow(ZodError);
    expect(publicBookingInput.parse({ serviceIds: [S1], start: "2026-10-21T04:30:00Z", name: "M", phone: "+91 98400 12345" }).staffId).toBeNull();
  });

  it("validates weekly hours", () => {
    const ok = hoursInput.parse({ days: [{ weekday: 1, opens: "09:00", closes: "18:00", breaks: [{ from: "13:00", to: "14:00" }] }] });
    expect(ok.staffId).toBeNull();
    expect(() => hoursInput.parse({ days: [{ weekday: 1, opens: "18:00", closes: "09:00" }] })).toThrow(ZodError);
    expect(() =>
      hoursInput.parse({
        days: [
          { weekday: 1, opens: "09:00", closes: "18:00" },
          { weekday: 1, opens: "10:00", closes: "18:00" },
        ],
      }),
    ).toThrow(ZodError);
  });

  it("validates time off", () => {
    expect(() => timeoffInput.parse({ from: "2026-10-21T10:00:00Z", to: "2026-10-21T09:00:00Z" })).toThrow(ZodError);
    expect(timeoffInput.parse({ from: "2026-10-21T00:00:00+05:30", to: "2026-10-22T00:00:00+05:30" }).staffId).toBeNull();
  });
});
