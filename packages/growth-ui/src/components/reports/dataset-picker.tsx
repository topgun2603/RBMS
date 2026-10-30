"use client";

import * as React from "react";
import { ArrowRightIcon, BoxesIcon, DatabaseIcon, GiftIcon, ReceiptIcon, UsersIcon, WalletIcon } from "lucide-react";
import { cn, EmptyState, motion, Skeleton, useReducedMotionSafe } from "@rbms/ui";
import { ModuleLink, QueryError, useI18n } from "@rbms/web";
import type { DatasetInfo } from "../../lib/types";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  invoices: ReceiptIcon,
  inventory: BoxesIcon,
  expenses: WalletIcon,
  loyalty: GiftIcon,
  customers: UsersIcon,
};

const iconFor = (ds: DatasetInfo) => (ds.id.endsWith("customers") ? ICONS.customers! : (ICONS[ds.module] ?? DatabaseIcon));

/** Dataset cards: label, description, column count. Each links to reports/new?dataset=id (or calls `onPick`). */
export function DatasetPicker({
  datasets,
  loading,
  error,
  onRetry,
  onPick,
  className,
}: {
  datasets: DatasetInfo[] | undefined;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onPick?: (id: string) => void;
  className?: string;
}) {
  const { t } = useI18n();
  const reduced = useReducedMotionSafe();
  if (loading) {
    return (
      <div className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-3", className)} aria-busy="true">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
    );
  }
  if (error) return <QueryError error={error} onRetry={onRetry} compact />;
  if (!datasets?.length) return <EmptyState compact icon={DatabaseIcon} title={t("growth.reports.datasets.emptyTitle")} description={t("growth.reports.datasets.emptyBody")} />;
  const cardClass =
    "group flex h-full w-full items-start gap-3 rounded-2xl border bg-card p-4 text-left shadow-xs transition-[border-color,box-shadow] outline-none hover:border-primary/40 hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50";
  return (
    <ul className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-3", className)}>
      {datasets.map((ds, i) => {
        const Icon = iconFor(ds);
        const body = (
          <>
            <span className="icon-chip size-10 shrink-0 rounded-xl text-primary">
              <Icon className="size-5" />
            </span>
            <span className="min-w-0 flex-1 space-y-1">
              <span className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{ds.label}</span>
                <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary motion-reduce:transition-none" />
              </span>
              {ds.description && <span className="line-clamp-2 block text-xs text-muted-foreground">{ds.description}</span>}
              <span className="block text-xs text-muted-foreground tabular-nums">{t("growth.reports.datasets.columns", { count: ds.columns.length })}</span>
            </span>
          </>
        );
        return (
          <motion.li
            key={ds.id}
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: reduced ? 0 : Math.min(i, 8) * 0.03 }}
          >
            {onPick ? (
              <button type="button" className={cardClass} onClick={() => onPick(ds.id)}>
                {body}
              </button>
            ) : (
              <ModuleLink to={`reports/new?dataset=${encodeURIComponent(ds.id)}`} className={cardClass}>
                {body}
              </ModuleLink>
            )}
          </motion.li>
        );
      })}
    </ul>
  );
}
