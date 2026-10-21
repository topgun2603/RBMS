import { randomBytes } from "node:crypto";
import {
  AppError,
  badRequest,
  conflict,
  defineSort,
  facetCounts,
  listFilter,
  listQuerySchema,
  notFound,
  rangeOrder,
  runList,
  searchAny,
  splitList,
  type ListPage,
  type TenantRef,
} from "@srirealtime/core";
import type { Db, Tx } from "@srirealtime/db";
import { isValidDate, todayIST } from "@srirealtime/gst";
import { and, asc, count, eq, gt, gte, inArray, isNull, lt, lte, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  appointmentBusy,
  canBill,
  canCustomerCancel,
  canMoveStatus,
  canReschedule,
  clipToDay,
  DAY_MIN,
  daysBetween,
  DEFAULT_STEP_MIN,
  earliestStart,
  formatHHMM,
  freeStarts,
  hoursError,
  hoursWindows,
  istDateOf,
  istDayRange,
  istInstant,
  istMinuteOf,
  istWeekday,
  mergeAnyStaff,
  nextStatuses,
  overlaps,
  priceWithGst,
  serviceTotals,
  staffDoes,
  workingWindows,
  type AnySlot,
  type DayHours,
  type Interval,
} from "./logic";
import {
  noopLogger,
  type BillingPort,
  type BillResult,
  type BookingNotice,
  type LoggerPort,
  type NotifyPort,
  type RemindableAppointment,
  type ServicePricePort,
} from "./ports";
import {
  APPOINTMENT_SOURCES,
  APPOINTMENT_STATUSES,
  BLOCKING_STATUSES,
  bookingAppointmentItems,
  bookingAppointments,
  bookingHours,
  bookingServices,
  bookingStaff,
  bookingTimeoff,
  type AppointmentSource,
  type AppointmentStatus,
  type BookingAppointmentItemRow,
  type BookingAppointmentRow,
  type BookingHoursRow,
  type BookingServiceRow,
  type BookingStaffRow,
  type BookingTimeoffRow,
} from "./schema";

/** Shop-wide booking rules. Defaults in brackets. */
export interface BookingsConfig {
  /** Slot grid in minutes [15]. */
  stepMin?: number;
  /** Minimum notice for online bookings, minutes [60]. */
  onlineLeadMin?: number;
  /** How far ahead customers may book online, days [60]. */
  horizonDays?: number;
  /** Customers may cancel online until this many minutes before the start [120]. */
  cancelBeforeMin?: number;
}

export interface BookingsDeps {
  db: Db;
  /** Catalogue rates for services; without it services are booked at ₹0 (development only). */
  prices?: ServicePricePort;
  billing?: BillingPort;
  notify?: NotifyPort;
  log?: LoggerPort;
  config?: BookingsConfig;
  now?: () => Date;
}

const MIN_MS = 60_000;
const DEFAULT_COLOR = "#6366f1";

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const dateStr = z.string().refine(isValidDate, "Use a YYYY-MM-DD date");
const instant = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s));
const hhmm = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM");
const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 -]{5,18}$/, "Enter a valid phone number");
const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a #rrggbb colour")
  .transform((s) => s.toLowerCase());
const sortNum = z.number().int().min(0).max(10_000);
const serviceIdList = z.array(z.string().uuid()).min(1).max(10);

export const serviceInput = z
  .object({
    itemId: z.string().uuid(),
    /** Leave out to take the catalogue item's name. */
    name: z.string().trim().min(1).max(120).optional(),
    durationMin: z.number().int().min(5).max(720),
    bufferMin: z.number().int().min(0).max(240).default(0),
    active: z.boolean().default(true),
    onlineBookable: z.boolean().default(true),
    sort: sortNum.default(0),
  })
  .strict();
export type ServiceInput = z.input<typeof serviceInput>;

export const servicePatch = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    durationMin: z.number().int().min(5).max(720).optional(),
    bufferMin: z.number().int().min(0).max(240).optional(),
    active: z.boolean().optional(),
    onlineBookable: z.boolean().optional(),
    sort: sortNum.optional(),
  })
  .strict();

export const staffInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    userId: z.string().uuid().nullish(),
    active: z.boolean().default(true),
    color: color.default(DEFAULT_COLOR),
    /** Catalogue item ids of the services they do; empty = all. */
    serviceItemIds: z.array(z.string().uuid()).max(500).default([]),
    sort: sortNum.default(0),
  })
  .strict();
export type StaffInput = z.input<typeof staffInput>;

export const staffPatch = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    userId: z.string().uuid().nullish(),
    active: z.boolean().optional(),
    color: color.optional(),
    serviceItemIds: z.array(z.string().uuid()).max(500).optional(),
    sort: sortNum.optional(),
  })
  .strict();

const dayInput = z
  .object({
    weekday: z.number().int().min(0).max(6),
    opens: hhmm,
    closes: hhmm,
    breaks: z
      .array(z.object({ from: hhmm, to: hhmm }).strict())
      .max(6)
      .default([]),
  })
  .strict();

/** Replaces the weekly hours of the shop (`staffId` null) or one staff member. Days left out are closed. */
export const hoursInput = z
  .object({ staffId: z.string().uuid().nullable().default(null), days: z.array(dayInput).max(7) })
  .strict()
  .superRefine((v, ctx) => {
    const seen = new Set<number>();
    v.days.forEach((d, i) => {
      if (seen.has(d.weekday)) ctx.addIssue({ code: "custom", path: ["days", i, "weekday"], message: "Each weekday once" });
      seen.add(d.weekday);
      const err = hoursError(d);
      if (err) ctx.addIssue({ code: "custom", path: ["days", i], message: err });
    });
  });
export type HoursInput = z.input<typeof hoursInput>;

const MAX_TIMEOFF_MS = 366 * 86_400_000;
export const timeoffInput = z
  .object({ staffId: z.string().uuid().nullable().default(null), from: instant, to: instant, reason: optText(200) })
  .strict()
  .refine((v) => v.to > v.from, { message: "Must end after it starts", path: ["to"] })
  .refine((v) => v.to.getTime() - v.from.getTime() <= MAX_TIMEOFF_MS, { message: "At most a year at a time", path: ["to"] });
export type TimeoffInput = z.input<typeof timeoffInput>;

export const timeoffPatch = z.object({ staffId: z.string().uuid().nullable().optional(), from: instant.optional(), to: instant.optional(), reason: optText(200) }).strict();

export const timeoffQuery = z
  .object({ from: dateStr.optional(), to: dateStr.optional(), staffId: z.string().uuid().optional() })
  .superRefine(rangeOrder("from", "to"));

/** GET /availability: `date`, `serviceIds` (comma list), `staffId` (uuid or "any", default any). */
export const availabilityQuery = z.object({
  date: dateStr,
  serviceIds: z.preprocess(splitList, serviceIdList),
  staffId: z.union([z.literal("any"), z.string().uuid()]).default("any"),
});
export type AvailabilityQuery = z.input<typeof availabilityQuery>;

