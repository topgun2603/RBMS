import { pk, tenantId, timestamps } from "@rbms/db";
import { boolean, date, index, integer, jsonb, pgTable, real, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

/**
 * Appointment flow: booked → confirmed → arrived → in_service → completed. `cancelled` and `no_show` end it early
 * (from booked / confirmed / arrived) and free the time.
 */
export const APPOINTMENT_STATUSES = ["booked", "confirmed", "arrived", "in_service", "completed", "cancelled", "no_show"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Statuses that hold their time on the calendar (cancelled and no-show free it). */
export const BLOCKING_STATUSES: readonly AppointmentStatus[] = ["booked", "confirmed", "arrived", "in_service", "completed"];

/** Who made the booking: the shop's own staff at the desk or the customer on the online booking page. */
export const APPOINTMENT_SOURCES = ["staff", "online"] as const;
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number];

/** A lunch or tea break inside a day's hours, "HH:MM" in IST. */
export interface HoursBreak {
  from: string;
  to: string;
}

/** A bookable service: a catalogue item (variant, what gets billed) with how long it takes. */
export const bookingServices = pgTable(
  "booking_services",
  {
    id: pk(),
    tenantId: tenantId(),
    /** Catalogue variant id: rate, GST and HSN come from it at booking time. */
    itemId: uuid("item_id").notNull(),
    /** Name snapshot from the catalogue ("Haircut", "Eye test", "PT session"). */
    name: text("name").notNull(),
    durationMin: integer("duration_min").notNull(),
    /** Clean-up / reset time after the service; the staff member can't be booked during it. */
    bufferMin: integer("buffer_min").notNull().default(0),
    active: boolean("active").notNull().default(true),
    /** Shown on the online booking page. */
    onlineBookable: boolean("online_bookable").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    ...timestamps(),
  },
  (t) => [unique("booking_services_tenant_item_uq").on(t.tenantId, t.itemId)],
);

/** Someone customers book: a stylist, an optometrist, a trainer. */
export const bookingStaff = pgTable(
  "booking_staff",
  {
    id: pk(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    /** The team member's sign-in, when they have one. */
    userId: uuid("user_id"),
    active: boolean("active").notNull().default(true),
    /** Calendar colour, "#rrggbb". */
    color: text("color").notNull().default("#6366f1"),
    /** Catalogue item ids of the services they do; empty = every service. */
    serviceItemIds: uuid("service_item_ids").array().notNull().default([]),
    sort: integer("sort").notNull().default(0),
    ...timestamps(),
  },
  (t) => [index("booking_staff_tenant_idx").on(t.tenantId, t.active)],
);

/**
 * Weekly hours, one row per weekday (0 = Sunday). `staffId` null = the shop's hours. A staff member with no rows works
 * the shop's hours; with rows, only those days (always inside the shop's hours). A day without a row is closed.
 */
export const bookingHours = pgTable(
  "booking_hours",
  {
    id: pk(),
    tenantId: tenantId(),
    staffId: uuid("staff_id"),
    weekday: integer("weekday").notNull(),
    /** "HH:MM" IST. */
    opens: text("opens").notNull(),
    closes: text("closes").notNull(),
    breaks: jsonb("breaks").$type<HoursBreak[]>().notNull().default([]),
    ...timestamps(),
  },
  (t) => [unique("booking_hours_tenant_staff_day_uq").on(t.tenantId, t.staffId, t.weekday).nullsNotDistinct()],
);

/** Leave, a training day or a shop holiday (`staffId` null = the whole shop). */
export const bookingTimeoff = pgTable(
  "booking_timeoff",
  {
    id: pk(),
    tenantId: tenantId(),
    staffId: uuid("staff_id"),
    from: timestamp("from", { withTimezone: true }).notNull(),
    to: timestamp("to", { withTimezone: true }).notNull(),
    reason: text("reason"),
    ...timestamps(),
  },
  (t) => [index("booking_timeoff_tenant_range_idx").on(t.tenantId, t.from, t.to)],
);

export const bookingAppointments = pgTable(
  "booking_appointments",
  {
    id: pk(),
    tenantId: tenantId(),
    /** Per shop per day of the appointment: 1, 2, 3… (shown as "#12"). */
    number: integer("number").notNull(),
    /** IST calendar day of `start`. */
    businessDate: date("business_date", { mode: "string" }).notNull(),
    /** Null = not assigned to anyone yet. */
    staffId: uuid("staff_id"),
    start: timestamp("start", { withTimezone: true }).notNull(),
    /** start + the services' durations (what the customer sees). */
    end: timestamp("end", { withTimezone: true }).notNull(),
    /** Clean-up after `end` that still blocks the staff member. */
    bufferMin: integer("buffer_min").notNull().default(0),
    status: text("status").$type<AppointmentStatus>().notNull().default("booked"),
    source: text("source").$type<AppointmentSource>().notNull().default("staff"),
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone"),
    /** The invoices customer, when the desk picked one. */
    customerId: uuid("customer_id"),
    notes: text("notes"),
    invoiceId: uuid("invoice_id"),
    cancelReason: text("cancel_reason"),
    /** Secret in the customer's own "view / cancel" link. */
    manageToken: text("manage_token").notNull(),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [
    unique("booking_appointments_tenant_date_number_uq").on(t.tenantId, t.businessDate, t.number),
    unique("booking_appointments_manage_token_uq").on(t.manageToken),
    index("booking_appointments_tenant_start_idx").on(t.tenantId, t.start),
    index("booking_appointments_tenant_staff_idx").on(t.tenantId, t.staffId, t.start),
    index("booking_appointments_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

/** The services on an appointment, priced from the catalogue when booked. */
export const bookingAppointmentItems = pgTable(
  "booking_appointment_items",
  {
    id: pk(),
    tenantId: tenantId(),
    appointmentId: uuid("appointment_id").notNull(),
    serviceId: uuid("service_id"),
    itemId: uuid("item_id"),
    name: text("name").notNull(),
    durationMin: integer("duration_min").notNull(),
    /** Paise, GST-exclusive (as the catalogue and the bill use it). */
    rate: integer("rate").notNull(),
    gstRate: real("gst_rate").notNull().default(18),
    hsn: text("hsn"),
    unit: text("unit"),
    sort: integer("sort").notNull().default(0),
    ...timestamps(),
  },
  (t) => [index("booking_appointment_items_tenant_appt_idx").on(t.tenantId, t.appointmentId)],
);

export type BookingServiceRow = typeof bookingServices.$inferSelect;
export type BookingStaffRow = typeof bookingStaff.$inferSelect;
export type BookingHoursRow = typeof bookingHours.$inferSelect;
export type BookingTimeoffRow = typeof bookingTimeoff.$inferSelect;
export type BookingAppointmentRow = typeof bookingAppointments.$inferSelect;
export type BookingAppointmentItemRow = typeof bookingAppointmentItems.$inferSelect;
