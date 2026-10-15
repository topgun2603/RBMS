/**
 * Report builder logic, pure (no React): builder state ⇄ ReportSpec (packages/reports/src/spec.ts), filter value
 * parsing per column type (rupees → paise), output keys for sorting, measure key naming, validation messages
 * (as i18n keys) and schedule time helpers.
 */
import { paiseToInput, rupeesToPaise } from "./format";
import type {
  ColumnType,
  DatasetColumn,
  DatasetInfo,
  DateBucket,
  DatePreset,
  FilterOp,
  MeasureFn,
  ReportFilter,
  ReportSchedule,
  ReportSpec,
  ReportFormat,
  RunColumn,
  ScheduleInput,
  SchedulePreset,
} from "./types";

// ------------------------------------------------------------------ limits (mirror packages/reports/src/spec.ts)

export const MAX_GROUP_BY = 3;
export const MAX_MEASURES = 10;
export const MAX_FILTERS = 20;
export const MAX_IN_VALUES = 100;
export const MAX_TEXT_VALUE = 200;
export const MAX_LIMIT = 5000;
export const MAX_RECIPIENTS = 10;

export const MEASURE_FNS: readonly MeasureFn[] = ["count", "sum", "avg", "min", "max"];
export const DATE_BUCKETS: readonly DateBucket[] = ["day", "week", "month", "quarter", "year"];
export const SCHEDULE_PRESETS: readonly SchedulePreset[] = ["daily", "weekly", "monthly"];
export const REPORT_FORMATS: readonly ReportFormat[] = ["xlsx", "csv"];

/** Fallback when a dataset doesn't send `ops` (same table as the server's OPS_BY_TYPE). */
export const OPS_BY_TYPE: Record<ColumnType, FilterOp[]> = {
  text: ["eq", "neq", "in", "contains"],
  number: ["eq", "neq", "in", "gte", "lte", "between"],
  money: ["eq", "neq", "in", "gte", "lte", "between"],
  date: ["eq", "gte", "lte", "between"],
  enum: ["eq", "neq", "in"],
};

// ------------------------------------------------------------------ state

export interface BuilderColumn {
  key: string;
  on: boolean;
}

export interface BuilderFilter {
  id: string;
  column: string;
  op: FilterOp;
  /** Single value (as typed: rupees for money, YYYY-MM-DD for dates). */
  value: string;
  /** Second value for `between`. */
  value2: string;
  /** Values for `in` (as typed). */
  values: string[];
}

export interface BuilderGroup {
  id: string;
  column: string;
  /** Only for date columns. */
  bucket: DateBucket | null;
}

export interface BuilderMeasure {
  id: string;
  fn: MeasureFn;
  /** null for count. */
  column: string | null;
}

export type BuilderDateRange = { kind: "none" } | { kind: "preset"; preset: DatePreset } | { kind: "custom"; from: string; to: string };

export interface BuilderState {
  dataset: string;
  /** Every dataset column in display order, with on/off. */
  columns: BuilderColumn[];
  filters: BuilderFilter[];
  groupBy: BuilderGroup[];
  measures: BuilderMeasure[];
  sort: { column: string; dir: "asc" | "desc" } | null;
  /** As typed; empty = server default. */
  limit: string;
  dateRange: BuilderDateRange;
}

