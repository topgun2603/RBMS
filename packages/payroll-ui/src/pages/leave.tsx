"use client";

import * as React from "react";
import { CalendarPlusIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, Loader2Icon, PencilIcon, XIcon } from "lucide-react";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ChipGroup,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
  Skeleton,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
  type StatusTone,
} from "@srirealtime/ui";
import { ConfirmDialog, describeError, Page, PageHeading, useI18n, usePermission } from "@srirealtime/web";
import { InlineError } from "../components/bits";
import { LeaveDialog } from "../components/leave-dialog";
import { PAYROLL_PERMISSIONS } from "../lib/access";
import { parseHalfDays } from "../lib/format";
import { useBalances, useCarryForward, useLeaveDecision, useLeaveRequests, useSetBalance } from "../lib/queries";
import { LEAVE_STATUSES, type BalanceCell, type LeaveRequest, type LeaveStatus } from "../lib/types";

const TONE: Record<LeaveStatus, StatusTone> = { pending: "warning", approved: "success", rejected: "danger", cancelled: "neutral" };

/** Leave: requests to approve, every request, and the year's balances. */
export default function LeavePage() {
  const { t } = useI18n();
  const [adding, setAdding] = React.useState(false);
  return (
    <Page>
      <PageHeading
        title={t("payroll.leave.title")}
        description={t("payroll.leave.description")}
        actions={
          <Button onClick={() => setAdding(true)}>
            <CalendarPlusIcon /> {t("payroll.leave.newTitle")}
          </Button>
        }
      />
      <RequestsCard />
      <BalancesCard />
      <LeaveDialog open={adding} onOpenChange={setAdding} />
    </Page>
  );
}

export function LeaveStatusPill({ status }: { status: LeaveStatus }) {
  const { t } = useI18n();
  return <StatusPill tone={TONE[status]}>{t(`payroll.leave.status.${status}`)}</StatusPill>;
}

export function leaveDates(r: Pick<LeaveRequest, "fromDate" | "toDate" | "halfDay">, formatDate: (d: string) => string, t: (k: string) => string) {
  if (r.halfDay) return `${formatDate(r.fromDate)} (${t("payroll.leave.half")})`;
  return r.fromDate === r.toDate ? formatDate(r.fromDate) : `${formatDate(r.fromDate)} – ${formatDate(r.toDate)}`;
}

