"use client";

import * as React from "react";
import { ArrowRightIcon, CalendarCheckIcon, CalendarClockIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Skeleton } from "@rbms/ui";
import { KpiTile, ModuleLink, QueryError, useI18n } from "@rbms/web";
import { AppointmentStatusPill, StaffDot } from "../components/bits";
import { istMinute, time12, todayIST } from "../lib/format";
import { useSummary } from "../lib/queries";

/** KPI tile "Appointments today": the count, with how many are still to come. */
export function TodayKpiWidget() {
  const { t } = useI18n();
  const s = useSummary();
  const d = s.data;
  const toCome = d ? (d.byStatus.booked ?? 0) + (d.byStatus.confirmed ?? 0) + (d.byStatus.arrived ?? 0) : 0;
  const next = d?.upcoming[0];
  return (
    <KpiTile
      label={t("bookings.widget.today")}
      icon={CalendarCheckIcon}
      value={d?.today}
      hint={
        d
          ? next && next.businessDate === todayIST()
            ? t("bookings.widget.kpiHintNext", { count: toCome, time: time12(istMinute(next.start)) })
            : t("bookings.widget.kpiHint", { count: toCome })
          : undefined
      }
      to=""
      loading={s.isPending}
      error={s.isError}
      onRetry={() => void s.refetch()}
    />
  );
}

/** "Next appointments": the next five still to come, soonest first. */
export function NextAppointmentsWidget() {
  const { t, formatDate } = useI18n();
  const s = useSummary();
  const items = s.data?.upcoming ?? [];
  const today = todayIST();
  return (
    <Card className="h-full gap-2 py-4">
      <CardHeader className="flex flex-row items-center justify-between px-4 sm:px-5">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className="icon-chip size-8 text-primary">
            <CalendarClockIcon className="size-4" />
          </span>
          {t("bookings.widget.next")}
        </CardTitle>
        <Button asChild variant="ghost" size="sm">
          <ModuleLink to="">
            {t("bookings.widget.viewAll")} <ArrowRightIcon />
          </ModuleLink>
        </Button>
      </CardHeader>
      <CardContent className="px-1.5 sm:px-2.5">
        {s.isError ? (
          <QueryError compact error={s.error} onRetry={() => void s.refetch()} />
        ) : s.isPending ? (
          <div className="grid gap-2 px-2">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState compact icon={CalendarCheckIcon} title={t("bookings.widget.noneTitle")} description={t("bookings.widget.noneBody")} />
        ) : (
          <ul className="grid">
            {items.map((a) => (
              <li key={a.id}>
                <ModuleLink
                  to={`?${new URLSearchParams({ ...(a.businessDate !== today ? { date: a.businessDate } : {}), open: a.id }).toString()}`}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted"
                >
                  <span className="w-16 shrink-0 text-sm font-semibold tabular-nums">
                    {time12(istMinute(a.start))}
                    {a.businessDate !== today && <span className="block text-meta font-normal text-muted-foreground">{formatDate(a.businessDate, { day: "numeric", month: "short" })}</span>}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{a.customerName}</span>
                    <span className="flex items-center gap-1.5 truncate text-meta text-muted-foreground">
                      {a.staffName && <StaffDot color={a.staffColor} />}
                      {[a.staffName, a.items.map((i) => i.name).join(", ")].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <AppointmentStatusPill status={a.status} />
                </ModuleLink>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
