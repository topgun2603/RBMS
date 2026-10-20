import { defineModule } from "@srirealtime/core";
import { BOOKINGS_FEATURES, BOOKINGS_PERMISSIONS } from "./ports";
import { bookingsRoutes } from "./routes";
import { bookingAppointmentItems, bookingAppointments, bookingHours, bookingServices, bookingStaff, bookingTimeoff } from "./schema";
import { BookingsService, type BookingsDeps } from "./service";

export * from "./schema";
export * from "./logic";
export * from "./ports";
export {
  BookingsService,
  APPOINTMENT_SORT,
  appointmentInput,
  appointmentListQuery,
  appointmentPatch,
  availabilityQuery,
  billInput,
  hoursInput,
  moveInput,
  publicBookingInput,
  serviceInput,
  staffInput,
  statusInput,
  timeoffInput,
} from "./service";
export type {
  AppointmentInput,
  AppointmentListQuery,
  AppointmentSummary,
  AppointmentView,
  Availability,
  AvailabilityQuery,
  BillInput,
  BookingsConfig,
  BookingsDeps,
  BookingsSummary,
  DayRow,
  DayView,
  HoursInput,
  HoursView,
  PublicAppointment,
  PublicBookingInput,
  ServiceInput,
  ServiceView,
  Slot,
  StaffInput,
  TimeoffInput,
} from "./service";
export { bookingsRoutes } from "./routes";

/**
 * Appointments back end (salons, spas, eye tests, personal training, clinics): bookable services from catalogue items,
 * staff with their services and colours, weekly hours with breaks, time off, free-slot search in IST ("any staff" goes
 * to the least busy), desk bookings and reschedules re-checked under a per-day lock, the appointment flow, GST bills
 * through the kit's `BillingPort`, and the customers' own online booking with a cancel link.
 */
export function createBookings(deps: BookingsDeps) {
  const service = new BookingsService(deps);
  const module = defineModule({
    id: "bookings",
    tables: { bookingServices, bookingStaff, bookingHours, bookingTimeoff, bookingAppointments, bookingAppointmentItems },
    routes: bookingsRoutes(service),
    features: BOOKINGS_FEATURES,
    permissions: BOOKINGS_PERMISSIONS,
  });
  return { service, module };
}
