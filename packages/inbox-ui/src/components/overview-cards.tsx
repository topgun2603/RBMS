"use client";

/* The inbox overview's cards (the dashboard uses the needs-attention rows in widgets/inbox.tsx instead). */

import * as React from "react";
import { ArrowRightIcon, BadgeCheckIcon, InboxIcon, LifeBuoyIcon, MessageCircleIcon, MessageSquareTextIcon, OctagonAlertIcon } from "lucide-react";
import { AnimatedNumber, Button, Card, CardContent, CardHeader, CardTitle, cn, Skeleton } from "@srirealtime/ui";
import { ModuleLink, QueryError, useI18n } from "@srirealtime/web";
import { SlaBadge } from "./pills";
import { useInboxSources } from "../widgets/inbox";
import { useChatUnread, useTicketSummary, useWaUnread } from "../lib/queries";

/** "Unread messages": chat + WhatsApp, each row opens its inbox. Hidden when neither is on. */
export function UnreadWidget() {
  const { t } = useI18n();
  const s = useInboxSources();
  const chat = useChatUnread(s.chat);
  const wa = useWaUnread(s.wa);
  if (!s.chat && !s.wa) return null;
  const rows = [
    s.chat && { key: "chat", to: "chat", label: t("inbox.nav.chat"), icon: MessageCircleIcon, tone: "text-primary", q: chat },
    s.wa && { key: "wa", to: "whatsapp?filter=unread", label: t("inbox.nav.whatsapp"), icon: MessageSquareTextIcon, tone: "text-success-ink", q: wa },
  ].filter(Boolean) as { key: string; to: string; label: string; icon: React.ComponentType<{ className?: string }>; tone: string; q: ReturnType<typeof useChatUnread> }[];
  const total = rows.reduce((n, r) => n + (r.q.data ?? 0), 0);
  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className="icon-chip size-8 text-primary">
            <InboxIcon className="size-4" />
          </span>
          {t("inbox.widget.unread")}
        </CardTitle>
        {rows.every((r) => r.q.isSuccess) && <AnimatedNumber value={total} from={0} className={cn("font-heading text-2xl font-bold tabular-nums", total === 0 && "text-muted-foreground")} />}
      </CardHeader>
      <CardContent className="grid gap-2">
        {rows.map((r) => (
          <ModuleLink key={r.key} to={r.to} className="flex items-center gap-3 rounded-xl border bg-muted/20 px-3 py-2.5 outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring">
            <span className={cn("icon-chip size-8", r.tone)}>
              <r.icon className="size-4" />
            </span>
            <span className="flex-1 text-sm">{r.label}</span>
            {r.q.isError ? (
              <span className="text-xs text-muted-foreground">—</span>
            ) : r.q.isPending ? (
              <Skeleton className="h-6 w-8" />
            ) : (
              <AnimatedNumber value={r.q.data ?? 0} from={0} className={cn("font-heading text-xl font-bold tabular-nums", (r.q.data ?? 0) === 0 && "text-muted-foreground")} />
            )}
            <ArrowRightIcon className="size-4 text-muted-foreground" aria-hidden />
          </ModuleLink>
        ))}
        {total === 0 && rows.every((r) => r.q.isSuccess) && (
          <p className="flex items-center gap-1.5 text-xs text-success-ink">
            <BadgeCheckIcon className="size-3.5" aria-hidden /> {t("inbox.widget.allRead")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** "Tickets needing reply": open tickets (waiting on the shop), overdue count, the three due soonest. */
export function TicketsWidget() {
  const { t } = useI18n();
  const s = useTicketSummary();
  const d = s.data;
  const open = d?.counts.open ?? 0;
  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className="icon-chip size-8 text-primary">
            <LifeBuoyIcon className="size-4" />
          </span>
          {t("inbox.widget.tickets")}
        </CardTitle>
        <Button asChild variant="ghost" size="sm">
          <ModuleLink to="support?status=open">
            {t("inbox.widget.view")} <ArrowRightIcon />
          </ModuleLink>
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3">
        {s.isError ? (
          <QueryError compact error={s.error} onRetry={() => void s.refetch()} />
        ) : (
          <>
            <div className="flex items-end justify-between gap-3">
              <div>
                {s.isPending ? <Skeleton className="h-9 w-16" /> : <AnimatedNumber value={open} from={0} className="font-heading text-3xl font-bold tabular-nums" />}
                <p className="text-meta text-muted-foreground">{t("inbox.widget.needReply")}</p>
              </div>
              {d && d.overdue > 0 && (
                <ModuleLink to="support?status=open&overdue=1" className="inline-flex items-center gap-1.5 rounded-full bg-destructive/12 px-3 py-1 text-sm font-medium text-danger-ink ring-1 ring-destructive/25 ring-inset outline-none hover:bg-destructive/20 focus-visible:ring-2 focus-visible:ring-ring">
                  <OctagonAlertIcon className="size-4" aria-hidden /> {t("inbox.widget.overdue", { count: d.overdue })}
                </ModuleLink>
              )}
            </div>
            {d && d.items.length > 0 ? (
              <ul className="grid gap-1.5">
                {d.items.map((tk) => (
                  <li key={tk.id}>
                    <ModuleLink to={`support/${tk.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="font-mono text-[0.6875rem] text-muted-foreground">{tk.number}</span>
                      <span className="min-w-0 flex-1 truncate">{tk.subject}</span>
                      <SlaBadge ticket={tk} hideOnTrack hideDone />
                    </ModuleLink>
                  </li>
                ))}
              </ul>
            ) : (
              d && (
                <p className="flex items-center gap-1.5 rounded-xl border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-success-ink">
                  <BadgeCheckIcon className="size-4" aria-hidden /> {t("inbox.ticket.allCaughtUp")}
                </p>
              )
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
