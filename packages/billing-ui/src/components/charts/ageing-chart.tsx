"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import { useReducedMotionSafe } from "@rbms/ui";
import { ChartTooltipBox } from "./chart-card";
import { money, tickINR } from "../../lib/format";

export interface AgeingBucket {
  key: string;
  label: string;
  amount: number;
  count: number;
}

/** Ordinal sequential ramp (one hue, light → dark on light surfaces; dark → light on dark). */
export const SEQ_COLORS = ["var(--seq-1)", "var(--seq-2)", "var(--seq-3)", "var(--seq-4)", "var(--seq-5)"];

/**
 * Dues ageing as columns in ordinal order (current → 90+), one hue stepping light → dark so older
 * money reads heavier. Columns ≤ 24px with a 4px rounded top, square on the baseline.
 */
export function AgeingChart({
  buckets,
  height = 220,
  countLabel,
}: {
  buckets: AgeingBucket[];
  height?: number;
  /** "{count} bills" formatter for the tooltip. */
  countLabel: (count: number) => string;
}) {
  const reduced = useReducedMotionSafe();
  return (
    <div style={{ height }} className="w-full select-none">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={buckets} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeWidth={1} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} tick={{ fill: "var(--chart-axis)", fontSize: 11 }} />
          <YAxis
            width={44}
            tickLine={false}
            axisLine={false}
            tickCount={4}
            allowDecimals={false}
            tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
            tickFormatter={(v: number) => tickINR(v)}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.5 }}
            content={(p: TooltipProps<number, string>) => {
              const b = p.payload?.[0]?.payload as (AgeingBucket & { index?: number }) | undefined;
              if (!p.active || !b) return null;
              const i = buckets.findIndex((x) => x.key === b.key);
              return (
                <ChartTooltipBox
                  title={b.label}
                  rows={[
                    { label: countLabel(b.count), value: money(b.amount), color: SEQ_COLORS[Math.max(0, i)] },
                  ]}
                />
              );
            }}
          />
          <Bar dataKey="amount" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={!reduced} animationDuration={600}>
            {buckets.map((b, i) => (
              <Cell key={b.key} fill={SEQ_COLORS[Math.min(i, SEQ_COLORS.length - 1)]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
