import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { NOW, salesDef, salesMapping, TENANT } from "./fixtures.test-helpers";
import { validateSpec } from "./spec";
import { buildSql, datasetFromSql, filterSql, runSql, type ColumnSql } from "./sql";
import type { PlanFilter, QueryPlan } from "./types";

const dialect = new PgDialect();
const render = (s: SQL) => {
  const q = dialect.sqlToQuery(s);
  return { sql: q.sql, params: q.params };
};

function plan(spec: Record<string, unknown>): QueryPlan {
  const r = validateSpec(salesDef, { dataset: "test.sales", ...spec }, { now: NOW });
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.plan;
}
const rows = (spec: Record<string, unknown>) => render(buildSql(plan(spec), salesMapping()).rows);
const totals = (spec: Record<string, unknown>) => {
  const t = buildSql(plan(spec), salesMapping()).totals;
  return t ? render(t) : null;
};
const f = (filter: PlanFilter, col: ColumnSql = { expr: sql`x` }) => render(filterSql(filter, col));

describe("filterSql per op and type", () => {
  it("text: case-insensitive eq/neq/in, escaped contains", () => {
    expect(f({ column: "c", type: "text", op: "eq", value: "Raja" })).toEqual({ sql: "lower(x) = $1", params: ["raja"] });
    expect(f({ column: "c", type: "text", op: "neq", value: "A" })).toEqual({ sql: "lower(x) IS DISTINCT FROM $1", params: ["a"] });
    expect(f({ column: "c", type: "text", op: "in", value: ["A", "b"] })).toEqual({ sql: "lower(x) IN ($1, $2)", params: ["a", "b"] });
    expect(f({ column: "c", type: "text", op: "contains", value: "50%_off\\" })).toEqual({
      sql: "x ILIKE $1 ESCAPE '\\'",
      params: ["%50\\%\\_off\\\\%"],
    });
  });

  it("number/money: comparisons with bound values", () => {
    expect(f({ column: "c", type: "money", op: "eq", value: 100 })).toEqual({ sql: "x = $1", params: [100] });
    expect(f({ column: "c", type: "money", op: "neq", value: 100 })).toEqual({ sql: "x IS DISTINCT FROM $1", params: [100] });
    expect(f({ column: "c", type: "number", op: "in", value: [1, 2.5] })).toEqual({ sql: "x IN ($1, $2)", params: [1, 2.5] });
    expect(f({ column: "c", type: "number", op: "gte", value: 3 })).toEqual({ sql: "x >= $1", params: [3] });
    expect(f({ column: "c", type: "number", op: "lte", value: 3 })).toEqual({ sql: "x <= $1", params: [3] });
    expect(f({ column: "c", type: "money", op: "between", value: [1, 9] })).toEqual({ sql: "x BETWEEN $1 AND $2", params: [1, 9] });
  });

  it("enum: exact match", () => {
    expect(f({ column: "c", type: "enum", op: "eq", value: "paid" })).toEqual({ sql: "x = $1", params: ["paid"] });
    expect(f({ column: "c", type: "enum", op: "in", value: ["paid", "issued"] })).toEqual({ sql: "x IN ($1, $2)", params: ["paid", "issued"] });
  });

  it("date column (Postgres date): inclusive range as >= from AND < day after", () => {
    expect(f({ column: "d", type: "date", op: "between", value: ["2026-04-01", "2026-04-30"] })).toEqual({
      sql: "(x)::date >= $1::date AND (x)::date < $2::date",
      params: ["2026-04-01", "2026-05-01"],
    });
    expect(f({ column: "d", type: "date", op: "eq", value: "2026-12-31" })).toEqual({
      sql: "(x)::date >= $1::date AND (x)::date < $2::date",
      params: ["2026-12-31", "2027-01-01"],
    });
    expect(f({ column: "d", type: "date", op: "gte", value: "2026-04-01" })).toEqual({ sql: "(x)::date >= $1::date", params: ["2026-04-01"] });
    expect(f({ column: "d", type: "date", op: "lte", value: "2026-04-30" })).toEqual({ sql: "(x)::date < $1::date", params: ["2026-05-01"] });
  });

  it("timestamptz column: IST day boundaries as UTC instants", () => {
    const ts = { expr: sql`o.placed_at`, timestamp: true };
    expect(f({ column: "d", type: "date", op: "between", value: ["2026-04-01", "2026-04-30"] }, ts)).toEqual({
      sql: "o.placed_at >= $1::timestamptz AND o.placed_at < $2::timestamptz",
      params: ["2026-03-31T18:30:00.000Z", "2026-04-30T18:30:00.000Z"],
    });
    expect(f({ column: "d", type: "date", op: "eq", value: "2026-10-15" }, ts).params).toEqual(["2026-10-14T18:30:00.000Z", "2026-10-15T18:30:00.000Z"]);
  });

  it("refuses ops that make no sense for the type even if a plan was hand-built", () => {
    expect(() => filterSql({ column: "d", type: "date", op: "in", value: ["2026-01-01"] }, { expr: sql`x` })).toThrow();
    expect(() => filterSql({ column: "d", type: "money", op: "contains", value: "1" }, { expr: sql`x` })).toThrow();
  });
});

