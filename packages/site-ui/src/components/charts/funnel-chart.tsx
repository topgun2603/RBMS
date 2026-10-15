"use client";

import * as React from "react";
import { ArrowDownIcon } from "lucide-react";
import { motion, useReducedMotionSafe } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import type { FunnelRow } from "../../lib/analytics";
import { pct } from "../../lib/format";

/**
 * Funnel as horizontal bars in step order (never re-sorted): one hue, 20px bars with a 4px rounded data end, width =
 * share of the first step. Between bars, the drop-off from the previous step as text (no colour-only encoding).
 */
export function FunnelChart({ rows, label }: { rows: FunnelRow[]; label: (step: FunnelRow["step"]) => string }) {
  const { t, formatNumber } = useI18n();
  const reduced = useReducedMotionSafe();
  return (
    <ol className="grid gap-1 px-2 py-1">
      {rows.map((r, i) => (
        <li key={r.step} className="grid gap-1">
          {i > 0 && (
            <p className="flex items-center gap-1 pl-1 text-[0.6875rem] text-muted-foreground">
              <ArrowDownIcon className="size-3" aria-hidden />
              {r.dropOff === null ? t("site.analytics.noDropData") : t("site.analytics.dropOff", { pct: pct(r.dropOff) })}
            </p>
          )}
          <div className="grid gap-1.5" aria-label={`${label(r.step)}: ${formatNumber(r.count)} (${pct(r.ofStart)})`}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate">{label(r.step)}</span>
              <span className="shrink-0 tabular-nums">
                <span className="font-semibold">{formatNumber(r.count)}</span>
                <span className="ml-1.5 text-xs text-muted-foreground">{pct(r.ofStart)}</span>
              </span>
            </div>
            <div className="h-5 w-full rounded-r-[4px] bg-muted/50">
              <motion.div
                className="h-full rounded-r-[4px]"
                style={{ background: "var(--primary)", minWidth: r.count > 0 ? 3 : 0 }}
                initial={{ width: reduced ? `${r.ofStart}%` : 0 }}
                animate={{ width: `${r.ofStart}%` }}
                transition={reduced ? { duration: 0 } : { duration: 0.6, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
