"use client";

import * as React from "react";
import { AlertTriangleIcon, BanIcon, PackageCheckIcon, ReceiptIcon, ShieldAlertIcon, ShieldCheckIcon, ShieldOffIcon, Undo2Icon, WrenchIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle, cn, StatusPill, type StatusTone } from "@rbms/ui";
import { ModuleLink, useI18n } from "@rbms/web";
import { useSerialsConfig } from "../lib/config";
import type { SerialEvent, SerialStatus, WarrantyStatus } from "../lib/types";

export function InlineError({ title, children }: { title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <Alert variant="destructive">
      <AlertTriangleIcon />
      <AlertTitle>{title}</AlertTitle>
      {children && <AlertDescription>{children}</AlertDescription>}
    </Alert>
  );
}

const STATUS_TONE: Record<SerialStatus, StatusTone> = { in_stock: "success", sold: "info", returned: "warning", defective: "danger", written_off: "neutral" };
const STATUS_ICON: Record<SerialStatus, React.ComponentType<{ className?: string }>> = {
  in_stock: PackageCheckIcon,
  sold: ReceiptIcon,
  returned: Undo2Icon,
  defective: WrenchIcon,
  written_off: BanIcon,
};

export function StatusChip({ status }: { status: SerialStatus }) {
  const { t } = useI18n();
  return (
    <StatusPill tone={STATUS_TONE[status]} icon={STATUS_ICON[status]}>
      {t(`serials.status.${status}`)}
    </StatusPill>
  );
}

/** Green while the warranty runs (with days left), red once over, muted without one. */
export function WarrantyPill({ status, end, daysLeft, size }: { status: WarrantyStatus; end: string | null; daysLeft: number | null; size?: "sm" | "md" }) {
  const { t, formatDate } = useI18n();
  if (status === "none" || !end) {
    return (
      <StatusPill tone="neutral" icon={ShieldOffIcon} size={size}>
        {t("serials.warranty.none")}
      </StatusPill>
    );
  }
  return status === "active" ? (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <StatusPill tone="success" icon={ShieldCheckIcon} size={size}>
        {t("serials.warranty.activeUntil", { date: formatDate(end) })}
      </StatusPill>
      <span className="text-meta text-muted-foreground">{t("serials.warranty.daysLeft", { days: daysLeft ?? 0 })}</span>
    </span>
  ) : (
    <StatusPill tone="danger" icon={ShieldAlertIcon} size={size}>
      {t("serials.warranty.expiredOn", { date: formatDate(end) })}
    </StatusPill>
  );
}

/** Link to the bill a unit was sold on (host route, default /invoices/:id). */
export function BillLink({ id, number }: { id: string | null; number: string | null }) {
  const { invoiceHref } = useSerialsConfig();
  const { t } = useI18n();
  if (!id) return <span>{number ?? "—"}</span>;
  return (
    <ModuleLink href={invoiceHref(id)} className="font-medium text-primary hover:underline">
      {number ?? t("serials.common.bill")}
    </ModuleLink>
  );
}

/** A unit's history, newest first. */
export function EventTimeline({ events }: { events: SerialEvent[] }) {
  const { t, formatDate } = useI18n();
  if (events.length === 0) return <p className="text-sm text-muted-foreground">{t("serials.events.empty")}</p>;
  return (
    <ol className="relative grid gap-3 border-l pl-4">
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span
            className={cn(
              "absolute top-1.5 -left-[21px] size-2.5 rounded-full ring-2 ring-background",
              e.type === "sold" ? "bg-info" : e.type === "warranty_claim" || e.type === "defective" ? "bg-destructive" : e.type === "received" || e.type === "back_in_stock" ? "bg-success" : "bg-muted-foreground",
            )}
            aria-hidden
          />
          <p className="text-sm font-medium">
            {t(`serials.events.types.${e.type}`)}
            {e.refNumber && <span className="font-normal text-muted-foreground"> · {e.refNumber}</span>}
          </p>
          <p className="text-meta text-muted-foreground">
            {formatDate(e.createdAt, { dateStyle: "medium", timeStyle: "short" })}
            {e.note ? ` · ${e.note}` : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}