function RequestsCard() {
  const { t, formatDate } = useI18n();
  const [status, setStatus] = React.useState<LeaveStatus | "all">("pending");
  const list = useLeaveRequests(status);
  const decide = useLeaveDecision();
  const items = list.data?.items ?? [];

  const act = async (r: LeaveRequest, action: "approve" | "reject" | "cancel") => {
    try {
      await decide.mutateAsync({ id: r.id, action });
      toast.success(t(`payroll.leave.done.${action}`));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("payroll.leave.requests")}</CardTitle>
        <CardDescription>{t("payroll.leave.requestsBody")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ChipGroup
          size="sm"
          aria-label={t("payroll.leave.filter")}
          value={status}
          onChange={(v) => setStatus(v as LeaveStatus | "all")}
          options={[...LEAVE_STATUSES.map((s) => ({ value: s, label: t(`payroll.leave.status.${s}`) })), { value: "all", label: t("payroll.common.all") }]}
        />
        {list.isError ? (
          <InlineError title={describeError(list.error, t)} />
        ) : list.isPending ? (
          <Skeleton className="h-24" />
        ) : items.length === 0 ? (
          <EmptyState compact icon={CalendarPlusIcon} title={t("payroll.leave.emptyTitle")} description={t("payroll.leave.emptyBody")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("payroll.col.name")}</TableHead>
                <TableHead>{t("payroll.mark.leaveType")}</TableHead>
                <TableHead>{t("payroll.col.dates")}</TableHead>
                <TableHead numeric>{t("payroll.col.days")}</TableHead>
                <TableHead>{t("payroll.leave.reason")}</TableHead>
                <TableHead>{t("payroll.col.status")}</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.employeeName}</TableCell>
                  <TableCell>
                    {r.leaveTypeName} ({r.leaveTypeCode})
                  </TableCell>
                  <TableCell>{leaveDates(r, formatDate, t)}</TableCell>
                  <TableCell numeric>{r.days}</TableCell>
                  <TableCell className="max-w-64 truncate">{r.reason ?? "—"}</TableCell>
                  <TableCell>
                    <LeaveStatusPill status={r.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="inline-flex gap-1">
                      {r.status === "pending" && (
                        <>
                          <Button size="sm" disabled={decide.isPending} onClick={() => act(r, "approve")}>
                            <CheckIcon /> {t("payroll.leave.approve")}
                          </Button>
                          <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => act(r, "reject")}>
                            <XIcon /> {t("payroll.leave.reject")}
                          </Button>
                        </>
                      )}
                      {(r.status === "pending" || r.status === "approved") && (
                        <Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => act(r, "cancel")}>
                          {t("payroll.common.cancel")}
                        </Button>
                      )}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function BalancesCard() {
  const { t } = useI18n();
  const canManage = usePermission(PAYROLL_PERMISSIONS.manage);
  const [year, setYear] = React.useState<number | undefined>(undefined);
  const b = useBalances(year);
  const carry = useCarryForward();
  const [carrying, setCarrying] = React.useState(false);
  const [editing, setEditing] = React.useState<{ employee: { id: string; name: string }; cell: BalanceCell; year: number } | null>(null);
  const shown = b.data?.year ?? year ?? new Date().getFullYear();
  const types = b.data?.items[0]?.types ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("payroll.leave.balances", { year: shown })}</CardTitle>
        <CardDescription>{t("payroll.leave.balancesBody")}</CardDescription>
        <CardAction className="flex items-center gap-1">
          <Button size="icon" variant="outline" aria-label={t("payroll.common.prevYear")} onClick={() => setYear(shown - 1)}>
            <ChevronLeftIcon />
          </Button>
          <Button size="icon" variant="outline" aria-label={t("payroll.common.nextYear")} onClick={() => setYear(shown + 1)}>
            <ChevronRightIcon />
          </Button>
          {canManage && (
            <Button size="sm" variant="outline" onClick={() => setCarrying(true)}>
              {t("payroll.leave.carry", { year: shown })}
            </Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent>
        {b.isError ? (
          <InlineError title={describeError(b.error, t)} />
        ) : !b.data ? (
          <Skeleton className="h-24" />
        ) : b.data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("payroll.leave.noStaff")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("payroll.col.name")}</TableHead>
                {types.map((c) => (
                  <TableHead key={c.leaveTypeId} numeric>
                    {c.code}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {b.data.items.map((row) => (
                <TableRow key={row.employee.id}>
                  <TableCell className="font-medium">{row.employee.name}</TableCell>
                  {row.types.map((c) => (
                    <TableCell key={c.leaveTypeId} numeric>
                      <span className="inline-flex items-center gap-1">
                        <span title={t("payroll.leave.cellTitle", { used: c.used, pending: c.pending })}>{c.balance === null ? t("payroll.leave.usedN", { days: c.used }) : c.balance}</span>
                        {canManage && c.balance !== null && (
                          <Button size="icon" variant="ghost" className="size-6" aria-label={t("payroll.common.edit")} onClick={() => setEditing({ employee: row.employee, cell: c, year: shown })}>
                            <PencilIcon className="size-3" />
                          </Button>
                        )}
                      </span>
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <BalanceDialog target={editing} onOpenChange={(o) => !o && setEditing(null)} />
      <ConfirmDialog
        open={carrying}
        onOpenChange={setCarrying}
        title={t("payroll.leave.carryTitle", { year: shown })}
        description={t("payroll.leave.carryBody", { year: shown, prev: shown - 1 })}
        confirmLabel={t("payroll.leave.carryCta")}
        onConfirm={async () => {
          try {
            const r = await carry.mutateAsync(shown);
            toast.success(t("payroll.leave.carried", { count: r.written }));
            setCarrying(false);
          } catch (err) {
            toast.error(describeError(err, t));
          }
        }}
      />
    </Card>
  );
}

function BalanceDialog({ target, onOpenChange }: { target: { employee: { id: string; name: string }; cell: BalanceCell; year: number } | null; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const save = useSetBalance();
  const [opening, setOpening] = React.useState("0");
  const [adjustment, setAdjustment] = React.useState("0");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!target) return;
    setOpening(String(target.cell.opening));
    setAdjustment(String(target.cell.adjustment));
    setNote("");
    setError(null);
  }, [target]);

  const o = parseHalfDays(opening, true);
  const a = parseHalfDays(adjustment, true);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target || o === null || a === null) return;
    try {
      await save.mutateAsync({ employeeId: target.employee.id, leaveTypeId: target.cell.leaveTypeId, year: target.year, opening: o, adjustment: a, note: note.trim() || null });
      toast.success(t("payroll.leave.balanceSaved"));
      onOpenChange(false);
    } catch (err) {
      setError(describeError(err, t));
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("payroll.common.close")} className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t("payroll.leave.adjustTitle")}</DialogTitle>
            <DialogDescription>
              {target?.employee.name} · {target?.cell.name} · {target?.year}
            </DialogDescription>
          </DialogHeader>
          {error && <InlineError title={error} />}
          <p className="text-sm text-muted-foreground">{t("payroll.leave.adjustInfo", { yearly: target?.cell.yearlyDays ?? 0, used: target?.cell.used ?? 0 })}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field invalid={o === null}>
              <FieldLabel>{t("payroll.leave.opening")}</FieldLabel>
              <FieldControl>
                <Input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} />
              </FieldControl>
              <FieldHint>{t("payroll.leave.openingHint")}</FieldHint>
              <FieldError>{o === null ? t("payroll.common.halfDaysInvalid") : null}</FieldError>
            </Field>
            <Field invalid={a === null}>
              <FieldLabel>{t("payroll.leave.adjustment")}</FieldLabel>
              <FieldControl>
                <Input inputMode="decimal" value={adjustment} onChange={(e) => setAdjustment(e.target.value)} />
              </FieldControl>
              <FieldHint>{t("payroll.leave.adjustmentHint")}</FieldHint>
              <FieldError>{a === null ? t("payroll.common.halfDaysInvalid") : null}</FieldError>
            </Field>
          </div>
          <Field>
            <FieldLabel optional>{t("payroll.mark.note")}</FieldLabel>
            <FieldControl>
              <Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
            </FieldControl>
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending || o === null || a === null}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              {t("payroll.common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
