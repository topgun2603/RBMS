"use client";

import * as React from "react";
import {
  AlarmClockIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  BadgeCheckIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleSlashIcon,
  ClockIcon,
  FileEditIcon,
  FlameIcon,
  HourglassIcon,
  Loader2Icon,
  MinusIcon,
  OctagonAlertIcon,
  SendIcon,
  TriangleAlertIcon,
  XCircleIcon,
} from "lucide-react";
import { cn, StatusPill, type StatusTone } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import { durationParts, minutesToDue, slaState, type SlaState } from "../lib/sla";
import type { CampaignCounts, CampaignStatus, Ticket, TicketPriority, TicketStatus } from "../lib/types";

type Icon = React.ComponentType<{ className?: string }>;

const TICKET_STATUS: Record<TicketStatus, { tone: StatusTone; icon: Icon }> = {
  open: { tone: "info", icon: CircleDotIcon },
  pending: { tone: "warning", icon: HourglassIcon },
  resolved: { tone: "success", icon: CheckCircle2Icon },
  closed: { tone: "neutral", icon: CircleSlashIcon },
};

export function TicketStatusPill({ status }: { status: TicketStatus }) {
  const { t } = useI18n();
  const s = TICKET_STATUS[status];
  return (
    <StatusPill tone={s.tone} icon={s.icon}>
      {t(`inbox.ticket.status.${status}`)}
    </StatusPill>
  );
}

const PRIORITY: Record<TicketPriority, { tone: StatusTone; icon: Icon }> = {
  urgent: { tone: "danger", icon: FlameIcon },
  high: { tone: "warning", icon: ArrowUpIcon },
  normal: { tone: "neutral", icon: MinusIcon },
  low: { tone: "neutral", icon: ArrowDownIcon },
};

export function PriorityPill({ priority, hideNormal }: { priority: TicketPriority; hideNormal?: boolean }) {
  const { t } = useI18n();
  if (hideNormal && priority === "normal") return null;
  const p = PRIORITY[priority];
  return (
    <StatusPill tone={p.tone} icon={p.icon}>
      {t(`inbox.ticket.priority.${priority}`)}
    </StatusPill>
  );
}

const SLA: Record<Exclude<SlaState, "none">, { tone: StatusTone; icon: Icon }> = {
  overdue: { tone: "danger", icon: OctagonAlertIcon },
  due_soon: { tone: "warning", icon: AlarmClockIcon },
  on_track: { tone: "neutral", icon: ClockIcon },
  met: { tone: "success", icon: BadgeCheckIcon },
  missed: { tone: "warning", icon: TriangleAlertIcon },
};

/** "Overdue 2h 5m" (red) / "Due in 45m" (amber) / "Due in 6h" / "Replied on time" — always icon + text. */
export function SlaBadge({ ticket, now, hideOnTrack, hideDone }: { ticket: Ticket; now?: number; hideOnTrack?: boolean; hideDone?: boolean }) {
  const { t } = useI18n();
  const [tick, setTick] = React.useState(() => now ?? Date.now());
  React.useEffect(() => {
    if (now !== undefined) return;
    const id = window.setInterval(() => setTick(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [now]);
  const at = now ?? tick;
  const state = slaState(ticket, at);
  if (state === "none" || (hideOnTrack && state === "on_track") || (hideDone && (state === "met" || state === "missed"))) return null;
  const look = SLA[state];
  let text: string;
  if ((state === "overdue" || state === "due_soon" || state === "on_track") && ticket.slaDueAt) {
    const mins = minutesToDue(ticket.slaDueAt, at);
    const { d, h, m } = durationParts(mins);
    const span = d > 0 ? t("inbox.duration.dh", { d, h }) : h > 0 ? t("inbox.duration.hm", { h, m }) : t("inbox.duration.m", { m: Math.max(1, m) });
    text = t(`inbox.sla.${state}`, { time: span });
  } else text = t(`inbox.sla.${state}`);
  return (
    <StatusPill tone={look.tone} icon={look.icon}>
      {text}
    </StatusPill>
  );
}

const CAMPAIGN: Record<CampaignStatus, { tone: StatusTone; icon: Icon; spin?: boolean }> = {
  draft: { tone: "neutral", icon: FileEditIcon },
  scheduled: { tone: "info", icon: CalendarClockIcon },
  running: { tone: "brand", icon: Loader2Icon, spin: true },
  completed: { tone: "success", icon: CheckCircle2Icon },
  cancelled: { tone: "neutral", icon: CircleDashedIcon },
  failed: { tone: "danger", icon: XCircleIcon },
};

export function CampaignStatusPill({ status }: { status: CampaignStatus }) {
  const { t } = useI18n();
  const c = CAMPAIGN[status];
  const Icon = c.icon;
  return (
    <StatusPill tone={c.tone}>
      <Icon className={cn("size-3.5", c.spin && "animate-spin motion-reduce:animate-none")} aria-hidden />
      {t(`inbox.campaign.status.${status}`)}
    </StatusPill>
  );
}

const BAR_ROWS = [
  { key: "sent", cls: "bg-primary", icon: SendIcon },
  { key: "delivered", cls: "bg-info", icon: CheckCircle2Icon },
  { key: "read", cls: "bg-success", icon: BadgeCheckIcon },
  { key: "failed", cls: "bg-destructive", icon: XCircleIcon },
] as const;

/** Small bars: sent / delivered / read / failed out of the total (funnel numbers from the API). */
export function CountBars({ counts, compact }: { counts: CampaignCounts; compact?: boolean }) {
  const { t, formatNumber } = useI18n();
  const total = Math.max(counts.total, 1);
  return (
    <div className={cn("grid gap-1.5", compact ? "w-44" : "w-full")}>
      {BAR_ROWS.map((r) => {
        const v = counts[r.key];
        const pctv = Math.round((v / total) * 100);
        return (
          <div key={r.key} className="grid grid-cols-[4.75rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-xs">
            <span className="flex items-center gap-1 text-muted-foreground">
              <r.icon className="size-3" aria-hidden />
              {t(`inbox.campaign.count.${r.key}`)}
            </span>
            <span
              className="relative h-1.5 overflow-hidden rounded-full bg-muted"
              role="meter"
              aria-label={t(`inbox.campaign.count.${r.key}`)}
              aria-valuemin={0}
              aria-valuemax={counts.total}
              aria-valuenow={v}
              aria-valuetext={`${formatNumber(v)} / ${formatNumber(counts.total)}`}
            >
              <span className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-500", r.cls)} style={{ width: `${pctv}%` }} />
            </span>
            <span className="text-right tabular-nums">{formatNumber(v)}</span>
          </div>
        );
      })}
    </div>
  );
}
