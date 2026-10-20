/** Feature keys the restaurant UI uses (declared by @srirealtime/dining). */
export const RESTAURANT_FEATURES = {
  dining: "dining",
  kitchen: "dining.kitchen-display",
  qr: "dining.qr-ordering",
} as const;

/** Permissions of @srirealtime/dining. Owners and admins hold all of them. */
export const RESTAURANT_PERMISSIONS = {
  serve: "dining.serve",
  kitchen: "dining.kitchen",
  bill: "dining.bill",
  manage: "dining.manage",
} as const;

const P = RESTAURANT_PERMISSIONS;
/** Anyone working the floor or the counter. */
export const FLOOR_ACCESS = [P.serve, P.bill];
/** The kitchen display: cooks, and floor staff who want to see what's ready. */
export const KITCHEN_ACCESS = [P.kitchen, P.serve];