describe("buildSql: rows mode", () => {
  it("selects mapped expressions under generated aliases, tenant first, sorted, limit + 1", () => {
    const q = rows({ columns: ["date", "customer", "amount"], filters: [{ column: "status", op: "eq", value: "paid" }], limit: 50 });
    expect(q.sql).toBe(
      "SELECT to_char((s.date)::date, 'YYYY-MM-DD') AS c0, s.customer->>'name' AS c1, s.amount AS c2 FROM sales s " +
        "WHERE (s.tenant_id = $1) AND (s.status = $2) ORDER BY c0 DESC NULLS LAST LIMIT 51",
    );
    expect(q.params).toEqual([TENANT, "paid"]);
  });

  it("applies the date range on the dataset's date column", () => {
    const q = rows({ columns: ["number"], dateRange: { preset: "this_month" } });
    expect(q.sql).toContain("WHERE (s.tenant_id = $1) AND ((s.date)::date >= $2::date AND (s.date)::date < $3::date)");
    expect(q.params).toEqual([TENANT, "2026-10-01", "2026-10-16"]);
  });

  it("timestamptz date columns are shown as IST dates", () => {
    expect(rows({ columns: ["placedAt"] }).sql).toContain("to_char(((s.placed_at) AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS c0");
  });

  it("totals sum only aggregatable number/money columns shown, plus the row count", () => {
    const q = totals({ columns: ["customer", "qty", "amount", "rate"], filters: [{ column: "amount", op: "gte", value: 100 }] })!;
    expect(q.sql).toBe(
      "SELECT count(*) AS n, coalesce(sum((s.qty)::numeric), 0) AS t1, coalesce(sum(s.amount), 0) AS t2 FROM sales s " +
        "WHERE (s.tenant_id = $1) AND (s.amount >= $2)",
    );
    expect(q.params).toEqual([TENANT, 100]);
    expect(totals({ totals: false })).toBeNull();
  });

  it("multiple sort keys in order", () => {
    expect(rows({ columns: ["customer", "amount"], sort: [{ column: "amount", dir: "desc" }, { column: "customer" }] }).sql).toContain(
      "ORDER BY c1 DESC NULLS LAST, c0 ASC NULLS LAST",
    );
  });
});

describe("buildSql: grouped mode", () => {
  it("groups by position with measures; buckets dates", () => {
    const q = rows({
      groupBy: ["date:month", "status"],
      measures: [{ column: "amount", fn: "sum" }, { fn: "count" }, { column: "amount", fn: "avg" }, { column: "qty", fn: "avg" }],
      sort: [{ column: "sum_amount", dir: "desc" }],
    });
    expect(q.sql).toBe(
      "SELECT to_char(date_trunc('month', (s.date)::date)::date, 'YYYY-MM-DD') AS c0, s.status AS c1, " +
        "coalesce(sum(s.amount), 0) AS c2, count(*) AS c3, round(avg(s.amount)) AS c4, avg((s.qty)::numeric) AS c5 " +
        "FROM sales s WHERE (s.tenant_id = $1) GROUP BY 1, 2 ORDER BY c2 DESC NULLS LAST LIMIT 501",
    );
  });

  it("week bucket of a timestamptz column truncates the IST date; day bucket is the plain date", () => {
    expect(rows({ groupBy: ["placedAt:week"] }).sql).toContain(
      "to_char(date_trunc('week', ((s.placed_at) AT TIME ZONE 'Asia/Kolkata')::date)::date, 'YYYY-MM-DD') AS c0",
    );
    expect(rows({ groupBy: ["date:day"] }).sql).toContain("to_char((s.date)::date, 'YYYY-MM-DD') AS c0");
  });

  it("min/max/count(column)", () => {
    const q = rows({ measures: [{ column: "amount", fn: "min" }, { column: "amount", fn: "max" }, { column: "customer", fn: "count" }] });
    expect(q.sql).toBe(
      "SELECT min(s.amount) AS c0, max(s.amount) AS c1, count(s.customer->>'name') AS c2 FROM sales s WHERE (s.tenant_id = $1) ORDER BY c0 DESC NULLS LAST LIMIT 501",
    );
  });

  it("totals are the measures over all rows, without GROUP BY", () => {
    const q = totals({ groupBy: ["customer"], measures: [{ column: "amount", fn: "sum" }, { fn: "count" }], filters: [{ column: "status", op: "in", value: ["paid"] }] })!;
    expect(q.sql).toBe(
      "SELECT count(*) AS n, coalesce(sum(s.amount), 0) AS t1, count(*) AS t2 FROM sales s WHERE (s.tenant_id = $1) AND (s.status IN ($2))",
    );
  });
});

