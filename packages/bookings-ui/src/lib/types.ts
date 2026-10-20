export const APPOINTMENT_STATUSES = ["booked", "confirmed", "arrived", "in_service", "completed", "cancelled", "no_show"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
export type AppointmentSource = "staff" | "online";

/** Statuses that are over: they leave the calendar's main lanes unless "Show cancelled" is on. */
export const CLOSED_STATUSES: readonly AppointmentStatus[] = ["cancelled", "no_show"];

/** Minutes since IST midnight, half-open [from, to). */
export interface Interval {
  from: number;
  to: number;
}

export interface BookingService {
  id: string;
  itemId: string;
  name: string;
  durationMin: number;
  bufferMin: number;
  active: boolean;
  onlineBookable: boolean;
  sort: number;
  /** GST-exclusive paise from the catalogue; null when the item is gone. */
  rate: number | null;
  gstRate: number | null;
}

export interface BookingStaff {
  id: string;
  name: string;
  userId: string | null;
  active: boolean;
  color: string;
  /** Catalogue item ids; empty = every service. */
  serviceItemIds: string[];
  sort: number;
}

export interface HoursBreak {
  from: string;
  to: string;
}

export interface DayRow {
  weekday: number;
  opens: string;
  closes: string;
  breaks: HoursBreak[];
}

export interface Hours {
  shop: DayRow[];
  staff: Record<string, DayRow[]>;
}

export interface Timeoff {
  id: string;
  staffId: string | null;
  from: string;
  to: string;
  reason: string | null;
}

export interface AppointmentItem {
  id: string;
  serviceId: string | null;
  itemId: string | null;
  name: string;
  durationMin: number;
  rate: number;
  gstRate: number;
}

export interface Appointment {
  id: string;
  number: number;
  businessDate: string;
  staffId: string | null;
  start: string;
  end: string;
  bufferMin: number;
  status: AppointmentStatus;
  source: AppointmentSource;
  customerName: string;
  customerPhone: string | null;
  customerId: string | null;
  notes: string | null;
  invoiceId: string | null;
  cancelReason: string | null;
  manageToken: string;
  createdAt: string;
  staffName: string | null;
  staffColor: string | null;
  items: AppointmentItem[];
  durationMin: number;
  amount: number;
  nextStatuses: AppointmentStatus[];
}

/** A row of `GET /bookings/appointments`. */
export interface AppointmentRow extends Omit<Appointment, "items" | "durationMin" | "nextStatuses" | "manageToken"> {
  services: string | null;
}

export interface DayView {
  date: string;
  weekday: number;
  staff: BookingStaff[];
  windows: { shop: Interval[]; staff: Record<string, Interval[]> };
  timeoff: Record<string, Interval[]>;
  appointments: Appointment[];
}

export interface Slot {
  start: string;
  end: string;
  time: string;
  staffId: string | null;
  staffIds: (string | null)[];
}

export interface Availability {
  date: string;
  durationMin: number;
  bufferMin: number;
  slots: Slot[];
}

export interface BookingsSummary {
  date: string;
  today: number;
  byStatus: Partial<Record<AppointmentStatus, number>>;
  upcoming: Appointment[];
}

/** A billing item (catalogue variant) from `GET /invoices/items`. */
export interface ShopItem {
  id: string;
  name: string;
  unit: string;
  rate: number;
  gstRate: number;
}

export interface BillResult {
  id: string;
  number: string | null;
  total: number;
}
