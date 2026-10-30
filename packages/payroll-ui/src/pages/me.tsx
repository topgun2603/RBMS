"use client";

import * as React from "react";
import { CalendarPlusIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon, FileDownIcon, Loader2Icon, LogInIcon, LogOutIcon, UserRoundIcon } from "lucide-react";
import { Button, Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle, cn, EmptyState, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, toast } from "@rbms/ui";
import { describeError, Page, PageHeading, useFeature, useI18n } from "@rbms/web";
import { DayPill, InlineError } from "../components/bits";
import { LeaveDialog } from "../components/leave-dialog";
import { PAYROLL_FEATURES } from "../lib/access";
import { addMonths, hours, istTime, minutesLabel, money, monthName, todayIst, weekdayName } from "../lib/format";
import { FILES, useCancelMyLeave, useMe, useMyAttendance, useMyPayslips, useSelfCheck } from "../lib/queries";
import { leaveDates, LeaveStatusPill } from "./leave";

/** The signed-in person's own day, month, leave and payslips. */
export default function MePage() {
  const { t } = useI18n();
  const me = useMe();
  if (me.isError) return <Page><InlineError title={describeError(me.error, t)} /></Page>;
  if (!me.data) return <Page><Skeleton className="h-64" /></Page>;
  if (!me.data.employee) {
    return (
      <Page>
        <PageHeading title={t("payroll.me.title")} />
        <EmptyState icon={UserRoundIcon} title={t("payroll.me.notLinkedTitle")} description={t("payroll.me.notLinkedBody")} />
      </Page>
    );
  }
  return <Mine />;
}