describe("buildSql: injection safety", () => {
  it("never puts user values in the SQL text", () => {
    const evil = "'; DROP TABLE invoices; --";
    const q = rows({
      filters: [
        { column: "customer", op: "contains", value: evil },
        { column: "customer", op: "in", value: [evil, "x"] },
        { column: "number", op: "eq", value: evil },
      ],
    });
    expect(q.sql).not.toContain("DROP");
    expect(q.params).toContain(`%${evil}%`);
    expect(q.params).toContain(evil.toLowerCase());
  });

  it("refuses plans naming unmapped columns or sorts outside the output", () => {
    const p = plan({ columns: ["customer"] });
    expect(() => buildSql({ ...p, columns: [{ ...p.columns[0]!, column: "hack" }] }, salesMapping())).toThrow(/No SQL mapping/);
    expect(() => buildSql({ ...p, sort: [{ key: "1; DROP", dir: "asc" }] }, salesMapping())).toThrow(/not in the report/);
    expect(() => buildSql({ ...p, filters: [{ column: "zzz", type: "text", op: "eq", value: "a" }] }, salesMapping())).toThrow(/No SQL mapping/);
  });

  it("clamps the limit and the sort direction even on a hand-built plan", () => {
    const p = plan({ columns: ["customer"] });
    const q = render(buildSql({ ...p, limit: 10_000_000, sort: [{ key: "customer", dir: "desc; DROP" as never }] }, salesMapping()).rows);
    expect(q.sql).toMatch(/ORDER BY c0 ASC NULLS LAST LIMIT 50001$/);
  });
});

describe("runSql / datasetFromSql", () => {
  it("maps aliases back to keys and coerces numeric strings", async () => {
    const calls: string[] = [];
    const execute = async (q: SQL) => {
      const text = render(q).sql;
      calls.push(text);
      if (text.startsWith("SELECT count(*) AS n")) return [{ n: "3", t2: "12.5", t3: "4500" }];
      return [
        { c0: "2026-10-01", c1: "Raja", c2: "1.5", c3: "1500" },
        { c0: new Date("2026-10-02T00:00:00Z"), c1: null, c2: null, c3: 3000 },
      ];
    };
    const r = await runSql(execute, plan({ columns: ["date", "customer", "qty", "amount"] }), salesMapping());
    expect(r.rows).toEqual([
      { date: "2026-10-01", customer: "Raja", qty: 1.5, amount: 1500 },
      { date: "2026-10-02", customer: null, qty: null, amount: 3000 },
    ]);
    expect(r.totals).toEqual({ count: 3, qty: 12.5, amount: 4500 });
    expect(calls).toHaveLength(2);
  });

  it("datasetFromSql checks the mapping covers the definition exactly and scopes by tenant", async () => {
    const m = salesMapping();
    const base = { definition: salesDef, from: m.from, where: (t: string) => sql`s.tenant_id = ${t}`, execute: async () => [] };
    const { secret: _s, ...missing } = m.columns;
    expect(() => datasetFromSql({ ...base, columns: missing })).toThrow(/no SQL for secret/);
    expect(() => datasetFromSql({ ...base, columns: { ...m.columns, extra: sql`1` } })).toThrow(/unknown columns extra/);
    expect(() => datasetFromSql({ ...base, definition: { ...salesDef, columns: [] }, columns: {} })).toThrow(/no columns/);

    const seen: unknown[][] = [];
    const ds = datasetFromSql({
      ...base,
      columns: m.columns,
      execute: async (q) => {
        seen.push(render(q).params);
        return [];
      },
    });
    await ds.query("22222222-2222-4222-8222-222222222222", plan({ columns: ["customer"] }));
    expect(seen[0]![0]).toBe("22222222-2222-4222-8222-222222222222");
  });
});
