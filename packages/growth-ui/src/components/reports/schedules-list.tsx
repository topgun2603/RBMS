"use client";

import * as React from "react";
import { CalendarClockIcon, InfoIcon, Loader2Icon, MailIcon, MoreVerticalIcon, PencilIcon, PlayIcon, PlusIcon, Trash2Icon } from "lucide-react";
import {
  AnimatePresence,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  motion,
  Skeleton,
  Switch,
  toast,
  useReducedMotionSafe,
} from "@srirealtime/ui";
import { ConfirmDialog, describeError, ModuleLink, QueryError, useI18n } from "@srirealtime/web";
import { ScheduleDialog } from "./schedule-dialog";
import { ScheduleStatus, useDateTime, useRelativeTime } from "./shared";
import { useDeleteSchedule, useRunScheduleNow, useSchedules, useToggleSchedule } from "../../lib/queries/reports";
import { scheduleToDraft, sortByLastRun } from "../../lib/report-spec";
import type { ReportSchedule, SavedReport } from "../../lib/types";

/** "Weekly · Monday 08:00 IST" */
export function useScheduleSummary() {
  const { t } = useI18n();
  return React.useCallback(
    (s: ReportSchedule) => {
      const d = scheduleToDraft(s);
      const time = d.time;
      if (s.preset === "weekly") return t("growth.reports.schedule.summary.weekly", { day: t(`growth.reports.schedule.days.${d.weekday}`), time });
      if (s.preset === "monthly") return t("growth.reports.schedule.summary.monthly", { day: d.dayOfMonth, time });
      return t("growth.reports.schedule.summary.daily", { time });
    },
    [t],
  );
}

/**
 * Schedules with their last run (the server keeps only the latest run per schedule): status, rows, error, next run,
 * active switch, run now, edit, delete. `reportId` limits it to one report and shows an "Add schedule" button.
 */
export function SchedulesList({
  reportId,
  reportName,
  reports,
  canManage,
}: {
  reportId?: string;
  reportName?: string;
  /** Saved reports, for names and links (all-schedules view). */
  reports?: SavedReport[];
  canManage: boolean;
}) {
  const { t } = useI18n();
  const reduced = useReducedMotionSafe();
  const q = useSchedules(reportId, canManage);
  const [editing, setEditing] = React.useState<ReportSchedule | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [deleting, setDeleting] = React.useState<ReportSchedule | null>(null);
  const del = useDeleteSchedule();

  if (!canManage) return null;
  const items = q.data ? sortByLastRun(q.data) : undefined;
  const nameOf = (id: string) => reports?.find((r) => r.id === id)?.name;

  return (
    <div className="grid gap-3">
      {reportId && (
        <div>
          <Button type="button" size="sm" variant="outline" onClick={() => setCreating(true)}>
            <PlusIcon /> {t("growth.reports.schedule.add")}
          </Button>
        </div>
      )}
      {q.isPending ? (
        <div className="grid gap-2" aria-busy="true">
          {Array.from({ length: 2 }, (_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} compact />
      ) : !items?.length ? (
        <EmptyState compact icon={CalendarClockIcon} title={t("growth.reports.schedule.emptyTitle")} description={t(reportId ? "growth.reports.schedule.emptyOne" : "growth.reports.schedule.emptyAll")} />
      ) : (
        <ul className="grid gap-2">
          <AnimatePresence initial={false}>
            {items.map((s) => (
              <motion.li
                key={s.id}
                layout={!reduced}
                initial={reduced ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <ScheduleRow schedule={s} name={reportId ? undefined : (nameOf(s.reportId) ?? t("growth.reports.schedule.unknownReport"))} onEdit={() => setEditing(s)} onDelete={() => setDeleting(s)} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
        {t("growth.reports.schedule.lastOnly")}
      </p>

      {reportId && <ScheduleDialog open={creating} onOpenChange={setCreating} reportId={reportId} reportName={reportName} />}
      {editing && (
        <ScheduleDialog
          open={!!editing}
          onOpenChange={(o) => !o && setEditing(null)}
          reportId={editing.reportId}
          reportName={reportName ?? nameOf(editing.reportId)}
          schedule={editing}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("growth.reports.schedule.deleteTitle")}
        description={t("growth.reports.schedule.deleteBody")}
        confirmLabel={t("growth.common.delete")}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await del.mutateAsync(deleting.id);
            toast.success(t("growth.reports.schedule.deleted"));
          } catch (e) {
            toast.error(describeError(e, t));
            throw e;
          }
        }}
      />
    </div>
  );
}

function ScheduleRow({ schedule: s, name, onEdit, onDelete }: { schedule: ReportSchedule; name?: string; onEdit: () => void; onDelete: () => void }) {
  const { t } = useI18n();
  const rel = useRelativeTime();
  const dt = useDateTime();
  const summary = useScheduleSummary();
  const toggle = useToggleSchedule();
  const runNow = useRunScheduleNow();

  const run = async () => {
    try {
      const out = await runNow.mutateAsync(s.id);
      const r = out.result;
      if (r.status === "ok") toast.success(t("growth.reports.schedule.ranOk", { count: r.rowCount, sent: r.sentTo.length }));
      else if (r.status === "skipped") toast.warning(t("growth.reports.schedule.ranSkipped", { error: r.error ?? "" }));
      else toast.error(t("growth.reports.schedule.ranFailed", { error: r.error ?? "" }));
    } catch (e) {
      toast.error(describeError(e, t));
    }
  };

  return (
    <div className="grid gap-2 rounded-xl border bg-card p-3 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {name && (
            <ModuleLink to={`reports/${s.reportId}`} className="truncate font-medium hover:underline">
              {name}
            </ModuleLink>
          )}
          <ScheduleStatus schedule={s} />
          {!s.active && <span className="text-xs font-medium text-muted-foreground">{t("growth.reports.schedule.paused")}</span>}
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <CalendarClockIcon className="size-3.5" />
            {summary(s)}
          </span>
          <span className="flex items-center gap-1">
            <MailIcon className="size-3.5" />
            {t("growth.reports.schedule.toCount", { count: s.recipients.length })} · {t(`growth.reports.formats.${s.format}`)}
          </span>
        </p>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span title={dt(s.lastRunAt)}>{s.lastRunAt ? t("growth.widgets.scheduleLast", { when: rel(s.lastRunAt) }) : t("growth.widgets.scheduleNever")}</span>
          {s.lastRowCount !== null && s.lastRunAt && <span>{t("growth.reports.schedule.rows", { count: s.lastRowCount })}</span>}
          {s.active && s.nextRunAt && <span title={dt(s.nextRunAt)}>{t("growth.widgets.scheduleNext", { when: dt(s.nextRunAt) })}</span>}
        </p>
        {s.lastStatus !== "ok" && s.lastError && <p className="text-xs break-words text-danger-ink">{s.lastError}</p>}
      </div>
      <div className="flex items-center justify-end gap-1">
        <Switch
          checked={s.active}
          disabled={toggle.isPending}
          aria-label={t("growth.reports.schedule.activeFor", { summary: summary(s) })}
          onCheckedChange={(active) =>
            toggle.mutate({ id: s.id, active }, { onError: (e) => toast.error(describeError(e, t)) })
          }
        />
        <Button type="button" size="sm" variant="outline" disabled={runNow.isPending} onClick={run}>
          {runNow.isPending ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
          {t("growth.reports.schedule.runNow")}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="icon-sm" variant="ghost" aria-label={t("growth.common.actions")}>
              <MoreVerticalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <PencilIcon /> {t("growth.common.edit")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2Icon /> {t("growth.common.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

