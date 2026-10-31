"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiDownload, type QueryParams } from "@rbms/web";
import { retry4xx } from "./http";
import type {
  Advance,
  AttendanceMark,
  AttendanceStatus,
  Balances,
  CheckResult,
  DayBoard,
  DueKind,
  DueRow,
  Employee,
  Holiday,
  LeaveRequest,
  LeaveType,
  LineAdjustments,
  LinkableMember,
  LogEntry,
  MeResponse,
  MyPayslip,
  PayMethod,
  PayrollConfig,
  PayrollSettings,
  Run,
  RunSummary,
  SalaryStructure,
  Sheet,
} from "./types";

const P = "/payroll";

/** Query keys. Everything starts with "payroll" so a mutation can refresh the lot. */
export const pk = {
  all: ["payroll"] as const,
  settings: ["payroll", "settings"] as const,
  members: ["payroll", "members"] as const,
  employees: (status: string, branchId?: string) => ["payroll", "employees", status, branchId ?? ""] as const,
  employee: (id: string) => ["payroll", "employee", id] as const,
  holidays: (year: number) => ["payroll", "holidays", year] as const,
  day: (date: string, branchId?: string) => ["payroll", "day", date, branchId ?? ""] as const,
  sheet: (month: string, branchId?: string) => ["payroll", "sheet", month, branchId ?? ""] as const,
  log: (q: QueryParams) => ["payroll", "log", q] as const,
  leaveTypes: ["payroll", "leave-types"] as const,
  requests: (status: string) => ["payroll", "leave-requests", status] as const,
  balances: (year?: number) => ["payroll", "balances", year ?? "current"] as const,
  advances: (status: string) => ["payroll", "advances", status] as const,
  runs: ["payroll", "runs"] as const,
  run: (id: string) => ["payroll", "run", id] as const,
  dues: ["payroll", "dues"] as const,
  me: ["payroll", "me"] as const,
  myAttendance: (month?: string) => ["payroll", "me", "attendance", month ?? ""] as const,
  myPayslips: ["payroll", "me", "payslips"] as const,
};

// ---------------------------------------------------------------- reads

export const useSettings = () => useQuery({ queryKey: pk.settings, queryFn: () => api.get<PayrollSettings>(`${P}/settings`), retry: retry4xx });
export const useMembers = (enabled = true) =>
  useQuery({ queryKey: pk.members, queryFn: () => api.get<{ items: LinkableMember[] }>(`${P}/members`), enabled, retry: retry4xx });
export const useEmployees = (status: "active" | "left" | "all" = "active", branchId?: string) =>
  useQuery({ queryKey: pk.employees(status, branchId), queryFn: () => api.get<{ items: Employee[]; total: number }>(`${P}/employees`, { status, branchId }), retry: retry4xx });
export const useEmployee = (id: string | null) =>
  useQuery({ queryKey: pk.employee(id ?? ""), queryFn: () => api.get<Employee>(`${P}/employees/${id}`), enabled: !!id, retry: retry4xx });
export const useHolidays = (year: number) =>
  useQuery({ queryKey: pk.holidays(year), queryFn: () => api.get<{ year: number; items: Holiday[]; suggestions: { date: string; name: string }[] }>(`${P}/holidays`, { year }), retry: retry4xx });
export const useDay = (date: string, branchId?: string) =>
  useQuery({ queryKey: pk.day(date, branchId), queryFn: () => api.get<DayBoard>(`${P}/attendance/day`, { date, branchId }), placeholderData: keepPreviousData, retry: retry4xx });
export const useSheet = (month: string, branchId?: string) =>
  useQuery({ queryKey: pk.sheet(month, branchId), queryFn: () => api.get<Sheet>(`${P}/attendance/sheet`, { month, branchId }), placeholderData: keepPreviousData, retry: retry4xx });
export const useLog = (q: { employeeId?: string; from?: string; to?: string }, enabled = true) =>
  useQuery({ queryKey: pk.log(q), queryFn: () => api.get<{ items: LogEntry[] }>(`${P}/attendance/log`, { ...q, limit: 200 }), enabled, retry: retry4xx });
export const useLeaveTypes = () => useQuery({ queryKey: pk.leaveTypes, queryFn: () => api.get<{ items: LeaveType[] }>(`${P}/leave/types`), retry: retry4xx });
export const useLeaveRequests = (status: string) =>
  useQuery({ queryKey: pk.requests(status), queryFn: () => api.get<{ items: LeaveRequest[] }>(`${P}/leave/requests`, { status, limit: 200 }), retry: retry4xx });
