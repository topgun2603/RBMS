"use client";

import * as React from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import { useReducedMotionSafe } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import { ChartTooltipBox } from "./chart-card";
import { money, tickINR } from "../../lib/format";

export interface MonthPoint {
  /** "YYYY-MM" */
  month: string;
  value: number;
}

/**
 * Single-series monthly columns (paise): one hue, 4px rounded data-end on a square baseline, hairline gridlines,
 * compact ₹ ticks, tooltip with the exact amount. No legend: the card title names the series.
 */
export function MonthBars({
  data,
  seriesLabel,
  height = 220,
  color = "var(--series-1)",
}: {
  data: MonthPoint[];
  seriesLabel: string;
  height?: number;
  color?: string;
}) {
  const { formatDate } = useI18n();
  const reduced = useReducedMotionSafe();
  const label = (m: string) => formatDate(`${m}-01`, { month: "short", year: "2-digit" });
  const max = Math.max(0, ...data.map((d) => d.value));
  return (
    <div style={{ height }} className="w-full select-none">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeWidth={1} />
          <XAxis
            dataKey="month"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
            tickFormatter={(m: string) => label(m)}
          />
          <YAxis
            width={44}
            tickLine={false}
            axisLine={false}
            tickCount={4}
            allowDecimals={false}
            domain={[0, max > 0 ? "auto" : 100]}
            tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
            tickFormatter={(v: number) => tickINR(v)}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)", fillOpacity: 0.5 }}
            content={(p: TooltipProps<number, string>) =>
              p.active && p.payload?.length ? (
                <ChartTooltipBox title={label(String(p.label))} rows={[{ label: seriesLabel, value: money(Number(p.payload[0]?.value ?? 0)), color }]} />
              ) : null
            }
          />
          <Bar dataKey="value" name={seriesLabel} fill={color} radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={!reduced} animationDuration={600} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
