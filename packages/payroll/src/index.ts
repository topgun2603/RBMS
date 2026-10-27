import { defineModule } from "@srirealtime/core";
import { PAYROLL_FEATURES, PAYROLL_PERMISSIONS } from "./ports";
import { payrollRoutes } from "./routes";
import {
  payrollAdvances,
  payrollAttendance,
  payrollAttendanceLog,
  payrollDuePayments,
  payrollEmployees,
  payrollHolidays,
  payrollLeaveBalances,
  payrollLeaveRequests,
  payrollLeaveTypes,
  payrollPayments,
  payrollRunLines,
  payrollRuns,
  payrollSettings,
} from "./schema";
import { PayrollService, type PayrollDeps } from "./service";

export * from "./schema";
export * from "./logic";
export * from "./ports";
export * from "./csv";
export { payslipBodyHtml, payslipFilename, PAYSLIP_CSS, type PayslipDoc } from "./payslip";
export { configPatch, employeeInput, mergeConfig, MAX_PAISE } from "./inputs";
export { PayrollService } from "./service";
export type { Actor, AdvanceView, CheckResult, DayRow, DueRow, EmployeeView, LeaveBalanceRow, PayrollBookSources, PayrollDeps, RunLineView, RunView, SheetRow } from "./service";
export { payrollRoutes } from "./routes";

/**
 * Staff attendance and payroll (docs/payroll.md): staff records with salary structures, daily attendance (check-in with a
 * PIN or marked by the manager), holidays, leave with balances and approval, the monthly payroll from attendance with
 * advances and optional PF / ESI / professional tax, payslips, the register and bank sheet, and the books (read by the
 * accounting sync through `bookSources`).
 */
export function createPayroll(deps: PayrollDeps) {
  const service = new PayrollService(deps);
  const module = defineModule({
    id: "payroll",
    tables: {
      payrollSettings,
      payrollEmployees,
      payrollHolidays,
      payrollAttendance,
      payrollAttendanceLog,
      payrollLeaveTypes,
      payrollLeaveBalances,
      payrollLeaveRequests,
      payrollAdvances,
      payrollRuns,
      payrollRunLines,
      payrollPayments,
      payrollDuePayments,
    },
    routes: payrollRoutes(service),
    features: PAYROLL_FEATURES,
    permissions: PAYROLL_PERMISSIONS,
  });
  return { service, module };
}
