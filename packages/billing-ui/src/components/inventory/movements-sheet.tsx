"use client";

import * as React from "react";
import { ModuleLink, QueryError, tOr, useI18n } from "@srirealtime/web";
import { ExternalLinkIcon, HistoryIcon } from "lucide-react";
import {
  cn,
  EmptyState,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Stagger,
  StaggerItem,
} from "@srirealtime/ui";
import { REASON_META, StockStatusPill, useIsPhone } from "./stock-meta";
import { formatQty } from "../../lib/format";
import { useMovements } from "../../lib/queries-v2";
import type { StockMovement, StockRow } from "../../lib/types";

const refHref = (m: StockMovement) =>
  !m.refId ? null : m.refType === "invoice" ? `invoices/${m.refId}` : m.refType === "purchase" ? `purchases/${m.refId}` : null;

/** Stock history of one item: right sheet on larger screens, bottom sheet on phones. */
export function MovementsSheet({
  open,
  onOpenChange,
  row,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: StockRow | null;
}) {
  const { t, formatDate } = useI18n();
  const phone = useIsPhone();
  const list = useMovements(open ? (row?.itemId ?? null) : null);
  const items = list.data?.items ?? [];
  const unit = row?.unit || "pcs";

  const when = (d: string) =>
    d.includes("T") ? formatDate(d, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : formatDate(d);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={phone ? "bottom" : "right"}
        closeLabel={t("billing.common.close")}
        className={cn(
          "gap-0 bg-page",
          phone ? "max-h-[85dvh] rounded-t-3xl pb-[env(safe-area-inset-bottom)]" : "w-full sm:max-w-md",
        )}
      >
        <SheetHeader className="border-b bg-card">
          <div className="flex items-center gap-3 pr-8">
            <span className="icon-chip size-10 rounded-xl text-primary">
              <HistoryIcon className="size-5" />
            </span>
            <div className="min-w-0">
              <SheetTitle className="truncate">{t("billing.movements.title")}</SheetTitle>
              <SheetDescription className="truncate">{row?.name}</SheetDescription>
            </div>
          </div>
          {row && (
            <div className="mt-2 flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">
                {t("billing.movements.inStock")}{" "}
                <span className="font-semibold text-foreground tabular-nums">
                  {formatQty(row.qty)} {unit}
                </span>
              </span>
              <StockStatusPill row={row} />
            </div>
          )}
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {list.isError ? (
            <QueryError compact error={list.error} onRetry={() => void list.refetch()} />
          ) : list.isPending ? (
            <div className="grid gap-2">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl bg-card p-3">
                  <Skeleton className="size-9 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                  <Skeleton className="h-5 w-12" />
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState compact icon={HistoryIcon} title={t("billing.movements.empty")} description={t("billing.movements.emptyBody")} />
          ) : (
            <Stagger className="grid gap-2">
              {items.map((m) => {
                const meta = REASON_META[m.reason] ?? REASON_META.adjustment;
                const Icon = meta.icon;
                const href = refHref(m);
                const up = m.delta > 0;
                return (
                  <StaggerItem key={m.id} className="flex items-start gap-3 rounded-xl border border-card-ring bg-card p-3 shadow-xs">
                    <span className={cn("icon-chip size-9 shrink-0", meta.tone)}>
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{tOr(t, `billing.movements.reason.${m.reason}`, m.reason)}</p>
                      <p className="text-xs text-muted-foreground">{when(m.date)}</p>
                      {href ? (
                        <ModuleLink
                          to={href}
                          className="mt-0.5 inline-flex items-center gap-1 rounded text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {m.refNumber || t("billing.movements.viewRef")} <ExternalLinkIcon className="size-3" aria-hidden />
                        </ModuleLink>
                      ) : (
                        m.refNumber && <p className="text-xs text-muted-foreground">{m.refNumber}</p>
                      )}
                      {m.note && <p className="mt-1 text-xs break-words text-muted-foreground italic">{m.note}</p>}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={cn("font-semibold tabular-nums", up ? "text-success-ink" : m.delta < 0 ? "text-danger-ink" : "")}>
                        <span className="sr-only">{up ? t("billing.movements.in") : t("billing.movements.out")} </span>
                        {up ? "+" : m.delta < 0 ? "−" : ""}
                        {formatQty(Math.abs(m.delta))}
                      </p>
                      <p className="text-[0.6875rem] text-muted-foreground tabular-nums">
                        {t("billing.movements.after", { qty: formatQty(m.qtyAfter) })}
                      </p>
                    </div>
                  </StaggerItem>
                );
              })}
            </Stagger>
          )}
          {list.data && list.data.total > items.length && (
            <p className="mt-3 text-center text-xs text-muted-foreground">
              {t("billing.movements.showing", { shown: items.length, total: list.data.total })}
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
