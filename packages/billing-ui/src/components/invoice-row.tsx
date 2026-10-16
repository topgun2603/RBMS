"use client";

import { ModuleLink, useI18n } from "@srirealtime/web";
import { ChevronRightIcon, FileTextIcon } from "lucide-react";
import { cn, InitialsAvatar, Skeleton } from "@srirealtime/ui";
import { StatusBadge } from "./status-badge";
import { money } from "../lib/format";
import type { InvoiceSummary } from "../lib/types";

/** Tappable invoice row: avatar, customer + number/date on the left, total/balance + status pill on the right. */
export function InvoiceRow({ inv, hideCustomer }: { inv: InvoiceSummary; hideCustomer?: boolean }) {
  const { t, formatDate } = useI18n();
  const open = inv.status === "issued" || inv.status === "partially_paid";
  const overdue = inv.isOverdue && open;
  return (
    <ModuleLink
      to={`invoices/${inv.id}`}
      className={cn(
        "group flex min-h-16 items-center gap-3.5 rounded-xl px-3 py-3 outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring",
        overdue && "bg-destructive/[0.04] hover:bg-destructive/[0.08]",
      )}
    >
      {hideCustomer ? (
        <span className="icon-chip size-10 rounded-full text-muted-foreground">
          <FileTextIcon className="size-4" />
        </span>
      ) : (
        <InitialsAvatar name={inv.customerName} />
      )}
      <div className="min-w-0 flex-1">
        <p className={cn("truncate font-medium", inv.status === "cancelled" && "text-muted-foreground line-through")}>
          {hideCustomer ? (inv.number ?? t("billing.status.draft")) : inv.customerName}
        </p>
        <p className="mt-0.5 truncate text-meta text-muted-foreground tabular-nums">
          {hideCustomer ? "" : `${inv.number ?? t("billing.status.draft")} · `}
          {formatDate(inv.date)}
          {inv.dueDate && open && (
            <span className={cn(inv.isOverdue && "font-medium text-danger-ink")}>
              {" · "}
              {t("billing.invoices.due", { date: formatDate(inv.dueDate) })}
            </span>
          )}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="font-semibold tabular-nums">{money(inv.total)}</span>
        <div className="flex items-center gap-1.5">
          {open && inv.balance > 0 && inv.balance !== inv.total && (
            <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
              {t("billing.invoices.balanceShort", { amount: money(inv.balance) })}
            </span>
          )}
          <StatusBadge status={inv.status} overdue={inv.isOverdue} />
        </div>
      </div>
      <ChevronRightIcon className="hidden size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 sm:block" />
    </ModuleLink>
  );
}

export function InvoiceRowSkeleton() {
  return (
    <div className="flex min-h-16 items-center gap-3.5 px-3 py-3">
      <Skeleton className="size-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-28" />
      </div>
      <div className="flex flex-col items-end gap-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
    </div>
  );
}
