"use client";

import * as React from "react";
import { CalendarRangeIcon } from "lucide-react";
import { ChipGroup, cn, Input, Label } from "@srirealtime/ui";
import { rangeFor, RANGE_PRESETS, todayIST, type DateRange, type RangePreset } from "../lib/format";
import { useI18n } from "@srirealtime/web";

export interface DateRangeValue extends DateRange {
  preset: RangePreset;
}

export const initialRange = (preset: Exclude<RangePreset, "custom"> = "thisMonth"): DateRangeValue => ({ preset, ...rangeFor(preset) });

/** Preset chips (This month … Last FY, Custom) and, for Custom, two date inputs. */
export function DateRangePicker({
  value,
  onChange,
  presets = RANGE_PRESETS,
  className,
}: {
  value: DateRangeValue;
  onChange: (v: DateRangeValue) => void;
  presets?: RangePreset[];
  className?: string;
}) {
  const { t, formatDate } = useI18n();
  const today = todayIST();
  return (
    <div className={cn("grid gap-2", className)}>
      <ChipGroup
        size="sm"
        aria-label={t("billing.range.label")}
        value={value.preset}
        onChange={(p) => onChange(p === "custom" ? { ...value, preset: p } : { preset: p, ...rangeFor(p) })}
        options={presets.map((p) => ({ value: p, label: t(`billing.range.${p}`) }))}
      />
      {value.preset === "custom" ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <Label htmlFor="range-from" className="text-xs text-muted-foreground">
              {t("billing.range.from")}
            </Label>
            <Input
              id="range-from"
              type="date"
              className="h-10 w-40"
              value={value.from}
              max={value.to || today}
              onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="range-to" className="text-xs text-muted-foreground">
              {t("billing.range.to")}
            </Label>
            <Input
              id="range-to"
              type="date"
              className="h-10 w-40"
              value={value.to}
              min={value.from}
              max={today}
              onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })}
            />
          </div>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
          <CalendarRangeIcon className="size-3.5" />
          {formatDate(value.from, { day: "numeric", month: "short", year: "numeric" })} –{" "}
          {formatDate(value.to, { day: "numeric", month: "short", year: "numeric" })}
        </p>
      )}
    </div>
  );
}
