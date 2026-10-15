"use client";

import * as React from "react";
import {
  BarChart3Icon,
  CalendarClockIcon,
  DatabaseIcon,
  DownloadIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FolderOpenIcon,
  Loader2Icon,
  MoreVerticalIcon,
  PlusIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";
import {
  AnimatePresence,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  motion,
  Skeleton,
  toast,
  useReducedMotionSafe,
} from "@srirealtime/ui";
import { ConfirmDialog, describeError, ModuleLink, Page, PageHeading, QueryError, useI18n, usePermission } from "@srirealtime/web";
import { SectionCard } from "../components/bits";
import { DatasetPicker } from "../components/reports/dataset-picker";
import { ScheduleDialog } from "../components/reports/schedule-dialog";
import { SchedulesList } from "../components/reports/schedules-list";
import { datasetLabel, ScheduleStatus, useDateTime, useRelativeTime } from "../components/reports/shared";
import { downloadSaved, useDatasets, useDeleteReport, useSavedReports, useSchedules } from "../lib/queries/reports";
import { sortByLastRun } from "../lib/report-spec";
import type { DatasetInfo, ReportFormat, ReportSchedule, SavedReport } from "../lib/types";

export default function ReportsPage() {
  const { t } = useI18n();
  const canManage = usePermission("reports.manage");
  const datasets = useDatasets();
  const saved = useSavedReports();
  const schedules = useSchedules(undefined, canManage);

  return (
    <Page wide>
      <PageHeading
        icon={BarChart3Icon}
        title={t("growth.reports.title")}
        description={t("growth.reports.description")}
        actions={
          <Button asChild>
            <ModuleLink to="reports/new">
              <PlusIcon /> {t("growth.reports.new")}
            </ModuleLink>
          </Button>
        }
      />

      <div className="grid gap-4">
        <SectionCard icon={FolderOpenIcon} title={t("growth.reports.saved.title")} description={t("growth.reports.saved.description")}>
          <SavedList
            reports={saved.data}
            loading={saved.isPending}
            error={saved.error}
            onRetry={() => saved.refetch()}
            datasets={datasets.data}
            schedules={schedules.data}
            canManage={canManage}
          />
        </SectionCard>

        <SectionCard icon={DatabaseIcon} title={t("growth.reports.datasets.title")} description={t("growth.reports.datasets.description")}>
          <DatasetPicker datasets={datasets.data} loading={datasets.isPending} error={datasets.error} onRetry={() => datasets.refetch()} />
        </SectionCard>

        {canManage && (
          <SectionCard icon={CalendarClockIcon} title={t("growth.reports.schedule.allTitle")} description={t("growth.reports.schedule.allBody")}>
            <SchedulesList reports={saved.data} canManage={canManage} />
          </SectionCard>
        )}
      </div>
    </Page>
  );
}

function SavedList({
  reports,
  loading,
  error,
  onRetry,
  datasets,
  schedules,
  canManage,
}: {
  reports: SavedReport[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  datasets: DatasetInfo[] | undefined;
  schedules: ReportSchedule[] | undefined;
  canManage: boolean;
}) {
  const { t } = useI18n();
  const reduced = useReducedMotionSafe();
  const del = useDeleteReport();
  const [deleting, setDeleting] = React.useState<SavedReport | null>(null);
  const [scheduling, setScheduling] = React.useState<SavedReport | null>(null);

  if (loading) {
    return (
      <div className="grid gap-2" aria-busy="true">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
    );
  }
  if (error) return <QueryError error={error} onRetry={onRetry} compact />;
  if (!reports?.length) {
    return (
      <EmptyState
        compact
        icon={FolderOpenIcon}
        title={t("growth.reports.saved.emptyTitle")}
        description={t("growth.reports.saved.emptyBody")}
        action={
          <Button asChild variant="outline" size="sm">
            <ModuleLink to="reports/new">
              <PlusIcon /> {t("growth.reports.new")}
            </ModuleLink>
          </Button>
        }
      />
    );
  }
  const sorted = [...reports].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <>
      <ul className="grid gap-2">
        <AnimatePresence initial={false}>
          {sorted.map((r) => (
            <motion.li key={r.id} layout={!reduced} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}>
              <SavedRow
                report={r}
                dataset={datasetLabel(datasets, r.dataset)}
                schedules={schedules?.filter((s) => s.reportId === r.id)}
                canManage={canManage}
                onDelete={() => setDeleting(r)}
                onSchedule={() => setScheduling(r)}
              />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {scheduling && (
        <ScheduleDialog open={!!scheduling} onOpenChange={(o) => !o && setScheduling(null)} reportId={scheduling.id} reportName={scheduling.name} />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("growth.reports.saved.deleteTitle", { name: deleting?.name ?? "" })}
        description={t("growth.reports.saved.deleteBody")}
        confirmLabel={t("growth.common.delete")}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await del.mutateAsync(deleting.id);
            toast.success(t("growth.reports.saved.deleted"));
          } catch (e) {
            toast.error(describeError(e, t));
            throw e;
          }
        }}
      />
    </>
  );
}

function SavedRow({
  report: r,
  dataset,
  schedules,
  canManage,
  onDelete,
  onSchedule,
}: {
  report: SavedReport;
  dataset: string;
  schedules: ReportSchedule[] | undefined;
  canManage: boolean;
  onDelete: () => void;
  onSchedule: () => void;
}) {
  const { t } = useI18n();
  const rel = useRelativeTime();
  const dt = useDateTime();
  const [downloading, setDownloading] = React.useState<ReportFormat | null>(null);
  const latest = schedules?.length ? sortByLastRun(schedules)[0] : undefined;
  const next = schedules
    ?.filter((s) => s.active && s.nextRunAt)
    .map((s) => s.nextRunAt!)
    .sort()[0];

  const download = async (format: ReportFormat) => {
    setDownloading(format);
    try {
      await downloadSaved(r, format);
      toast.success(t("growth.common.downloaded"));
    } catch (e) {
      toast.error(describeError(e, t));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-3 transition-colors hover:border-primary/30 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <ModuleLink to={`reports/${r.id}`} className="truncate font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
            {r.name}
          </ModuleLink>
          <Badge variant="secondary" className="font-normal">
            {dataset}
          </Badge>
          {r.shared && (
            <Badge variant="outline" className="gap-1 font-normal">
              <UsersIcon className="size-3" /> {t("growth.reports.saved.shared")}
            </Badge>
          )}
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span title={dt(r.updatedAt)}>{t("growth.reports.saved.updated", { when: rel(r.updatedAt) })}</span>
          {latest && (
            <span className="flex items-center gap-1.5">
              <ScheduleStatus schedule={latest} />
              {latest.lastRunAt && <span title={dt(latest.lastRunAt)}>{rel(latest.lastRunAt)}</span>}
            </span>
          )}
          {next && <span title={dt(next)}>{t("growth.widgets.scheduleNext", { when: dt(next) })}</span>}
          {schedules && !schedules.length && canManage && <span>{t("growth.reports.saved.notScheduled")}</span>}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button asChild size="sm" variant="outline">
          <ModuleLink to={`reports/${r.id}`}>{t("growth.reports.saved.open")}</ModuleLink>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={!!downloading} aria-label={t("growth.reports.saved.run")}>
              {downloading ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
              <span className="hidden sm:inline">{t("growth.reports.saved.run")}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t("growth.reports.saved.runHint")}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => void download("xlsx")}>
              <FileSpreadsheetIcon /> {t("growth.reports.formats.xlsx")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void download("csv")}>
              <FileTextIcon /> {t("growth.reports.formats.csv")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label={t("growth.common.actions")}>
                <MoreVerticalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onSchedule}>
                <CalendarClockIcon /> {t("growth.reports.schedule.add")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2Icon /> {t("growth.common.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
