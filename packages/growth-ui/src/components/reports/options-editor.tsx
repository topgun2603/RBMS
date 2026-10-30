"use client";

import * as React from "react";
import {
  AnimatePresence,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  FieldRow,
  Input,
  motion,
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  useReducedMotionSafe,
} from "@rbms/ui";
import { useI18n } from "@rbms/web";
import { useReportLabels } from "./shared";
import { MAX_LIMIT, outputKeys, type BuilderDateRange, type BuilderState, type Issue } from "../../lib/report-spec";
import { monthStartIST, todayIST } from "../../lib/format";
import type { DatasetInfo, DatePreset } from "../../lib/types";

const AUTO = "__auto";
const NONE = "__none";
const CUSTOM = "__custom";

/** Date range (presets + custom), only for datasets with a date column. */
export function DateRangeEditor({
  ds,
  value,
  onChange,
  issues,
}: {
  ds: DatasetInfo;
  value: BuilderDateRange;
  onChange: (r: BuilderDateRange) => void;
  issues: Issue[];
}) {
  const { t } = useI18n();
  const L = useReportLabels();
  const reduced = useReducedMotionSafe();
  if (!ds.dateColumn) return null;
  const dateCol = ds.columns.find((c) => c.key === ds.dateColumn);
  const selectValue = value.kind === "preset" ? value.preset : value.kind === "custom" ? CUSTOM : NONE;
  const errFrom = issues.find((i) => i.path === "dateRange.from");
  const errTo = issues.find((i) => i.path === "dateRange.to" || i.path === "dateRange");
  return (
    <div className="grid gap-3">
      <Field>
        <FieldLabel>{t("growth.reports.range.label", { column: dateCol?.label ?? ds.dateColumn })}</FieldLabel>
        <Select
          value={selectValue}
          onValueChange={(v) => {
            if (v === NONE) onChange({ kind: "none" });
            else if (v === CUSTOM) onChange({ kind: "custom", from: value.kind === "custom" ? value.from : monthStartIST(), to: value.kind === "custom" ? value.to : todayIST() });
            else onChange({ kind: "preset", preset: v as DatePreset });
          }}
        >
          <FieldControl>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
          </FieldControl>
          <SelectContent>
            {ds.datePresets.map((p) => (
              <SelectItem key={p} value={p}>
                {L.preset(p)}
              </SelectItem>
            ))}
            <SelectSeparator />
            <SelectItem value={CUSTOM}>{t("growth.reports.range.custom")}</SelectItem>
            <SelectItem value={NONE}>{t("growth.reports.range.all")}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <AnimatePresence initial={false}>
        {value.kind === "custom" && (
          <motion.div
            key="custom"
            initial={reduced ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <FieldRow cols={2}>
              <Field invalid={!!errFrom}>
                <FieldLabel>{t("growth.common.from")}</FieldLabel>
                <FieldControl>
                  <Input size="sm" type="date" value={value.from} max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value })} />
                </FieldControl>
                <FieldError>{errFrom ? L.issue(errFrom) : null}</FieldError>
              </Field>
              <Field invalid={!!errTo}>
                <FieldLabel>{t("growth.common.to")}</FieldLabel>
                <FieldControl>
                  <Input size="sm" type="date" value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} />
                </FieldControl>
                <FieldError>{errTo ? L.issue(errTo) : null}</FieldError>
              </Field>
            </FieldRow>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Sort (one output key + direction) and row limit. */
export function SortLimitEditor({
  ds,
  state,
  onChange,
  issues,
}: {
  ds: DatasetInfo;
  state: BuilderState;
  onChange: (patch: Partial<BuilderState>) => void;
  issues: Issue[];
}) {
  const { t } = useI18n();
  const L = useReportLabels();
  const keys = outputKeys(ds, state);
  const sortValue = state.sort && keys.some((k) => k.key === state.sort!.column) ? state.sort.column : AUTO;
  const limitErr = issues.find((i) => i.path === "limit");
  return (
    <FieldRow cols={3}>
      <Field>
        <FieldLabel>{t("growth.reports.sort.label")}</FieldLabel>
        <Select value={sortValue} onValueChange={(v) => onChange({ sort: v === AUTO ? null : { column: v, dir: state.sort?.dir ?? "desc" } })}>
          <FieldControl>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
          </FieldControl>
          <SelectContent>
            <SelectItem value={AUTO}>{t("growth.reports.sort.auto")}</SelectItem>
            {keys.map((k) => (
              <SelectItem key={k.key} value={k.key}>
                {L.outputKey(ds, k)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel>{t("growth.reports.sort.dir")}</FieldLabel>
        <Select
          value={state.sort?.dir ?? "desc"}
          disabled={sortValue === AUTO}
          onValueChange={(v) => state.sort && onChange({ sort: { ...state.sort, dir: v as "asc" | "desc" } })}
        >
          <FieldControl>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
          </FieldControl>
          <SelectContent>
            <SelectItem value="asc">{t("growth.reports.sort.asc")}</SelectItem>
            <SelectItem value="desc">{t("growth.reports.sort.desc")}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field invalid={!!limitErr}>
        <FieldLabel optional={t("growth.common.optional")}>{t("growth.reports.limit.label")}</FieldLabel>
        <FieldControl>
          <Input size="sm" inputMode="numeric" value={state.limit} placeholder="500" onChange={(e) => onChange({ limit: e.target.value.replace(/[^\d]/g, "") })} />
        </FieldControl>
        {limitErr ? <FieldError>{L.issue(limitErr)}</FieldError> : <FieldHint>{t("growth.reports.limit.hint", { max: MAX_LIMIT })}</FieldHint>}
      </Field>
    </FieldRow>
  );
}