export const appointmentInput = z
  .object({
    serviceIds: serviceIdList,
    /** A staff member, "any" (the least busy free one) or null (not assigned yet). */
    staffId: z.union([z.literal("any"), z.string().uuid()]).nullable().default("any"),
    start: instant,
    customerName: z.string().trim().min(1).max(120),
    customerPhone: phone.nullish().transform((v) => v ?? null),
    customerId: z.string().uuid().nullish(),
    notes: optText(1000),
  })
  .strict();
export type AppointmentInput = z.input<typeof appointmentInput>;

/** POST /public/appointments: the customer's own booking. `staffId` null = anyone. */
export const publicBookingInput = z
  .object({
    serviceIds: serviceIdList,
    staffId: z.string().uuid().nullable().default(null),
    start: instant,
    name: z.string().trim().min(1).max(120),
    phone,
    notes: optText(500),
  })
  .strict();
export type PublicBookingInput = z.input<typeof publicBookingInput>;

export const appointmentPatch = z
  .object({
    customerName: z.string().trim().min(1).max(120).optional(),
    customerPhone: phone.nullish(),
    customerId: z.string().uuid().nullish(),
    notes: optText(1000),
  })
  .strict();

/** New time and/or person; `staffId` left out = keep, null = unassign. */
export const moveInput = z.object({ start: instant, staffId: z.string().uuid().nullable().optional() }).strict();
export const statusInput = z.object({ status: z.enum(APPOINTMENT_STATUSES), reason: optText(200) }).strict();

export const billInput = z
  .object({
    customer: z.object({ name: z.string().trim().min(1).max(120), phone: optText(20) }).nullish(),
    tillSessionId: z.string().uuid().nullish(),
  })
  .strict();
export type BillInput = z.input<typeof billInput>;

export const dayQuery = z.object({ date: dateStr.optional() });

/** GET /appointments: `when` (upcoming | past), `status`, `source`, `staffId` (comma lists), `from`/`to` days, `q`. */
export const appointmentListQuery = listQuerySchema()
  .extend({
    when: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["upcoming", "past"]).optional()),
    status: listFilter.oneOf(APPOINTMENT_STATUSES),
    source: listFilter.oneOf(APPOINTMENT_SOURCES),
    staffId: listFilter.ids(),
    from: listFilter.date(),
    to: listFilter.date(),
  })
  .superRefine(rangeOrder("from", "to"));
export type AppointmentListQuery = z.input<typeof appointmentListQuery>;

export const APPOINTMENT_SORT = defineSort(
  {
    start: bookingAppointments.start,
    number: bookingAppointments.number,
    customer: sql`lower(${bookingAppointments.customerName})`,
    status: bookingAppointments.status,
    created: bookingAppointments.createdAt,
  },
  { default: "start", tieBreaker: [bookingAppointments.id] },
);

export interface ServiceView extends BookingServiceRow {
  /** Catalogue rate, GST-exclusive paise; null when the item is gone. */
  rate: number | null;
  gstRate: number | null;
}

export interface DayRow {
  weekday: number;
  opens: string;
  closes: string;
  breaks: { from: string; to: string }[];
}

export interface HoursView {
  shop: DayRow[];
  /** Only staff with their own hours; the rest follow the shop. */
  staff: Record<string, DayRow[]>;
}

export interface AppointmentView extends BookingAppointmentRow {
  staffName: string | null;
  staffColor: string | null;
  items: BookingAppointmentItemRow[];
  durationMin: number;
  /** Σ service rates, GST-exclusive paise. */
  amount: number;
  /** Status moves the desk can make now. */
  nextStatuses: AppointmentStatus[];
}

export interface AppointmentSummary extends Omit<BookingAppointmentRow, "manageToken"> {
  staffName: string | null;
  staffColor: string | null;
  /** "Haircut, Beard trim". */
  services: string | null;
  amount: number;
}

export interface Slot {
  start: Date;
  end: Date;
  /** "HH:MM" IST. */
  time: string;
  /** Who it goes to ("any": the least busy free person); null = the shop without staff, or unassigned. */
  staffId: string | null;
  staffIds: (string | null)[];
}

export interface Availability {
  date: string;
  durationMin: number;
  bufferMin: number;
  slots: Slot[];
}

export interface DayView {
  date: string;
  weekday: number;
  /** Staff on the calendar: everyone active, plus anyone switched off who still has appointments that day. */
  staff: BookingStaffRow[];
  /** Working minutes of the day (IST): the shop's, and each staff member's. */
  windows: { shop: Interval[]; staff: Record<string, Interval[]> };
  /** Time off on the day, in minutes: `shop` for the whole shop, else per staff id. */
  timeoff: Record<string, Interval[]>;
  appointments: AppointmentView[];
}

export interface BookingsSummary {
  date: string;
  /** Today's appointments, not counting cancelled and no-shows. */
  today: number;
  byStatus: Partial<Record<AppointmentStatus, number>>;
  /** The next few still to come (booked → in service), soonest first. */
  upcoming: AppointmentView[];
}

/** What the customer sees on their booking link. */
export interface PublicAppointment {
  number: number;
  date: string;
  start: Date;
  end: Date;
  status: AppointmentStatus;
  staffName: string | null;
  services: { name: string; durationMin: number; price: number }[];
  /** GST-inclusive paise. */
  total: number;
  customerName: string;
  notes: string | null;
  canCancel: boolean;
  cancelUntil: Date;
}

interface DayContext {
  date: string;
  shop: DayHours | null;
  /** Active staff, in calendar order. */
  staff: BookingStaffRow[];
  /** Staff with their own weekly hours → that day's hours (null = off); missing = follows the shop. */
  staffHours: Map<string, DayHours | null>;
  timeoff: BookingTimeoffRow[];
  /** Appointments holding time that day. */
  appointments: BookingAppointmentRow[];
}

interface Resource {
  staffId: string | null;
  windows: Interval[];
  busy: Interval[];
  bookedMin: number;
}

