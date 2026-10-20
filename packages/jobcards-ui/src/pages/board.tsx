"use client";

import * as React from "react";
import { ClipboardListIcon, KanbanIcon, ListIcon, PlusIcon } from "lucide-react";
import { Button, Card, ChipGroup, cn, DataTable, DataTableToolbar, EmptyState, Skeleton, type DataTableColumn } from "@srirealtime/ui";
import {
  describeError,
  ModuleLink,
  Page,
  PageHeading,
  SearchField,
  useDebounced,
  useI18n,
  useModuleNavigate,
  usePermission,
  useQueryParams,
  useServerTable,
  type ServerFilterDefs,
} from "@srirealtime/web";
import { DueDate, InlineError, JobStatusPill, STATUS_TONE, TemplateIcon, UrgentBadge } from "../components/bits";
import { NewJobDialog } from "../components/new-job-dialog";
import { JOBCARDS_PERMISSIONS } from "../lib/access";
import { money } from "../lib/format";
import { jk, useBoard } from "../lib/queries";
import { BOARD_STATUSES, JOB_STATUSES, JOB_TEMPLATES, type JobSummary } from "../lib/types";

/** The job board (columns by status) and the full list (`?view=list`), plus the "New job" dialog (`?new=1`). */
export default function BoardPage() {
  return (
    <React.Suspense fallback={null}>
      <Jobs />
    </React.Suspense>
  );
}

function Jobs() {
  const { t } = useI18n();
  const params = useQueryParams();
  const navigate = useModuleNavigate();
  const canManage = usePermission(JOBCARDS_PERMISSIONS.manage);
  const view = params.get("view") === "list" ? "list" : "board";
  const [creating, setCreating] = React.useState(false);

  // Quick action / dashboard link: /jobs?new=1 opens the dialog.
  React.useEffect(() => {
    if (params.get("new") === "1" && canManage) setCreating(true);
  }, [params, canManage]);

  return (
    <Page width="full">
      <PageHeading
        title={t("jobcards.board.title")}
        description={t("jobcards.board.description")}
        actions={
          <>
            <ChipGroup
              size="sm"
              aria-label={t("jobcards.board.view")}
              value={view}
              onChange={(v) => navigate(v === "list" ? "?view=list" : "?", { replace: true, scroll: false })}
              options={[
                { value: "board", label: <span className="inline-flex items-center gap-1.5"><KanbanIcon className="size-4" />{t("jobcards.board.viewBoard")}</span> },
                { value: "list", label: <span className="inline-flex items-center gap-1.5"><ListIcon className="size-4" />{t("jobcards.board.viewList")}</span> },
              ]}
            />
            {canManage && (
              <Button onClick={() => setCreating(true)}>
                <PlusIcon /> {t("jobcards.new.title")}
              </Button>
            )}
          </>
        }
      />
      {view === "list" ? <JobList /> : <Board onNew={canManage ? () => setCreating(true) : undefined} />}
      <NewJobDialog open={creating} onOpenChange={setCreating} />
    </Page>
  );
}

