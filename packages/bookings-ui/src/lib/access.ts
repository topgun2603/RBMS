/** Feature keys the appointments UI uses (declared by @rbms/bookings). */
export const BOOKINGS_FEATURES = {
  bookings: "bookings",
  online: "bookings.online",
} as const;

/** Permissions of @rbms/bookings. Owners and admins hold all of them. */
export const BOOKINGS_PERMISSIONS = {
  manage: "bookings.manage",
  desk: "bookings.desk",
  bill: "bookings.bill",
} as const;

const P = BOOKINGS_PERMISSIONS;
/** Anyone who works with appointments can see the calendar. */
export const CALENDAR_ACCESS = [P.desk, P.manage, P.bill];
