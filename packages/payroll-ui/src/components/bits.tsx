"use client";

import * as React from "react";
import { AlertTriangleIcon, ShieldAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, StatusPill, type StatusTone } from "@srirealtime/ui";
import { useFeature, useI18n, useMyBranches } from "@srirealtime/web";
import { PAYROLL_FEATURES } from "../lib/access";
import { useEmployees, useLeaveTypes } from "../lib/queries";
import { PAY_METHODS, type AttendanceStatus, type ExpectedDay, type LineWarning, type PayMethod, type RunStatus } from "../lib/types";

export function InlineError({ title, children }: { title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <Alert variant="destructive">
      <AlertTriangleIcon />
      <AlertTitle>{title}</AlertTitle>
      {children && <AlertDescription>{children}</AlertDescription>}
    </Alert>
  );
}

/** "Defaults — check with your auditor" on every statutory setting. */
export function AuditorBadge() {
  const { t } = useI18n();
  return (
    <StatusPill tone="warning" icon={ShieldAlertIcon}>
      {t("payroll.common.checkAuditor")}
    </StatusPill>
  );
}

/** "—" for empty values in tables. */
export const dash = (v: React.ReactNode) => (v === null || v === undefined || v === "" ? "—" : v);

const STATUS_TONE: Record<AttendanceStatus, StatusTone> = {
  present: "success",
  absent: "danger",
  half_day: "warning",
  leave: "info",
  week_off: "neutral",
  holiday: "brand",
};

/** The pill of a day's mark, or of the calendar day when nothing is marked. */
export function DayPill({ status, expected, leaveCode }: { status: AttendanceStatus | null; expected?: ExpectedDay; leaveCode?: string | null }) {
  const { t } = useI18n();
  if (!status) {
    if (expected && expected !== "working") return <StatusPill tone="neutral">{t(`payroll.expected.${expected}`)}</StatusPill>;
    return <StatusPill tone="neutral">{t("payroll.status.unmarked")}</StatusPill>;
  }
  return (
    <StatusPill tone={STATUS_TONE[status]}>
      {t(`payroll.status.${status}`)}
      {leaveCode ? ` · ${leaveCode}` : ""}
    </StatusPill>
  );
}

const RUN_TONE: Record<RunStatus, StatusTone> = { draft: "warning", finalized: "success", cancelled: "neutral" };
export function RunPill({ status }: { status: RunStatus }) {
  const { t } = useI18n();
  return <StatusPill tone={RUN_TONE[status]}>{t(`payroll.run.status.${status}`)}</StatusPill>;
}

export function WarningPills({ warnings }: { warnings: readonly LineWarning[] }) {
  const { t } = useI18n();
  if (!warnings.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {warnings.map((w) => (
        <StatusPill key={w} tone={w === "net_negative" ? "danger" : "warning"}>
          {t(`payroll.warning.${w}`)}
        </StatusPill>
      ))}
    </span>
  );
}

/** Picks an active staff member. */
export function EmployeeSelect({ value, onChange, id }: { value: string; onChange: (id: string) => void; id?: string }) {
  const { t } = useI18n();
  const list = useEmployees("active");
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={list.isPending ? t("payroll.common.loading") : t("payroll.common.pickStaff")} />
      </SelectTrigger>
      <SelectContent>
        {(list.data?.items ?? []).map((e) => (
          <SelectItem key={e.id} value={e.id}>
            {e.name} · {e.code}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Picks a leave type (active ones). */
export function LeaveTypeSelect({ value, onChange, id }: { value: string; onChange: (id: string) => void; id?: string }) {
  const { t } = useI18n();
  const types = useLeaveTypes();
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={types.isPending ? t("payroll.common.loading") : t("payroll.common.pickLeaveType")} />
      </SelectTrigger>
      <SelectContent>
        {(types.data?.items ?? [])
          .filter((x) => x.active)
          .map((x) => (
            <SelectItem key={x.id} value={x.id}>
              {x.name} ({x.code}){x.paid ? "" : ` · ${t("payroll.leave.unpaid")}`}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}

export function MethodSelect({ value, onChange, id, allowDefault }: { value: PayMethod | ""; onChange: (m: PayMethod | "") => void; id?: string; allowDefault?: boolean }) {
  const { t } = useI18n();
  const DEFAULT = "__own";
  return (
    <Select value={value || (allowDefault ? DEFAULT : undefined)} onValueChange={(v) => onChange(v === DEFAULT ? "" : (v as PayMethod))}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allowDefault && <SelectItem value={DEFAULT}>{t("payroll.method.own")}</SelectItem>}
        {PAY_METHODS.map((m) => (
          <SelectItem key={m} value={m}>
            {t(`payroll.method.${m}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A month input ("YYYY-MM"). */
export function MonthInput({ value, onChange, id, max }: { value: string; onChange: (m: string) => void; id?: string; max?: string }) {
  const { t } = useI18n();
  return <Input id={id} type="month" className="w-44" aria-label={t("payroll.common.month")} value={value} max={max} onChange={(e) => e.target.value && onChange(e.target.value)} />;
}

/** Branch filter (only when branches are on and there are two or more). `""` = all branches. */
export function BranchFilter({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { t } = useI18n();
  const on = useFeature(PAYROLL_FEATURES.branches);
  const branches = useMyBranches();
  const items = branches.data?.items ?? [];
  if (!on || items.length < 2) return null;
  const ALL = "__all";
  return (
    <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
      <SelectTrigger className="w-48" aria-label={t("payroll.common.branch")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{t("payroll.common.allBranches")}</SelectItem>
        {items.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            {b.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Branch name by id (for tables), when branches are on. */
export function useBranchName() {
  const branches = useMyBranches();
  const by = new Map((branches.data?.items ?? []).map((b) => [b.id, b.name]));
  return (id: string | null | undefined) => (id ? (by.get(id) ?? null) : null);
}
