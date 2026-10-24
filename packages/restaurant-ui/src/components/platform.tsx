"use client";

import { cn } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import { minutesUntil } from "../lib/online";
import type { Platform } from "../lib/types";

/** Brand colours staff recognise at a glance: Zomato red, Swiggy orange; ONDC blue; others neutral. */
const PLATFORM_CLASS: Record<Platform, string> = {
  zomato: "bg-[#E23744] text-white",
  swiggy: "bg-[#FC8019] text-white",
  ondc: "bg-[#1C75BC] text-white",
  other: "bg-muted text-foreground",
};

export function PlatformBadge({ platform, className }: { platform: Platform | null | undefined; className?: string }) {
  const { t } = useI18n();
  if (!platform) return null;
  return (
    <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-xs font-bold tracking-wide uppercase", PLATFORM_CLASS[platform] ?? PLATFORM_CLASS.other, className)}>
      {t(`restaurant.online.platform.${platform}`)}
    </span>
  );
}

/** "Pickup in 12 min" / "Late by 3 min", coloured as it gets close. */
export function DueChip({ dueAt, now, className }: { dueAt: string | null | undefined; now: number; className?: string }) {
  const { t } = useI18n();
  if (!dueAt) return null;
  const m = minutesUntil(dueAt, now);
  return (
    <span
      className={cn(
        "rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums",
        m < 0 ? "bg-destructive text-white dark:bg-destructive/60" : m <= 5 ? "bg-warning/20 text-warning-ink" : "bg-muted",
        className,
      )}
    >
      {m < 0 ? t("restaurant.online.lateBy", { min: -m }) : t("restaurant.online.pickupIn", { min: m })}
    </span>
  );
}
