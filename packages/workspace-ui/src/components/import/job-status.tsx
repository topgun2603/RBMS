"use client";

import * as React from "react";
import { AlertTriangleIcon, CheckCircle2Icon, ClockIcon, DownloadIcon, Loader2Icon, Undo2Icon, XCircleIcon } from "lucide-react";
import { Button, StatusPill, toast } from "@srirealtime/ui";
import { describeError, useI18n } from "@srirealtime/web";
import { downloadImportErrors, useRollbackImport } from "../../lib/queries";
import { errorRowsCsv, saveText } from "../../lib/csv";
import type { ImportJob, ImportJobStatus } from "../../lib/types";

const META: Record<ImportJobStatus, { tone: "success" | "warning" | "danger" | "info" | "neutral"; icon: React.ComponentType<{ className?: string }> }> = {
  preview: { tone: "neutral", icon: ClockIcon },
  queued: { tone: "info", icon: ClockIcon },
  running: { tone: "info", icon: Loader2Icon },
  done: { tone: "success", icon: CheckCircle2Icon },
  failed: { tone: "danger", icon: XCircleIcon },
  rolled_back: { tone: "neutral", icon: Undo2Icon },
};

export function JobStatusPill({ job }: { job: Pick<ImportJob, "status" | "failed"> }) {
  const { t } = useI18n();
  const partial = job.status === "done" && job.failed > 0;
  const m = partial ? { tone: "warning" as const, icon: AlertTriangleIcon } : META[job.status];
  return (
    <StatusPill tone={m.tone} icon={m.icon}>
      {partial ? t("workspace.import.status.partial") : t(`workspace.import.status.${job.status}`)}
    </StatusPill>
  );
}

/** Downloads the job's error rows as CSV (with the original cells when the preview still has them). */
export function ErrorRowsButton({
  job,
  raw,
  headers,
  className,
}: {
  job: ImportJob;
  raw?: ReadonlyMap<number, readonly string[]>;
  headers?: readonly string[];
  className?: string;
}) {
  const { t } = useI18n();
  if (!job.errors.length) return null;
  const run = () => {
    // Without the preview's cells in hand, the server builds the report (it keeps the original cells of each bad row).
    if (!raw) {
      const name = `${(job.fileName ?? job.key).replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_")}-errors.csv`;
      downloadImportErrors(job.jobId, name).catch((err) => toast.error(describeError(err, t)));
      return;
    }
    const csv = errorRowsCsv(job.errors, raw ?? new Map(), headers ?? [], { row: t("workspace.import.csvRow"), error: t("workspace.import.csvError") });
    const base = (job.fileName ?? job.key).replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_");
    saveText(csv, `${base}-errors.csv`);
  };
  return (
    <Button type="button" variant="outline" className={className} onClick={run}>
      <DownloadIcon /> {t("workspace.import.downloadErrors", { count: job.errors.length })}
    </Button>
  );
}

/** "Undo this import": asks once, then removes what the batch created (bills, new parties, new products). */
export function RollbackButton({ job, className }: { job: Pick<ImportJob, "jobId" | "status" | "created">; className?: string }) {
  const { t } = useI18n();
  const undo = useRollbackImport();
  const [ask, setAsk] = React.useState(false);
  if (job.status !== "done" || job.created === 0) return null;
  if (!ask)
    return (
      <Button type="button" variant="outline" className={className} onClick={() => setAsk(true)}>
        <Undo2Icon /> {t("workspace.import.rollback.button")}
      </Button>
    );
  return (
    <div className="grid gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3" role="alertdialog" aria-label={t("workspace.import.rollback.button")}>
      <p className="text-sm">{t("workspace.import.rollback.confirm", { count: job.created })}</p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="destructive"
          disabled={undo.isPending}
          onClick={() =>
            undo.mutate(job.jobId, {
              onSuccess: (j) => {
                toast.success(t("workspace.import.rollback.done", { count: j.rollback?.reverted ?? 0 }));
                setAsk(false);
              },
              onError: (err) => toast.error(describeError(err, t)),
            })
          }
        >
          {undo.isPending ? <Loader2Icon className="animate-spin" /> : <Undo2Icon />} {t("workspace.import.rollback.yes")}
        </Button>
        <Button type="button" variant="ghost" disabled={undo.isPending} onClick={() => setAsk(false)}>
          {t("workspace.common.cancel")}
        </Button>
      </div>
    </div>
  );
}

/** What an undo left in place. */
export function RollbackResult({ job }: { job: Pick<ImportJob, "status" | "rollback"> }) {
  const { t } = useI18n();
  if (job.status !== "rolled_back" || !job.rollback) return null;
  return (
    <div className="grid gap-1 rounded-xl border p-3 text-sm">
      <p className="font-medium">{t("workspace.import.rollback.done", { count: job.rollback.reverted })}</p>
      {job.rollback.kept.length > 0 && (
        <>
          <p className="text-muted-foreground">{t("workspace.import.rollback.kept", { count: job.rollback.kept.length })}</p>
          <ul className="max-h-40 overflow-auto text-xs text-muted-foreground">
            {job.rollback.kept.slice(0, 50).map((k, i) => (
              <li key={i}>
                {k.key}: {k.reason}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
