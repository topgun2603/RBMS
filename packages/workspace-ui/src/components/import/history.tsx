"use client";

import * as React from "react";
import { FileClockIcon, Loader2Icon } from "lucide-react";
import { Card, EmptyState, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, Skeleton } from "@srirealtime/ui";
import { QueryError, useI18n } from "@srirealtime/web";
import { CountTile, useRelativeTime } from "../bits";
import { useImporters, useImportJob, useImportJobs } from "../../lib/queries";
import type { ImportJob } from "../../lib/types";
import { ErrorRowsButton, JobStatusPill } from "./job-status";
import { importerLabel } from "./wizard";

/** Recent imports; a row opens the job's summary and errors. */
export function ImportHistory() {
  const { t } = useI18n();
  const jobs = useImportJobs();
  const importers = useImporters();
  const ago = useRelativeTime();
  const [open, setOpen] = React.useState<string | null>(null);
  const label = (key: string) => {
    const imp = importers.data?.find((i) => i.key === key);
    return imp ? importerLabel(t, imp) : t.has(`workspace.import.kinds.${key}`) ? t(`workspace.import.kinds.${key}`) : key;
  };
  const items = (jobs.data?.items ?? []).filter((j) => j.status !== "preview");

  return (
    <section aria-labelledby="import-history" className="grid gap-2">
      <h2 id="import-history" className="flex items-center gap-2 font-heading text-base font-semibold">
        <FileClockIcon className="size-4 text-primary" /> {t("workspace.import.historyTitle")}
      </h2>
      {jobs.isError ? (
        <QueryError compact error={jobs.error} onRetry={() => void jobs.refetch()} />
      ) : jobs.isPending ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : items.length === 0 ? (
        <EmptyState compact icon={FileClockIcon} title={t("workspace.import.historyEmpty")} />
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <ul className="divide-y">
            {items.map((j) => (
              <li key={j.jobId}>
                <button
                  type="button"
                  onClick={() => setOpen(j.jobId)}
                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left outline-none hover:bg-accent/40 focus-visible:bg-accent/40 sm:px-5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{j.fileName ?? label(j.key)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {label(j.key)} · {ago(j.createdAt)}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">{t("workspace.import.historyCounts", { created: j.created, updated: j.updated, failed: j.failed })}</span>
                  <JobStatusPill job={j} />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
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