const manageToken = () => randomBytes(18).toString("base64url");
const slotTaken = () => new AppError(409, "slot_taken", "That time was just taken: pick another slot");
const notNull = <T>(v: T | null | undefined): v is T => v !== null && v !== undefined;
const toDayHours = (r: BookingHoursRow): DayHours => ({ opens: r.opens, closes: r.closes, breaks: r.breaks ?? [] });
const toDayRow = (r: BookingHoursRow): DayRow => ({ weekday: r.weekday, opens: r.opens, closes: r.closes, breaks: r.breaks ?? [] });

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export class BookingsService {
  private readonly db: Db;
  private readonly log: LoggerPort;
  private readonly now: () => Date;
  private readonly cfg: Required<BookingsConfig>;

  constructor(private readonly deps: BookingsDeps) {
    this.db = deps.db;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
    this.cfg = {
      stepMin: deps.config?.stepMin ?? DEFAULT_STEP_MIN,
      onlineLeadMin: deps.config?.onlineLeadMin ?? 60,
      horizonDays: deps.config?.horizonDays ?? 60,
      cancelBeforeMin: deps.config?.cancelBeforeMin ?? 120,
    };
  }

  today() {
    return todayIST(this.now());
  }

  // ---------------------------------------------------------------- services

  async services(tenantId: string, opts: { includeInactive?: boolean } = {}): Promise<ServiceView[]> {
    const rows = await this.db
      .select()
      .from(bookingServices)
      .where(and(eq(bookingServices.tenantId, tenantId), opts.includeInactive ? undefined : eq(bookingServices.active, true)))
      .orderBy(asc(bookingServices.sort), asc(bookingServices.name));
    const prices = await this.priceMap(tenantId, rows.map((r) => r.itemId));
    return rows.map((r) => ({ ...r, rate: prices.get(r.itemId)?.rate ?? null, gstRate: prices.get(r.itemId)?.gstRate ?? null }));
  }

  private async priceMap(tenantId: string, itemIds: string[]) {
    const ids = [...new Set(itemIds)];
    if (!ids.length || !this.deps.prices) return new Map<string, Awaited<ReturnType<ServicePricePort["items"]>>[number]>();
    const items = await this.deps.prices.items(tenantId, ids);
    return new Map(items.map((i) => [i.id, i]));
  }

  private async serviceRow(tenantId: string, id: string): Promise<BookingServiceRow> {
    const [row] = await this.db
      .select()
      .from(bookingServices)
      .where(and(eq(bookingServices.tenantId, tenantId), eq(bookingServices.id, id)))
      .limit(1);
    if (!row) throw notFound("Service");
    return row;
  }

  /** Makes a catalogue item bookable. The name comes from the catalogue unless given. */
  async createService(tenantId: string, input: unknown): Promise<BookingServiceRow> {
    const b = serviceInput.parse(input);
    let name = b.name;
    if (this.deps.prices) {
      const [item] = await this.deps.prices.items(tenantId, [b.itemId]);
      if (!item) throw badRequest("Unknown item");
      name ??= item.name;
    }
    if (!name) throw badRequest("Give the service a name");
    try {
      const [row] = await this.db
        .insert(bookingServices)
        .values({ tenantId, itemId: b.itemId, name, durationMin: b.durationMin, bufferMin: b.bufferMin, active: b.active, onlineBookable: b.onlineBookable, sort: b.sort })
        .returning();
      return row!;
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("That item is already a service");
      throw err;
    }
  }

  async updateService(tenantId: string, id: string, input: unknown): Promise<BookingServiceRow> {
    const b = servicePatch.parse(input);
    await this.serviceRow(tenantId, id);
    const set = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
    const [row] = await this.db
      .update(bookingServices)
      .set({ ...set, updatedAt: new Date() })
      .where(and(eq(bookingServices.tenantId, tenantId), eq(bookingServices.id, id)))
      .returning();
    return row!;
  }

  /** Removes a service. Appointments keep their own copy of its name, duration and rate. */
  async deleteService(tenantId: string, id: string): Promise<void> {
    const rows = await this.db
      .delete(bookingServices)
      .where(and(eq(bookingServices.tenantId, tenantId), eq(bookingServices.id, id)))
      .returning({ id: bookingServices.id });
    if (rows.length === 0) throw notFound("Service");
  }

  /** Active services by id, in the order asked; unknown, switched off (or, online, not bookable online) → 400. */
  private async servicesFor(tenantId: string, ids: string[], opts: { online?: boolean } = {}, db: Db | Tx = this.db): Promise<BookingServiceRow[]> {
    const unique = [...new Set(ids)];
    const rows = await db
      .select()
      .from(bookingServices)
      .where(and(eq(bookingServices.tenantId, tenantId), inArray(bookingServices.id, unique), eq(bookingServices.active, true)));
    const byId = new Map(rows.map((r) => [r.id, r]));
    return unique.map((id) => {
      const s = byId.get(id);
      if (!s || (opts.online && !s.onlineBookable)) throw badRequest("Unknown service");
      return s;
    });
  }

  // ---------------------------------------------------------------- staff

  async staff(tenantId: string, opts: { includeInactive?: boolean } = {}): Promise<BookingStaffRow[]> {
    return this.db
      .select()
      .from(bookingStaff)
      .where(and(eq(bookingStaff.tenantId, tenantId), opts.includeInactive ? undefined : eq(bookingStaff.active, true)))
      .orderBy(asc(bookingStaff.sort), asc(bookingStaff.name));
  }

  private async staffRow(tenantId: string, id: string, db: Db | Tx = this.db): Promise<BookingStaffRow> {
    const [row] = await db
      .select()
      .from(bookingStaff)
      .where(and(eq(bookingStaff.tenantId, tenantId), eq(bookingStaff.id, id)))
      .limit(1);
    if (!row) throw notFound("Staff member");
    return row;
  }

  async createStaff(tenantId: string, input: unknown): Promise<BookingStaffRow> {
    const b = staffInput.parse(input);
    const [row] = await this.db
      .insert(bookingStaff)
      .values({ tenantId, name: b.name, userId: b.userId ?? null, active: b.active, color: b.color, serviceItemIds: [...new Set(b.serviceItemIds)], sort: b.sort })
      .returning();
    return row!;
  }

  async updateStaff(tenantId: string, id: string, input: unknown): Promise<BookingStaffRow> {
    const b = staffPatch.parse(input);
    await this.staffRow(tenantId, id);
    const set = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
    if (b.serviceItemIds) set.serviceItemIds = [...new Set(b.serviceItemIds)];
    const [row] = await this.db
      .update(bookingStaff)
      .set({ ...set, updatedAt: new Date() })
      .where(and(eq(bookingStaff.tenantId, tenantId), eq(bookingStaff.id, id)))
      .returning();
    return row!;
  }

  /** Removes a staff member with no appointments still to come (move them first), with their hours and time off. */
  async deleteStaff(tenantId: string, id: string): Promise<void> {
    await this.staffRow(tenantId, id);
    const [busy] = await this.db
      .select({ id: bookingAppointments.id })
      .from(bookingAppointments)
      .where(
        and(
          eq(bookingAppointments.tenantId, tenantId),
          eq(bookingAppointments.staffId, id),
          inArray(bookingAppointments.status, ["booked", "confirmed", "arrived", "in_service"]),
          gte(bookingAppointments.end, this.now()),
        ),
      )
      .limit(1);
    if (busy) throw new AppError(409, "staff_has_appointments", "This person has appointments still to come: move or cancel them first");
    await this.db.transaction(async (tx) => {
      await tx.delete(bookingHours).where(and(eq(bookingHours.tenantId, tenantId), eq(bookingHours.staffId, id)));
      await tx.delete(bookingTimeoff).where(and(eq(bookingTimeoff.tenantId, tenantId), eq(bookingTimeoff.staffId, id)));
      await tx.delete(bookingStaff).where(and(eq(bookingStaff.tenantId, tenantId), eq(bookingStaff.id, id)));
    });
  }

  // ---------------------------------------------------------------- hours & time off

  async hours(tenantId: string): Promise<HoursView> {
    const rows = await this.db.select().from(bookingHours).where(eq(bookingHours.tenantId, tenantId)).orderBy(asc(bookingHours.weekday));
    const staff: Record<string, DayRow[]> = {};
    for (const r of rows) if (r.staffId) (staff[r.staffId] ??= []).push(toDayRow(r));
    return { shop: rows.filter((r) => !r.staffId).map(toDayRow), staff };
  }

  /** Replaces a week of hours. A staff member with no days set goes back to the shop's hours. */
  async putHours(tenantId: string, input: unknown): Promise<HoursView> {
    const b = hoursInput.parse(input);
    if (b.staffId) await this.staffRow(tenantId, b.staffId);
    await this.db.transaction(async (tx) => {
      await tx
        .delete(bookingHours)
        .where(and(eq(bookingHours.tenantId, tenantId), b.staffId ? eq(bookingHours.staffId, b.staffId) : isNull(bookingHours.staffId)));
      if (b.days.length) {
        await tx.insert(bookingHours).values(b.days.map((d) => ({ tenantId, staffId: b.staffId, weekday: d.weekday, opens: d.opens, closes: d.closes, breaks: d.breaks })));
      }
    });
    return this.hours(tenantId);
  }

  /** Time off overlapping the `from`…`to` days (IST); without a range, everything not over yet. */
  async timeoff(tenantId: string, query: unknown = {}): Promise<BookingTimeoffRow[]> {
    const q = timeoffQuery.parse(query);
    return this.db
      .select()
      .from(bookingTimeoff)
      .where(
        and(
          eq(bookingTimeoff.tenantId, tenantId),
          q.staffId ? eq(bookingTimeoff.staffId, q.staffId) : undefined,
          q.from ? gt(bookingTimeoff.to, istDayRange(q.from).start) : q.to ? undefined : gt(bookingTimeoff.to, this.now()),
          q.to ? lt(bookingTimeoff.from, istDayRange(q.to).end) : undefined,
        ),
      )
      .orderBy(asc(bookingTimeoff.from))
      .limit(500);
  }

  private async timeoffRow(tenantId: string, id: string): Promise<BookingTimeoffRow> {
    const [row] = await this.db
      .select()
      .from(bookingTimeoff)
      .where(and(eq(bookingTimeoff.tenantId, tenantId), eq(bookingTimeoff.id, id)))
      .limit(1);
    if (!row) throw notFound("Time off");
    return row;
  }

  async createTimeoff(tenantId: string, input: unknown): Promise<BookingTimeoffRow> {
    const b = timeoffInput.parse(input);
    if (b.staffId) await this.staffRow(tenantId, b.staffId);
    const [row] = await this.db.insert(bookingTimeoff).values({ tenantId, staffId: b.staffId, from: b.from, to: b.to, reason: b.reason }).returning();
    return row!;
  }

  async updateTimeoff(tenantId: string, id: string, input: unknown): Promise<BookingTimeoffRow> {
    const b = timeoffPatch.parse(input);
    const cur = await this.timeoffRow(tenantId, id);
    const merged = timeoffInput.parse({
      staffId: b.staffId === undefined ? cur.staffId : b.staffId,
      from: (b.from ?? cur.from).toISOString(),
      to: (b.to ?? cur.to).toISOString(),
      reason: b.reason === undefined ? cur.reason : b.reason,
    });
    if (merged.staffId) await this.staffRow(tenantId, merged.staffId);
    const [row] = await this.db
      .update(bookingTimeoff)
      .set({ staffId: merged.staffId, from: merged.from, to: merged.to, reason: merged.reason, updatedAt: new Date() })
      .where(and(eq(bookingTimeoff.tenantId, tenantId), eq(bookingTimeoff.id, id)))
      .returning();
    return row!;
  }

  async deleteTimeoff(tenantId: string, id: string): Promise<void> {
    const rows = await this.db
      .delete(bookingTimeoff)
      .where(and(eq(bookingTimeoff.tenantId, tenantId), eq(bookingTimeoff.id, id)))
      .returning({ id: bookingTimeoff.id });
    if (rows.length === 0) throw notFound("Time off");
  }

  // ---------------------------------------------------------------- availability

  /** Everything slot maths needs for one IST day. `exclude` leaves an appointment out (when moving it). */
  private async dayContext(tenantId: string, date: string, db: Db | Tx = this.db, exclude?: string): Promise<DayContext> {
    const weekday = istWeekday(date);
    const { start, end } = istDayRange(date);
    // Sequential: inside a transaction these share one connection anyway.
    const staff = await db
      .select()
      .from(bookingStaff)
      .where(and(eq(bookingStaff.tenantId, tenantId), eq(bookingStaff.active, true)))
      .orderBy(asc(bookingStaff.sort), asc(bookingStaff.name));
    const hours = await db.select().from(bookingHours).where(eq(bookingHours.tenantId, tenantId));
    const timeoff = await db
      .select()
      .from(bookingTimeoff)
      .where(and(eq(bookingTimeoff.tenantId, tenantId), lt(bookingTimeoff.from, end), gt(bookingTimeoff.to, start)));
    const appointments = await db
      .select()
      .from(bookingAppointments)
      .where(
        and(
          eq(bookingAppointments.tenantId, tenantId),
          inArray(bookingAppointments.status, [...BLOCKING_STATUSES]),
          lt(bookingAppointments.start, end),
          // Yesterday's late appointment whose buffer runs past midnight still counts.
          gt(bookingAppointments.end, new Date(start.getTime() - 240 * MIN_MS)),
          exclude ? ne(bookingAppointments.id, exclude) : undefined,
        ),
      );
    const shopRow = hours.find((h) => !h.staffId && h.weekday === weekday);
    const staffHours = new Map<string, DayHours | null>();
    for (const h of hours) if (h.staffId && !staffHours.has(h.staffId)) staffHours.set(h.staffId, null);
    for (const h of hours) if (h.staffId && h.weekday === weekday) staffHours.set(h.staffId, toDayHours(h));
    return { date, shop: shopRow ? toDayHours(shopRow) : null, staff, staffHours, timeoff, appointments };
  }

  /** Busy minutes of one person (`null` = the whole shop when it has no staff). */
  private busyOf(ctx: DayContext, staffId: string | null): { busy: Interval[]; bookedMin: number } {
    const off = ctx.timeoff.filter((t) => !t.staffId || t.staffId === staffId).map((t) => clipToDay(ctx.date, t.from, t.to));
    const appts = ctx.appointments.filter((a) => staffId === null || a.staffId === staffId);
    const bookedMin = appts.reduce((s, a) => s + Math.round((a.end.getTime() - a.start.getTime()) / MIN_MS), 0);
    return { busy: [...off, ...appts.map((a) => appointmentBusy(ctx.date, a))].filter(notNull), bookedMin };
  }

  /** Who can be booked for these services: one person, or everyone who does them. A shop with no staff is one chair. */
  private resources(ctx: DayContext, itemIds: string[], staffId: string): Resource[] {
    if (ctx.staff.length === 0) return staffId === "any" ? [{ staffId: null, windows: hoursWindows(ctx.shop), ...this.busyOf(ctx, null) }] : [];
    return ctx.staff
      .filter((s) => (staffId === "any" || s.id === staffId) && staffDoes(s.serviceItemIds, itemIds))
      .map((s) => ({ staffId: s.id, windows: workingWindows(ctx.shop, ctx.staffHours.get(s.id)), ...this.busyOf(ctx, s.id) }));
  }

  private slotsFor(ctx: DayContext, services: BookingServiceRow[], staffId: string, earliest: number): AnySlot[] {
    const totals = serviceTotals(services);
    return mergeAnyStaff(
      this.resources(
        ctx,
        services.map((s) => s.itemId),
        staffId,
      ).map((r) => ({
        staffId: r.staffId,
        bookedMin: r.bookedMin,
        starts: freeStarts({ windows: r.windows, busy: r.busy, durationMin: totals.durationMin, bufferMin: totals.bufferMin, stepMin: this.cfg.stepMin, earliest }),
      })),
    );
  }

  /** Free slots on a day for these services. The desk sees every free slot from now on; online adds notice and a horizon. */
  async availability(tenantId: string, query: unknown, opts: { online?: boolean } = {}): Promise<Availability> {
    const q = availabilityQuery.parse(query);
    const services = await this.servicesFor(tenantId, q.serviceIds, opts);
    const totals = serviceTotals(services);
    const out: Availability = { date: q.date, durationMin: totals.durationMin, bufferMin: totals.bufferMin, slots: [] };
    if (opts.online && daysBetween(this.today(), q.date) > this.cfg.horizonDays) return out;
    const ctx = await this.dayContext(tenantId, q.date);
    const earliest = earliestStart(q.date, this.now(), opts.online ? this.cfg.onlineLeadMin : 0);
    out.slots = this.slotsFor(ctx, services, q.staffId, earliest).map((s) => ({
      start: istInstant(q.date, s.start),
      end: istInstant(q.date, s.start + totals.durationMin),
      time: formatHHMM(s.start),
      staffId: s.staffId,
      staffIds: s.staffIds,
    }));
    return out;
  }

  /**
   * Who gets the appointment, re-checked under the day lock. Online and "any": the start must be a free slot by the
   * full rules (hours, breaks, time off, clashes; online also notice). The desk naming a person may book outside their
   * hours (squeezing someone in); only clashes count. Null = unassigned: no check.
   */
  private assign(
    ctx: DayContext,
    services: BookingServiceRow[],
    wanted: string | null,
    start: Date,
    opts: { online: boolean },
  ): string | null {
    const startMin = istMinuteOf(start);
    if (opts.online || wanted === "any") {
      const earliest = opts.online ? earliestStart(ctx.date, this.now(), this.cfg.onlineLeadMin) : 0;
      const slot = this.slotsFor(ctx, services, wanted ?? "any", earliest).find((s) => s.start === startMin);
      if (!slot) throw slotTaken();
      return slot.staffId;
    }
    if (wanted === null) return null;
    if (!ctx.staff.some((s) => s.id === wanted)) throw badRequest("Unknown staff member");
    this.assertFree(ctx, wanted, startMin, serviceTotals(services));
    return wanted;
  }

  private assertFree(ctx: DayContext, staffId: string, startMin: number, totals: { durationMin: number; bufferMin: number }) {
    const slot = { from: startMin, to: startMin + totals.durationMin + totals.bufferMin };
    if (this.busyOf(ctx, staffId).busy.some((b) => overlaps(slot, b))) throw slotTaken();
  }

  private checkStart(start: Date, durationMin: number): { date: string; startMin: number } {
    if (start.getTime() % MIN_MS !== 0) throw badRequest("Start on a whole minute");
    const date = istDateOf(start);
    const startMin = istMinuteOf(start);
    if (startMin + durationMin > DAY_MIN) throw badRequest("An appointment must end the same day");
    return { date, startMin };
  }

  // ---------------------------------------------------------------- appointments

  /** One lock per shop per day: numbering and the overlap re-check run under it. */
  private async lockDay(tx: Tx, tenantId: string, date: string) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`bookings:day:${tenantId}:${date}`}))`);
  }

  private async nextNumber(tx: Tx, tenantId: string, date: string): Promise<number> {
    const [r] = await tx
      .select({ n: sql<number>`coalesce(max(${bookingAppointments.number}), 0)::int` })
      .from(bookingAppointments)
      .where(and(eq(bookingAppointments.tenantId, tenantId), eq(bookingAppointments.businessDate, date)));
    return (r?.n ?? 0) + 1;
  }

  /** Services priced from the catalogue (rates as billed, GST-exclusive). */
  private async priceItems(tenantId: string, services: BookingServiceRow[]) {
    const prices = await this.priceMap(tenantId, services.map((s) => s.itemId));
    return services.map((s, i) => {
      const p = prices.get(s.itemId);
      if (this.deps.prices && !p) throw badRequest(`${s.name} is no longer for sale`);
      return { serviceId: s.id, itemId: s.itemId, name: s.name, durationMin: s.durationMin, rate: p?.rate ?? 0, gstRate: p?.gstRate ?? 18, hsn: p?.hsn ?? null, unit: p?.unit ?? null, sort: i };
    });
  }

  private async book(
    tenantId: string,
    b: { serviceIds: string[]; staffId: string | null; start: Date; customerName: string; customerPhone: string | null; customerId: string | null; notes: string | null },
    opts: { source: AppointmentSource; userId: string | null },
  ): Promise<AppointmentView> {
    const online = opts.source === "online";
    const services = await this.servicesFor(tenantId, b.serviceIds, { online });
    const totals = serviceTotals(services);
    const { date } = this.checkStart(b.start, totals.durationMin);
    if (online && daysBetween(this.today(), date) > this.cfg.horizonDays) throw badRequest("That day is too far ahead");
    const items = await this.priceItems(tenantId, services);
    const id = await this.db.transaction(async (tx) => {
      await this.lockDay(tx, tenantId, date);
      const ctx = await this.dayContext(tenantId, date, tx);
      const staffId = this.assign(ctx, services, b.staffId, b.start, { online });
      const number = await this.nextNumber(tx, tenantId, date);
      const [a] = await tx
        .insert(bookingAppointments)
        .values({
          tenantId,
          number,
          businessDate: date,
          staffId,
          start: b.start,
          end: new Date(b.start.getTime() + totals.durationMin * MIN_MS),
          bufferMin: totals.bufferMin,
          source: opts.source,
          customerName: b.customerName,
          customerPhone: b.customerPhone,
          customerId: b.customerId,
          notes: b.notes,
          manageToken: manageToken(),
          createdBy: opts.userId,
        })
        .returning();
      await tx.insert(bookingAppointmentItems).values(items.map((i) => ({ tenantId, appointmentId: a!.id, ...i })));
      return a!.id;
    });
    const view = await this.get(tenantId, id);
    this.notify("booked", tenantId, view);
    return view;
  }

  /** The desk books: a named person (clashes 409 `slot_taken`), "any" (a free slot) or unassigned (null). */
  async create(tenantId: string, input: unknown, userId: string | null = null): Promise<AppointmentView> {
    const b = appointmentInput.parse(input);
    return this.book(
      tenantId,
      { ...b, customerPhone: b.customerPhone, customerId: b.customerId ?? null },
      { source: "staff", userId },
    );
  }

  private async row(tenantId: string, id: string, db: Db | Tx = this.db, lock = false): Promise<BookingAppointmentRow> {
    const q = db
      .select()
      .from(bookingAppointments)
      .where(and(eq(bookingAppointments.tenantId, tenantId), eq(bookingAppointments.id, id)))
      .limit(1);
    const [row] = lock ? await q.for("update") : await q;
    if (!row) throw notFound("Appointment");
    return row;
  }

  /** Full views (services, staff, amount) for appointment rows, in their order. */
  private async views(tenantId: string, rows: BookingAppointmentRow[]): Promise<AppointmentView[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const staffIds = [...new Set(rows.map((r) => r.staffId).filter(notNull))];
    const [items, staff] = await Promise.all([
      this.db
        .select()
        .from(bookingAppointmentItems)
        .where(and(eq(bookingAppointmentItems.tenantId, tenantId), inArray(bookingAppointmentItems.appointmentId, ids)))
        .orderBy(asc(bookingAppointmentItems.sort), asc(bookingAppointmentItems.id)),
      staffIds.length
        ? this.db
            .select({ id: bookingStaff.id, name: bookingStaff.name, color: bookingStaff.color })
            .from(bookingStaff)
            .where(and(eq(bookingStaff.tenantId, tenantId), inArray(bookingStaff.id, staffIds)))
        : Promise.resolve([]),
    ]);
    const byAppt = new Map<string, BookingAppointmentItemRow[]>();
    for (const i of items) byAppt.set(i.appointmentId, [...(byAppt.get(i.appointmentId) ?? []), i]);
    const staffById = new Map(staff.map((s) => [s.id, s]));
    return rows.map((r) => {
      const lines = byAppt.get(r.id) ?? [];
      const s = r.staffId ? staffById.get(r.staffId) : undefined;
      return {
        ...r,
        staffName: s?.name ?? null,
        staffColor: s?.color ?? null,
        items: lines,
        durationMin: Math.round((r.end.getTime() - r.start.getTime()) / MIN_MS),
        amount: lines.reduce((sum, l) => sum + l.rate, 0),
        nextStatuses: [...nextStatuses(r.status)],
      };
    });
  }

  async get(tenantId: string, id: string): Promise<AppointmentView> {
    const [view] = await this.views(tenantId, [await this.row(tenantId, id)]);
    return view!;
  }

  /** The calendar of one IST day: staff columns, working windows, time off and every appointment (any status). */
  async day(tenantId: string, query: unknown = {}): Promise<DayView> {
    const date = dayQuery.parse(query).date ?? this.today();
    const [ctx, rows, allStaff] = await Promise.all([
      this.dayContext(tenantId, date),
      this.db
        .select()
        .from(bookingAppointments)
        .where(and(eq(bookingAppointments.tenantId, tenantId), eq(bookingAppointments.businessDate, date)))
        .orderBy(asc(bookingAppointments.start), asc(bookingAppointments.number)),
      this.staff(tenantId, { includeInactive: true }),
    ]);
    const used = new Set(rows.map((r) => r.staffId).filter(notNull));
    const staff = allStaff.filter((s) => s.active || used.has(s.id));
    const windows: DayView["windows"] = { shop: hoursWindows(ctx.shop), staff: {} };
    for (const s of staff) windows.staff[s.id] = s.active ? workingWindows(ctx.shop, ctx.staffHours.get(s.id)) : [];
    const timeoff: Record<string, Interval[]> = {};
    for (const t of ctx.timeoff) {
      const i = clipToDay(date, t.from, t.to);
      if (i) (timeoff[t.staffId ?? "shop"] ??= []).push(i);
    }
    return { date, weekday: istWeekday(date), staff, windows, timeoff, appointments: await this.views(tenantId, rows) };
  }

  /** WHERE of the list; without `status` for the status facet counts. */
  listConditions(tenantId: string, p: z.output<typeof appointmentListQuery>, withStatus = true): SQL | undefined {
    const now = this.now();
    return and(
      eq(bookingAppointments.tenantId, tenantId),
      p.when === "upcoming" ? gte(bookingAppointments.end, now) : p.when === "past" ? lt(bookingAppointments.end, now) : undefined,
      withStatus && p.status?.length ? inArray(bookingAppointments.status, p.status) : undefined,
      p.source?.length ? inArray(bookingAppointments.source, p.source) : undefined,
      p.staffId?.length ? inArray(bookingAppointments.staffId, p.staffId) : undefined,
      p.from ? gte(bookingAppointments.businessDate, p.from) : undefined,
      p.to ? lte(bookingAppointments.businessDate, p.to) : undefined,
      searchAny(p.q, [bookingAppointments.customerName, bookingAppointments.customerPhone, sql`${bookingAppointments.number}::text`]),
    );
  }

  async list(tenantId: string, query: AppointmentListQuery = {}): Promise<ListPage<AppointmentSummary>> {
    const p = appointmentListQuery.parse(query);
    const order = APPOINTMENT_SORT.orderBy(p.sort);
    const where = this.listConditions(tenantId, p);
    const i = bookingAppointmentItems;
    const a = bookingAppointments;
    const [page, byStatus] = await Promise.all([
      runList(p, {
        rows: () =>
          this.db
            .select({
              a,
              staffName: bookingStaff.name,
              staffColor: bookingStaff.color,
              services: sql<string | null>`(select string_agg(${i.name}, ', ' order by ${i.sort}) from ${i} where ${i.tenantId} = ${tenantId} and ${i.appointmentId} = ${a.id})`,
              amount: sql<number>`(select coalesce(sum(${i.rate}), 0)::int from ${i} where ${i.tenantId} = ${tenantId} and ${i.appointmentId} = ${a.id})`,
            })
            .from(a)
            .leftJoin(bookingStaff, eq(bookingStaff.id, a.staffId))
            .where(where)
            .orderBy(...order)
            .limit(p.limit)
            .offset(p.offset),
        count: () => this.db.select({ total: count() }).from(a).where(where),
        map: (r): AppointmentSummary => {
          const { manageToken: _token, ...row } = r.a;
          return { ...row, staffName: r.staffName, staffColor: r.staffColor, services: r.services, amount: Number(r.amount ?? 0) };
        },
      }),
      this.db.select({ key: a.status, n: count() }).from(a).where(this.listConditions(tenantId, p, false)).groupBy(a.status),
    ]);
    return { ...page, facets: { status: facetCounts(byStatus) } };
  }

  /** Today's count by status and the next few appointments still to come (dashboard). */
  async summary(tenantId: string): Promise<BookingsSummary> {
    const date = this.today();
    const [byStatus, next] = await Promise.all([
      this.db
        .select({ key: bookingAppointments.status, n: count() })
        .from(bookingAppointments)
        .where(and(eq(bookingAppointments.tenantId, tenantId), eq(bookingAppointments.businessDate, date)))
        .groupBy(bookingAppointments.status),
      this.db
        .select()
        .from(bookingAppointments)
        .where(
          and(
            eq(bookingAppointments.tenantId, tenantId),
            inArray(bookingAppointments.status, ["booked", "confirmed", "arrived", "in_service"]),
            gte(bookingAppointments.end, this.now()),
          ),
        )
        .orderBy(asc(bookingAppointments.start))
        .limit(5),
    ]);
    const counts = facetCounts(byStatus) as Partial<Record<AppointmentStatus, number>>;
    const today = Object.entries(counts).reduce((s, [k, n]) => (k === "cancelled" || k === "no_show" ? s : s + (n ?? 0)), 0);
    return { date, today, byStatus: counts, upcoming: await this.views(tenantId, next) };
  }

  /** Customer details and notes. */
  async update(tenantId: string, id: string, input: unknown): Promise<AppointmentView> {
    const b = appointmentPatch.parse(input);
    await this.row(tenantId, id);
    const set = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
    if (Object.keys(set).length) {
      await this.db
        .update(bookingAppointments)
        .set({ ...set, updatedAt: new Date() })
        .where(and(eq(bookingAppointments.tenantId, tenantId), eq(bookingAppointments.id, id)));
    }
    return this.get(tenantId, id);
  }

  /**
   * Reschedules (new time and/or person) a booked or confirmed appointment. Clashes are re-checked under the lock of
   * both days; moving to another day gives it that day's next number.
   */
  async move(tenantId: string, id: string, input: unknown): Promise<AppointmentView> {
    const b = moveInput.parse(input);
    const current = await this.row(tenantId, id);
    if (!canReschedule(current.status)) throw new AppError(409, "not_movable", "Only booked or confirmed appointments can be moved");
    const durationMin = Math.round((current.end.getTime() - current.start.getTime()) / MIN_MS);
    const { date, startMin } = this.checkStart(b.start, durationMin);
    const staffId = b.staffId === undefined ? current.staffId : b.staffId;
    await this.db.transaction(async (tx) => {
      for (const d of [...new Set([current.businessDate, date])].sort()) await this.lockDay(tx, tenantId, d);
      const row = await this.row(tenantId, id, tx, true);
      if (!canReschedule(row.status)) throw new AppError(409, "not_movable", "Only booked or confirmed appointments can be moved");
      const ctx = await this.dayContext(tenantId, date, tx, id);
      if (staffId) {
        if (!ctx.staff.some((s) => s.id === staffId)) throw badRequest("Unknown staff member");
        this.assertFree(ctx, staffId, startMin, { durationMin, bufferMin: row.bufferMin });
      }
      const number = date === row.businessDate ? row.number : await this.nextNumber(tx, tenantId, date);
      await tx
        .update(bookingAppointments)
        .set({ start: b.start, end: new Date(b.start.getTime() + durationMin * MIN_MS), businessDate: date, number, staffId, updatedAt: new Date() })
        .where(eq(bookingAppointments.id, id));
    });
    const view = await this.get(tenantId, id);
    if (view.start.getTime() !== current.start.getTime() || view.staffId !== current.staffId) {
      this.notify("rescheduled", tenantId, view, { previousStart: current.start });
    }
    return view;
  }

  /** Desk status change, by the flow in `canMoveStatus` (409 `status_move` otherwise). */
  async setStatus(tenantId: string, id: string, input: unknown): Promise<AppointmentView> {
    const b = statusInput.parse(input);
    const changed = await this.db.transaction(async (tx) => {
      const row = await this.row(tenantId, id, tx, true);
      if (!canMoveStatus(row.status, b.status)) throw new AppError(409, "status_move", `A ${row.status} appointment can't become ${b.status}`);
      if (row.status === b.status) return false;
      await tx
        .update(bookingAppointments)
        .set({ status: b.status, ...(b.status === "cancelled" ? { cancelReason: b.reason } : {}), updatedAt: new Date() })
        .where(eq(bookingAppointments.id, id));
      return true;
    });
    const view = await this.get(tenantId, id);
    if (changed && b.status === "cancelled") this.notify("cancelled", tenantId, view, { by: "shop", reason: b.reason });
    return view;
  }

  /**
   * Bills an appointment whose service has started: one GST bill with its services, issued through invoices, and the
   * appointment is marked completed. The row stays locked while the bill is made so two devices can't bill it twice.
   */
  async bill(tenant: TenantRef, id: string, input: unknown, opts: { branchId?: string | null } = {}): Promise<{ appointment: AppointmentView; bill: BillResult }> {
    const b = billInput.parse(input);
    const billing = this.deps.billing;
    if (!billing) throw new AppError(501, "billing_unavailable", "Billing is not available");
    const tenantId = tenant.id;
    const bill = await this.db.transaction(async (tx) => {
      const a = await this.row(tenantId, id, tx, true);
      if (a.invoiceId) throw new AppError(409, "already_billed", "This appointment is already billed", { invoiceId: a.invoiceId });
      if (!canBill(a.status)) throw new AppError(409, "not_billable", "Start the service before billing");
      const items = await tx
        .select()
        .from(bookingAppointmentItems)
        .where(and(eq(bookingAppointmentItems.tenantId, tenantId), eq(bookingAppointmentItems.appointmentId, id)))
        .orderBy(asc(bookingAppointmentItems.sort));
      if (items.length === 0) throw badRequest("Nothing to bill");
      const staffName = a.staffId ? (await this.staffRow(tenantId, a.staffId, tx).catch(() => null))?.name : null;
      const customer = b.customer ? { name: b.customer.name, phone: b.customer.phone } : { name: a.customerName, phone: a.customerPhone };
      try {
        const r = await billing.createBill(
          tenant,
          {
            lines: items.map((l) => ({ description: l.name, itemId: l.itemId, qty: 1, rate: l.rate, gstRate: l.gstRate, hsn: l.hsn, unit: l.unit })),
            customer,
            notes: `Appointment #${a.number} · ${a.businessDate} ${formatHHMM(istMinuteOf(a.start))}${staffName ? ` · ${staffName}` : ""}`,
            tillSessionId: b.tillSessionId ?? null,
          },
          { branchId: opts.branchId ?? null },
        );
        await tx.update(bookingAppointments).set({ invoiceId: r.id, status: "completed", updatedAt: new Date() }).where(eq(bookingAppointments.id, id));
        return r;
      } catch (err) {
        this.log.error({ err, tenantId, appointmentId: id }, "bookings: billing failed");
        throw err;
      }
    });
    return { appointment: await this.get(tenantId, id), bill };
  }

  // ---------------------------------------------------------------- online (customers)

  /** Services on the booking page with their GST-inclusive price. */
  async publicServices(tenantId: string) {
    const list = (await this.services(tenantId)).filter((s) => s.onlineBookable && (!this.deps.prices || s.rate !== null));
    return list.map((s) => ({
      id: s.id,
      name: s.name,
      durationMin: s.durationMin,
      rate: s.rate ?? 0,
      gstRate: s.gstRate ?? 0,
      price: priceWithGst(s.rate ?? 0, s.gstRate ?? 0),
    }));
  }

  /** Staff on the booking page, with the services (ids) each of them does. */
  async publicStaff(tenantId: string) {
    const [staff, services] = await Promise.all([this.staff(tenantId), this.services(tenantId)]);
    const online = services.filter((s) => s.onlineBookable);
    return staff.map((s) => ({ id: s.id, name: s.name, color: s.color, serviceIds: online.filter((x) => staffDoes(s.serviceItemIds, [x.itemId])).map((x) => x.id) }));
  }

  async publicSlots(tenantId: string, query: unknown) {
    const a = await this.availability(tenantId, query, { online: true });
    return { date: a.date, durationMin: a.durationMin, slots: a.slots.map((s) => ({ start: s.start, end: s.end, time: s.time })) };
  }

  /** The customer's booking: the slot is checked again under the day lock (409 `slot_taken`). */
  async publicBook(tenantId: string, input: unknown): Promise<{ number: number; manageToken: string; appointment: PublicAppointment }> {
    const b = publicBookingInput.parse(input);
    const view = await this.book(
      tenantId,
      { serviceIds: b.serviceIds, staffId: b.staffId, start: b.start, customerName: b.name, customerPhone: b.phone, customerId: null, notes: b.notes },
      { source: "online", userId: null },
    );
    return { number: view.number, manageToken: view.manageToken, appointment: this.publicView(view) };
  }

  private publicView(v: AppointmentView): PublicAppointment {
    const services = v.items.map((i) => ({ name: i.name, durationMin: i.durationMin, price: priceWithGst(i.rate, i.gstRate) }));
    return {
      number: v.number,
      date: v.businessDate,
      start: v.start,
      end: v.end,
      status: v.status,
      staffName: v.staffName,
      services,
      total: services.reduce((s, x) => s + x.price, 0),
      customerName: v.customerName,
      notes: v.notes,
      canCancel: canCustomerCancel(v.status, v.start, this.now(), this.cfg.cancelBeforeMin),
      cancelUntil: new Date(v.start.getTime() - this.cfg.cancelBeforeMin * MIN_MS),
    };
  }

  private async byToken(tenantId: string, token: string): Promise<BookingAppointmentRow> {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw notFound("Appointment");
    const [row] = await this.db
      .select()
      .from(bookingAppointments)
      .where(and(eq(bookingAppointments.manageToken, token), eq(bookingAppointments.tenantId, tenantId)))
      .limit(1);
    if (!row) throw notFound("Appointment");
    return row;
  }

  async publicAppointment(tenantId: string, token: string): Promise<PublicAppointment> {
    const row = await this.byToken(tenantId, token);
    return this.publicView((await this.views(tenantId, [row]))[0]!);
  }

  /** The customer cancels from their link, until `cancelBeforeMin` before the start (409 `too_late` after). */
  async publicCancel(tenantId: string, token: string): Promise<PublicAppointment> {
    const found = await this.byToken(tenantId, token);
    const changed = await this.db.transaction(async (tx) => {
      const row = await this.row(tenantId, found.id, tx, true);
      if (row.status === "cancelled") return false;
      if (!canCustomerCancel(row.status, row.start, this.now(), this.cfg.cancelBeforeMin)) {
        throw new AppError(409, "too_late", "This booking can't be cancelled online any more: please call the shop");
      }
      await tx
        .update(bookingAppointments)
        .set({ status: "cancelled", cancelReason: "Cancelled by the customer", updatedAt: new Date() })
        .where(eq(bookingAppointments.id, row.id));
      return true;
    });
    const view = await this.get(tenantId, found.id);
    if (changed) this.notify("cancelled", tenantId, view, { by: "customer", reason: null });
    return this.publicView(view);
  }

  // ---------------------------------------------------------------- notices

  /**
   * Booked / confirmed appointments of every shop starting in (from, to], soonest first, for the host's reminder job
   * (it decides per shop how far ahead to remind). At most `limit` rows.
   */
  async remindable(from: Date, to: Date, limit = 2000): Promise<RemindableAppointment[]> {
    const rows = await this.db
      .select()
      .from(bookingAppointments)
      .where(and(gt(bookingAppointments.start, from), lte(bookingAppointments.start, to), inArray(bookingAppointments.status, ["booked", "confirmed"])))
      .orderBy(asc(bookingAppointments.start))
      .limit(limit);
    const byTenant = new Map<string, BookingAppointmentRow[]>();
    for (const r of rows) byTenant.set(r.tenantId, [...(byTenant.get(r.tenantId) ?? []), r]);
    const out: RemindableAppointment[] = [];
    for (const [tenantId, list] of byTenant) {
      for (const v of await this.views(tenantId, list)) out.push({ ...this.noticeOf(v), tenantId, createdAt: v.createdAt });
    }
    return out.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  private noticeOf(v: AppointmentView): BookingNotice {
    return {
      appointmentId: v.id,
      number: v.number,
      status: v.status,
      source: v.source,
      start: v.start,
      end: v.end,
      staffName: v.staffName,
      services: v.items.map((i) => i.name),
      customer: { name: v.customerName, phone: v.customerPhone },
      manageToken: v.manageToken,
    };
  }

  private notify(
    kind: "booked" | "cancelled" | "rescheduled",
    tenantId: string,
    v: AppointmentView,
    extra?: { by?: "shop" | "customer"; reason?: string | null; previousStart?: Date },
  ) {
    const n = this.deps.notify;
    if (!n) return;
    const notice = this.noticeOf(v);
    try {
      const p =
        kind === "booked"
          ? n.booked(tenantId, notice)
          : kind === "rescheduled"
            ? n.rescheduled?.(tenantId, { ...notice, previousStart: extra?.previousStart ?? notice.start })
            : n.cancelled(tenantId, { ...notice, by: extra?.by ?? "shop", reason: extra?.reason ?? null });
      void Promise.resolve(p).catch((err: unknown) => this.log.warn({ err, tenantId, appointmentId: v.id }, `bookings: ${kind} notice failed`));
    } catch (err) {
      this.log.warn({ err, tenantId, appointmentId: v.id }, `bookings: ${kind} notice failed`);
    }
  }
}
