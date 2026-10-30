"use client";

import * as React from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import { useReducedMotionSafe } from "@rbms/ui";
import { compactINR, num } from "../../lib/format";
import type { RunColumn, RunResult } from "../../lib/types";

export type ChartKind = "bar" | "line";

export interface ChartPoint {
  label: string;
  value: number;
}

/** First group column × first measure of a grouped result, as chart points (labels formatted). */
export function chartData(result: RunResult, format: (col: RunColumn, v: string | number | null) => string): { x: RunColumn; y: RunColumn; points: ChartPoint[] } | null {
  if (result.mode !== "grouped") return null;
  const x = result.columns.find((c) => !c.fn);
  const y = result.columns.find((c) => c.fn);
  if (!x || !y) return null;
  return { x, y, points: result.rows.map((r) => ({ label: format(x, r[x.key] ?? null), value: Number(r[y.key] ?? 0) })) };
}

/**
 * Single series in the tenant primary colour: bars ≤ 24 px with 4px rounded ends on the baseline, or a 2px line;
 * recessive horizontal grid, no axis lines, 11px muted ticks, tooltip with the exact formatted value.
 */
export function ReportChart({
  kind,
  points,
  seriesLabel,
  formatValue,
  money,
  height = 260,
}: {
  kind: ChartKind;
  points: ChartPoint[];
  seriesLabel: string;
  formatValue: (v: number) => string;
  /** Compact ₹ ticks. */
  money: boolean;
  height?: number;
}) {
  const reduced = useReducedMotionSafe();
  const color = "var(--primary)";
  const max = Math.max(0, ...points.map((p) => p.value));
  const tick = (v: number) => (money ? compactINR(v) : num(v));
  const common = {
    data: points,
    margin: { top: 8, right: 12, bottom: 0, left: 0 },
  };
  const grid = <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeWidth={1} />;
  const xAxis = (
    <XAxis
      dataKey="label"
      tickLine={false}
      axisLine={false}
      tickMargin={8}
      minTickGap={16}
      interval="preserveStartEnd"
      tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
    />
  );
  const yAxis = (
    <YAxis
      width={52}
      tickLine={false}
      axisLine={false}
      tickCount={4}
      allowDecimals={false}
      domain={[(min: number) => Math.min(0, min), max > 0 ? "auto" : 1]}
      tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
      tickFormatter={tick}
    />
  );
  const tooltip = (cursor: object) => (
    <Tooltip
      cursor={cursor}
      content={(p: TooltipProps<number, string>) =>
        p.active && p.payload?.length ? (
          <div className="min-w-36 rounded-xl border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-raised">
            <p className="mb-1 font-medium text-muted-foreground">{String(p.label)}</p>
            <div className="flex items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: color }} aria-hidden />
              <span className="text-muted-foreground">{seriesLabel}</span>
              <span className="ml-auto pl-3 font-semibold tabular-nums">{formatValue(Number(p.payload[0]?.value ?? 0))}</span>
            </div>
          </div>
        ) : null
      }
    />
  );

  return (
    <div style={{ height }} className="w-full select-none [&_.recharts-surface]:overflow-visible">
      <ResponsiveContainer width="100%" height="100%">
        {kind === "bar" ? (
          <BarChart {...common} barCategoryGap="24%">
            {grid}
            {xAxis}
            {yAxis}
            {tooltip({ fill: "var(--muted)", fillOpacity: 0.5 })}
            <Bar dataKey="value" name={seriesLabel} fill={color} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={!reduced} animationDuration={500} />
          </BarChart>
        ) : (
          <LineChart {...common}>
            {grid}
            {xAxis}
            {yAxis}
            {tooltip({ stroke: "var(--muted-foreground)", strokeWidth: 1, strokeOpacity: 0.5 })}
            <Line
              type="monotone"
              dataKey="value"
              name={seriesLabel}
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={points.length <= 24 ? { r: 3, fill: color, stroke: "var(--card)", strokeWidth: 2 } : false}
              activeDot={{ r: 5, fill: color, stroke: "var(--card)", strokeWidth: 2 }}
              isAnimationActive={!reduced}
              animationDuration={600}
            />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
