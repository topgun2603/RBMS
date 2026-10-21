import type { FeatureDef, PermissionDef, TenantRef } from "@srirealtime/core";
import type { AppointmentSource, AppointmentStatus } from "./schema";

export interface BillLine {
  description: string;
  itemId: string | null;
  qty: number;
  rate: number;
  gstRate: number;
  hsn: string | null;
  unit: string | null;
}

export interface BillResult {
  id: string;
  number: string | null;
  total: number;
}

/** Makes the GST bill for an appointment (invoices). The bill is issued; payment is taken on it as usual. */
export interface BillingPort {
  createBill(
    tenant: TenantRef,
    input: { lines: BillLine[]; customer: { name: string; phone: string | null } | null; notes: string | null; tillSessionId: string | null },
    opts: { branchId: string | null },
  ): Promise<BillResult>;
}

/** Billing items (catalogue variants) by id: the service's name, rate (GST-exclusive paise), GST and HSN. */
export interface ServicePricePort {
  items(tenantId: string, ids: string[]): Promise<{ id: string; name: string; rate: number; gstRate: number; hsn: string | null; unit: string }[]>;
}

/** What a booking notice carries (SMS / WhatsApp to the customer, a ping to the staff member). */
export interface BookingNotice {
  appointmentId: string;
  number: number;
  status: AppointmentStatus;
  source: AppointmentSource;
  start: Date;
  end: Date;
  staffName: string | null;
  services: string[];
  customer: { name: string; phone: string | null };
  /** Secret of the customer's own view / cancel link. */
  manageToken: string;
}

/** Optional notifications. Calls are fire-and-forget: a failing notifier never breaks a booking. */
export interface NotifyPort {
  booked(tenantId: string, notice: BookingNotice): void | Promise<void>;
  cancelled(tenantId: string, notice: BookingNotice & { by: "shop" | "customer"; reason: string | null }): void | Promise<void>;
  /** The desk moved it to another time and/or person (`previousStart` is the old start). */
  rescheduled?(tenantId: string, notice: BookingNotice & { previousStart: Date }): void | Promise<void>;
}

/** An upcoming appointment for the reminder job (`BookingsService.remindable`). */
export interface RemindableAppointment extends BookingNotice {
  tenantId: string;
  createdAt: Date;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };

export const BOOKINGS_FEATURE = "bookings";
export const BOOKINGS_ONLINE_FEATURE = "bookings.online";

export const BOOKINGS_MANAGE = "bookings.manage";
export const BOOKINGS_DESK = "bookings.desk";
export const BOOKINGS_BILL = "bookings.bill";

export const BOOKINGS_FEATURES: FeatureDef[] = [
  {
    key: BOOKINGS_FEATURE,
    module: "bookings",
    label: "Appointments",
    description: "A day calendar per staff member, services with durations, weekly hours and time off, and bills from appointments.",
  },
  {
    key: BOOKINGS_ONLINE_FEATURE,
    module: "bookings",
    label: "Online booking",
    description: "Customers pick a service, a staff member and a free slot on the shop's booking page, and can cancel it themselves.",
    dependsOn: [BOOKINGS_FEATURE],
    shopToggle: true,
  },
];

export const BOOKINGS_PERMISSIONS: PermissionDef[] = [
  { key: BOOKINGS_MANAGE, module: "bookings", label: "Manage services & staff", description: "Bookable services, staff, weekly hours, breaks and time off." },
  { key: BOOKINGS_DESK, module: "bookings", label: "Front desk", description: "Book, move and cancel appointments and mark customers arrived, in service or done." },
  { key: BOOKINGS_BILL, module: "bookings", label: "Bill appointments", description: "Make the bill for an appointment once the service has started." },
];
