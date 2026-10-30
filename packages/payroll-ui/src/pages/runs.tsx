"use client";

import * as React from "react";
import { Loader2Icon, PlayIcon, WalletIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle, Button, EmptyState, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, toast } from "@rbms/ui";
import { describeError, Page, PageHeading, useI18n, useModuleNavigate } from "@rbms/web";
import { InlineError, MonthInput, RunPill } from "../components/bits";
import { addMonths, money, monthName, todayIst } from "../lib/format";
import { isCode } from "../lib/http";
import { useCreateRun, useRuns } from "../lib/queries";

/** Payroll by month: start a month's payroll (worked out from attendance), see what was paid. */
export default function RunsPage() {
  const { t, locale } = useI18n();
  const navigate = useModuleNavigate();
  const runs = useRuns();
  const create = useCreateRun();
  const thisMonth = todayIst().slice(0, 7);
  const items = runs.data?.items ?? [];
  const live = items.filter((r) => r.status !== "cancelled");
  // Suggest last month until this month's payroll is due (most shops pay in the first week).
  const suggested = live.some((r) => r.month === addMonths(thisMonth, -1)) ? thisMonth : addMonths(thisMonth, -1);
  const [month, setMonth] = React.useState(suggested);
  React.useEffect(() => setMonth(suggested), [suggested]);

  const start = async () => {
    try {
      const r = await create.mutateAsync({ month });
      navigate(`payroll/${r.id}`);
    } catch (err) {
      const existing = live.find((x) => x.month === month);
      if (isCode(err, "run_exists") && existing) navigate(`payroll/${existing.id}`);
      else toast.error(describeError(err, t));
    }
  };

  return (
    <Page>
      <PageHeading
        title={t("payroll.runs.title")}
        description={t("payroll.runs.description")}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <MonthInput value={month} onChange={setMonth} max={thisMonth} />
            <Button onClick={start} disabled={create.isPending}>
              {create.isPending ? <Loader2Icon className="animate-spin" /> : <PlayIcon />} {t("payroll.runs.start", { month: monthName(month, locale) })}
            </Button>
          </span>
        }
      />
      <Alert>
        <WalletIcon />
        <AlertTitle>{t("payroll.runs.booksTitle")}</AlertTitle>
        <AlertDescription>{t("payroll.runs.booksBody")}</AlertDescription>
      </Alert>
      {runs.isError ? (
        <InlineError title={describeError(runs.error, t)} />
      ) : runs.isPending ? (
        <Skeleton className="h-40" />
      ) : items.length === 0 ? (
        <EmptyState icon={WalletIcon} title={t("payroll.runs.emptyTitle")} description={t("payroll.runs.emptyBody")} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("payroll.common.month")}</TableHead>
              <TableHead>{t("payroll.col.status")}</TableHead>
              <TableHead numeric>{t("payroll.col.staff")}</TableHead>
              <TableHead numeric>{t("payroll.col.gross")}</TableHead>
              <TableHead numeric>{t("payroll.col.net")}</TableHead>
              <TableHead numeric>{t("payroll.col.paid")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((r) => (
              <TableRow key={r.id} className="cursor-pointer" onClick={() => navigate(`payroll/${r.id}`)}>
                <TableCell className="font-medium">{monthName(r.month, locale)}</TableCell>
                <TableCell>
                  <RunPill status={r.status} />
                </TableCell>
                <TableCell numeric>{r.totals?.staff ?? 0}</TableCell>
                <TableCell numeric>{money(r.totals?.gross)}</TableCell>
                <TableCell numeric>{money(r.totals?.net)}</TableCell>
                <TableCell numeric>
                  {r.status === "finalized" ? t("payroll.runs.paidOf", { paid: r.paid.count, staff: r.totals?.staff ?? 0 }) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Page>
  );
}
