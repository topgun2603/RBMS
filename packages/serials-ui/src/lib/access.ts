/** Feature keys the serials UI uses (declared by @rbms/serials). */
export const SERIALS_FEATURES = {
  serials: "serials",
  warranty: "serials.warranty",
} as const;

/** Permissions of @rbms/serials. Owners and admins hold both. */
export const SERIALS_PERMISSIONS = {
  manage: "serials.manage",
  view: "serials.view",
} as const;

/** Either permission can read units and look up warranty. */
export const SERIALS_VIEW = [SERIALS_PERMISSIONS.view, SERIALS_PERMISSIONS.manage];
