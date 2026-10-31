/** Report spec: zod shape + semantic validation against a dataset definition → QueryPlan. Pure. */
import { badRequest } from "@rbms/core";
import { z } from "zod";
import { daysBetween, isIsoDate, resolvePreset } from "./dates";
import {
  COLUMN_TYPES,
  DATE_BUCKETS,
  DATE_PRESETS,
  FILTER_OPS,
  MEASURE_FNS,
  OPS_BY_TYPE,
  type ColumnDef,
  type DateBucket,
  type DatasetDefinition,
  type PlanColumn,
  type PlanFilter,
  type PlanGroup,
  type PlanMeasure,
  type QueryPlan,
  type SortDir,
} from "./types";

export const MAX_COLUMNS = 40;
export const MAX_FILTERS = 20;
export const MAX_GROUP_BY = 3;
export const MAX_MEASURES = 10;
export const MAX_SORT = 3;
export const MAX_IN_VALUES = 100;
export const MAX_TEXT_VALUE = 200;
/** Longest date range a report may cover (three years and a day). */
export const MAX_RANGE_DAYS = 3 * 366;
export const DEFAULT_LIMIT = 500;
/** Hard cap for any plan (exports included). */
export const HARD_MAX_LIMIT = 50_000;

const key = z.string().trim().min(1).max(80);

const dateRangeSchema = z.union([
  z.object({ from: z.string(), to: z.string() }).strict(),
  z.object({ preset: z.enum(DATE_PRESETS) }).strict(),
]);

/**
 * What the client sends (`POST /run`, saved reports). `groupBy` items are a column key, or `"<dateColumn>:<bucket>"`
 * (`day|week|month|quarter|year`) to group dates. Measure `column` is a column key, or `"*"` / omitted for `count`.
 */
export const reportSpecSchema = z
  .object({
    dataset: z.string().trim().min(1).max(80),
    columns: z.array(key).max(MAX_COLUMNS).default([]),
    filters: z
      .array(z.object({ column: key, op: z.enum(FILTER_OPS), value: z.unknown() }).strict())
      .max(MAX_FILTERS)
      .default([]),
    groupBy: z.array(key).max(MAX_GROUP_BY).default([]),
    measures: z
      .array(z.object({ column: key.optional(), fn: z.enum(MEASURE_FNS) }).strict())
      .max(MAX_MEASURES)
      .default([]),
    sort: z
      .array(z.object({ column: key, dir: z.enum(["asc", "desc"]).default("asc") }).strict())
      .max(MAX_SORT)
      .default([]),
    limit: z.number().int().positive().optional(),
    dateRange: dateRangeSchema.nullable().optional(),
    /** Compute the totals row (default true). */
    totals: z.boolean().default(true),
  })
  .strict();

export type ReportSpecInput = z.input<typeof reportSpecSchema>;
export type ReportSpec = z.output<typeof reportSpecSchema>;

export interface SpecIssue {
  /** e.g. "filters.1.value" */
  path: string;
  message: string;
}

export interface PlanOptions {
  /** "Now" for relative date presets. */
  now: Date;
  /** Default 500. */
  defaultLimit?: number;
  /** Cap for `limit` (default 5000, never above HARD_MAX_LIMIT). */
  maxLimit?: number;
}

// ------------------------------------------------------------------ definition checks

const KEY_RE = /^[a-z][a-zA-Z0-9_]*$/;

