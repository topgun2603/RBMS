"use client";

import * as React from "react";
import { AlertTriangleIcon, CheckCircle2Icon, ClockIcon, DownloadIcon, Loader2Icon, XCircleIcon } from "lucide-react";
import { Button, StatusPill } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import { errorRowsCsv, saveText } from "../../lib/csv";
import type { ImportJob, ImportJobStatus } from "../../lib/types";

const META: Record<ImportJobStatus, { tone: "success" | "warning" | "danger" | "info" | "neutral"; icon: React.ComponentType<{ className?: string }> }> = {
  preview: { tone: "neutral", icon: ClockIcon },
  queued: { tone: "info", icon: ClockIcon },
  running: { tone: "info", icon: Loader2Icon },
  done: { tone: "success", icon: CheckCircle2Icon },
  failed: { tone: "danger", icon: XCircleIcon },
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
