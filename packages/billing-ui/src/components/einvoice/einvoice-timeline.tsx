"use client";

import { useI18n } from "@srirealtime/web";
import { BanIcon, CircleAlertIcon, FileCheck2Icon, TruckIcon } from "lucide-react";
import { AnimatePresence, cn, motion, useReducedMotionSafe } from "@srirealtime/ui";
import { IRN_CANCEL_REASONS, type TimelineEvent, type TimelineKind } from "../../lib/einvoice";

const ICONS: Record<TimelineKind, { icon: typeof BanIcon; tone: string }> = {
  generated: { icon: FileCheck2Icon, tone: "bg-success/15 text-success-ink" },
  failed: { icon: CircleAlertIcon, tone: "bg-destructive/10 text-danger-ink" },
  cancelled: { icon: BanIcon, tone: "bg-muted text-muted-foreground" },
  ewbGenerated: { icon: TruckIcon, tone: "bg-primary/10 text-primary" },
  ewbCancelled: { icon: BanIcon, tone: "bg-muted text-muted-foreground" },
};

/** IRN / e-way bill events, newest first. */
export function EInvoiceTimeline({ events }: { events: TimelineEvent[] }) {
  const { t, formatDate } = useI18n();
  const reduced = useReducedMotionSafe();
  if (!events.length) return null;

  const title = (e: TimelineEvent) =>
    e.kind === "ewbGenerated" || e.kind === "ewbCancelled"
      ? t(`billing.einvoice.timeline.${e.kind}`, { number: e.detail ?? "" })
      : t(`billing.einvoice.timeline.${e.kind}`);
  const sub = (e: TimelineEvent) => {
    if (e.kind === "failed") return e.detail;
    if (e.kind === "generated" && e.detail) return t("billing.einvoice.timeline.ack", { number: e.detail });
    if (e.kind === "cancelled") {
      const reason = e.reason ? t(`billing.einvoice.reasons.${IRN_CANCEL_REASONS[e.reason]}`) : e.detail;
      return [reason ? t("billing.einvoice.timeline.reason", { reason }) : null, e.remark].filter(Boolean).join(" · ") || null;
    }
    return null;
  };

  return (
    <section className="grid gap-2 border-t pt-3">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("billing.einvoice.timeline.title")}</h3>
      <ol className="relative grid gap-3 before:absolute before:top-2 before:bottom-2 before:left-3.5 before:w-px before:bg-border">
        <AnimatePresence initial={false}>
          {events.map((e, i) => {
            const { icon: Icon, tone } = ICONS[e.kind];
            const s = sub(e);
            return (
              <motion.li
                key={e.key}
                layout={!reduced}
                initial={reduced ? false : { opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, delay: reduced ? 0 : Math.min(i, 6) * 0.04 }}
                className="relative flex items-start gap-3"
              >
                <span className={cn("relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full ring-4 ring-card", tone)}>
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium">{title(e)}</p>
                  {s && <p className={cn("text-xs break-words", e.kind === "failed" ? "text-danger-ink" : "text-muted-foreground")}>{s}</p>}
                  <time dateTime={e.at} className="text-[0.6875rem] text-muted-foreground tabular-nums">
                    {formatDate(e.at, { dateStyle: "medium", timeStyle: "short" })}
                  </time>
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>
    </section>
  );
}
