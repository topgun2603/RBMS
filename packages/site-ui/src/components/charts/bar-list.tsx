"use client";

import * as React from "react";
import { ModuleLink } from "@srirealtime/web";
import { cn, motion, Tooltip, TooltipContent, TooltipTrigger, useReducedMotionSafe } from "@srirealtime/ui";
import { ChartTooltipBox } from "./chart-card";
import { money } from "../../lib/format";

export interface BarListItem {
  key: string;
  label: React.ReactNode;
  /** Plain text label for tooltips / aria. */
  text: string;
  value: number;
  /** Secondary line in the tooltip, e.g. "12 payments". */
  meta?: string;
  icon?: React.ComponentType<{ className?: string }>;
  href?: string;
}

/**
 * Horizontal bars for categorical magnitudes, sorted by value (largest first). One hue (identity comes
 * from the text label, never the colour); 20px bars with a 4px rounded data-end and square baseline,
 * 6px gaps, value text in foreground ink. Hover/focus shows a tooltip with the exact value and share.
 */
export function BarList({
  items,
  formatValue = money,
  color = "var(--series-1)",
  sort = true,
  className,
}: {
  items: BarListItem[];
  formatValue?: (v: number) => string;
  color?: string;
  sort?: boolean;
  className?: string;
}) {
  const reduced = useReducedMotionSafe();
  const rows = sort ? [...items].sort((a, b) => b.value - a.value) : items;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((s, r) => s + Math.max(0, r.value), 0);

  return (
    <ul className={cn("grid gap-3 px-2 py-1", className)}>
      {rows.map((r, i) => {
        const pct = Math.max(0, (r.value / max) * 100);
        const share = total > 0 ? Math.round((r.value / total) * 100) : 0;
        const Icon = r.icon;
        return (
          <li key={r.key}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  tabIndex={0}
                  className="group grid gap-1.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`${r.text}: ${formatValue(r.value)}${r.meta ? `, ${r.meta}` : ""}`}
                >
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
                      {r.href ? (
                        <ModuleLink to={r.href} className="truncate text-foreground underline-offset-4 hover:underline">
                          {r.label}
                        </ModuleLink>
                      ) : (
                        <span className="truncate text-foreground">{r.label}</span>
                      )}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{formatValue(r.value)}</span>
                  </div>
                  <div className="h-5 w-full">
                    <motion.div
                      className="h-full rounded-r-[4px] rounded-l-none transition-[filter] group-hover:brightness-110"
                      style={{ background: color, minWidth: r.value > 0 ? 3 : 0 }}
                      initial={{ width: reduced ? `${pct}%` : 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={reduced ? { duration: 0 } : { duration: 0.6, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
                    />
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="border-0 bg-transparent p-0 shadow-none [&>span]:hidden">
                <ChartTooltipBox
                  title={r.text}
                  rows={[
                    { label: formatValue(r.value), value: `${share}%`, color },
                    ...(r.meta ? [{ label: r.meta, value: "" }] : []),
                  ]}
                />
              </TooltipContent>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}
