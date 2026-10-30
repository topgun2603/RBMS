"use client";

import * as React from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import { useReducedMotionSafe } from "@rbms/ui";
import { ChartTooltipBox } from "./chart-card";
import { money, tickINR } from "../../lib/format";
import { useI18n } from "@rbms/web";

export interface TrendPoint {
  date: string;
  value: number;
}

/**
 * Single-series area chart over time (paise). Tenant primary line (2px, round caps), 10% area fill,
 * hairline solid gridlines, compact ₹ ticks, crosshair + tooltip on hover. No legend: the card title names it.
 */
export function TrendChart({
  data,
  seriesLabel,
  height = 220,
  formatValue = money,
  color = "var(--primary)",
}: {
  data: TrendPoint[];
  /** Name shown in the tooltip, e.g. "Sales". */
  seriesLabel: string;
  height?: number;
  formatValue?: (paise: number) => string;
  color?: string;
}) {
  const { formatDate } = useI18n();
  const reduced = useReducedMotionSafe();
  const gid = React.useId().replace(/:/g, "");
  const max = Math.max(0, ...data.map((d) => d.value));

  return (
    <div style={{ height }} className="w-full select-none [&_.recharts-surface]:overflow-visible">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`trend-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.14} />
              <stop offset="100%" stopColor={color} stopOpacity={0.06} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeWidth={1} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            minTickGap={24}
            tickMargin={8}
            tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
            tickFormatter={(d: string) => formatDate(d, { day: "numeric", month: "short" })}
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
            cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1, strokeOpacity: 0.5 }}
            content={(p: TooltipProps<number, string>) =>
              p.active && p.payload?.length ? (
                <ChartTooltipBox
                  title={formatDate(String(p.label), { weekday: "short", day: "numeric", month: "short" })}
                  rows={[{ label: seriesLabel, value: formatValue(Number(p.payload[0]?.value ?? 0)), color }]}
                />
              ) : null
            }
          />
          <Area
            type="monotone"
            dataKey="value"
            name={seriesLabel}
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill={`url(#trend-${gid})`}
            isAnimationActive={!reduced}
            animationDuration={700}
            activeDot={{ r: 5, fill: color, stroke: "var(--card)", strokeWidth: 2 }}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
