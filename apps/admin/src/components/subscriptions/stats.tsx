"use client";

import * as React from "react";
import { AlertTriangleIcon, BadgeIndianRupeeIcon, CalendarRangeIcon, HourglassIcon, PercentIcon, TrendingDownIcon, UsersIcon } from "lucide-react";
import { cn, motion, StatCard, useReducedMotionSafe } from "@rbms/ui";
import { useI18n } from "@/lib/i18n";
import { useSubsT } from "@/lib/subscriptions-messages";
import type { SubscriptionStats, SubscriptionStatus } from "@/lib/types";

const rupees = (paise: number) => paise / 100;

/**
 * Revenue row (MRR, ARR, trial conversion, churn) and the status row (paying, trialing, past due). Status tiles are
 * buttons that filter the list below.
 */
export function SubscriptionStatsTiles({
  stats,
  loading,
  status,
  onStatus,
}: {
  stats: SubscriptionStats | undefined;
  loading: boolean;
  status: SubscriptionStatus | "all";
  onStatus: (s: SubscriptionStatus | "all") => void;
}) {
  const { formatCurrency, formatNumber } = useI18n();
  const k = useSubsT();
  const reduced = useReducedMotionSafe();
  const s = stats;
  const money = (p: number) => formatCurrency(rupees(p), { maximumFractionDigits: 0 });
  const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${formatNumber(Math.round(v * 1000) / 10)}%`);

  const revenue = [
    { id: "mrr", title: k("admin.subs.stats.mrr"), value: s ? money(s.mrrPaise) : "—", description: k("admin.subs.stats.mrrHint"), icon: BadgeIndianRupeeIcon, tone: "text-primary" },
    { id: "arr", title: k("admin.subs.stats.arr"), value: s ? money(s.arrPaise) : "—", description: k("admin.subs.stats.arrHint"), icon: CalendarRangeIcon, tone: "text-primary" },
    {
      id: "conversion",
      title: k("admin.subs.stats.conversion"),
      value: pct(s?.trialConversion),
      description: s && s.trialsEnded > 0 ? k("admin.subs.stats.conversionHint", { converted: s.trialsConverted, ended: s.trialsEnded }) : k("admin.subs.stats.conversionNone"),
      icon: PercentIcon,
      tone: "text-success-ink",
    },
    { id: "churn", title: k("admin.subs.stats.churn"), value: s ? formatNumber(s.churned30d) : "—", description: k("admin.subs.stats.churnHint"), icon: TrendingDownIcon, tone: "text-danger-ink" },
  ];

  const counts: { id: SubscriptionStatus; title: string; value: number | undefined; hint: string; icon: typeof UsersIcon; tone: string; ring: string }[] = [
    {
      id: "active",
      title: k("admin.subs.stats.active"),
      value: s?.active,
      hint: s ? k("admin.subs.stats.activeHint", { comp: s.comp, free: s.free }) : "",
      icon: UsersIcon,
      tone: "text-success-ink",
      ring: "ring-success/40",
    },
    { id: "trialing", title: k("admin.subs.stats.trialing"), value: s?.trialing, hint: "", icon: HourglassIcon, tone: "text-info-ink", ring: "ring-info/40" },
    { id: "past_due", title: k("admin.subs.stats.pastDue"), value: s?.pastDue, hint: k("admin.subs.stats.pastDueHint"), icon: AlertTriangleIcon, tone: "text-danger-ink", ring: "ring-destructive/40" },
  ];

  return (
    <div className="mb-5 grid gap-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {revenue.map((r, i) => (
          <motion.div key={r.id} initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduced ? 0 : i * 0.04 }}>
            <StatCard className="h-full p-4" title={r.title} value={r.value} description={r.description} icon={r.icon} iconClassName={r.tone} loading={loading} />
          </motion.div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {counts.map((c) => {
          const on = status === c.id;
          return (
            <motion.button
              key={c.id}
              type="button"
              aria-pressed={on}
              whileTap={reduced ? undefined : { scale: 0.98 }}
              onClick={() => onStatus(on ? "all" : c.id)}
              className={cn(
                "flex min-w-0 flex-col items-start gap-1 rounded-2xl border border-card-ring bg-card p-3 text-left shadow-elevated outline-none transition-[box-shadow,background-color] hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring sm:p-4",
                on && `ring-2 ${c.ring}`,
              )}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="truncate text-xs font-medium text-muted-foreground sm:text-sm">{c.title}</span>
                <c.icon className={cn("size-4 shrink-0", c.tone)} aria-hidden />
              </span>
              {loading ? (
                <span className="h-7 w-10 animate-pulse rounded bg-muted" />
              ) : (
                <span className={cn("font-heading text-2xl font-semibold tabular-nums", c.id === "past_due" && (c.value ?? 0) > 0 && "text-danger-ink")}>{formatNumber(c.value ?? 0)}</span>
              )}
              {c.hint && <span className="hidden truncate text-xs text-muted-foreground sm:block">{c.hint}</span>}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
