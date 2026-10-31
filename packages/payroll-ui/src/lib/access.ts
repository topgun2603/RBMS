/** Feature keys the payroll UI uses (declared by @rbms/payroll). */
export const PAYROLL_FEATURES = {
  payroll: "payroll",
  salary: "payroll.salary",
  /** Branch filters show only when branches are on. */
  branches: "multi-branch",
} as const;

/** Permissions of @rbms/payroll. Owners and admins hold all of them. There is no payroll "view" on purpose. */
export const PAYROLL_PERMISSIONS = {
  manage: "payroll.manage",
  attendance: "payroll.attendance",
} as const;

const P = PAYROLL_PERMISSIONS;
/** Attendance, the check-in screen, leave approvals: either permission (UI arrays are any-of). */
export const DESK_ACCESS = [P.manage, P.attendance];