/** Problems with a dataset definition (programmer errors; the registry refuses such datasets). */
export function definitionProblems(def: DatasetDefinition): string[] {
  const out: string[] = [];
  if (!def.id || !/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/.test(def.id)) out.push(`invalid dataset id "${def.id}"`);
  if (!def.columns.length) out.push("no columns");
  const seen = new Set<string>();
  for (const c of def.columns) {
    if (!KEY_RE.test(c.key)) out.push(`invalid column key "${c.key}"`);
    if (c.key === "count" || /^(sum|count|avg|min|max)_/.test(c.key)) out.push(`column key "${c.key}" clashes with measure keys`);
    if (seen.has(c.key)) out.push(`duplicate column "${c.key}"`);
    seen.add(c.key);
    if (!COLUMN_TYPES.includes(c.type)) out.push(`column "${c.key}" has unknown type "${c.type}"`);
    if (c.type === "enum" && !c.options?.length) out.push(`enum column "${c.key}" needs options`);
    if (c.aggregatable && c.type !== "number" && c.type !== "money") out.push(`column "${c.key}" is aggregatable but not number/money`);
  }
  const byKey = new Map(def.columns.map((c) => [c.key, c]));
  if (!byKey.has(def.defaultSort.column)) out.push(`defaultSort column "${def.defaultSort.column}" does not exist`);
  if (def.dateColumn && byKey.get(def.dateColumn)?.type !== "date") out.push(`dateColumn "${def.dateColumn}" must be a date column`);
  return out;
}

export function assertValidDefinition(def: DatasetDefinition): void {
  const p = definitionProblems(def);
  if (p.length) throw new Error(`Dataset "${def.id}": ${p.join("; ")}`);
}

// ------------------------------------------------------------------ values

type Scalar = string | number;

function parseScalar(col: ColumnDef, raw: unknown, op: string): { value?: Scalar; error?: string } {
  switch (col.type) {
    case "text": {
      if (typeof raw !== "string" && typeof raw !== "number") return { error: "must be text" };
      const s = String(raw).trim();
      if (!s) return { error: "must not be empty" };
      if (s.length > MAX_TEXT_VALUE) return { error: `must be at most ${MAX_TEXT_VALUE} characters` };
      return { value: s };
    }
    case "number":
    case "money": {
      const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
      if (typeof n !== "number" || !Number.isFinite(n)) return { error: "must be a number" };
      if (col.type === "money" && !Number.isInteger(n)) return { error: "must be whole paise" };
      if (Math.abs(n) > 1e15) return { error: "is too large" };
      return { value: n };
    }
    case "date":
      return isIsoDate(raw) ? { value: raw } : { error: "must be a date YYYY-MM-DD" };
    case "enum": {
      if (typeof raw !== "string") return { error: "must be one of the listed values" };
      if (!col.options!.some((o) => o.value === raw)) return { error: `"${raw}" is not a valid ${col.label.toLowerCase()}` };
      return { value: raw };
    }
  }
  return { error: `unsupported for ${op}` };
}

// ------------------------------------------------------------------ labels

const FN_LABEL: Record<string, string> = { sum: "total", avg: "average", min: "lowest", max: "highest", count: "count" };
const BUCKET_LABEL: Record<DateBucket, string> = { day: "day", week: "week", month: "month", quarter: "quarter", year: "year" };

export const measureKey = (fn: string, column: string | null) => (column === null ? "count" : `${fn}_${column}`);

// ------------------------------------------------------------------ validation

export type ValidateResult = { ok: true; plan: QueryPlan } | { ok: false; issues: SpecIssue[] };

/**
 * Checks a spec against the dataset: columns exist, filter ops suit the column type, values are typed (enum values
 * in the options, money whole paise, dates real), measures only on aggregatable number/money columns (count on any),
 * group-by only on groupable columns (date buckets only on dates), sort only on output columns, date range only with
 * a dateColumn. Returns every issue at once.
 */