let seq = 0;
/** Row id for React keys. */
export const rowId = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`;

export const columnOf = (ds: DatasetInfo, key: string) => ds.columns.find((c) => c.key === key);
export const isFilterable = (c: DatasetColumn) => c.filterable !== false;
export const isGroupable = (c: DatasetColumn) => !!c.groupable;
export const isAggregatable = (c: DatasetColumn) => !!c.aggregatable && (c.type === "number" || c.type === "money");

/** Default date range: "this month" when the dataset offers it, else the first preset. */
export function defaultDateRange(ds: DatasetInfo): BuilderDateRange {
  if (!ds.dateColumn) return { kind: "none" };
  const presets = ds.datePresets ?? [];
  const preset = presets.includes("this_month") ? "this_month" : presets[0];
  return preset ? { kind: "preset", preset } : { kind: "none" };
}

/** Fresh builder for a dataset: default columns on (those with `default !== false`), nothing else. */
export function initialState(ds: DatasetInfo): BuilderState {
  return {
    dataset: ds.id,
    columns: ds.columns.map((c) => ({ key: c.key, on: c.default !== false })),
    filters: [],
    groupBy: [],
    measures: [],
    sort: null,
    limit: "",
    dateRange: defaultDateRange(ds),
  };
}

/** Moves item `from` to index `to` (clamped). Returns a new array. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length) return out;
  const target = Math.max(0, Math.min(out.length - 1, to));
  const [item] = out.splice(from, 1);
  out.splice(target, 0, item!);
  return out;
}

// ------------------------------------------------------------------ filters

/** Ops allowed for a column (dataset.ops by type). */
export function opsFor(ds: DatasetInfo, col: DatasetColumn | undefined): FilterOp[] {
  if (!col) return [];
  return [...(ds.ops?.[col.type] ?? OPS_BY_TYPE[col.type])];
}

/** A sensible first op: "contains" for text, "eq" otherwise (when allowed). */
export function defaultOp(ds: DatasetInfo, col: DatasetColumn): FilterOp {
  const ops = opsFor(ds, col);
  if (col.type === "text" && ops.includes("contains")) return "contains";
  if (col.type === "date" && ops.includes("between")) return "between";
  return ops.includes("eq") ? "eq" : (ops[0] ?? "eq");
}

/** New filter on the first filterable column (or `column`). */
export function newFilter(ds: DatasetInfo, column?: string): BuilderFilter | null {
  const col = column ? columnOf(ds, column) : ds.columns.find(isFilterable);
  if (!col || !isFilterable(col)) return null;
  const value = col.type === "enum" ? (col.options?.[0]?.value ?? "") : "";
  return { id: rowId(), column: col.key, op: defaultOp(ds, col), value, value2: "", values: [] };
}

/** Changing a filter's column resets op and values (types differ). */
export function changeFilterColumn(ds: DatasetInfo, f: BuilderFilter, column: string): BuilderFilter {
  const next = newFilter(ds, column);
  return next ? { ...next, id: f.id } : f;
}

/** Changing the op keeps values that still make sense. */
export function changeFilterOp(f: BuilderFilter, op: FilterOp): BuilderFilter {
  if (op === f.op) return f;
  if (op === "in") return { ...f, op, values: f.values.length ? f.values : f.value.trim() ? [f.value.trim()] : [] };
  if (f.op === "in") return { ...f, op, value: f.value || (f.values[0] ?? "") };
  return { ...f, op };
}

/** Issue: an i18n key under growth.reports.issues.* plus params. */
export interface Issue {
  /** e.g. "filters.0.value" */
  path: string;
  key: string;
  params?: Record<string, string | number>;
}

type Parsed = { ok: true; value: string | number } | { ok: false; key: string; params?: Record<string, string | number> };

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isIsoDate(s: string): boolean {
  if (!ISO_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** One typed value → what the server expects (money in paise). */
export function parseValue(col: DatasetColumn, raw: string): Parsed {
  const s = raw.trim();
  if (!s) return { ok: false, key: "valueRequired" };
  switch (col.type) {
    case "text":
      return s.length > MAX_TEXT_VALUE ? { ok: false, key: "valueTooLong", params: { max: MAX_TEXT_VALUE } } : { ok: true, value: s };
    case "number": {
      const n = Number(s.replace(/,/g, ""));
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, key: "valueNumber" };
    }
    case "money": {
      const p = rupeesToPaise(s);
      return p === null ? { ok: false, key: "valueMoney" } : { ok: true, value: p };
    }
    case "date":
      return isIsoDate(s) ? { ok: true, value: s } : { ok: false, key: "valueDate" };
    case "enum":
      return col.options?.some((o) => o.value === s) ? { ok: true, value: s } : { ok: false, key: "valueOption" };
  }
  return { ok: false, key: "valueRequired" };
}

/** Builder filter → spec filter, or the first problem. */
export function filterToSpec(ds: DatasetInfo, f: BuilderFilter): { filter: ReportFilter } | { issue: Omit<Issue, "path"> & { sub?: string } } {
  const col = columnOf(ds, f.column);
  if (!col || !isFilterable(col)) return { issue: { key: "unknownColumn", sub: "column" } };
  if (!opsFor(ds, col).includes(f.op)) return { issue: { key: "badOp", sub: "op" } };
  if (f.op === "in") {
    const raw = [...new Set(f.values.map((v) => v.trim()).filter(Boolean))];
    if (!raw.length) return { issue: { key: col.type === "enum" ? "pickOne" : "valueList", sub: "value" } };
    if (raw.length > MAX_IN_VALUES) return { issue: { key: "tooManyValues", params: { max: MAX_IN_VALUES }, sub: "value" } };
    const out: (string | number)[] = [];
    for (const v of raw) {
      const p = parseValue(col, v);
      if (!p.ok) return { issue: { key: p.key, params: { ...p.params, value: v }, sub: "value" } };
      if (!out.includes(p.value)) out.push(p.value);
    }
    return { filter: { column: col.key, op: "in", value: out } };
  }
  if (f.op === "between") {
    const a = parseValue(col, f.value);
    if (!a.ok) return { issue: { key: a.key, params: a.params, sub: "value" } };
    const b = parseValue(col, f.value2);
    if (!b.ok) return { issue: { key: b.key, params: b.params, sub: "value2" } };
    if (a.value > b.value) return { issue: { key: "fromAfterTo", sub: "value2" } };
    return { filter: { column: col.key, op: "between", value: [a.value, b.value] } };
  }
  const p = parseValue(col, f.value);
  if (!p.ok) return { issue: { key: p.key, params: p.params, sub: "value" } };
  return { filter: { column: col.key, op: f.op, value: p.value } };
}

// ------------------------------------------------------------------ measures, groups, output keys

/** Output key of a measure: `count`, or `<fn>_<column>` (`sum_total`). Same as the server's measureKey. */
export const measureKey = (fn: MeasureFn, column: string | null | undefined) => (!column || fn === "count" ? "count" : `${fn}_${column}`);

/** groupBy item: "date:month" for bucketed dates, the column key otherwise. */
export const groupKey = (g: Pick<BuilderGroup, "column" | "bucket">) => (g.bucket ? `${g.column}:${g.bucket}` : g.column);

/** Parses "date:month" → { column, bucket }. */
export function parseGroupKey(k: string): { column: string; bucket: DateBucket | null } {
  const [column, bucket] = k.split(":");
  return { column: column!, bucket: bucket && (DATE_BUCKETS as readonly string[]).includes(bucket) ? (bucket as DateBucket) : null };
}

export function newGroup(ds: DatasetInfo, taken: string[] = []): BuilderGroup | null {
  const col = ds.columns.find((c) => isGroupable(c) && !taken.includes(c.key)) ?? null;
  if (!col) return null;
  return { id: rowId(), column: col.key, bucket: col.type === "date" ? "month" : null };
}

export function changeGroupColumn(ds: DatasetInfo, g: BuilderGroup, column: string): BuilderGroup {
  const col = columnOf(ds, column);
  return { ...g, column, bucket: col?.type === "date" ? (g.bucket ?? "month") : null };
}

/** New measure: sum of the first aggregatable column not measured yet, or count. */
export function newMeasure(ds: DatasetInfo, existing: BuilderMeasure[] = []): BuilderMeasure {
  const used = new Set(existing.map((m) => measureKey(m.fn, m.column)));
  const allowed = ds.measures?.length ? ds.measures : MEASURE_FNS;
  if (allowed.includes("sum")) {
    for (const c of ds.columns.filter(isAggregatable)) {
      if (!used.has(measureKey("sum", c.key))) return { id: rowId(), fn: "sum", column: c.key };
    }
  }
  return { id: rowId(), fn: "count", column: null };
}

/** Changing fn: count drops the column; other fns need an aggregatable column. */
export function changeMeasureFn(ds: DatasetInfo, m: BuilderMeasure, fn: MeasureFn): BuilderMeasure {
  if (fn === "count") return { ...m, fn, column: null };
  const col = m.column ? columnOf(ds, m.column) : undefined;
  return { ...m, fn, column: col && isAggregatable(col) ? col.key : (ds.columns.find(isAggregatable)?.key ?? null) };
}

/** Grouped when there's any group or measure (same rule as the server). */
export const isGrouped = (s: Pick<BuilderState, "groupBy" | "measures">) => s.groupBy.length > 0 || s.measures.length > 0;

/** Measures the report will use: count when grouped without measures. */
export function effectiveMeasures(s: Pick<BuilderState, "groupBy" | "measures">): BuilderMeasure[] {
  if (s.groupBy.length && !s.measures.length) return [{ id: "auto-count", fn: "count", column: null }];
  return s.measures;
}

export interface OutputKey {
  key: string;
  kind: "column" | "group" | "measure";
  column: string | null;
  fn?: MeasureFn;
  bucket?: DateBucket | null;
}

/**
 * Keys the report output has (what `sort` may use): grouped → group columns then measure keys; rows → the enabled
 * columns in order. Duplicates dropped.
 */
export function outputKeys(ds: DatasetInfo, s: BuilderState): OutputKey[] {
  const out: OutputKey[] = [];
  const push = (k: OutputKey) => {
    if (!out.some((o) => o.key === k.key)) out.push(k);
  };
  if (isGrouped(s)) {
    for (const g of s.groupBy) if (columnOf(ds, g.column)) push({ key: g.column, kind: "group", column: g.column, bucket: g.bucket });
    for (const m of effectiveMeasures(s)) push({ key: measureKey(m.fn, m.column), kind: "measure", column: m.fn === "count" ? null : m.column, fn: m.fn });
  } else {
    for (const c of s.columns) if (c.on && columnOf(ds, c.key)) push({ key: c.key, kind: "column", column: c.key });
  }
  return out;
}

// ------------------------------------------------------------------ build

export interface BuildResult {
  spec: ReportSpec;
  issues: Issue[];
  /** False when the spec can't run at all (e.g. no columns); filter issues only drop that filter. */
  runnable: boolean;
}

/** Positive whole number or null; invalid → undefined. */
export function parseLimit(raw: string): number | null | undefined {
  const s = raw.trim();
  if (!s) return null;
  if (!/^\d+$/.test(s)) return undefined;
  const n = Number(s);
  return n >= 1 && n <= MAX_LIMIT ? n : undefined;
}

/**
 * Builder state → spec. Incomplete filters are left out of the spec (so the preview keeps working) and reported as
 * issues; a dangling sort is dropped. Grouped specs send no `columns` (the server shows group + measure columns).
 */
export function buildSpec(ds: DatasetInfo, s: BuilderState): BuildResult {
  const issues: Issue[] = [];
  let runnable = true;
  const spec: ReportSpec = { dataset: ds.id };

  const grouped = isGrouped(s);
  if (!grouped) {
    const cols = s.columns.filter((c) => c.on && columnOf(ds, c.key)).map((c) => c.key);
    if (!cols.length) {
      issues.push({ path: "columns", key: "pickColumn" });
      runnable = false;
    }
    spec.columns = cols;
  }

  const filters: ReportFilter[] = [];
  s.filters.forEach((f, i) => {
    const r = filterToSpec(ds, f);
    if ("filter" in r) filters.push(r.filter);
    else issues.push({ path: `filters.${i}.${r.issue.sub ?? "value"}`, key: r.issue.key, params: r.issue.params });
  });
  if (filters.length) spec.filters = filters;

  if (grouped) {
    const seen = new Set<string>();
    const groupBy: string[] = [];
    s.groupBy.slice(0, MAX_GROUP_BY).forEach((g, i) => {
      const col = columnOf(ds, g.column);
      if (!col || !isGroupable(col)) return issues.push({ path: `groupBy.${i}`, key: "unknownColumn" });
      if (seen.has(col.key)) return issues.push({ path: `groupBy.${i}`, key: "groupedTwice" });
      seen.add(col.key);
      groupBy.push(groupKey({ column: col.key, bucket: col.type === "date" ? g.bucket : null }));
    });
    if (s.groupBy.length > MAX_GROUP_BY) issues.push({ path: "groupBy", key: "tooManyGroups", params: { max: MAX_GROUP_BY } });
    if (groupBy.length) spec.groupBy = groupBy;

    const mk = new Set<string>();
    const measures: NonNullable<ReportSpec["measures"]> = [];
    effectiveMeasures(s)
      .slice(0, MAX_MEASURES)
      .forEach((m, i) => {
        if (m.fn !== "count") {
          const col = m.column ? columnOf(ds, m.column) : undefined;
          if (!col || !isAggregatable(col)) return issues.push({ path: `measures.${i}.column`, key: "measureColumn" });
        }
        const k = measureKey(m.fn, m.column);
        if (mk.has(k)) return issues.push({ path: `measures.${i}`, key: "duplicateMeasure" });
        mk.add(k);
        measures.push(m.fn === "count" ? { fn: "count" } : { fn: m.fn, column: m.column! });
      });
    if (!measures.length) {
      issues.push({ path: "measures", key: "pickMeasure" });
      runnable = false;
    }
    spec.measures = measures;
  }

  if (s.sort) {
    const keys = outputKeys(ds, s).map((k) => k.key);
    if (keys.includes(s.sort.column)) spec.sort = [{ column: s.sort.column, dir: s.sort.dir }];
  }

  const limit = parseLimit(s.limit);
  if (limit === undefined) issues.push({ path: "limit", key: "limitRange", params: { max: MAX_LIMIT } });
  else if (limit !== null) spec.limit = limit;

  if (ds.dateColumn) {
    const r = s.dateRange;
    if (r.kind === "preset") spec.dateRange = { preset: r.preset };
    else if (r.kind === "custom") {
      if (!isIsoDate(r.from)) issues.push({ path: "dateRange.from", key: "valueDate" });
      else if (!isIsoDate(r.to)) issues.push({ path: "dateRange.to", key: "valueDate" });
      else if (r.to < r.from) issues.push({ path: "dateRange.to", key: "fromAfterTo" });
      else spec.dateRange = { from: r.from, to: r.to };
    }
  }
  return { spec, issues, runnable };
}

/** Issues under a path prefix ("filters.2"). */
export const issuesAt = (issues: Issue[], prefix: string) => issues.filter((i) => i.path === prefix || i.path.startsWith(`${prefix}.`));

// ------------------------------------------------------------------ load a saved spec

const valueToInput = (col: DatasetColumn, v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (col.type === "money" && typeof v === "number") return paiseToInput(v);
  return String(v);
};

/** Spec (e.g. of a saved report) → builder state. Unknown columns are dropped. */
export function specToState(ds: DatasetInfo, spec: ReportSpec): BuilderState {
  const base = initialState(ds);
  // Columns: the spec's (in order, on), then the rest (off). Empty = dataset defaults.
  const specCols = (spec.columns ?? []).filter((k) => columnOf(ds, k));
  const columns: BuilderColumn[] = specCols.length
    ? [...specCols.map((key) => ({ key, on: true })), ...ds.columns.filter((c) => !specCols.includes(c.key)).map((c) => ({ key: c.key, on: false }))]
    : base.columns;

  const filters: BuilderFilter[] = [];
  for (const f of spec.filters ?? []) {
    const col = columnOf(ds, f.column);
    if (!col) continue;
    const row: BuilderFilter = { id: rowId(), column: col.key, op: f.op, value: "", value2: "", values: [] };
    if (f.op === "in" && Array.isArray(f.value)) row.values = f.value.map((v) => valueToInput(col, v));
    else if (f.op === "between" && Array.isArray(f.value)) {
      row.value = valueToInput(col, f.value[0]);
      row.value2 = valueToInput(col, f.value[1]);
    } else row.value = valueToInput(col, f.value);
    filters.push(row);
  }

  const groupBy: BuilderGroup[] = (spec.groupBy ?? [])
    .map(parseGroupKey)
    .filter((g) => columnOf(ds, g.column))
    .map((g) => ({ id: rowId(), column: g.column, bucket: columnOf(ds, g.column)!.type === "date" ? (g.bucket ?? "day") : null }));

  const measures: BuilderMeasure[] = (spec.measures ?? [])
    .filter((m) => m.fn === "count" || (m.column && columnOf(ds, m.column)))
    .map((m) => ({ id: rowId(), fn: m.fn, column: m.fn === "count" ? null : m.column! }));

  const first = spec.sort?.[0];
  let dateRange: BuilderDateRange = { kind: "none" };
  if (ds.dateColumn && spec.dateRange) {
    dateRange = "preset" in spec.dateRange ? { kind: "preset", preset: spec.dateRange.preset } : { kind: "custom", from: spec.dateRange.from, to: spec.dateRange.to };
  }
  return {
    dataset: ds.id,
    columns,
    filters,
    groupBy,
    measures,
    sort: first ? { column: first.column, dir: first.dir ?? "asc" } : null,
    limit: spec.limit ? String(spec.limit) : "",
    dateRange,
  };
}

// ------------------------------------------------------------------ result formatting

/** Enum value → its option label (falls back to the raw value). */
export function optionLabel(col: Pick<RunColumn, "options">, v: string | number | null): string {
  if (v === null || v === undefined) return "";
  return col.options?.find((o) => o.value === String(v))?.label ?? String(v);
}

type DateFmt = (d: string, opts: Intl.DateTimeFormatOptions) => string;

/** A bucketed date ("2026-10-01" + month) as a label: "Oct 2026", "Jul–Sep 2026", "2026", "Week of 12 Oct". */
export function bucketLabel(value: string, bucket: DateBucket | null | undefined, fmt: DateFmt, weekOf = (d: string) => d): string {
  if (!value) return "";
  const d = value.slice(0, 10);
  switch (bucket) {
    case "year":
      return d.slice(0, 4);
    case "month":
      return fmt(d, { month: "short", year: "numeric" });
    case "quarter": {
      const m = Number(d.slice(5, 7));
      const startMonth = Math.floor((m - 1) / 3) * 3 + 1;
      const y = d.slice(0, 4);
      const start = `${y}-${String(startMonth).padStart(2, "0")}-01`;
      const end = `${y}-${String(startMonth + 2).padStart(2, "0")}-01`;
      return `${fmt(start, { month: "short" })}–${fmt(end, { month: "short" })} ${y}`;
    }
    case "week":
      return weekOf(fmt(d, { day: "numeric", month: "short" }));
    default:
      return fmt(d, { day: "numeric", month: "short", year: "numeric" });
  }
}

// ------------------------------------------------------------------ schedules

export interface ScheduleDraft {
  preset: SchedulePreset;
  /** "HH:MM" (IST). */
  time: string;
  weekday: number;
  dayOfMonth: number;
  recipients: string[];
  format: ReportFormat;
  active: boolean;
}

export const defaultScheduleDraft = (email?: string | null): ScheduleDraft => ({
  preset: "daily",
  time: "08:00",
  weekday: 1,
  dayOfMonth: 1,
  recipients: email ? [email] : [],
  format: "xlsx",
  active: true,
});

export const pad2 = (n: number) => String(n).padStart(2, "0");
export const formatTime = (hour: number, minute: number) => `${pad2(hour)}:${pad2(minute)}`;

/** "08:30" → { hour: 8, minute: 30 }; invalid → null. */
export function parseTime(s: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

/** Same shape the server's cron uses: `m h dom * dow`. Used when a schedule has no `timing`. */
export function timingFromCron(cron: string): { hour: number; minute: number; weekday: number | null; dayOfMonth: number | null } | null {
  const p = cron.trim().split(/\s+/);
  if (p.length !== 5) return null;
  const n = (s: string) => (s === "*" ? null : /^\d{1,2}$/.test(s) ? Number(s) : NaN);
  const minute = n(p[0]!);
  const hour = n(p[1]!);
  const dom = n(p[2]!);
  const dow = n(p[4]!);
  if (minute === null || hour === null || Number.isNaN(minute) || Number.isNaN(hour) || Number.isNaN(dom as number) || Number.isNaN(dow as number)) return null;
  return { hour, minute, weekday: dow, dayOfMonth: dom };
}

export function scheduleToDraft(s: ReportSchedule): ScheduleDraft {
  const c = s.timing ?? (() => {
    const t = timingFromCron(s.cron);
    return t ? { preset: s.preset, hour: t.hour, minute: t.minute, weekday: t.weekday ?? 1, dayOfMonth: t.dayOfMonth ?? 1 } : null;
  })();
  return {
    preset: s.preset,
    time: formatTime(c?.hour ?? 8, c?.minute ?? 0),
    weekday: c?.weekday ?? 1,
    dayOfMonth: Math.min(28, Math.max(1, c?.dayOfMonth ?? 1)),
    recipients: [...s.recipients],
    format: s.format,
    active: s.active,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmail = (s: string) => s.length <= 254 && EMAIL_RE.test(s.trim());

/** Splits pasted text ("a@x.in, b@y.in; c@z.in") into trimmed lower-case parts. */
export const splitList = (s: string) =>
  s
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);

export const normalizeEmail = (s: string) => s.trim().toLowerCase();

export interface ScheduleIssues {
  time?: string;
  recipients?: string;
  dayOfMonth?: string;
}

/** Validation (keys under growth.reports.issues.*). */
export function validateSchedule(d: ScheduleDraft): ScheduleIssues {
  const out: ScheduleIssues = {};
  if (!parseTime(d.time)) out.time = "time";
  if (!d.recipients.length) out.recipients = "recipientsRequired";
  else if (d.recipients.length > MAX_RECIPIENTS) out.recipients = "recipientsMax";
  else if (d.recipients.some((r) => !isEmail(r))) out.recipients = "recipientInvalid";
  if (d.preset === "monthly" && !(Number.isInteger(d.dayOfMonth) && d.dayOfMonth >= 1 && d.dayOfMonth <= 28)) out.dayOfMonth = "dayOfMonth";
  return out;
}

/** Draft → POST /schedules body (PATCH takes the same without reportId). Only the fields the preset needs. */
export function scheduleBody(reportId: string, d: ScheduleDraft): ScheduleInput {
  const t = parseTime(d.time) ?? { hour: 8, minute: 0 };
  return {
    reportId,
    preset: d.preset,
    hour: t.hour,
    minute: t.minute,
    ...(d.preset === "weekly" ? { weekday: d.weekday } : {}),
    ...(d.preset === "monthly" ? { dayOfMonth: d.dayOfMonth } : {}),
    recipients: [...new Set(d.recipients.map(normalizeEmail))],
    format: d.format,
    active: d.active,
  };
}

/** The most recently run schedules first; never-run ones last (by next run). */
export function sortByLastRun<T extends Pick<ReportSchedule, "lastRunAt" | "nextRunAt">>(list: T[]): T[] {
  const ts = (s: string | null) => (s ? new Date(s).getTime() : 0);
  return [...list].sort((a, b) => {
    if (a.lastRunAt && b.lastRunAt) return ts(b.lastRunAt) - ts(a.lastRunAt);
    if (a.lastRunAt) return -1;
    if (b.lastRunAt) return 1;
    return ts(a.nextRunAt) - ts(b.nextRunAt);
  });
}

/** `iso` relative to `now` as an Intl.RelativeTimeFormat value + unit (minutes under an hour, … up to days). */
export function relativeParts(iso: string, now: number = Date.now()): { value: number; unit: "second" | "minute" | "hour" | "day" } {
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return { value: Math.round(diff), unit: "second" };
  if (abs < 3600) return { value: Math.round(diff / 60), unit: "minute" };
  if (abs < 86_400) return { value: Math.round(diff / 3600), unit: "hour" };
  return { value: Math.round(diff / 86_400), unit: "day" };
}

/** A file-name-friendly slug of a report name. */
export const fileSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "report";
