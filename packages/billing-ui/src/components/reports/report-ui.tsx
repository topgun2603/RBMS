"use client";

import * as React from "react";
import { ChevronDownIcon, DownloadIcon, Loader2Icon } from "lucide-react";
import {
  AnimatePresence,
  Button,
  Card,
  cn,
  EmptyState,
  motion,
  Skeleton,
  Stagger,
  StaggerItem,
  toast,
  useReducedMotionSafe,
} from "@srirealtime/ui";
import { ChartIllustration } from "../illustrations";
import { describeError, QueryError, type QueryParams, useI18n } from "@srirealtime/web";
import { downloadCsv } from "../../lib/queries-v2";
import type { Translator } from "@srirealtime/i18n/client";

/** Shared range props every dated tab receives. */
export interface RangeProps {
  from: string;
  to: string;
}

/** "Download CSV" with a spinner while the file is prepared; errors become a toast. */
export function DownloadCsvButton({
  path,
  params,
  fileName,
  label,
  className,
  size = "default",
}: {
  path: string;
  params: QueryParams;
  fileName: string;
  label?: string;
  className?: string;
  size?: "default" | "sm";
}) {
  const { t } = useI18n();
  const [busy, setBusy] = React.useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await downloadCsv(path, params, fileName);
      toast.success(t("billing.common.downloaded"));
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      className={cn(size === "default" ? "h-11 sm:h-9" : "h-9", className)}
      onClick={run}
      disabled={busy}
      aria-busy={busy}
      data-print-hide
    >
      {busy ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
      {busy ? t("billing.common.downloading") : (label ?? t("billing.common.download"))}
    </Button>
  );
}

/** Headline tiles: two columns on phones, four on desktop, staggered entrance. */
export function TileGrid({ children }: { children: React.ReactNode[] }) {
  return (
    <Stagger className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 sm:gap-4 lg:grid-cols-4">
      {children.map((c, i) => (
        <StaggerItem key={i} className="min-w-0">
          {c}
        </StaggerItem>
      ))}
    </Stagger>
  );
}

/** Polished "nothing in this period" panel with the chart illustration. */
export function PeriodEmpty({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <EmptyState
      illustration={<ChartIllustration />}
      title={title}
      description={description ?? t("billing.reports.emptyHint")}
      action={action}
    />
  );
}

/** Per-tab error panel inside a card so the rest of the page keeps working. */
export function TabError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Card className="py-2">
      <QueryError error={error} onRetry={onRetry} />
    </Card>
  );
}

/** Dims the tab body while a new range loads over the previous data. */
export function Refreshing({ active, children }: { active: boolean; children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className={cn("relative grid grid-cols-[minmax(0,1fr)] gap-section transition-opacity", active && "opacity-60")} aria-busy={active}>
      {active && (
        <span className="sr-only" role="status">
          {t("billing.reports.updating")}
        </span>
      )}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- tables

export interface Column<T> {
  key: string;
  label: React.ReactNode;
  numeric?: boolean;
  cell: (row: T) => React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

/** Plain report table: sticky header, right-aligned tabular money, optional totals footer, row cap with "Show all". */
export function ReportTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  limit = 100,
  emptyText,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, i: number) => string;
  caption?: string;
  limit?: number;
  emptyText?: string;
}) {
  const { t } = useI18n();
  const [all, setAll] = React.useState(false);
  const shown = all ? rows : rows.slice(0, limit);
  const hasFooter = columns.some((c) => c.footer !== undefined);
  if (!rows.length) {
    return <p className="px-4 py-8 text-center text-sm text-muted-foreground">{emptyText ?? t("billing.reports.noRows")}</p>;
  }
  return (
    <div>
      <div className="max-h-[32rem] overflow-auto">
        <table className="w-full border-collapse text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b text-left">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    "h-10 px-3 text-xs font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5",
                    c.numeric && "text-right",
                    c.className,
                  )}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={rowKey(r, i)} className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-3 py-2.5 whitespace-nowrap first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5",
                      c.numeric && "text-right tabular-nums",
                      c.className,
                    )}
                  >
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {hasFooter && (
            <tfoot className="sticky bottom-0 bg-muted/70 backdrop-blur">
              <tr className="border-t font-semibold">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-3 py-2.5 whitespace-nowrap first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5",
                      c.numeric && "text-right tabular-nums",
                    )}
                  >
                    {c.footer}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {rows.length > limit && (
        <div className="flex items-center justify-between gap-2 border-t px-4 py-2 text-xs text-muted-foreground sm:px-5" data-print-hide>
          <span className="tabular-nums">{t("billing.reports.showingFirst", { shown: shown.length, count: rows.length })}</span>
          {!all && (
            <Button variant="ghost" size="sm" className="h-9" onClick={() => setAll(true)}>
              {t("billing.reports.showAll", { count: rows.length })}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Card with an icon-chip header, actions (CSV) and a table body. */
export function TableCard({
  title,
  description,
  icon: Icon,
  actions,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("gap-0 overflow-hidden py-0", className)}>
      <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          {Icon && (
            <span className="icon-chip size-9 text-primary">
              <Icon className="size-4" />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="font-heading text-base font-semibold">{title}</h2>
            {description && <p className="text-meta text-muted-foreground">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </Card>
  );
}

/** Collapsible card section (GSTR-1 tables): header button with aria-expanded, animated body. */
export function CollapsibleCard({
  title,
  description,
  badge,
  actions,
  defaultOpen = false,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const reduced = useReducedMotionSafe();
  const [open, setOpen] = React.useState(defaultOpen);
  const id = React.useId();
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-col gap-2 px-2 py-2 sm:flex-row sm:items-center sm:justify-between sm:pr-4">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          aria-label={t(open ? "billing.reports.collapse" : "billing.reports.expand", { name: title })}
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-1.5 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDownIcon
            className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open ? "rotate-0" : "-rotate-90")}
            aria-hidden
          />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-heading text-sm font-semibold sm:text-base">{title}</span>
              {badge}
            </span>
            {description && <span className="block text-xs text-muted-foreground">{description}</span>}
          </span>
        </button>
        {actions && <div className="flex shrink-0 items-center gap-2 pl-9 sm:pl-0">{actions}</div>}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={id}
            key="body"
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-t"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

/** Skeleton for a table card while its query loads. */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex items-center gap-3 border-b px-4 py-3 sm:px-5">
        <Skeleton className="size-9 rounded-xl" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="ml-auto h-9 w-28 rounded-lg" />
      </div>
      <div className="grid gap-3 px-4 py-4 sm:px-5">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Sum helper that tolerates missing numbers. */
export const sum = <T,>(rows: readonly T[], f: (r: T) => number | null | undefined) =>
  rows.reduce((s, r) => s + (Number(f(r)) || 0), 0);

/** Integer percentage of a total (0 when there's no total). */
export const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

/** "GST 18%" label (0.25 stays 0.25). */
export const rateText = (t: Translator, rate: number) => t("billing.reports.gst.rateLabel", { rate: Number(rate) });
