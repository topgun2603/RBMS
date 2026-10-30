"use client";

import * as React from "react";
import { FileClockIcon, Loader2Icon } from "lucide-react";
import {
  DataTable,
  DataTableToolbar,
  EmptyState,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  type DataTableColumn,
} from "@rbms/ui";
import { api, QueryError, useI18n, useServerTable, type ListResponse, type ServerFilterDefs } from "@rbms/web";
import { CountTile, useRelativeTime } from "../bits";
import { useImporters, useImportJob, wk } from "../../lib/queries";
import type { ImportJob } from "../../lib/types";
import { ErrorRowsButton, JobStatusPill, RollbackButton, RollbackResult } from "./job-status";
import { importerLabel } from "./wizard";

/** Statuses the history shows; "preview" (uploaded, never started) stays out unless the API is asked for it. */
const STATUSES = ["queued", "running", "done", "failed", "rolled_back"] as const;

/** Import history (server-paged table: sort, status / type / date filters, file-name search); a row opens the job. */
export function ImportHistory() {
  const { t, formatDate } = useI18n();
  const importers = useImporters();
  const ago = useRelativeTime();
  const [open, setOpen] = React.useState<string | null>(null);
  const importerList = importers.data;
  const label = React.useCallback(
    (key: string) => {
      const imp = importerList?.find((i) => i.key === key);
      return imp ? importerLabel(t, imp) : t.has(`workspace.import.kinds.${key}`) ? t(`workspace.import.kinds.${key}`) : key;
    },
    [importerList, t],
  );

  const filters = React.useMemo(
    () =>
      ({
        status: {
          kind: "options",
          label: t("workspace.import.filter.status"),
          options: STATUSES.map((s) => ({ value: s, label: t(`workspace.import.status.${s}`) })),
        },
        key: {
          kind: "options",
          label: t("workspace.import.filter.kind"),
          options: (importerList ?? []).map((i) => ({ value: i.key, label: importerLabel(t, i) })),
          dynamic: true,
          hidden: (importerList?.length ?? 0) < 2,
        },
        date: { kind: "dateRange", label: t("workspace.import.filter.date") },
      }) satisfies ServerFilterDefs,
    [t, importerList],
  );

  const columns = React.useMemo<DataTableColumn<ImportJob>[]>(
    () => [
      {
        id: "file",
        header: t("workspace.import.col.file"),
        sortable: true,
        hideable: false,
        card: "title",
        className: "max-w-[18rem]",
        cell: (j) => <span className="block truncate font-medium">{j.fileName ?? label(j.key)}</span>,
      },
      {
        id: "kind",
        header: t("workspace.import.col.kind"),
        sortable: true,
        card: "subtitle",
        cell: (j) => label(j.key),
        cardCell: (j) => `${label(j.key)} · ${ago(j.createdAt)}`,
      },
      {
        id: "created",
        header: t("workspace.import.col.created"),
        sortable: true,
        sortDescFirst: true,
        cell: (j) => (
          <span
            className="whitespace-nowrap text-muted-foreground tabular-nums"
            title={formatDate(j.createdAt, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}
          >
            {ago(j.createdAt)}
          </span>
        ),
      },
      {
        id: "result",
        header: t("workspace.import.col.result"),
        hideBelow: "sm",
        card: "meta",
        cell: (j) => (
          <span className="text-xs text-muted-foreground tabular-nums">
            {t("workspace.import.historyCounts", { created: j.created, updated: j.updated, failed: j.failed })}
          </span>
        ),
      },
      {
        id: "status",
        header: t("workspace.import.col.status"),
        sortable: true,
        card: "right",
        cell: (j) => <JobStatusPill job={j} />,
      },
    ],
    [t, formatDate, label, ago],
  );

  const st = useServerTable<ImportJob, typeof filters>({
    queryKey: wk.jobs,
    path: "/import/jobs",
    columns,
    filters,
    defaultSort: "-created",
    search: t("workspace.import.historySearch"),
    storageKey: "workspace-import-jobs",
    getRowId: (j) => j.jobId,
    // Without a status filter, leave out uploads that were never started.
    fetcher: (params, signal) =>
      api.get<ListResponse<ImportJob>>("/import/jobs", params.status ? params : { ...params, status: STATUSES.join(",") }, { signal }),
  });

  // Refresh while an import on this page is still waiting or running.
  const busy = (st.query.data?.items ?? []).some((j) => j.status === "queued" || j.status === "running");
  const { refetch } = st.query;
  React.useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(() => void refetch(), 2000);
    return () => window.clearInterval(id);
  }, [busy, refetch]);

  const filtered = st.table.activeFilterCount > 0;

  return (
    <section aria-labelledby="import-history" className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <h2 id="import-history" className="flex items-center gap-2 font-heading text-base font-semibold">
        <FileClockIcon className="size-4 text-primary" /> {t("workspace.import.historyTitle")}
      </h2>
      <DataTableToolbar table={st.table} />
      <DataTable
        table={st.table}
        onRowClick={(j) => setOpen(j.jobId)}
        empty={filtered ? undefined : <EmptyState compact className="border-0 bg-transparent" icon={FileClockIcon} title={t("workspace.import.historyEmpty")} />}
      />
      <JobSheet jobId={open} title={(j) => j.fileName ?? label(j.key)} onClose={() => setOpen(null)} />
    </section>
  );
}

function JobSheet({ jobId, title, onClose }: { jobId: string | null; title: (j: ImportJob) => string; onClose: () => void }) {
  const { t, formatDate } = useI18n();
  const q = useImportJob(jobId);
  const job = q.data;
  return (
    <Sheet open={!!jobId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg" closeLabel={t("workspace.common.close")}>
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>{job ? title(job) : t("workspace.import.historyTitle")}</SheetTitle>
          {job && (
            <SheetDescription>
              {formatDate(job.createdAt, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}
            </SheetDescription>
          )}
        </SheetHeader>
        <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-5 py-4">
          {q.isError ? (
            <QueryError compact error={q.error} onRetry={() => void q.refetch()} />
          ) : !job ? (
            <Loader2Icon className="mx-auto size-6 animate-spin text-muted-foreground" />
          ) : (
            <>
              <JobStatusPill job={job} />
              <RollbackResult job={job} />
              <RollbackButton job={job} className="h-11" />
              <div className="grid grid-cols-2 gap-2">
                <CountTile label={t("workspace.import.result.created")} value={job.created} tone="text-success-ink" />
                <CountTile label={t("workspace.import.result.updated")} value={job.updated} tone="text-info-ink" />
                <CountTile label={t("workspace.import.result.skipped")} value={job.skipped || job.invalid} tone="text-muted-foreground" />
                <CountTile label={t("workspace.import.result.failed")} value={job.failed} tone={job.failed ? "text-danger-ink" : "text-muted-foreground"} />
              </div>
              {job.errors.length > 0 && (
                <>
                  <ul className="max-h-80 divide-y overflow-auto rounded-xl border text-sm">
                    {job.errors.slice(0, 200).map((e, i) => (
                      <li key={`${e.row}-${i}`} className="flex gap-3 px-3 py-2">
                        <span className="w-14 shrink-0 text-xs text-muted-foreground tabular-nums">{t("workspace.import.rowN", { row: e.row })}</span>
                        <span className="text-danger-ink">{e.message}</span>
                      </li>
                    ))}
                  </ul>
                  <ErrorRowsButton job={job} className="h-11" />
                </>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
