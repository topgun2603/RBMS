"use client";

import * as React from "react";
import { ArrowDownIcon, ArrowUpIcon, GripVerticalIcon, InfoIcon } from "lucide-react";
import { Badge, Button, Checkbox, cn, motion, useReducedMotionSafe } from "@rbms/ui";
import { useI18n } from "@rbms/web";
import { columnOf, moveItem, type BuilderColumn } from "../../lib/report-spec";
import type { ColumnType, DatasetInfo } from "../../lib/types";

/**
 * Columns of a rows report: checkbox on/off and drag to reorder (HTML5 drag on the handle, live reorder with layout
 * animation), plus up/down buttons for keyboard and touch.
 */
export function ColumnsPicker({
  ds,
  value,
  onChange,
  disabled,
}: {
  ds: DatasetInfo;
  value: BuilderColumn[];
  onChange: (next: BuilderColumn[]) => void;
  /** Grouped mode: columns come from group by + measures. */
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const reduced = useReducedMotionSafe();
  const [dragKey, setDragKey] = React.useState<string | null>(null);
  const onCount = value.filter((c) => c.on).length;
  const live = React.useRef<HTMLParagraphElement>(null);

  const move = (from: number, to: number, announce = true) => {
    if (to < 0 || to >= value.length || from === to) return;
    onChange(moveItem(value, from, to));
    if (announce && live.current) {
      const label = columnOf(ds, value[from]!.key)?.label ?? "";
      live.current.textContent = t("growth.reports.columns.moved", { column: label, position: to + 1, total: value.length });
    }
  };

  return (
    <div className="grid gap-2">
      {disabled && (
        <p className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-meta text-muted-foreground">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
          {t("growth.reports.columns.groupedNote")}
        </p>
      )}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{t("growth.reports.columns.count", { on: onCount, total: value.length })}</span>
        <span className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => onChange(value.map((c) => ({ ...c, on: true })))}
          >
            {t("growth.reports.columns.all")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => onChange(value.map((c) => ({ ...c, on: columnOf(ds, c.key)?.default !== false })))}
          >
            {t("growth.reports.columns.reset")}
          </Button>
        </span>
      </div>
      <p ref={live} className="sr-only" aria-live="polite" />
      <ul className={cn("grid gap-1", disabled && "pointer-events-none opacity-50")} aria-label={t("growth.reports.columns.title")} aria-disabled={disabled || undefined}>
        {value.map((c, i) => {
          const col = columnOf(ds, c.key);
          if (!col) return null;
          const id = `col-${ds.id}-${c.key}`;
          return (
            <motion.li
              key={c.key}
              layout={reduced ? false : "position"}
              transition={{ type: "spring", stiffness: 500, damping: 40 }}
              onDragOver={(e: React.DragEvent) => {
                if (!dragKey || dragKey === c.key) return;
                e.preventDefault();
                const from = value.findIndex((x) => x.key === dragKey);
                if (from >= 0) move(from, i, false);
              }}
              onDrop={(e: React.DragEvent) => {
                e.preventDefault();
                setDragKey(null);
              }}
              className={cn(
                "flex items-center gap-2 rounded-lg border bg-card py-1 pr-1 pl-1.5",
                dragKey === c.key && "border-primary/50 shadow-md ring-2 ring-primary/20",
                !c.on && "bg-muted/30",
              )}
            >
              <span
                draggable={!disabled}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", c.key);
                  setDragKey(c.key);
                }}
                onDragEnd={() => setDragKey(null)}
                className="flex cursor-grab touch-none items-center self-stretch px-0.5 text-muted-foreground active:cursor-grabbing"
                aria-hidden
                title={t("growth.reports.columns.drag")}
              >
                <GripVerticalIcon className="size-4" />
              </span>
              <Checkbox
                id={id}
                checked={c.on}
                disabled={disabled}
                onCheckedChange={(on) => onChange(value.map((x) => (x.key === c.key ? { ...x, on: on === true } : x)))}
              />
              <label htmlFor={id} className={cn("min-w-0 flex-1 cursor-pointer truncate py-1.5 text-sm", !c.on && "text-muted-foreground")}>
                {col.label}
              </label>
              <TypeBadge type={col.type} />
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                disabled={disabled || i === 0}
                aria-label={t("growth.reports.columns.up", { column: col.label })}
                onClick={() => move(i, i - 1)}
              >
                <ArrowUpIcon />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                disabled={disabled || i === value.length - 1}
                aria-label={t("growth.reports.columns.down", { column: col.label })}
                onClick={() => move(i, i + 1)}
              >
                <ArrowDownIcon />
              </Button>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}

export function TypeBadge({ type }: { type: ColumnType }) {
  const { t } = useI18n();
  return (
    <Badge variant="outline" className="hidden shrink-0 font-normal text-muted-foreground sm:inline-flex">
      {t(`growth.reports.types.${type}`)}
    </Badge>
  );
}