export function validateSpec(def: DatasetDefinition, input: unknown, opts: PlanOptions): ValidateResult {
  const parsed = reportSpecSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  }
  const spec = parsed.data;
  const issues: SpecIssue[] = [];
  const issue = (path: string, message: string) => issues.push({ path, message });
  const cols = new Map(def.columns.map((c) => [c.key, c]));

  if (spec.dataset !== def.id) issue("dataset", `Spec is for "${spec.dataset}", not "${def.id}"`);

  // filters
  const filters: PlanFilter[] = [];
  spec.filters.forEach((f, i) => {
    const col = cols.get(f.column);
    if (!col) return issue(`filters.${i}.column`, `Unknown column "${f.column}"`);
    if (col.filterable === false) return issue(`filters.${i}.column`, `${col.label} can't be filtered`);
    if (!OPS_BY_TYPE[col.type].includes(f.op)) return issue(`filters.${i}.op`, `"${f.op}" can't be used on ${col.label} (${col.type})`);
    const vpath = `filters.${i}.value`;
    if (f.op === "in") {
      if (!Array.isArray(f.value) || f.value.length === 0) return issue(vpath, "must be a non-empty list");
      if (f.value.length > MAX_IN_VALUES) return issue(vpath, `must have at most ${MAX_IN_VALUES} values`);
      const values: Scalar[] = [];
      for (const [j, raw] of f.value.entries()) {
        const r = parseScalar(col, raw, f.op);
        if (r.error) return issue(`${vpath}.${j}`, `${col.label} ${r.error}`);
        if (!values.includes(r.value!)) values.push(r.value!);
      }
      filters.push({ column: col.key, type: col.type, op: "in", value: values });
    } else if (f.op === "between") {
      if (!Array.isArray(f.value) || f.value.length !== 2) return issue(vpath, "must be [from, to]");
      const a = parseScalar(col, f.value[0], f.op);
      const b = parseScalar(col, f.value[1], f.op);
      if (a.error) return issue(`${vpath}.0`, `${col.label} ${a.error}`);
      if (b.error) return issue(`${vpath}.1`, `${col.label} ${b.error}`);
      if (a.value! > b.value!) return issue(vpath, "'from' must not be after 'to'");
      filters.push({ column: col.key, type: col.type, op: "between", value: [a.value!, b.value!] });
    } else {
      if (Array.isArray(f.value)) return issue(vpath, "must be a single value");
      const r = parseScalar(col, f.value, f.op);
      if (r.error) return issue(vpath, `${col.label} ${r.error}`);
      filters.push({ column: col.key, type: col.type, op: f.op, value: r.value! });
    }
  });

  // date range
  let dateRange: QueryPlan["dateRange"] = null;
  if (spec.dateRange) {
    if (!def.dateColumn) issue("dateRange", `${def.label} has no date to filter on`);
    else {
      const r = "preset" in spec.dateRange ? resolvePreset(spec.dateRange.preset, opts.now) : spec.dateRange;
      if (!isIsoDate(r.from)) issue("dateRange.from", "must be a date YYYY-MM-DD");
      else if (!isIsoDate(r.to)) issue("dateRange.to", "must be a date YYYY-MM-DD");
      else if (r.to < r.from) issue("dateRange", "'to' must be on or after 'from'");
      else if (daysBetween(r.from, r.to) > MAX_RANGE_DAYS) issue("dateRange", "Reports cover at most three years");
      else dateRange = { column: def.dateColumn, from: r.from, to: r.to };
    }
  }

  // group by
  const groupBy: PlanGroup[] = [];
  spec.groupBy.forEach((g, i) => {
    const [name, bucket, extra] = g.split(":");
    const col = cols.get(name!);
    if (!col || extra !== undefined) return issue(`groupBy.${i}`, `Unknown column "${g}"`);
    if (!col.groupable) return issue(`groupBy.${i}`, `${col.label} can't be grouped`);
    if (bucket !== undefined) {
      if (col.type !== "date") return issue(`groupBy.${i}`, `Only dates can be grouped by ${bucket}`);
      if (!DATE_BUCKETS.includes(bucket as DateBucket)) return issue(`groupBy.${i}`, `Unknown date grouping "${bucket}"`);
    }
    if (groupBy.some((x) => x.column === col.key)) return issue(`groupBy.${i}`, `${col.label} is grouped twice`);
    groupBy.push(bucket ? { column: col.key, bucket: bucket as DateBucket } : { column: col.key });
  });

  // measures
  const measures: PlanMeasure[] = [];
  spec.measures.forEach((m, i) => {
    const colKey = m.column === undefined || m.column === "*" ? null : m.column;
    if (colKey === null) {
      if (m.fn !== "count") return issue(`measures.${i}.column`, `${m.fn} needs a column`);
    } else {
      const col = cols.get(colKey);
      if (!col) return issue(`measures.${i}.column`, `Unknown column "${colKey}"`);
      if (m.fn !== "count" && !(col.aggregatable && (col.type === "number" || col.type === "money"))) {
        return issue(`measures.${i}.fn`, `${m.fn} can't be used on ${col.label}`);
      }
    }
    const k = measureKey(m.fn, colKey);
    if (measures.some((x) => x.key === k)) return issue(`measures.${i}`, "Duplicate measure");
    measures.push({ key: k, fn: m.fn, column: colKey });
  });

  const mode: QueryPlan["mode"] = groupBy.length || measures.length ? "grouped" : "rows";
  if (mode === "grouped" && groupBy.length && !measures.length) measures.push({ key: "count", fn: "count", column: null });

  // output columns
  const out: PlanColumn[] = [];
  const plainColumn = (c: ColumnDef, bucket?: DateBucket): PlanColumn => ({
    key: c.key,
    label: bucket ? `${c.label} (${BUCKET_LABEL[bucket]})` : c.label,
    type: c.type,
    column: c.key,
    ...(bucket ? { bucket } : {}),
    ...(c.options ? { options: c.options } : {}),
    ...(!bucket && c.aggregatable ? { aggregatable: true } : {}),
  });
  if (mode === "rows") {
    const keys = spec.columns.length ? spec.columns : def.columns.filter((c) => c.default !== false).map((c) => c.key);
    keys.forEach((k, i) => {
      const col = cols.get(k);
      if (!col) return issue(`columns.${i}`, `Unknown column "${k}"`);
      if (out.some((o) => o.key === k)) return issue(`columns.${i}`, `${col.label} is listed twice`);
      out.push(plainColumn(col));
    });
  } else {
    spec.columns.forEach((k, i) => {
      if (!groupBy.some((g) => g.column === k)) issue(`columns.${i}`, `In a grouped report only grouped columns can be shown ("${k}")`);
    });
    for (const g of groupBy) out.push(plainColumn(cols.get(g.column)!, g.bucket));
    for (const m of measures) {
      const col = m.column ? cols.get(m.column)! : null;
      const type = m.fn === "count" ? "number" : col!.type;
      out.push({
        key: m.key,
        label: col ? `${col.label} (${FN_LABEL[m.fn]})` : "Count",
        type,
        fn: m.fn,
        column: m.column,
      });
    }
  }

  // sort
  const outKeys = new Set(out.map((o) => o.key));
  const sort: { key: string; dir: SortDir }[] = [];
  spec.sort.forEach((s, i) => {
    if (!outKeys.has(s.column)) return issue(`sort.${i}.column`, `Can only sort by a column in the report ("${s.column}")`);
    if (sort.some((x) => x.key === s.column)) return issue(`sort.${i}.column`, "Sorted twice");
    sort.push({ key: s.column, dir: s.dir });
  });
  if (!sort.length && out.length) {
    if (outKeys.has(def.defaultSort.column)) sort.push({ key: def.defaultSort.column, dir: def.defaultSort.dir });
    else if (mode === "grouped" && measures.length) {
      // Date buckets read best in time order; otherwise biggest first.
      const dateGroup = groupBy.find((g) => g.bucket);
      sort.push(dateGroup ? { key: dateGroup.column, dir: "asc" } : { key: measures[0]!.key, dir: "desc" });
    } else sort.push({ key: out[0]!.key, dir: "asc" });
  }

  if (!out.length && !issues.length) issue("columns", "Pick at least one column");

  if (issues.length) return { ok: false, issues };
  const maxLimit = Math.min(opts.maxLimit ?? 5000, HARD_MAX_LIMIT);
  const limit = Math.max(1, Math.min(spec.limit ?? opts.defaultLimit ?? DEFAULT_LIMIT, maxLimit));
  return {
    ok: true,
    plan: { dataset: def.id, mode, columns: out, filters, dateRange, groupBy, measures, sort, limit, totals: spec.totals },
  };
}

/** `validateSpec` that throws 400 `bad_request` `{ issues }`. */
export function planReport(def: DatasetDefinition, input: unknown, opts: PlanOptions): QueryPlan {
  const r = validateSpec(def, input, opts);
  if (!r.ok) throw badRequest(`Invalid report: ${r.issues[0]!.message}`, { issues: r.issues });
  return r.plan;
}