function Mine() {
  const { t, locale, formatDate } = useI18n();
  const me = useMe();
  const salaryOn = useFeature(PAYROLL_FEATURES.salary);
  const check = useSelfCheck();
  const cancel = useCancelMyLeave();
  const [month, setMonth] = React.useState(todayIst().slice(0, 7));
  const att = useMyAttendance(month);
  const slips = useMyPayslips(salaryOn);
  const [asking, setAsking] = React.useState(false);
  const d = me.data!;
  const e = d.employee!;
  const mark = d.today?.mark ?? null;
  const thisMonth = todayIst().slice(0, 7);

  const doCheck = async () => {
    try {
      const r = await check.mutateAsync();
      toast.success(r.action === "in" ? t("payroll.me.checkedIn", { time: istTime(r.at) }) : t("payroll.me.checkedOut", { time: istTime(r.at), worked: minutesLabel(r.workedMinutes) }));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const fail = (err: unknown) => toast.error(describeError(err, t));
  const inNow = !!mark?.checkIn && !mark.checkOut;
  const done = !!mark?.checkIn && !!mark.checkOut;
  const row = att.data?.row;

  return (
    <Page>
      <PageHeading title={t("payroll.me.title")} description={[e.name, e.code, e.designation].filter(Boolean).join(" · ")} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClockIcon className="size-4 text-primary" /> {t("payroll.me.today", { date: formatDate(d.today?.date ?? todayIst()) })}
          </CardTitle>
          <CardDescription>{t("payroll.me.shift", { start: e.shiftStart, end: e.shiftEnd })}</CardDescription>
          {d.selfCheckIn && !done && (
            <CardAction>
              <Button size="lg" onClick={doCheck} disabled={check.isPending}>
                {check.isPending ? <Loader2Icon className="animate-spin" /> : inNow ? <LogOutIcon /> : <LogInIcon />} {inNow ? t("payroll.me.checkOut") : t("payroll.me.checkIn")}
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 text-sm">
          <DayPill status={mark?.status ?? null} />
          {mark?.checkIn && <span className="tabular-nums">{t("payroll.me.inAt", { time: istTime(mark.checkIn) })}</span>}
          {mark?.checkOut && <span className="tabular-nums">{t("payroll.me.outAt", { time: istTime(mark.checkOut) })}</span>}
          {mark?.lateMinutes ? <span className="text-warning-foreground">{t("payroll.kiosk.late", { minutes: mark.lateMinutes })}</span> : null}
          {!d.selfCheckIn && <span className="text-muted-foreground">{t("payroll.me.selfOff")}</span>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{monthName(month, locale)}</CardTitle>
          <CardDescription>
            {row ? t("payroll.me.monthSummary", { present: row.counts.present + row.counts.halfDays * 0.5, leave: row.counts.paidLeave + row.counts.unpaidLeave, lop: row.counts.lopDays, ot: hours(row.counts.overtimeMinutes) }) : ""}
          </CardDescription>
          <CardAction className="flex gap-1">
            <Button size="icon" variant="outline" aria-label={t("payroll.common.prevMonth")} onClick={() => setMonth(addMonths(month, -1))}>
              <ChevronLeftIcon />
            </Button>
            <Button size="icon" variant="outline" aria-label={t("payroll.common.nextMonth")} disabled={month >= thisMonth} onClick={() => setMonth(addMonths(month, 1))}>
              <ChevronRightIcon />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {!row ? (
            <Skeleton className="h-32" />
          ) : (
            <div className="grid grid-cols-7 gap-1 text-center text-xs">
              {[0, 1, 2, 3, 4, 5, 6].map((w) => (
                <span key={w} className="py-1 text-muted-foreground">
                  {weekdayName(w, locale)}
                </span>
              ))}
              {Array.from({ length: new Date(`${month}-01T00:00:00Z`).getUTCDay() }, (_, i) => (
                <span key={`b${i}`} />
              ))}
              {row.cells.map((c) => (
                <span key={c.date} className={cn("grid rounded-md border py-1.5", c.code === "A" && "border-destructive/40 bg-destructive/10", c.code === "P" && "border-success/30 bg-success/5")}>
                  <span className="font-medium">{Number(c.date.slice(8))}</span>
                  <span className="text-muted-foreground">{c.code || "·"}</span>
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("payroll.me.leave")}</CardTitle>
          <CardDescription>
            {(d.balances ?? [])
              .filter((b) => b.balance !== null)
              .map((b) => `${b.name}: ${b.balance}`)
              .join(" · ") || t("payroll.me.noBalances")}
          </CardDescription>
          <CardAction>
            <Button size="sm" onClick={() => setAsking(true)}>
              <CalendarPlusIcon /> {t("payroll.leave.requestTitle")}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {(d.requests ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("payroll.me.noRequests")}</p>
          ) : (
            <ul className="grid gap-1">
              {(d.requests ?? []).map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-2 odd:bg-muted/40">
                  <span className="text-sm">
                    {r.leaveTypeName} · {leaveDates(r, formatDate, t)} · {t("payroll.me.daysN", { days: r.days })}
                  </span>
                  <span className="flex items-center gap-2">
                    <LeaveStatusPill status={r.status} />
                    {r.status === "pending" && (
                      <Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutateAsync(r.id).then(() => toast.success(t("payroll.leave.done.cancel")), fail)}>
                        {t("payroll.common.cancel")}
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {salaryOn && (
        <Card>
          <CardHeader>
            <CardTitle>{t("payroll.me.payslips")}</CardTitle>
          </CardHeader>
          <CardContent>
            {slips.isPending ? (
              <Skeleton className="h-20" />
            ) : (slips.data?.items ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("payroll.me.noPayslips")}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("payroll.common.month")}</TableHead>
                    <TableHead numeric>{t("payroll.col.paidDays")}</TableHead>
                    <TableHead numeric>{t("payroll.col.gross")}</TableHead>
                    <TableHead numeric>{t("payroll.col.net")}</TableHead>
                    <TableHead className="text-right">{t("payroll.run.payslip")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slips.data!.items.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{monthName(p.month, locale)}</TableCell>
                      <TableCell numeric>{p.paidDays}</TableCell>
                      <TableCell numeric>{money(p.gross)}</TableCell>
                      <TableCell numeric className="font-semibold">
                        {money(p.net)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => FILES.myPayslip(p.id, "en", `payslip-${p.month}.pdf`).catch(fail)}>
                          <FileDownIcon /> EN
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => FILES.myPayslip(p.id, "ta", `payslip-${p.month}-ta.pdf`).catch(fail)}>
                          <FileDownIcon /> தமிழ்
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
      <LeaveDialog open={asking} onOpenChange={setAsking} self />
    </Page>
  );
}
