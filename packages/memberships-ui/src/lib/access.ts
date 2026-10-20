/** Feature keys the memberships UI uses (declared by @srirealtime/memberships). */
export const MEMBERSHIPS_FEATURES = {
  memberships: "memberships",
  checkin: "memberships.checkin",
  /** Billing (invoices): "Bill now" shows only when it is on. */
  invoices: "invoices",
} as const;

/** Permissions of @srirealtime/memberships. Owners and admins hold all of them. */
export const MEMBERSHIPS_PERMISSIONS = {
  manage: "memberships.manage",
  checkin: "memberships.checkin",
  view: "memberships.view",
} as const;

const P = MEMBERSHIPS_PERMISSIONS;
/** Reading members and plans: any memberships permission. */
export const MEMBERS_VIEW = [P.view, P.manage, P.checkin];
/** The front desk: checking members in. */
export const DESK_ACCESS = [P.checkin, P.manage];
