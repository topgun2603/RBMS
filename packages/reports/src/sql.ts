/**
 * Generic SQL for datasets. The implementer supplies trusted SQL fragments (FROM, a tenant WHERE, one expression per
 * column); `buildSql` assembles a parameterised query from a validated QueryPlan. Identifiers in the output come only
 * from the implementer's mapping or from generated aliases (c0, c1 ...); every user value is a bound parameter.
 */
import { sql, type SQL } from "drizzle-orm";
import { addDaysISO, istStart } from "./dates";
import { assertValidDefinition, HARD_MAX_LIMIT } from "./spec";
import type { ColumnType, DatasetDefinition, DatasetPort, DatasetResult, PlanColumn, PlanFilter, QueryPlan, ReportRow } from "./types";

/** How a column is read in SQL. Use the object form with `timestamp: true` for `timestamptz` date columns. */
export interface ColumnSql {
  expr: SQL;
  /**
   * The expression is a `timestamptz` (e.g. orders.placed_at): dates are taken in IST, and a date range covers
   * 00:00 IST of `from` up to (not including) 00:00 IST of the day after `to`. Without it a date column must be a
   * Postgres `date` (or text "YYYY-MM-DD" castable to date) already in IST.
   */
  timestamp?: boolean;
}
export type ColumnMapping = SQL | ColumnSql;

export interface SqlMapping {
  /** Everything after FROM, e.g. sql`invoices i CROSS JOIN LATERAL jsonb_array_elements(i.lines) AS l(line)`. */
  from: SQL;
  /** Base condition; MUST include the tenant filter, e.g. sql`i.tenant_id = ${tenantId} AND i.status <> 'draft'`. */
  where: SQL;
  /** Column key → SQL expression for every column of the definition. */
  columns: Record<string, ColumnMapping>;
}

export interface BuiltSql {
  rows: SQL;
  /** Null when `plan.totals` is false. */
  totals: SQL | null;
  /** alias → output key, in select order (rows query). */
  aliases: { alias: string; key: string; type: ColumnType }[];
  /** alias → output key for the totals query (`n` is the source row count). */
  totalAliases: { alias: string; key: string; type: ColumnType }[];
}

const asColumnSql = (m: ColumnMapping): ColumnSql => (m && typeof m === "object" && "expr" in m ? m : { expr: m as SQL });

function mappingFor(mapping: SqlMapping, key: string): ColumnSql {
  const m = mapping.columns[key];
  if (!m) throw new Error(`No SQL mapping for column "${key}"`);
  return asColumnSql(m);
}

/** The column as an IST `date` value. */
function dateExpr(c: ColumnSql): SQL {
  return c.timestamp ? sql`((${c.expr}) AT TIME ZONE 'Asia/Kolkata')::date` : sql`(${c.expr})::date`;
}

const BUCKET_SQL: Record<string, string> = { day: "day", week: "week", month: "month", quarter: "quarter", year: "year" };

function outputExpr(col: PlanColumn, c: ColumnSql): SQL {
  if (col.type !== "date") return c.expr;
  const d = dateExpr(c);
  if (col.bucket && col.bucket !== "day") {
    // Fixed whitelist → safe raw literal.
    return sql`to_char(date_trunc(${sql.raw(`'${BUCKET_SQL[col.bucket]}'`)}, ${d})::date, 'YYYY-MM-DD')`;
  }
  return sql`to_char(${d}, 'YYYY-MM-DD')`;
}

