/**
 * The dataset contract. A module that owns data (invoices, orders, inventory, ...) declares a `DatasetDefinition`
 * (which columns exist and what may be done with them) and implements `DatasetPort.query` with whitelisted SQL —
 * usually in a few lines through `datasetFromSql` / `buildSql` (see ./sql.ts and ./examples). User input never
 * reaches SQL as text: the spec is validated against the definition into a `QueryPlan` first, and the plan only
 * carries column keys that exist in the definition plus typed values that are sent as parameters.
 */

export const COLUMN_TYPES = ["text", "number", "money", "date", "enum"] as const;
/**
 * - `text`   free text (names, numbers like "INV/26-27/0001")
 * - `number` quantities, counts (may have decimals)
 * - `money`  integer paise (rendered as ₹ with 2 decimals in CSV/XLSX)
 * - `date`   an IST calendar date, returned as "YYYY-MM-DD"
 * - `enum`   one of `options[].value` (status, payment method, channel ...)
 */
export type ColumnType = (typeof COLUMN_TYPES)[number];

export const FILTER_OPS = ["eq", "neq", "in", "gte", "lte", "between", "contains"] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

/** Which filter operators each column type accepts. */
export const OPS_BY_TYPE: Record<ColumnType, readonly FilterOp[]> = {
  text: ["eq", "neq", "in", "contains"],
  number: ["eq", "neq", "in", "gte", "lte", "between"],
  money: ["eq", "neq", "in", "gte", "lte", "between"],
  date: ["eq", "gte", "lte", "between"],
  enum: ["eq", "neq", "in"],
};

export const MEASURE_FNS = ["sum", "count", "avg", "min", "max"] as const;
export type MeasureFn = (typeof MEASURE_FNS)[number];

/** Date buckets for grouping a `date` column: `groupBy: ["date:month"]`. */
export const DATE_BUCKETS = ["day", "week", "month", "quarter", "year"] as const;
export type DateBucket = (typeof DATE_BUCKETS)[number];

/** Relative date ranges, resolved in IST when the report runs (so a scheduled "last 7 days" report stays current). */
export const DATE_PRESETS = [
  "today",
  "yesterday",
  "last_7_days",
  "last_30_days",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_quarter",
  "this_fy",
  "last_fy",
] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

export interface EnumOption {
  value: string;
  /** English label shown in the builder and in CSV/XLSX. */
  label: string;
}

export interface ColumnDef {
  /** Stable key, `^[a-z][a-zA-Z0-9_]*$`, e.g. "customerName". Saved reports reference it — never rename. */
  key: string;
  /** English label, e.g. "Customer". */
  label: string;
  type: ColumnType;
  description?: string;
  /** May be used in `filters` (default true). */
  filterable?: boolean;
  /** May be used in `groupBy` (default false). Turn on for low-cardinality columns: status, customer, item, date. */
  groupable?: boolean;
  /** `sum` / `avg` / `min` / `max` allowed, and summed in the totals row (default false). Only `number` / `money`. */
  aggregatable?: boolean;
  /** Required for `enum`: the allowed values. */
  options?: EnumOption[];
  /** Shown when the spec lists no columns (default true). */
  default?: boolean;
}

export interface DatasetDefinition {
  /** Unique across the kit, `<module>.<name>`, e.g. "invoices.sales-lines". */
  id: string;
  /** English label, e.g. "Sales lines". */
  label: string;
  description?: string;
  /** Owning module id, e.g. "invoices". */
  module: string;
  /** Feature the shop needs to see this dataset (checked through FeatureGatePort), e.g. "invoices.reports". */
  feature?: string;
  /** Permission the member needs in addition to `reports.view`, e.g. "invoices.reports.view". */
  permission?: string;
  columns: ColumnDef[];
  defaultSort: { column: string; dir: SortDir };
  /** The `date` column that `dateRange` applies to. Without it, the dataset accepts no `dateRange`. */
  dateColumn?: string;
}

export type SortDir = "asc" | "desc";

// ------------------------------------------------------------------ the validated plan

export type FilterValue = string | number | (string | number)[] | [string | number, string | number];

/** A filter after validation: the value is typed for the column (numbers for number/money, "YYYY-MM-DD" for date). */
export type PlanFilter =
  | { column: string; type: ColumnType; op: "eq" | "neq" | "gte" | "lte" | "contains"; value: string | number }
  | { column: string; type: ColumnType; op: "in"; value: (string | number)[] }
  | { column: string; type: ColumnType; op: "between"; value: [string | number, string | number] };

export interface PlanGroup {
  column: string;
  bucket?: DateBucket;
}

export interface PlanMeasure {
  /** Output key: `<fn>_<column>`, or `count` for count of rows. */
  key: string;
  fn: MeasureFn;
  /** Null = count(*) */
  column: string | null;
}

/** One column of the result, in order. */
export interface PlanColumn {
  key: string;
  label: string;
  type: ColumnType;
  /** Set for measures. */
  fn?: MeasureFn;
  /** The dataset column behind this output (null for count(*)). */
  column: string | null;
  bucket?: DateBucket;
  options?: EnumOption[];
  /** Rows mode: summed in the totals row (the column is aggregatable). */
  aggregatable?: boolean;
}

export interface QueryPlan {
  dataset: string;
  /** `rows`: plain listing of `columns`; `grouped`: `groupBy` + `measures` with GROUP BY. */
  mode: "rows" | "grouped";
  columns: PlanColumn[];
  filters: PlanFilter[];
  /** Inclusive IST dates on the dataset's `dateColumn`. */
  dateRange: { column: string; from: string; to: string } | null;
  groupBy: PlanGroup[];
  measures: PlanMeasure[];
  /** Keys of `columns`. */
  sort: { key: string; dir: SortDir }[];
  /** Rows wanted. Implementations may return `limit + 1` rows to signal that more exist (buildSql does). */
  limit: number;
  /** Compute the totals row. */
  totals: boolean;
}

export type ReportRow = Record<string, string | number | null>;

export interface DatasetResult {
  /** Keyed by `PlanColumn.key`. Money in paise, dates "YYYY-MM-DD", enums as their value. */
  rows: ReportRow[];
  /**
   * Totals over every matching row (not just the page): in `rows` mode the sum of each aggregatable column shown,
   * in `grouped` mode each measure over all rows. `count` is the number of matching source rows.
   */
  totals?: ReportRow & { count?: number };
}

/** Implemented by the owning module (registered in apps/api kit). `query` must filter by `tenantId`. */
export interface DatasetPort {
  definition: DatasetDefinition;
  query(tenantId: string, plan: QueryPlan): Promise<DatasetResult>;
}
