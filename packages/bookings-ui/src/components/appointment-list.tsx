"use client";

import * as React from "react";
import { CalendarCheckIcon } from "lucide-react";
import { ChipGroup, DataTable, DataTableToolbar, EmptyState, type DataTableColumn } from "@srirealtime/ui";
import { useI18n, useModuleNavigate, useQueryParams, useServerTable, type ServerFilterDefs } from "@srirealtime/web";
import { istTime, money, time12, istMinute } from "../lib/format";
import { bk } from "../lib/queries";
import { APPOINTMENT_STATUSES, type AppointmentRow } from "../lib/types";
import { AppointmentStatusPill, SourceMark, StaffDot } from "./bits";

const WHEN = ["upcoming", "past", "all"] as const;
type When = (typeof WHEN)[number];

/** Server-paged list of appointments (upcoming by default) with status / date filters and search. */
export function AppointmentList({ onOpen }: { onOpen: (id: string) => void }) {
  const { t, formatDate } = useI18n();
  const params = useQueryParams();
  const navigate = useModuleNavigate();
  const raw = params.get("when");
  const when: When = raw === "past" || raw === "all" ? raw : "upcoming";
  const setWhen = (w: When) => {
    const next = new URLSearchParams(params.toString());
    if (w === "upcoming") next.delete("when");
    else next.set("when", w);
    next.delete("page");
    navigate(`?${next.toString()}`, { replace: true, scroll: false });
  };

  const filters = React.useMemo(
    () =>
      ({
        status: { kind: "options", label: t("bookings.list.status"), options: APPOINTMENT_STATUSES.map((s) => ({ value: s, label: t(`bookings.status.${s}`) })) },
        date: { kind: "dateRange", label: t("bookings.list.date") },
      }) satisfies ServerFilterDefs,
    [t],
  );

  const columns = React.useMemo<DataTableColumn<AppointmentRow>[]>(
    () => [
      {
        id: "start",
        header: t("bookings.list.when"),
        sortable: true,
        hideable: false,
        card: "subtitle",
        cell: (r) => (
          <span className="tabular-nums">
            {formatDate(r.businessDate, { weekday: "short", day: "numeric", month: "short" })} · {time12(istMinute(r.start))}
          </span>
        ),
        cardCell: (r) => `#${r.number} · ${formatDate(r.businessDate, { day: "numeric", month: "short" })} ${istTime(r.start)}`,
      },
      { id: "number", header: "#", sortable: true, defaultHidden: true, cell: (r) => <span className="tabular-nums">{r.number}</span> },
      {
        id: "customer",
        header: t("bookings.list.customer"),
        sortable: true,
        hideable: false,
        card: "title",
        cell: (r) => (
          <span className="flex items-center gap-1.5 font-medium">
            {r.customerName} <SourceMark source={r.source} />
            {r.customerPhone && <span className="font-normal text-muted-foreground">· {r.customerPhone}</span>}
          </span>
        ),
      },
      { id: "services", header: t("bookings.list.services"), card: "meta", cell: (r) => r.services ?? "—" },
      {
        id: "staff",
        header: t("bookings.list.staff"),
        card: "meta",
        cell: (r) =>
          r.staffName ? (
            <span className="flex items-center gap-1.5">
              <StaffDot color={r.staffColor} /> {r.staffName}
            </span>
          ) : (
            <span className="text-muted-foreground">{t("bookings.calendar.unassigned")}</span>
          ),
      },
      { id: "status", header: t("bookings.list.status"), sortable: true, card: "right", cell: (r) => <AppointmentStatusPill status={r.status} /> },
      { id: "amount", header: t("bookings.list.amount"), numeric: true, card: "right", cell: (r) => money(r.amount) },
    ],
    [t, formatDate],
  );

  const st = useServerTable<AppointmentRow, typeof filters>({
    queryKey: bk.list,
    path: "/bookings/appointments",
    columns,
    filters,
    defaultSort: "start",
    search: t("bookings.list.search"),
    storageKey: "bookings-appointments",
    params: when === "all" ? undefined : { when },
  });

  return (
    <div className="grid gap-3">
      <DataTableToolbar
        table={st.table}
        quickFilters={
          <ChipGroup
            size="sm"
            aria-label={t("bookings.list.when")}
            value={when}
            onChange={setWhen}
            options={WHEN.map((w) => ({ value: w, label: t(`bookings.list.${w}`) }))}
          />
        }
      />
      <DataTable
        table={st.table}
        onRowClick={(r) => onOpen(r.id)}
        empty={<EmptyState icon={CalendarCheckIcon} title={t("bookings.list.emptyTitle")} description={t("bookings.list.emptyBody")} compact />}
      />
    </div>
  );
}
