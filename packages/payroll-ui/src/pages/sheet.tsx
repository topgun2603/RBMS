"use client";

import * as React from "react";
import { ChevronLeftIcon, ChevronRightIcon, FileSpreadsheetIcon, HistoryIcon, LockIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle, Button, cn, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, toast } from "@rbms/ui";
import { api, describeError, Page, PageHeading, useI18n } from "@rbms/web";
import { BranchFilter, InlineError } from "../components/bits";
import { MarkDialog, type MarkTarget } from "../components/mark-dialog";
import { addMonths, hours, istTime, monthName, todayIst, weekdayName } from "../lib/format";
import { FILES, useLog, useSheet } from "../lib/queries";
import type { DayBoard, LogEntry } from "../lib/types";

const CODE_TONE: Record<string, string> = {
  P: "text-success",
  A: "bg-destructive/10 text-destructive font-semibold",
  H: "bg-warning/10 text-warning-foreground",
  WO: "text-muted-foreground",
  HO: "text-primary",
  "-": "text-muted-foreground/50",
};

/** The month sheet: a code per person per day, the totals payroll uses, corrections, and a CSV. */
export default function SheetPage() {
  const { t, locale } = useI18n();
  const [month, setMonth] = React.useState(todayIst().slice(0, 7));
  const [branchId, setBranchId] = React.useState("");
  const [showLog, setShowLog] = React.useState(false);
  const sheet = useSheet(month, branchId || undefined);
  const [editing, setEditing] = React.useState<MarkTarget | null>(null);
  const s = sheet.data;
  const thisMonth = todayIst().slice(0, 7);

  const open = async (employee: { id: string; name: string }, date: string) => {
    if (date > todayIst()) return;
    try {
      const day = await api.get<DayBoard>("/payroll/attendance/day", { date });
      setEditing({ employee, date, mark: day.items.find((r) => r.employee.id === employee.id)?.mark ?? null });
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const csv = () => FILES.sheetCsv(month, branchId || undefined).catch((err) => toast.error(describeError(err, t)));

  return (
    <Page width="full">
      <PageHeading
        title={t("payroll.sheet.title")}
        description={t("payroll.sheet.description")}
        actions={
          <>
            <Button variant="outline" onClick={() => setShowLog((v) => !v)}>
              <HistoryIcon /> {t("payroll.sheet.log")}
            </Button>
            <Button variant="outline" onClick={csv}>
              <FileSpreadsheetIcon /> {t("payroll.common.csv")}
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon" variant="outline" aria-label={t("payroll.common.prevMonth")} onClick={() => setMonth(addMonths(month, -1))}>
          <ChevronLeftIcon />
        </Button>
        <span className="min-w-40 text-center font-medium">{monthName(month, locale)}</span>
        <Button size="icon" variant="outline" aria-label={t("payroll.common.nextMonth")} disabled={month >= thisMonth} onClick={() => setMonth(addMonths(month, 1))}>
          <ChevronRightIcon />
        </Button>
        <BranchFilter value={branchId} onChange={setBranchId} />
        <span className="ml-auto text-meta text-muted-foreground">{t("payroll.sheet.legend")}</span>
      </div>
      {s?.finalized && (
        <Alert>
          <LockIcon />
          <AlertTitle>{t("payroll.common.finalizedTitle")}</AlertTitle>
          <AlertDescription>{t("payroll.common.finalizedBody")}</AlertDescription>
        </Alert>
      )}
      {sheet.isError ? (
        <InlineError title={describeError(sheet.error, t)} />
      ) : !s ? (
        <Skeleton className="h-72" />
      ) : s.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("payroll.sheet.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-muted/50">
                <th className="sticky left-0 z-10 bg-muted px-2 py-2 text-left font-medium">{t("payroll.col.name")}</th>
                {s.dates.map((d) => (
                  <th key={d} className="min-w-8 px-1 py-1 text-center font-normal text-muted-foreground">
                    <span className="block font-medium text-foreground">{Number(d.slice(8))}</span>
                    {weekdayName(new Date(`${d}T00:00:00Z`).getUTCDay(), locale).slice(0, 2)}
                  </th>
                ))}
                <th className="px-2 text-right font-medium">{t("payroll.col.present")}</th>
                <th className="px-2 text-right font-medium">{t("payroll.col.lop")}</th>
                <th className="px-2 text-right font-medium">{t("payroll.col.otHours")}</th>
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r) => (
                <tr key={r.employee.id} className="border-t">
                  <td className="sticky left-0 z-10 bg-background px-2 py-1.5 whitespace-nowrap">
                    <span className="font-medium">{r.employee.name}</span> <span className="text-muted-foreground">{r.employee.code}</span>
                  </td>
                  {r.cells.map((c) => (
                    <td key={c.date} className="p-0 text-center">
                      <button
                        type="button"
                        disabled={s.finalized || c.code === "-" || c.date > todayIst()}
                        onClick={() => open(r.employee, c.date)}
                        title={c.overtimeMinutes ? t("payroll.sheet.otTitle", { hours: hours(c.overtimeMinutes) }) : undefined}
                        className={cn("relative h-8 w-full min-w-8 px-0.5 tabular-nums hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent", CODE_TONE[c.code.split("/")[0]!] ?? "text-info")}
                      >
                        {c.code || "·"}
                        {c.late && <span aria-label={t("payroll.col.late")} className="absolute top-1 right-1 size-1.5 rounded-full bg-warning" />}
                      </button>
                    </td>
                  ))}
                  <td className="px-2 text-right tabular-nums">{r.counts.present + r.counts.halfDays * 0.5}</td>
                  <td className="px-2 text-right tabular-nums">{r.counts.lopDays}</td>
                  <td className="px-2 text-right tabular-nums">{hours(r.counts.overtimeMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showLog && s && <CorrectionsLog from={s.from} to={s.to} />}
      <MarkDialog target={editing} onOpenChange={(o) => !o && setEditing(null)} />
    </Page>
  );
}

const describe = (x: Record<string, unknown> | null, t: (k: string) => string) => {
  if (!x) return t("payroll.sheet.logNone");
  const status = typeof x.status === "string" ? t(`payroll.status.${x.status}`) : "";
  const times = [x.checkIn, x.checkOut].filter((v): v is string => typeof v === "string").map(istTime).join("–");
  return [status, times].filter(Boolean).join(" ");
};

function CorrectionsLog({ from, to }: { from: string; to: string }) {
  const { t, formatDate } = useI18n();
  const log = useLog({ from, to });
  const items: LogEntry[] = log.data?.items ?? [];
  return (
    <section className="grid gap-2">
      <h2 className="text-sm font-semibold">{t("payroll.sheet.logTitle")}</h2>
      {log.isPending ? (
        <Skeleton className="h-24" />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("payroll.sheet.logEmpty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("payroll.col.when")}</TableHead>
              <TableHead>{t("payroll.col.name")}</TableHead>
              <TableHead>{t("payroll.col.date")}</TableHead>
              <TableHead>{t("payroll.col.before")}</TableHead>
              <TableHead>{t("payroll.col.after")}</TableHead>
              <TableHead>{t("payroll.col.reason")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="tabular-nums">
                  {formatDate(e.at)} {istTime(e.at)}
                </TableCell>
                <TableCell>{e.employeeName}</TableCell>
                <TableCell>{formatDate(e.date)}</TableCell>
                <TableCell>{describe(e.before, t)}</TableCell>
                <TableCell>{describe(e.after, t)}</TableCell>
                <TableCell className="whitespace-normal">{e.reason ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
