"use client";

import * as React from "react";
import { ArrowRightIcon, CalendarClockIcon } from "lucide-react";
import { Button, Skeleton } from "@srirealtime/ui";
import { ModuleLink, useI18n } from "@srirealtime/web";
import { SectionCard } from "../components/bits";
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

  const items = schedules.data ? sortByLastRun(schedules.data).slice(0, 3) : [];
  const nameOf = (id: string) => saved.data?.find((r) => r.id === id)?.name ?? t("growth.reports.schedule.unknownReport");

  return (
    <SectionCard
      icon={CalendarClockIcon}
      title={t("growth.widgets.scheduleTitle")}
      className="h-full"
      action={
        <Button asChild size="sm" variant="ghost" className="text-muted-foreground">
          <ModuleLink to="reports">
            <span className="hidden sm:inline">{t("growth.widgets.openReports")}</span>
            <ArrowRightIcon />
          </ModuleLink>
        </Button>
      }
    >
      {schedules.isPending ? (
        <div className="grid gap-2" aria-busy="true">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      ) : schedules.isError ? (
        <p className="text-sm text-muted-foreground">{t("growth.reports.widget.error")}</p>
      ) : !items.length ? (
        <p className="text-sm text-muted-foreground">{t("growth.widgets.scheduleEmpty")}</p>
      ) : (
        <ul className="grid divide-y">
          {items.map((s) => (
            <li key={s.id} className="grid gap-1 py-2 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-2">
                <ModuleLink to={`reports/${s.reportId}`} className="min-w-0 truncate text-sm font-medium hover:underline">
                  {nameOf(s.reportId)}
                </ModuleLink>
                <ScheduleStatus schedule={s} />
              </div>
              <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                <span title={dt(s.lastRunAt)}>{s.lastRunAt ? t("growth.widgets.scheduleLast", { when: rel(s.lastRunAt) }) : t("growth.widgets.scheduleNever")}</span>
                {s.active && s.nextRunAt && <span>{t("growth.widgets.scheduleNext", { when: dt(s.nextRunAt) })}</span>}
              </p>
              {s.lastStatus === "failed" && s.lastError && <p className="line-clamp-2 text-xs text-danger-ink">{s.lastError}</p>}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
