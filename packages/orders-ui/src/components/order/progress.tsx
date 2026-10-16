"use client";

import { CheckIcon } from "lucide-react";
import { cn, motion } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import { flowIndex, ORDER_FLOW } from "../../lib/status";
import type { Order } from "../../lib/types";
import { ORDER_STATUS_META } from "../pills";

/** The order's journey: placed → confirmed → packed → shipped → delivered, with the date each step happened. */
export function OrderProgress({ order }: { order: Order }) {
  const { t, formatDate } = useI18n();
  const current = flowIndex(order.status);
  const stopped = current < 0;
  const dates: Partial<Record<string, string | null>> = {
    placed: order.placedAt,
    confirmed: order.confirmedAt,
    shipped: order.shippedAt,
    delivered: order.deliveredAt,
  };
  // Where a cancelled/returned order stopped: the last step it reached.
  const reached = stopped ? (order.status === "returned" ? ORDER_FLOW.length - 1 : lastReached(order)) : current;

  return (
    <ol className="grid grid-cols-5 gap-1" aria-label={t("orders.detail.progress")}>
      {ORDER_FLOW.map((s, i) => {
        const done = i <= reached;
        const isCurrent = !stopped && i === current;
        const Icon = ORDER_STATUS_META[s].icon;
        const d = dates[s];
        return (
          <li key={s} className="relative grid justify-items-center gap-1.5 text-center" aria-current={isCurrent ? "step" : undefined}>
            {i > 0 && (
              <span aria-hidden className="absolute top-4 right-1/2 h-0.5 w-full -translate-y-1/2 overflow-hidden rounded-full bg-border">
                <motion.span
                  className={cn("block h-full", stopped && i > reached ? "bg-transparent" : "bg-primary")}
                  initial={{ width: 0 }}
                  animate={{ width: done ? "100%" : "0%" }}
                  transition={{ duration: 0.4, delay: i * 0.06 }}
                />
              </span>
            )}
            <span
              className={cn(
                "relative z-10 flex size-8 items-center justify-center rounded-full ring-4 ring-card transition-colors",
                done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                isCurrent && "shadow-[0_0_0_4px] shadow-primary/25",
              )}
            >
              {done && !isCurrent ? <CheckIcon className="size-4" /> : <Icon className="size-4" />}
            </span>
            <span className={cn("text-xs leading-tight font-medium", done ? "text-foreground" : "text-muted-foreground")}>{t(`orders.status.${s}`)}</span>
            {d && done && (
              <span className="hidden text-xs text-muted-foreground tabular-nums sm:block">{formatDate(d, { day: "numeric", month: "short" })}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** The furthest flow step a cancelled order reached, from its status events. */
function lastReached(order: Order): number {
  let best = 0;
  for (const e of order.events) {
    if (e.type === "status" && e.toStatus) best = Math.max(best, flowIndex(e.toStatus));
    if (e.type === "status" && e.fromStatus) best = Math.max(best, flowIndex(e.fromStatus));
  }
  return best;
}
