"use client";

import * as React from "react";
import { FilterIcon, PlusIcon, Trash2Icon } from "lucide-react";
import {
  AnimatePresence,
  Button,
  Checkbox,
  Field,
  FieldControl,
  FieldError,
  FieldLabel,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  motion,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useReducedMotionSafe,
} from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import { ChipsInput } from "./chips-input";
import { useReportLabels } from "./shared";
import {
  changeFilterColumn,
  changeFilterOp,
  columnOf,
  isFilterable,
  issuesAt,
  MAX_FILTERS,
  newFilter,
  opsFor,
  parseValue,
  type BuilderFilter,
  type Issue,
} from "../../lib/report-spec";
import type { DatasetColumn, DatasetInfo } from "../../lib/types";

const EMPTY_KEYS = new Set(["valueRequired", "valueList", "pickOne"]);

/** Filter rows: column → op (allowed for its type) → type-aware value input(s). */
export function FiltersEditor({
  ds,
  value,
  onChange,
  issues,
}: {
  ds: DatasetInfo;
  value: BuilderFilter[];
  onChange: (next: BuilderFilter[]) => void;
  issues: Issue[];
}) {
  const { t } = useI18n();
  const reduced = useReducedMotionSafe();
  const filterable = ds.columns.filter(isFilterable);
  const update = (id: string, next: BuilderFilter) => onChange(value.map((f) => (f.id === id ? next : f)));
  const add = () => {
    const f = newFilter(ds);
    if (f) onChange([...value, f]);
  };

  return (
    <div className="grid gap-3">
      {!value.length && <p className="text-sm text-muted-foreground">{t("growth.reports.filters.empty")}</p>}
      <AnimatePresence initial={false}>
        {value.map((f, i) => (
          <motion.div
            key={f.id}
            layout={!reduced}
            initial={reduced ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <FilterRow ds={ds} index={i} filter={f} columns={filterable} issues={issuesAt(issues, `filters.${i}`)} onChange={(n) => update(f.id, n)} onRemove={() => onChange(value.filter((x) => x.id !== f.id))} />
          </motion.div>
        ))}
      </AnimatePresence>
      <div>
        <Button type="button" variant="outline" size="sm" onClick={add} disabled={!filterable.length || value.length >= MAX_FILTERS}>
          <PlusIcon /> {t("growth.reports.filters.add")}
        </Button>
      </div>
    </div>
  );
}

function FilterRow({
  ds,
  index,
  filter: f,
  columns,
  issues,
  onChange,
  onRemove,
}: {
  ds: DatasetInfo;
  index: number;
  filter: BuilderFilter;
  columns: DatasetColumn[];
  issues: Issue[];
  onChange: (f: BuilderFilter) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const L = useReportLabels();
  const col = columnOf(ds, f.column);
  const ops = opsFor(ds, col);
  const errOf = (sub: string) => {
    const i = issues.find((x) => x.path === `filters.${index}.${sub}`);
    // An empty value isn't an error yet: the filter is just skipped (see the "incomplete" hint).
    return i && !EMPTY_KEYS.has(i.key) ? L.issue(i) : null;
  };
  const incomplete = issues.some((x) => EMPTY_KEYS.has(x.key));

  return (
    <div className="grid gap-3 rounded-xl border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <FilterIcon className="size-3.5" />
          {t("growth.reports.filters.n", { n: index + 1 })}
        </span>
        <Button type="button" size="icon-sm" variant="ghost" aria-label={t("growth.reports.filters.remove", { n: index + 1 })} onClick={onRemove}>
          <Trash2Icon />
        </Button>
      </div>
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <Field invalid={!!errOf("column")}>
          <FieldLabel>{t("growth.reports.filters.column")}</FieldLabel>
          <Select value={f.column} onValueChange={(v) => onChange(changeFilterColumn(ds, f, v))}>
            <FieldControl>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
            </FieldControl>
            <SelectContent>
              {columns.map((c) => (
                <SelectItem key={c.key} value={c.key}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError>{errOf("column")}</FieldError>
        </Field>
        <Field invalid={!!errOf("op")}>
          <FieldLabel>{t("growth.reports.filters.op")}</FieldLabel>
          <Select value={f.op} onValueChange={(v) => onChange(changeFilterOp(f, v as BuilderFilter["op"]))}>
            <FieldControl>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
            </FieldControl>
            <SelectContent>
              {ops.map((o) => (
                <SelectItem key={o} value={o}>
                  {L.op(o)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError>{errOf("op")}</FieldError>
        </Field>
      </div>
      {col && <FilterValue col={col} filter={f} onChange={onChange} error={errOf("value")} error2={errOf("value2")} />}
      {incomplete && <p className="text-xs text-muted-foreground">{t("growth.reports.filters.incomplete")}</p>}
    </div>
  );
}

/** Value input(s) by column type and op. Money is typed in rupees (sent as paise). */
function FilterValue({
  col,
  filter: f,
  onChange,
  error,
  error2,
}: {
  col: DatasetColumn;
  filter: BuilderFilter;
  onChange: (f: BuilderFilter) => void;
  error: string | null;
  error2: string | null;
}) {
  const { t } = useI18n();

  // enum + in: checkboxes
  if (col.type === "enum" && f.op === "in") {
    return (
      <Field invalid={!!error}>
        <FieldLabel htmlFor={null}>{t("growth.reports.filters.values")}</FieldLabel>
        <div role="group" aria-label={col.label} className="flex flex-wrap gap-x-4 gap-y-2">
          {(col.options ?? []).map((o) => {
            const id = `${f.id}-${o.value}`;
            const on = f.values.includes(o.value);
            return (
              <label key={o.value} htmlFor={id} className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  id={id}
                  checked={on}
                  onCheckedChange={(c) => onChange({ ...f, values: c === true ? [...f.values, o.value] : f.values.filter((v) => v !== o.value) })}
                />
                {o.label}
              </label>
            );
          })}
        </div>
        <FieldError>{error}</FieldError>
      </Field>
    );
  }

  // enum single
  if (col.type === "enum") {
    return (
      <Field invalid={!!error}>
        <FieldLabel>{t("growth.reports.filters.value")}</FieldLabel>
        <Select value={f.value || undefined} onValueChange={(v) => onChange({ ...f, value: v })}>
          <FieldControl>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue placeholder={t("growth.reports.filters.pick")} />
            </SelectTrigger>
          </FieldControl>
          <SelectContent>
            {(col.options ?? []).map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError>{error}</FieldError>
      </Field>
    );
  }

  // in: chips (text, number, money)
  if (f.op === "in") {
    return (
      <Field invalid={!!error}>
        <FieldLabel>{t("growth.reports.filters.values")}</FieldLabel>
        <FieldControl>
          <ChipsInput
            size="sm"
            value={f.values}
            onChange={(values) => onChange({ ...f, values })}
            validate={(v) => parseValue(col, v).ok}
            inputMode={col.type === "text" ? undefined : "decimal"}
            placeholder={t(col.type === "money" ? "growth.reports.filters.inMoney" : "growth.reports.filters.inHint")}
          />
        </FieldControl>
        <FieldError>{error}</FieldError>
      </Field>
    );
  }

  const between = f.op === "between";
  const single = (v: string, set: (v: string) => void, label: string, err: string | null) => (
    <Field invalid={!!err}>
      <FieldLabel>{label}</FieldLabel>
      <FieldControl>
        {col.type === "money" ? (
          <InputGroup size="sm">
            <InputGroupAddon>₹</InputGroupAddon>
            <InputGroupInput inputMode="decimal" value={v} onChange={(e) => set(e.target.value)} placeholder="0.00" />
          </InputGroup>
        ) : col.type === "date" ? (
          <Input size="sm" type="date" value={v} onChange={(e) => set(e.target.value)} />
        ) : col.type === "number" ? (
          <Input size="sm" inputMode="decimal" value={v} onChange={(e) => set(e.target.value)} />
        ) : (
          <Input size="sm" value={v} onChange={(e) => set(e.target.value)} maxLength={200} />
        )}
      </FieldControl>
      <FieldError>{err}</FieldError>
    </Field>
  );

  if (between) {
    return (
      <div className="grid items-start gap-3 sm:grid-cols-2">
        {single(f.value, (value) => onChange({ ...f, value }), t("growth.common.from"), error)}
        {single(f.value2, (value2) => onChange({ ...f, value2 }), t("growth.common.to"), error2)}
      </div>
    );
  }
  return single(f.value, (value) => onChange({ ...f, value }), t("growth.reports.filters.value"), error);
}