export const useBalances = (year?: number) =>
  useQuery({ queryKey: pk.balances(year), queryFn: () => api.get<Balances>(`${P}/leave/balances`, { year }), placeholderData: keepPreviousData, retry: retry4xx });
export const useAdvances = (status: "open" | "closed" | "all" = "all") =>
  useQuery({ queryKey: pk.advances(status), queryFn: () => api.get<{ items: Advance[]; outstanding: number }>(`${P}/advances`, { status }), retry: retry4xx });
export const useRuns = () => useQuery({ queryKey: pk.runs, queryFn: () => api.get<{ items: RunSummary[] }>(`${P}/runs`), retry: retry4xx });
export const useRun = (id: string) => useQuery({ queryKey: pk.run(id), queryFn: () => api.get<Run>(`${P}/runs/${id}`), retry: retry4xx });
export const useDues = () => useQuery({ queryKey: pk.dues, queryFn: () => api.get<{ items: DueRow[] }>(`${P}/dues`), retry: retry4xx });
export const useMe = () => useQuery({ queryKey: pk.me, queryFn: () => api.get<MeResponse>(`${P}/me`), retry: retry4xx });
export const useMyAttendance = (month: string | undefined, enabled = true) =>
  useQuery({
    queryKey: pk.myAttendance(month),
    queryFn: () => api.get<{ month: string; dates: string[]; row: Sheet["rows"][number] | null }>(`${P}/me/attendance`, { month }),
    enabled,
    placeholderData: keepPreviousData,
    retry: retry4xx,
  });
export const useMyPayslips = (enabled = true) =>
  useQuery({ queryKey: pk.myPayslips, queryFn: () => api.get<{ items: MyPayslip[] }>(`${P}/me/payslips`), enabled, retry: retry4xx });

// ---------------------------------------------------------------- writes

function useRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: pk.all });
}

/** A mutation that refreshes every payroll query when it succeeds. */
function useWrite<A, R>(fn: (a: A) => Promise<R>) {
  const refresh = useRefresh();
  return useMutation({ mutationFn: fn, onSuccess: refresh });
}

export type DeepPartialConfig = Partial<Omit<PayrollConfig, "pf" | "esi" | "pt">> & {
  pf?: Partial<PayrollConfig["pf"]>;
  esi?: Partial<PayrollConfig["esi"]>;
  pt?: Partial<PayrollConfig["pt"]>;
};
export const useSaveSettings = () => useWrite((patch: DeepPartialConfig) => api.put<PayrollSettings>(`${P}/settings`, patch));

export interface EmployeeBody {
  name: string;
  phone: string | null;
  userId: string | null;
  branchId: string | null;
  designation: string | null;
  joinDate: string;
  leaveDate: string | null;
  salary: SalaryStructure;
  shiftStart: string | null;
  shiftEnd: string | null;
  weekOffs: number[] | null;
  payMethod: PayMethod;
  bankName: string | null;
  accountNumber: string | null;
  ifsc: string | null;
  upiId: string | null;
  uan: string | null;
  esiNumber: string | null;
  pan: string | null;
  notes: string | null;
}
export const useSaveEmployee = (id?: string) =>
  useWrite((body: EmployeeBody) => (id ? api.put<Employee>(`${P}/employees/${id}`, body) : api.post<Employee>(`${P}/employees`, body)));
export const useDeleteEmployee = () => useWrite((id: string) => api.delete(`${P}/employees/${id}`));

export const useAddHoliday = () => useWrite((b: { date: string; name: string; branchId?: string | null }) => api.post<Holiday>(`${P}/holidays`, b));
export const useRemoveHoliday = () => useWrite((id: string) => api.delete(`${P}/holidays/${id}`));

export interface MarkBody {
  employeeId: string;
  date: string;
  status: AttendanceStatus;
  leaveTypeId?: string | null;
  checkIn?: string | null;
  checkOut?: string | null;
  lateMinutes?: number | null;
  overtimeMinutes?: number | null;
  note?: string | null;
  reason?: string | null;
}
export const useMark = () => useWrite((b: MarkBody) => api.post<AttendanceMark>(`${P}/attendance/mark`, b));
export const useBulkMark = () =>
  useWrite((b: { date: string; items: { employeeId: string; status: AttendanceStatus; leaveTypeId?: string | null }[]; overwrite?: boolean; reason?: string | null }) =>
    api.post<{ marked: number; skipped: number }>(`${P}/attendance/bulk`, b),
  );
export const useClearMark = () => useWrite((b: { employeeId: string; date: string; reason: string }) => api.post(`${P}/attendance/clear`, b));
export const useKioskCheck = () => useWrite((pin: string) => api.post<CheckResult>(`${P}/attendance/kiosk`, { pin }));
export const useSelfCheck = () => useWrite(() => api.post<CheckResult>(`${P}/me/check`, {}));

