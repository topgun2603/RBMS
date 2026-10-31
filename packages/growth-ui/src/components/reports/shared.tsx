"use client";

import * as React from "react";
import { CheckCircle2Icon, CircleDashedIcon, CircleSlashIcon, XCircleIcon } from "lucide-react";
import { StatusPill, Tooltip, TooltipContent, TooltipTrigger } from "@rbms/ui";
import { ApiError, useI18n } from "@rbms/web";
import { money, num } from "../../lib/format";
import { bucketLabel, columnOf, optionLabel, relativeParts, type Issue, type OutputKey } from "../../lib/report-spec";
import type { DatasetInfo, DateBucket, DatePreset, FilterOp, MeasureFn, ReportSchedule, RunColumn } from "../../lib/types";

const P = "growth.reports";

/** Translated labels for presets, ops, measure functions, buckets, output keys and issues. */
export function useReportLabels() {
  const { t } = useI18n();
  return React.useMemo(() => {
    const preset = (p: DatePreset) => t(`${P}.presets.${p}`);
    const op = (o: FilterOp) => t(`${P}.ops.${o}`);
    const fn = (f: MeasureFn) => t(`${P}.fns.${f}`);
    const bucket = (b: DateBucket) => t(`${P}.buckets.${b}`);
    const measure = (ds: DatasetInfo, f: MeasureFn, column: string | null) =>
      f === "count" || !column ? t(`${P}.fns.count`) : t(`${P}.measureOf`, { fn: fn(f), column: columnOf(ds, column)?.label ?? column });
    const outputKey = (ds: DatasetInfo, k: OutputKey) => {
      if (k.kind === "measure") return measure(ds, k.fn ?? "count", k.column);
      const label = columnOf(ds, k.column ?? k.key)?.label ?? k.key;
      return k.bucket ? `${label} (${bucket(k.bucket)})` : label;
    };
    const issue = (i: Pick<Issue, "key" | "params">) => t(`${P}.issues.${i.key}`, i.params);
    return { preset, op, fn, bucket, measure, outputKey, issue };
  }, [t]);
}

/** "3 hours ago" / "in 2 days" in the current language. */
export function useRelativeTime() {
  const { locale } = useI18n();
  return React.useCallback(
    (iso: string | null | undefined) => {
      if (!iso) return "";
      const { value, unit } = relativeParts(iso);
      try {
        return new Intl.RelativeTimeFormat(locale === "ta" ? "ta-IN" : "en-IN", { numeric: "auto" }).format(value, unit);
      } catch {
        return new Date(iso).toLocaleString();
      }
    },
    [locale],
  );
}

/** Date + time in IST, e.g. "16 Oct, 8:00 am". */
export function useDateTime() {
  const { formatDate } = useI18n();
  return React.useCallback(
    (iso: string | null | undefined) =>
      iso ? formatDate(iso, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "",
    [formatDate],
  );
}

/** Formats one result cell by column type: ₹ for money, dates by bucket, enum labels. */
export function useCellFormatter() {
  const { t, formatDate } = useI18n();
  return React.useCallback(
    (col: RunColumn, v: string | number | null | undefined): string => {
      if (v === null || v === undefined || v === "") return "—";
      switch (col.type) {
        case "money":
          return money(Number(v));
        case "number": {
          const n = Number(v);
          return Number.isInteger(n) ? num(n) : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
        }
        case "date":
          return bucketLabel(String(v), col.bucket ?? null, (d, o) => formatDate(d, { ...o, timeZone: "UTC" }), (d) => t(`${P}.weekOf`, { date: d }));
        case "enum":
          return optionLabel(col, v);
        default:
          return String(v);
      }
    },
    [t, formatDate],
  );
}

/** Last run status of a schedule: pill (icon + text); the last error in a tooltip. */
export function ScheduleStatus({ schedule }: { schedule: Pick<ReportSchedule, "lastStatus" | "lastError" | "lastRunAt"> }) {
  const { t } = useI18n();
  const s = schedule.lastStatus;
  const pill =
    s === "ok" ? (
      <StatusPill tone="success" icon={CheckCircle2Icon}>
        {t(`${P}.status.ok`)}
      </StatusPill>
    ) : s === "failed" ? (
      <StatusPill tone="danger" icon={XCircleIcon}>
        {t(`${P}.status.failed`)}
      </StatusPill>
    ) : s === "skipped" ? (
      <StatusPill tone="warning" icon={CircleSlashIcon}>
        {t(`${P}.status.skipped`)}
      </StatusPill>
    ) : (
      <StatusPill tone="neutral" icon={CircleDashedIcon}>
        {t(`${P}.status.never`)}
      </StatusPill>
    );
  if (!schedule.lastError) return pill;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${t(`${P}.status.${s ?? "never"}`)}: ${schedule.lastError}`}>
          {pill}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{schedule.lastError}</TooltipContent>
    </Tooltip>
  );
}

/** Server validation issues of a 400 (`details.issues`), or null. */
export function serverIssues(err: unknown): { path: string; message: string }[] | null {
  if (!(err instanceof ApiError) || err.status !== 400) return null;
  const d = err.details as { issues?: { path: string; message: string }[] } | undefined;
  return d?.issues?.length ? d.issues : [{ path: "", message: err.message.replace(/^Invalid report:\s*/, "") }];
}

/** Dataset label by id (falls back to the id). */
export const datasetLabel = (datasets: DatasetInfo[] | undefined, id: string) => datasets?.find((d) => d.id === id)?.label ?? id;
