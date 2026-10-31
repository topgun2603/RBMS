"use client";

import { Badge } from "@rbms/ui";
import { tOr, useI18n } from "@/lib/i18n";

export function RoleBadges({ roles }: { roles: string[] }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap gap-1">
      {roles.map((r) => (
        <Badge key={r} variant={r === "owner" ? "default" : r === "admin" ? "secondary" : "outline"}>
          {tOr(t, `admin.roles.${r}`, r)}
        </Badge>
      ))}
    </div>
  );
}

const tone: Record<string, "success" | "destructive" | "warning" | "muted" | "secondary"> = {
  active: "success",
  sent: "success",
  completed: "success",
  ready: "success",
  suspended: "destructive",
  disabled: "destructive",
  failed: "destructive",
  deleted: "muted",
  cancelled: "muted",
  inactive: "muted",
  queued: "warning",
  pending: "warning",
  processing: "secondary",
};

/** Coloured status pill; label from admin.status.<status>. */
export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return (
    <Badge variant={tone[status] ?? "outline"} className="gap-1.5">
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {tOr(t, `admin.status.${status}`, status)}
    </Badge>
  );
}