export type LeaveTypeBody = Omit<LeaveType, "id" | "sort"> & { sort?: number };
export const useSaveLeaveType = (id?: string) =>
  useWrite((b: Partial<LeaveTypeBody>) => (id ? api.patch<LeaveType>(`${P}/leave/types/${id}`, b) : api.post<LeaveType>(`${P}/leave/types`, b)));

export interface LeaveBody {
  employeeId?: string;
  leaveTypeId: string;
  from: string;
  to: string;
  halfDay?: boolean;
  reason?: string | null;
  approve?: boolean;
}
export const useRequestLeave = (self = false) => useWrite((b: LeaveBody) => api.post<LeaveRequest>(self ? `${P}/me/leave-requests` : `${P}/leave/requests`, b));
export const useLeaveDecision = () =>
  useWrite(({ id, action, note }: { id: string; action: "approve" | "reject" | "cancel"; note?: string | null }) => api.post<LeaveRequest>(`${P}/leave/requests/${id}/${action}`, note ? { note } : {}));
export const useCancelMyLeave = () => useWrite((id: string) => api.post<LeaveRequest>(`${P}/me/leave-requests/${id}/cancel`, {}));
export const useSetBalance = () =>
  useWrite((b: { employeeId: string; leaveTypeId: string; year: number; opening?: number; adjustment?: number; note?: string | null }) => api.put(`${P}/leave/balances`, b));
export const useCarryForward = () => useWrite((year: number) => api.post<{ year: number; written: number }>(`${P}/leave/carry-forward`, { year }));

export const useCreateAdvance = () =>
  useWrite((b: { employeeId: string; date?: string; amount: number; instalment: number; startMonth?: string; method: PayMethod; reference?: string | null; reason?: string | null }) =>
    api.post<Advance>(`${P}/advances`, b),
  );
export const useUpdateAdvance = () => useWrite(({ id, ...b }: { id: string; instalment?: number; reason?: string | null }) => api.patch<Advance>(`${P}/advances/${id}`, b));
export const useCancelAdvance = () => useWrite((id: string) => api.post<Advance>(`${P}/advances/${id}/cancel`, {}));

export const useCreateRun = () => useWrite((b: { month: string; notes?: string | null }) => api.post<Run>(`${P}/runs`, b));
export function useRunActions(id: string) {
  return {
    refresh: useWrite(() => api.post<Run>(`${P}/runs/${id}/refresh`, {})),
    finalize: useWrite(() => api.post<Run>(`${P}/runs/${id}/finalize`, {})),
    cancel: useWrite((reason: string | null) => api.post<{ ok: true; deleted: boolean }>(`${P}/runs/${id}/cancel`, reason ? { reason } : {})),
    adjust: useWrite(({ lineId, ...b }: LineAdjustments & { lineId: string }) => api.patch<Run>(`${P}/runs/${id}/lines/${lineId}`, b)),
    pay: useWrite((b: { lineIds?: string[]; date?: string; method?: PayMethod; reference?: string | null }) => api.post<{ paid: number; amount: number }>(`${P}/runs/${id}/pay`, b)),
    unpay: useWrite((paymentId: string) => api.post(`${P}/payments/${paymentId}/cancel`, {})),
  };
}

export const usePayDue = () =>
  useWrite((b: { kind: DueKind; month: string; date?: string; amount: number; method: PayMethod; reference?: string | null }) => api.post(`${P}/dues`, b));
export const useCancelDue = () => useWrite((id: string) => api.post(`${P}/dues/${id}/cancel`, {}));

// ---------------------------------------------------------------- files

/** Downloads with the session's token (CSV and PDF). */
export const download = (path: string, query: QueryParams, name: string) => apiDownload(path, query, name);

export const FILES = {
  sheetCsv: (month: string, branchId?: string) => download(`${P}/attendance/sheet`, { month, branchId, format: "csv" }, `attendance-${month}.csv`),
  registerCsv: (run: { id: string; month: string }) => download(`${P}/runs/${run.id}/register.csv`, {}, `payroll-register-${run.month}.csv`),
  bankSheetCsv: (run: { id: string; month: string }) => download(`${P}/runs/${run.id}/bank-sheet.csv`, {}, `salary-bank-transfer-${run.month}.csv`),
  payslip: (lineId: string, locale: "en" | "ta", name: string) => download(`/documents/payslip/${lineId}.pdf`, { locale }, name),
  myPayslip: (lineId: string, lang: "en" | "ta", name: string) => download(`${P}/me/payslips/${lineId}/pdf`, { lang }, name),
};
