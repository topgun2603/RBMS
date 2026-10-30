"use client";

import * as React from "react";
import { PlusIcon, XIcon } from "lucide-react";
import {
  AnimatePresence,
  Button,
  Field,
  FieldControl,
  FieldError,
  FieldLabel,
  motion,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useReducedMotionSafe,
} from "@rbms/ui";
import { useI18n } from "@rbms/web";
import { useReportLabels } from "./shared";
import {
  changeGroupColumn,
  changeMeasureFn,
  columnOf,
  DATE_BUCKETS,
  isAggregatable,
  isGroupable,
  MAX_GROUP_BY,
  MAX_MEASURES,
  MEASURE_FNS,
  newGroup,
  newMeasure,
  type BuilderGroup,
  type BuilderMeasure,
  type Issue,
} from "../../lib/report-spec";
import type { DatasetInfo, DateBucket, MeasureFn } from "../../lib/types";

const rowMotion = (reduced: boolean) => ({
  layout: !reduced,
  initial: reduced ? false : ({ opacity: 0, y: -4 } as const),
  animate: { opacity: 1, y: 0 },
  exit: reduced ? { opacity: 0 } : { opacity: 0, y: -4 },
  transition: { duration: 0.18 },
});

/** Up to 3 group-by rows; date columns pick a bucket (day … year). */
export function GroupByEditor({
  ds,
  value,
  onChange,
  issues,
}: {
  ds: DatasetInfo;
  value: BuilderGroup[];
  onChange: (next: BuilderGroup[]) => void;
  issues: Issue[];
}) {
  const { t } = useI18n();
  const L = useReportLabels();
  const reduced = useReducedMotionSafe();
  const groupable = ds.columns.filter(isGroupable);
  const buckets = ds.dateBuckets?.length ? ds.dateBuckets : DATE_BUCKETS;
  const taken = value.map((g) => g.column);
  const canAdd = value.length < MAX_GROUP_BY && groupable.some((c) => !taken.includes(c.key));

  if (!groupable.length) return <p className="text-sm text-muted-foreground">{t("growth.reports.group.none")}</p>;
  return (
    <div className="grid gap-2">
      {!value.length && <p className="text-sm text-muted-foreground">{t("growth.reports.group.empty")}</p>}
      <AnimatePresence initial={false}>
        {value.map((g, i) => {
          const col = columnOf(ds, g.column);
          const err = issues.find((x) => x.path === `groupBy.${i}`);
          return (
            <motion.div key={g.id} {...rowMotion(reduced)}>
              <div className="flex items-start gap-2">
                <Field className="flex-1" invalid={!!err}>
                  <FieldLabel className="sr-only">{t("growth.reports.group.column", { n: i + 1 })}</FieldLabel>
                  <Select value={g.column} onValueChange={(v) => onChange(value.map((x) => (x.id === g.id ? changeGroupColumn(ds, x, v) : x)))}>
                    <FieldControl>
                      <SelectTrigger size="sm" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FieldControl>
                    <SelectContent>
                      {groupable.map((c) => (
                        <SelectItem key={c.key} value={c.key} disabled={c.key !== g.column && taken.includes(c.key)}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError>{err ? L.issue(err) : null}</FieldError>
                </Field>
                {col?.type === "date" && (
                  <Field className="w-32 shrink-0">
                    <FieldLabel className="sr-only">{t("growth.reports.group.bucket")}</FieldLabel>
                    <Select value={g.bucket ?? "month"} onValueChange={(v) => onChange(value.map((x) => (x.id === g.id ? { ...x, bucket: v as DateBucket } : x)))}>
                      <FieldControl>
                        <SelectTrigger size="sm" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FieldControl>
                      <SelectContent>
                        {buckets.map((b) => (
                          <SelectItem key={b} value={b}>
                            {L.bucket(b)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
                <Button type="button" size="icon-sm" variant="ghost" aria-label={t("growth.reports.group.remove", { column: col?.label ?? g.column })} onClick={() => onChange(value.filter((x) => x.id !== g.id))}>
                  <XIcon />
                </Button>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canAdd}
          onClick={() => {
            const g = newGroup(ds, taken);
            if (g) onChange([...value, g]);
          }}
        >
          <PlusIcon /> {t("growth.reports.group.add")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("growth.reports.group.max", { max: MAX_GROUP_BY })}</span>
      </div>
    </div>
  );
}

/** Measures: count, or sum/avg/min/max on an aggregatable (number/money) column. */
export function MeasuresEditor({
  ds,
  value,
  onChange,
  issues,
  grouped,
}: {
  ds: DatasetInfo;
  value: BuilderMeasure[];
  onChange: (next: BuilderMeasure[]) => void;
  issues: Issue[];
  /** Grouped by something: no measures means "count". */
  grouped: boolean;
}) {
  const { t } = useI18n();
  const L = useReportLabels();
  const reduced = useReducedMotionSafe();
  const aggregatable = ds.columns.filter(isAggregatable);
  const fns = (ds.measures?.length ? MEASURE_FNS.filter((f) => ds.measures.includes(f)) : MEASURE_FNS).filter((f) => f === "count" || aggregatable.length);

  return (
    <div className="grid gap-2">
      {!value.length && <p className="text-sm text-muted-foreground">{t(grouped ? "growth.reports.measures.defaultCount" : "growth.reports.measures.empty")}</p>}
      <AnimatePresence initial={false}>
        {value.map((m, i) => {
          const err = issues.find((x) => x.path === `measures.${i}` || x.path.startsWith(`measures.${i}.`));
          return (
            <motion.div key={m.id} {...rowMotion(reduced)}>
              <div className="flex items-start gap-2">
                <Field className="w-32 shrink-0" invalid={!!err}>
                  <FieldLabel className="sr-only">{t("growth.reports.measures.fn", { n: i + 1 })}</FieldLabel>
                  <Select value={m.fn} onValueChange={(v) => onChange(value.map((x) => (x.id === m.id ? changeMeasureFn(ds, x, v as MeasureFn) : x)))}>
                    <FieldControl>
                      <SelectTrigger size="sm" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FieldControl>
                    <SelectContent>
                      {fns.map((f) => (
                        <SelectItem key={f} value={f}>
                          {L.fn(f)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field className="flex-1" invalid={!!err}>
                  <FieldLabel className="sr-only">{t("growth.reports.measures.column", { n: i + 1 })}</FieldLabel>
                  {m.fn === "count" ? (
                    <p className="flex h-9 items-center px-1 text-sm text-muted-foreground">{t("growth.reports.measures.countRows")}</p>
                  ) : (
                    <Select value={m.column ?? undefined} onValueChange={(v) => onChange(value.map((x) => (x.id === m.id ? { ...x, column: v } : x)))}>
                      <FieldControl>
                        <SelectTrigger size="sm" className="w-full">
                          <SelectValue placeholder={t("growth.reports.filters.pick")} />
                        </SelectTrigger>
                      </FieldControl>
                      <SelectContent>
                        {aggregatable.map((c) => (
                          <SelectItem key={c.key} value={c.key}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <FieldError>{err ? L.issue(err) : null}</FieldError>
                </Field>
                <Button type="button" size="icon-sm" variant="ghost" aria-label={t("growth.reports.measures.remove", { n: i + 1 })} onClick={() => onChange(value.filter((x) => x.id !== m.id))}>
                  <XIcon />
                </Button>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
      <div>
        <Button type="button" variant="outline" size="sm" disabled={value.length >= MAX_MEASURES} onClick={() => onChange([...value, newMeasure(ds, value)])}>
          <PlusIcon /> {t("growth.reports.measures.add")}
        </Button>
      </div>
    </div>
  );
}
