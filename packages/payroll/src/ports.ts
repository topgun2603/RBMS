import type { AuditPort, FeatureDef, FeatureGatePort, PermissionDef } from "@rbms/core";

export type { AuditPort, FeatureGatePort };

/** Feature keys. `payroll.salary` needs `payroll` (attendance and leave work without salaries). */
export const PAYROLL_FEATURE = "payroll";
export const PAYROLL_SALARY_FEATURE = "payroll.salary";

/**
 * Permissions. There is deliberately no `payroll.view`: the built-in roles hold `*.view`, and salaries are not for every
 * member. Staff see their own attendance and payslips through `/me` without any permission (the employee linked to their
 * login only).
 */
export const PAYROLL_MANAGE = "payroll.manage";
export const PAYROLL_ATTENDANCE = "payroll.attendance";

export const PAYROLL_FEATURES: FeatureDef[] = [
  {
    key: PAYROLL_FEATURE,
    module: "payroll",
    label: "Staff attendance and leave",
    description: "Daily attendance with check-in by PIN, late and overtime minutes, holidays, leave types, balances and approvals.",
    shopToggle: true,
    defaultOn: false,
  },
  {
    key: PAYROLL_SALARY_FEATURE,
    module: "payroll",
    label: "Salary and payslips",
    description: "Monthly payroll from attendance: salary structures, advances, PF / ESI / professional tax, payslips, bank sheet and posting to the books.",
    dependsOn: [PAYROLL_FEATURE],
    shopToggle: true,
  },
];

export const PAYROLL_PERMISSIONS: PermissionDef[] = [
  {
    key: PAYROLL_MANAGE,
    module: "payroll",
    label: "Manage payroll",
    description: "Staff records and salaries, payroll runs, advances, payments, statutory dues and payroll settings.",
  },
  {
    key: PAYROLL_ATTENDANCE,
    module: "payroll",
    label: "Mark attendance and approve leave",
    description: "Mark and correct attendance, run the check-in screen, see the monthly sheet, approve or reject leave. No salaries.",
  },
];

/** The team member behind a POS PIN (pos.service.memberForPin). */
export interface PinPort {
  memberForPin(tenantId: string, pin: string): Promise<{ userId: string; name: string | null } | null>;
}

/** Team members of the shop, to link an employee to a login (staff.service.listMembers). */
export interface MembersPort {
  list(tenantId: string): Promise<{ userId: string; name: string | null; phone: string | null; active: boolean }[]>;
}

/** Renders a payslip PDF (documents type `payslip`). */
export interface PayslipPdfPort {
  render(tenantId: string, lineId: string, locale: "en" | "ta"): Promise<{ pdf: Buffer | Uint8Array; filename: string }>;
}

/** Nudges the books after a payroll change (accounting.kick, debounced). */
export interface BooksPort {
  changed(tenantId: string): void;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}
