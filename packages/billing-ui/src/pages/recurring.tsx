"use client";

import * as React from "react";
import { ModuleLink, Page, PageHeading, useI18n, useModuleNavigate, usePermission, useServerTable, type ServerFilterDefs } from "@rbms/web";
import { PlusIcon, RepeatIcon } from "lucide-react";
import { Button, ChipGroup, cn, DataTable, DataTableToolbar, EmptyState, InitialsAvatar, type DataTableColumn } from "@rbms/ui";
import { RecurringStatusPill, useScheduleText } from "../components/recurring/rc-ui";
import { money } from "../lib/format";
import { RECURRING_PATH, useRecurringSummary } from "../lib/queries-recurring";
import { RECURRING_FREQUENCIES, RECURRING_STATUSES, type RecurringProfile } from "../lib/types-recurring";

export default function RecurringPage() {
  return (
    <React.Suspense fallback={null}>
      <List />
    </React.Suspense>
  );
}

/** Recurring bill profiles: server-paged, sorted and filtered (docs/CONVENTIONS.md "Lists and tables"). */
function List() {
  const { t, formatDate } = useI18n();
  const navigate = useModuleNavigate();
  const canManage = usePermission("recurring.manage");
  const schedule = useScheduleText();
  const summary = useRecurringSummary();

  const filters = React.useMemo(
    () =>
      ({
        status: { kind: "options", label: t("billing.recurring.list.status"), options: RECURRING_STATUSES.map((s) => ({ value: s, label: t(`billing.recurring.status.${s}`) })) },
        frequency: { kind: "options", label: t("billing.recurring.list.frequency"), options: RECURRING_FREQUENCIES.map((f) => ({ value: f, label: t(`billing.recurring.frequency.${f}`) })) },
        customerId: { kind: "text" },
      }) satisfies ServerFilterDefs,
    [t],
  );

  const columns = React.useMemo<DataTableColumn<RecurringProfile>[]>(
    () => [
      {
        id: "name",
        header: t("billing.recurring.list.col.name"),
        sortable: true,
        hideable: false,
        card: "subtitle",
        cell: (r) => (
          <ModuleLink to={`recurring/${r.id}`} className="font-medium outline-none hover:text-primary hover:underline focus-visible:underline">
            {r.name}
          </ModuleLink>
        ),
      },
      {
        id: "customer",
        header: t("billing.recurring.list.col.customer"),
        sortable: true,
        card: "title",
        className: "max-w-[16rem]",
        cell: (r) => (
          <div className="flex min-w-0 items-center gap-2.5">
            <InitialsAvatar name={r.customerName} size="sm" />
            <span className={cn("truncate", r.status === "ended" && "text-muted-foreground")}>{r.customerName}</span>
          </div>
        ),
        cardCell: (r) => <span>{r.customerName}</span>,
      },
      { id: "repeats", header: t("billing.recurring.list.col.repeats"), hideBelow: "md", card: "meta", cell: (r) => <span>{schedule(r)}</span> },
      {
        id: "next",
        header: t("billing.recurring.list.col.next"),
        sortable: true,
        card: "meta",
        cell: (r) => <span className="tabular-nums">{r.status === "active" && r.nextRunDate ? formatDate(r.nextRunDate) : "—"}</span>,
      },
      {
        id: "count",
        header: t("billing.recurring.list.col.count"),
        sortable: true,
        numeric: true,
        hideBelow: "lg",
        cell: (r) => <span className="tabular-nums">{r.maxCount ? t("billing.recurring.countOf", { count: r.count, max: r.maxCount }) : r.count}</span>,
      },
      { id: "status", header: t("billing.recurring.list.status"), card: "right", cell: (r) => <RecurringStatusPill status={r.status} /> },
      { id: "estimate", header: t("billing.recurring.list.col.estimate"), numeric: true, card: "right", cell: (r) => <span className="font-semibold">{money(r.estimate)}</span> },
    ],
    [t, formatDate, schedule],
  );

  const st = useServerTable<RecurringProfile, typeof filters>({
    queryKey: ["recurring", "table"],
    path: RECURRING_PATH,
    columns,
    filters,
    defaultSort: "next",
    search: t("billing.recurring.list.search"),
    storageKey: "billing-recurring",
  });

  const status = st.filters.status;
  const counts = st.facets?.status;
  const pill = status.value.length === 0 ? "all" : status.value.length === 1 ? status.value[0]! : "";
  const filtered = st.table.activeFilterCount > 0;
  const s = summary.data;

  const newButton = canManage ? (
    <Button asChild size="lg">
      <ModuleLink to="recurring/new">
        <PlusIcon /> {t("billing.recurring.new")}
      </ModuleLink>
    </Button>
  ) : undefined;

  const strip = s
    ? [
        { label: t("billing.recurring.summary.active"), value: String(s.active) },
        { label: t("billing.recurring.summary.dueThisWeek"), value: String(s.dueThisWeek) },
        { label: t("billing.recurring.summary.failed"), value: String(s.failed), tone: s.failed > 0 ? "text-warning-ink" : undefined },
      ]
    : null;

  return (
    <Page>
      <PageHeading icon={RepeatIcon} title={t("billing.recurring.list.title")} description={t("billing.recurring.list.subtitle")} actions={newButton} />
      {strip && (
        <div className="mb-3 grid grid-cols-3 gap-2 rounded-2xl border border-card-ring bg-card p-3 shadow-elevated" aria-live="polite">
          {strip.map((x) => (
            <div key={x.label} className="min-w-0 text-center sm:text-left">
              <p className="truncate text-xs text-muted-foreground sm:text-meta">{x.label}</p>
              <p className={cn("truncate font-heading text-lg font-bold tabular-nums", "tone" in x ? x.tone : undefined)}>{x.value}</p>
            </div>
          ))}
        </div>
      )}
      <DataTableToolbar
        table={st.table}
        quickFilters={
          <ChipGroup
            size="sm"
            aria-label={t("billing.recurring.list.status")}
            value={pill}
            onChange={(v) => status.set(v === "all" ? [] : [v])}
            options={[
              { value: "all", label: t("billing.recurring.list.all") },
              ...RECURRING_STATUSES.map((x) => ({ value: x, label: t(`billing.recurring.status.${x}`), meta: counts ? counts[x] || undefined : undefined })),
            ]}
          />
        }
      />
      <DataTable
        table={st.table}
        onRowClick={(r) => navigate(`recurring/${r.id}`)}
        empty={
          filtered ? undefined : (
            <EmptyState className="border-0 bg-transparent" icon={RepeatIcon} title={t("billing.recurring.list.emptyTitle")} description={t("billing.recurring.list.emptyBody")} action={newButton} />
          )
        }
      />
    </Page>
  );
}