function Board({ onNew }: { onNew?: () => void }) {
  const { t } = useI18n();
  const [q, setQ] = React.useState("");
  const [template, setTemplate] = React.useState<string>("all");
  const term = useDebounced(q, 300);
  const board = useBoard({ q: term, template: template === "all" ? undefined : template });
  const items = board.data?.items ?? [];
  const byStatus = React.useMemo(() => {
    const m = new Map<string, JobSummary[]>(BOARD_STATUSES.map((s) => [s, []]));
    for (const j of items) m.get(j.status)?.push(j);
    return m;
  }, [items]);

  if (board.isError) return <InlineError title={describeError(board.error, t)} />;
  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchField value={q} onChange={setQ} placeholder={t("jobcards.list.search")} className="sm:max-w-sm" />
        <ChipGroup
          size="sm"
          aria-label={t("jobcards.list.template")}
          value={template}
          onChange={setTemplate}
          options={[{ value: "all", label: t("jobcards.common.all") }, ...JOB_TEMPLATES.map((v) => ({ value: v, label: t(`jobcards.template.${v}`) }))]}
        />
      </div>
      {!board.isPending && items.length === 0 && !term && template === "all" ? (
        <EmptyState
          icon={ClipboardListIcon}
          title={t("jobcards.board.emptyTitle")}
          description={t("jobcards.board.emptyBody")}
          action={
            onNew && (
              <Button onClick={onNew}>
                <PlusIcon /> {t("jobcards.new.title")}
              </Button>
            )
          }
        />
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          <div className="grid min-w-max auto-cols-[17rem] grid-flow-col gap-3 xl:min-w-0 xl:auto-cols-fr">
            {BOARD_STATUSES.map((s) => {
              const jobs = byStatus.get(s) ?? [];
              return (
                <section key={s} aria-label={t(`jobcards.status.${s}`)} className="flex flex-col gap-2 rounded-xl bg-muted/40 p-2">
                  <header className="flex items-center justify-between px-1 py-0.5">
                    <JobStatusPill status={s} />
                    <span className="text-meta font-medium text-muted-foreground tabular-nums">{board.isPending ? "…" : jobs.length}</span>
                  </header>
                  {board.isPending ? (
                    <Skeleton className="h-24" />
                  ) : jobs.length === 0 ? (
                    <p className="px-1 py-4 text-center text-meta text-muted-foreground">{t("jobcards.board.columnEmpty")}</p>
                  ) : (
                    jobs.map((j) => <JobCard key={j.id} job={j} />)
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}
      {board.data && board.data.total > items.length && <p className="text-meta text-muted-foreground">{t("jobcards.board.more", { shown: items.length, total: board.data.total })}</p>}
    </div>
  );
}

function JobCard({ job }: { job: JobSummary }) {
  const { t } = useI18n();
  return (
    <ModuleLink to={`jobs/${job.id}`} className="group block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className={cn("grid gap-1.5 p-3 transition-shadow group-hover:shadow-md", job.overdue && "ring-1 ring-destructive/40", STATUS_TONE[job.status] === "success" && "bg-success/5")}>
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-meta font-semibold tabular-nums">
            <TemplateIcon template={job.template} />
            {job.label}
          </span>
          {job.priority === "urgent" && <UrgentBadge />}
        </div>
        <p className="truncate text-sm font-medium">{job.customerName}</p>
        {job.summary && <p className="line-clamp-2 text-meta text-muted-foreground">{job.summary}</p>}
        <div className="flex items-center justify-between gap-2 text-meta">
          <DueDate date={job.dueDate} overdue={job.overdue} />
          {job.overdue && <span className="font-medium text-destructive">{t("jobcards.common.overdue")}</span>}
        </div>
      </Card>
    </ModuleLink>
  );
}

function JobList() {
  const { t, formatDate } = useI18n();
  const navigate = useModuleNavigate();

  const filters = React.useMemo(
    () =>
      ({
        status: { kind: "options", label: t("jobcards.list.status"), options: JOB_STATUSES.map((s) => ({ value: s, label: t(`jobcards.status.${s}`) })) },
        template: { kind: "options", label: t("jobcards.list.template"), options: JOB_TEMPLATES.map((s) => ({ value: s, label: t(`jobcards.template.${s}`) })) },
        overdue: { kind: "options", label: t("jobcards.list.overdue"), single: true, options: [{ value: "1", label: t("jobcards.common.overdue") }] },
      }) satisfies ServerFilterDefs,
    [t],
  );

  const columns = React.useMemo<DataTableColumn<JobSummary>[]>(
    () => [
      {
        id: "number",
        header: t("jobcards.list.number"),
        sortable: true,
        sortDescFirst: true,
        hideable: false,
        card: "subtitle",
        cell: (r) => (
          <ModuleLink to={`jobs/${r.id}`} className="inline-flex items-center gap-1.5 font-medium tabular-nums hover:underline">
            <TemplateIcon template={r.template} />
            {r.label}
          </ModuleLink>
        ),
        cardCell: (r) => `${r.label}${r.dueDate ? ` · ${formatDate(r.dueDate)}` : ""}`,
      },
      {
        id: "customer",
        header: t("jobcards.list.customer"),
        hideable: false,
        card: "title",
        cell: (r) => (
          <span className="grid">
            <span className="font-medium">{r.customerName}</span>
            {r.customerPhone && <span className="text-meta text-muted-foreground">{r.customerPhone}</span>}
          </span>
        ),
        cardCell: (r) => r.customerName,
      },
      { id: "job", header: t("jobcards.list.job"), hideBelow: "md", cell: (r) => <span className="line-clamp-1 text-muted-foreground">{r.summary || t(`jobcards.template.${r.template}`)}</span> },
      {
        id: "status",
        header: t("jobcards.list.status"),
        card: "meta",
        cell: (r) => (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <JobStatusPill status={r.status} />
            {r.priority === "urgent" && <UrgentBadge />}
          </span>
        ),
      },
      { id: "due", header: t("jobcards.list.due"), sortable: true, card: "meta", cell: (r) => <DueDate date={r.dueDate} overdue={r.overdue} /> },
      { id: "total", header: t("jobcards.list.total"), numeric: true, card: "right", cell: (r) => (r.total ? money(r.total) : "—") },
      { id: "assignee", header: t("jobcards.list.assignee"), defaultHidden: true, hideBelow: "lg", cell: (r) => r.assigneeName ?? "—" },
      { id: "updated", header: t("jobcards.list.updated"), sortable: true, sortDescFirst: true, hideBelow: "lg", cell: (r) => formatDate(r.updatedAt) },
    ],
    [t, formatDate],
  );

  const st = useServerTable<JobSummary, typeof filters>({
    queryKey: jk.list,
    path: "/jobcards",
    columns,
    filters,
    defaultSort: "-updated",
    search: t("jobcards.list.search"),
    storageKey: "jobcards-list",
  });

  const status = st.filters.status;
  return (
    <>
      <DataTableToolbar
        table={st.table}
        quickFilters={
          <ChipGroup
            size="sm"
            aria-label={t("jobcards.list.status")}
            value={status.value.length === 0 ? "all" : status.value.length === 1 ? status.value[0]! : ""}
            onChange={(v) => status.set(v === "all" ? [] : [v as (typeof JOB_STATUSES)[number]])}
            options={[
              { value: "all", label: t("jobcards.common.all") },
              ...JOB_STATUSES.map((s) => ({ value: s, label: t(`jobcards.status.${s}`), meta: st.facets?.status?.[s] })),
            ]}
          />
        }
      />
      <DataTable table={st.table} onRowClick={(r) => navigate(`jobs/${r.id}`)} />
    </>
  );
}
