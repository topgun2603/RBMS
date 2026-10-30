"use client";

import * as React from "react";
import { CalendarClockIcon } from "lucide-react";
import { Skeleton } from "@rbms/ui";
import { InsightCard, ModuleLink, useI18n } from "@rbms/web";
import { ScheduleStatus, useDateTime, useRelativeTime } from "../components/reports/shared";
import { isStatus } from "../lib/http";
import { useSavedReports, useSchedules } from "../lib/queries/reports";
import { sortByLastRun } from "../lib/report-spec";

/** Dashboard card: the most recently run report schedules (up to 3) with last status and next run. */
export function ScheduledReportsWidget() {
  const { t } = useI18n();
  const rel = useRelativeTime();
  const dt = useDateTime();
  const schedules = useSchedules();
  const saved = useSavedReports();

  if (isStatus(schedules.error, 403) || isStatus(saved.error, 403)) return null;

  const items = schedules.data ? sortByLastRun(schedules.data).slice(0, 2) : [];
  const nameOf = (id: string) => saved.data?.find((r) => r.id === id)?.name ?? t("growth.reports.schedule.unknownReport");

  return (
    <InsightCard icon={CalendarClockIcon} title={t("growth.widgets.scheduleTitle")} to="reports" linkLabel={t("growth.widgets.openReports")}>
      {schedules.isPending ? (
        <div className="grid gap-2" aria-busy="true">
          {Array.from({ length: 2 }, (_, i) => (
            <Skeleton key={i} className="h-10 rounded-lg" />
          ))}
        </div>
      ) : schedules.isError ? (
        <p className="text-sm text-muted-foreground">{t("growth.reports.widget.error")}</p>
      ) : !items.length ? (
        <p className="text-sm text-muted-foreground">{t("growth.widgets.scheduleEmpty")}</p>
      ) : (
        <ul className="grid divide-y">
          {items.map((s) => (
            <li key={s.id} className="grid gap-0.5 py-2 first:pt-0 last:pb-0">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <ModuleLink to={`reports/${s.reportId}`} className="min-w-0 truncate text-sm font-medium hover:underline">
                  {nameOf(s.reportId)}
                </ModuleLink>
                <ScheduleStatus schedule={s} />
              </div>
              <p className="truncate text-xs text-muted-foreground" title={dt(s.lastRunAt)}>
                {s.lastRunAt ? t("growth.widgets.scheduleLast", { when: rel(s.lastRunAt) }) : t("growth.widgets.scheduleNever")}
                {s.active && s.nextRunAt && <> · {t("growth.widgets.scheduleNext", { when: dt(s.nextRunAt) })}</>}
              </p>
              {s.lastStatus === "failed" && s.lastError && <p className="line-clamp-1 text-xs text-danger-ink">{s.lastError}</p>}
            </li>
          ))}
        </ul>
      )}
    </InsightCard>
  );
}
