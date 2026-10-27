"use client";

import * as React from "react";
import { CalendarCheckIcon, CheckCheckIcon, KeyRoundIcon, LockIcon, PencilIcon, UsersIcon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  EmptyState,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@srirealtime/ui";
import { describeError, ModuleLink, Page, PageHeading, useI18n, usePermission } from "@srirealtime/web";
import { BranchFilter, DayPill, InlineError, LeaveTypeSelect, dash } from "../components/bits";
import { MarkDialog, type MarkTarget } from "../components/mark-dialog";
import { DESK_ACCESS, PAYROLL_PERMISSIONS } from "../lib/access";
import { istTime, minutesLabel, todayIst } from "../lib/format";
import { useBulkMark, useDay, useMark } from "../lib/queries";
import type { AttendanceStatus, DayRow } from "../lib/types";

/** The day board: who is in, late, on leave or not marked yet, with one-tap marks. */
export default function TodayPage() {
  const { t, formatDate } = useI18n();
  const canDesk = usePermission(DESK_ACCESS);
  const canManage = usePermission(PAYROLL_PERMISSIONS.manage);
  const [date, setDate] = React.useState(todayIst());
  const [branchId, setBranchId] = React.useState("");
  const day = useDay(date, branchId || undefined);
  const bulk = useBulkMark();
  const [editing, setEditing] = React.useState<MarkTarget | null>(null);
  const items = day.data?.items ?? [];
  const finalized = !!day.data?.finalized;
  const unmarked = items.filter((r) => !r.mark && r.expected === "working");
  const c = day.data?.counts ?? {};

  const markAllPresent = async () => {
    try {
      const r = await bulk.mutateAsync({ date, items: unmarked.map((r) => ({ employeeId: r.employee.id, status: "present" as const })) });
      toast.success(t("payroll.today.bulkDone", { count: r.marked }));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Page>
      <PageHeading
        title={t("payroll.today.title")}
        description={t("payroll.today.description")}
        actions={
          <>
            {canDesk && (
              <Button asChild variant="outline">
                <ModuleLink to="kiosk">
                  <KeyRoundIcon /> {t("payroll.nav.kiosk")}
                </ModuleLink>
              </Button>
            )}
            {unmarked.length > 0 && !finalized && (
              <Button onClick={markAllPresent} disabled={bulk.isPending}>
                <CheckCheckIcon /> {t("payroll.today.allPresent", { count: unmarked.length })}
              </Button>
            )}
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" className="w-44" aria-label={t("payroll.common.date")} value={date} max={todayIst()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <BranchFilter value={branchId} onChange={setBranchId} />
        <span className="text-sm text-muted-foreground">{formatDate(date)}</span>
        <span className="ml-auto flex flex-wrap gap-3 text-sm tabular-nums text-muted-foreground">
          <span>{t("payroll.today.countPresent", { count: (c.present ?? 0) + (c.half_day ?? 0) })}</span>
          <span>{t("payroll.today.countAbsent", { count: c.absent ?? 0 })}</span>
          <span>{t("payroll.today.countLeave", { count: c.leave ?? 0 })}</span>
          <span>{t("payroll.today.countLate", { count: c.late ?? 0 })}</span>
          <span>{t("payroll.today.countUnmarked", { count: c.unmarked ?? 0 })}</span>
        </span>
      </div>
      {finalized && (
        <Alert>
          <LockIcon />
          <AlertTitle>{t("payroll.common.finalizedTitle")}</AlertTitle>
          <AlertDescription>{t("payroll.common.finalizedBody")}</AlertDescription>
        </Alert>
      )}
      {day.isError ? (
        <InlineError title={describeError(day.error, t)} />
      ) : day.isPending ? (
        <Skeleton className="h-64" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title={t("payroll.today.emptyTitle")}
          description={t("payroll.today.emptyBody")}
          action={
            canManage && (
              <Button asChild>
                <ModuleLink to="people">{t("payroll.people.add")}</ModuleLink>
              </Button>
            )
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("payroll.col.name")}</TableHead>
              <TableHead>{t("payroll.col.day")}</TableHead>
              <TableHead>{t("payroll.col.inOut")}</TableHead>
              <TableHead numeric>{t("payroll.col.late")}</TableHead>
              <TableHead numeric>{t("payroll.col.overtime")}</TableHead>
              <TableHead className="text-right">{t("payroll.col.mark")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((r) => (
              <DayLine key={r.employee.id} row={r} disabled={finalized} onEdit={() => setEditing({ employee: r.employee, date, mark: r.mark })} />
            ))}
          </TableBody>
        </Table>
      )}
      <MarkDialog target={editing} onOpenChange={(o) => !o && setEditing(null)} />
    </Page>
  );
}

function DayLine({ row, disabled, onEdit }: { row: DayRow; disabled: boolean; onEdit: () => void }) {
  const { t } = useI18n();
  const mark = useMark();
  const [leaveOpen, setLeaveOpen] = React.useState(false);
  const m = row.mark;

  const quick = async (status: AttendanceStatus, leaveTypeId?: string) => {
    // A day already marked is a correction: the edit dialog asks why.
    if (m) return onEdit();
    try {
      await mark.mutateAsync({ employeeId: row.employee.id, date: row.date, status, leaveTypeId: leaveTypeId ?? null });
      setLeaveOpen(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <TableRow>
      <TableCell>
        <span className="grid">
          <span className="font-medium">{row.employee.name}</span>
          <span className="text-meta text-muted-foreground">{[row.employee.code, row.employee.designation, row.holiday].filter(Boolean).join(" · ")}</span>
        </span>
      </TableCell>
      <TableCell>
        <DayPill status={m?.status ?? null} expected={row.expected} leaveCode={row.leaveCode} />
      </TableCell>
      <TableCell className="tabular-nums">{m?.checkIn ? `${istTime(m.checkIn)}${m.checkOut ? ` – ${istTime(m.checkOut)}` : ` – ${t("payroll.today.stillIn")}`}` : "—"}</TableCell>
      <TableCell numeric>{m?.lateMinutes ? minutesLabel(m.lateMinutes) : "—"}</TableCell>
      <TableCell numeric>{dash(m?.overtimeMinutes ? minutesLabel(m.overtimeMinutes) : null)}</TableCell>
      <TableCell className="text-right">
        {disabled ? null : leaveOpen ? (
          <span className="inline-flex min-w-56 items-center gap-1">
            <LeaveTypeSelect value="" onChange={(id) => quick("leave", id)} />
            <Button size="sm" variant="ghost" onClick={() => setLeaveOpen(false)}>
              {t("payroll.common.cancel")}
            </Button>
          </span>
        ) : (
          <span className="inline-flex flex-wrap justify-end gap-1">
            {!m && (
              <>
                <Button size="sm" variant="outline" disabled={mark.isPending} onClick={() => quick("present")}>
                  <CalendarCheckIcon /> {t("payroll.status.present")}
                </Button>
                <Button size="sm" variant="outline" disabled={mark.isPending} onClick={() => quick("absent")}>
                  {t("payroll.status.absent")}
                </Button>
                <Button size="sm" variant="outline" disabled={mark.isPending} onClick={() => quick("half_day")}>
                  {t("payroll.status.half_day")}
                </Button>
                <Button size="sm" variant="outline" disabled={mark.isPending} onClick={() => setLeaveOpen(true)}>
                  {t("payroll.status.leave")}
                </Button>
              </>
            )}
            <Button size="icon" variant="ghost" className="size-8" aria-label={t("payroll.common.edit")} onClick={onEdit}>
              <PencilIcon />
            </Button>
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}