function measureExpr(fn: string, type: ColumnType, c: ColumnSql | null): SQL {
  if (!c) return sql`count(*)`;
  switch (fn) {
    case "count":
      return sql`count(${c.expr})`;
    case "sum":
      return sql`coalesce(sum(${c.expr}), 0)`;
    case "avg":
      return type === "money" ? sql`round(avg(${c.expr}))` : sql`avg(${c.expr})`;
    case "min":
      return sql`min(${c.expr})`;
    case "max":
      return sql`max(${c.expr})`;
  }
  throw new Error(`Unknown measure ${fn}`);
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/** Date bound as a parameter: `date` for date columns, the IST instant for timestamptz columns. */
function dateBound(c: ColumnSql, date: string, side: "from" | "toExclusive"): SQL {
  if (c.timestamp) {
    const d = side === "from" ? date : addDaysISO(date, 1);
    return sql`${istStart(d).toISOString()}::timestamptz`;
  }
  return side === "from" ? sql`${date}::date` : sql`${addDaysISO(date, 1)}::date`;
}

function dateBetween(c: ColumnSql, from: string | null, to: string | null): SQL {
  const parts: SQL[] = [];
  const e = c.timestamp ? c.expr : sql`(${c.expr})::date`;
  if (from) parts.push(sql`${e} >= ${dateBound(c, from, "from")}`);
  if (to) parts.push(sql`${e} < ${dateBound(c, to, "toExclusive")}`);
  return sql.join(parts, sql` AND `);
}

/** One filter as a SQL condition with bound values. */
export function filterSql(f: PlanFilter, c: ColumnSql): SQL {
  if (f.type === "date") {
    if (f.op === "between") return dateBetween(c, String(f.value[0]), String(f.value[1]));
    if (f.op === "eq") return dateBetween(c, String(f.value), String(f.value));
    if (f.op === "gte") return dateBetween(c, String(f.value), null);
    if (f.op === "lte") return dateBetween(c, null, String(f.value));
    throw new Error(`Operator ${f.op} is not valid for dates`);
  }
  const text = f.type === "text";
  // Text matches ignore case.
  const e = text ? sql`lower(${c.expr})` : c.expr;
  const v = (x: string | number) => (text ? String(x).toLowerCase() : x);
  switch (f.op) {
    case "eq":
      return sql`${e} = ${v(f.value)}`;
    case "neq":
      return sql`${e} IS DISTINCT FROM ${v(f.value)}`;
    case "in":
      return sql`${e} IN (${sql.join(
        f.value.map((x) => sql`${v(x)}`),
        sql`, `,
      )})`;
    case "gte":
      return sql`${e} >= ${f.value}`;
    case "lte":
      return sql`${e} <= ${f.value}`;
    case "between":
      return sql`${e} BETWEEN ${f.value[0]} AND ${f.value[1]}`;
    case "contains":
      if (!text) throw new Error("contains is only valid for text");
      return sql`${c.expr} ILIKE ${`%${escapeLike(String(f.value))}%`} ESCAPE '\\'`;
  }
}

function whereSql(plan: QueryPlan, mapping: SqlMapping): SQL {
  const conds: SQL[] = [sql`(${mapping.where})`];
  if (plan.dateRange) {
    conds.push(sql`(${dateBetween(mappingFor(mapping, plan.dateRange.column), plan.dateRange.from, plan.dateRange.to)})`);
  }
  for (const f of plan.filters) conds.push(sql`(${filterSql(f, mappingFor(mapping, f.column))})`);
  return sql.join(conds, sql` AND `);
}

/**
 * Builds the rows query (with `LIMIT plan.limit + 1` so the caller can tell whether more rows exist) and the totals
 * query. Throws when the plan names a column the mapping lacks.
 */
export function buildSql(plan: QueryPlan, mapping: SqlMapping): BuiltSql {
  const aliases: BuiltSql["aliases"] = [];
  const select: SQL[] = [];
  plan.columns.forEach((col, i) => {
    const alias = `c${i}`;
    aliases.push({ alias, key: col.key, type: col.type });
    const expr =
      col.fn !== undefined
        ? measureExpr(col.fn, col.type, col.column ? mappingFor(mapping, col.column) : null)
        : outputExpr(col, mappingFor(mapping, col.column!));
    select.push(sql`${expr} AS ${sql.raw(alias)}`);
  });

  const where = whereSql(plan, mapping);
  const groupBy =
    plan.mode === "grouped" && plan.groupBy.length
      ? sql` GROUP BY ${sql.raw(plan.groupBy.map((_, i) => String(i + 1)).join(", "))}`
      : sql``;

  const order: string[] = [];
  for (const s of plan.sort) {
    const a = aliases.find((x) => x.key === s.key);
    if (!a) throw new Error(`Sort column "${s.key}" is not in the report`);
    order.push(`${a.alias} ${s.dir === "desc" ? "DESC" : "ASC"} NULLS LAST`);
  }
  const orderBy = order.length ? sql` ORDER BY ${sql.raw(order.join(", "))}` : sql``;
  const limit = Math.max(1, Math.min(Math.floor(plan.limit), HARD_MAX_LIMIT)) + 1;

  const rows = sql`SELECT ${sql.join(select, sql`, `)} FROM ${mapping.from} WHERE ${where}${groupBy}${orderBy} LIMIT ${sql.raw(String(limit))}`;

  const totalAliases: BuiltSql["totalAliases"] = [{ alias: "n", key: "count", type: "number" }];
  let totals: SQL | null = null;
  if (plan.totals) {
    const parts: SQL[] = [sql`count(*) AS n`];
    plan.columns.forEach((col, i) => {
      let expr: SQL | null = null;
      if (plan.mode === "grouped") {
        if (col.fn !== undefined) expr = measureExpr(col.fn, col.type, col.column ? mappingFor(mapping, col.column) : null);
      } else if ((col.type === "money" || col.type === "number") && col.aggregatable) {
        expr = measureExpr("sum", col.type, mappingFor(mapping, col.column!));
      }
      if (!expr) return;
      const alias = `t${i}`;
      totalAliases.push({ alias, key: col.key, type: col.type });
      parts.push(sql`${expr} AS ${sql.raw(alias)}`);
    });
    totals = sql`SELECT ${sql.join(parts, sql`, `)} FROM ${mapping.from} WHERE ${where}`;
  }
  return { rows, totals, aliases, totalAliases };
}

// ------------------------------------------------------------------ running

/** Runs a SQL query and returns its rows (e.g. `(q) => db.execute(q)` with a drizzle postgres-js Db). */
export type SqlExecutor = (query: SQL) => Promise<unknown>;

function normalize(type: ColumnType, v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (type === "number" || type === "money") {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function mapRow(raw: Record<string, unknown>, aliases: BuiltSql["aliases"]): ReportRow {
  const out: ReportRow = {};
  for (const a of aliases) out[a.key] = normalize(a.type, raw[a.alias]);
  return out;
}

/** Builds and runs both queries; returns up to `limit + 1` rows (the service trims and flags truncation). */
export async function runSql(execute: SqlExecutor, plan: QueryPlan, mapping: SqlMapping): Promise<DatasetResult> {
  const built = buildSql(plan, mapping);
  const [rows, totals] = await Promise.all([
    execute(built.rows) as Promise<Record<string, unknown>[]>,
    built.totals ? (execute(built.totals) as Promise<Record<string, unknown>[]>) : Promise.resolve(null),
  ]);
  const result: DatasetResult = { rows: Array.from(rows ?? []).map((r) => mapRow(r, built.aliases)) };
  const t = totals ? Array.from(totals)[0] : undefined;
  if (t) result.totals = mapRow(t, built.totalAliases) as DatasetResult["totals"];
  return result;
}

export interface SqlDatasetInput {
  definition: DatasetDefinition;
  /** Everything after FROM (static). */
  from: SQL;
  /** Base condition for a tenant; MUST filter by tenant_id. */
  where: (tenantId: string) => SQL;
  /** Column key → expression, one per definition column. */
  columns: Record<string, ColumnMapping>;
  execute: SqlExecutor;
}

/**
 * The few-lines way to implement a DatasetPort: definition + FROM + tenant WHERE + column expressions.
 * Checks the definition and that every column has an expression (throws at registration, not at run time).
 */
export function datasetFromSql(input: SqlDatasetInput): DatasetPort {
  assertValidDefinition(input.definition);
  const missing = input.definition.columns.filter((c) => !input.columns[c.key]).map((c) => c.key);
  if (missing.length) throw new Error(`Dataset "${input.definition.id}": no SQL for ${missing.join(", ")}`);
  const extra = Object.keys(input.columns).filter((k) => !input.definition.columns.some((c) => c.key === k));
  if (extra.length) throw new Error(`Dataset "${input.definition.id}": SQL for unknown columns ${extra.join(", ")}`);
  return {
    definition: input.definition,
    query: (tenantId, plan) =>
      runSql(input.execute, plan, {
        from: input.from,
        where: input.where(tenantId),
        columns: input.columns,
      }),
  };
}
