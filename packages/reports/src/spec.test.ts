import { AppError } from "@srirealtime/core";
import { describe, expect, it } from "vitest";
import { NOW, salesDef } from "./fixtures.test-helpers";
import { definitionProblems, planReport, validateSpec } from "./spec";
import type { DatasetDefinition } from "./types";

const v = (spec: Record<string, unknown>, opts: { maxLimit?: number; defaultLimit?: number } = {}) =>
  validateSpec(salesDef, { dataset: "test.sales", ...spec }, { now: NOW, ...opts });
const issues = (spec: Record<string, unknown>) => {
  const r = v(spec);
  if (r.ok) throw new Error("expected issues");
  return r.issues;
};
const plan = (spec: Record<string, unknown>, opts?: { maxLimit?: number; defaultLimit?: number }) => {
  const r = v(spec, opts);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.plan;
};

describe("validateSpec: columns and defaults", () => {
  it("defaults to the default columns, default sort and limit, rows mode, totals on", () => {
    const p = plan({});
    expect(p.mode).toBe("rows");
    expect(p.columns.map((c) => c.key)).toEqual(["date", "number", "customer", "status", "qty", "amount"]);
    expect(p.sort).toEqual([{ key: "date", dir: "desc" }]);
    expect(p.limit).toBe(500);
    expect(p.totals).toBe(true);
    expect(p.columns.find((c) => c.key === "amount")).toMatchObject({ aggregatable: true, type: "money" });
    expect(p.columns.find((c) => c.key === "status")?.options).toHaveLength(2);
  });

  it("rejects unknown and duplicate columns, wrong dataset and unknown fields", () => {
    expect(issues({ columns: ["nope", "date", "date"] }).map((i) => i.path)).toEqual(["columns.0", "columns.2"]);
    expect(validateSpec(salesDef, { dataset: "other" }, { now: NOW })).toMatchObject({ ok: false, issues: [{ path: "dataset" }] });
    expect(issues({ sql: "DROP TABLE x" })[0]!.message).toMatch(/unrecognized/i);
  });

  it("falls back to the first column for sort when defaultSort column is not shown", () => {
    expect(plan({ columns: ["customer", "amount"] }).sort).toEqual([{ key: "customer", dir: "asc" }]);
  });

  it("caps the limit at maxLimit and the hard cap", () => {
    expect(plan({ limit: 10 }).limit).toBe(10);
    expect(plan({ limit: 999_999 }).limit).toBe(5000);
    expect(plan({ limit: 999_999 }, { maxLimit: 100 }).limit).toBe(100);
    expect(plan({ limit: 999_999 }, { maxLimit: 10_000_000 }).limit).toBe(50_000);
    expect(plan({}, { defaultLimit: 20 }).limit).toBe(20);
    expect(issues({ limit: 0 })[0]!.path).toBe("limit");
  });
});

describe("validateSpec: filters", () => {
  it("accepts ops per type and types the values", () => {
    const p = plan({
      filters: [
        { column: "customer", op: "contains", value: "  Raja " },
        { column: "customer", op: "in", value: ["A", "B", "A"] },
        { column: "amount", op: "between", value: [100, "500"] },
        { column: "qty", op: "gte", value: 1.5 },
        { column: "status", op: "neq", value: "paid" },
        { column: "date", op: "between", value: ["2026-04-01", "2026-04-30"] },
      ],
    });
    expect(p.filters).toEqual([
      { column: "customer", type: "text", op: "contains", value: "Raja" },
      { column: "customer", type: "text", op: "in", value: ["A", "B"] },
      { column: "amount", type: "money", op: "between", value: [100, 500] },
      { column: "qty", type: "number", op: "gte", value: 1.5 },
      { column: "status", type: "enum", op: "neq", value: "paid" },
      { column: "date", type: "date", op: "between", value: ["2026-04-01", "2026-04-30"] },
    ]);
  });

  it.each([
    ["contains on money", { column: "amount", op: "contains", value: "1" }, "filters.0.op"],
    ["gte on enum", { column: "status", op: "gte", value: "paid" }, "filters.0.op"],
    ["in on date", { column: "date", op: "in", value: ["2026-01-01"] }, "filters.0.op"],
    ["neq on date", { column: "date", op: "neq", value: "2026-01-01" }, "filters.0.op"],
    ["between on text", { column: "number", op: "between", value: ["a", "b"] }, "filters.0.op"],
    ["unknown column", { column: "x", op: "eq", value: 1 }, "filters.0.column"],
    ["not filterable", { column: "secret", op: "eq", value: "a" }, "filters.0.column"],
    ["enum value not in options", { column: "status", op: "eq", value: "draft" }, "filters.0.value"],
    ["enum in with a bad value", { column: "status", op: "in", value: ["paid", "x"] }, "filters.0.value.1"],
    ["money with decimals", { column: "amount", op: "eq", value: 10.5 }, "filters.0.value"],
    ["number not numeric", { column: "qty", op: "eq", value: "abc" }, "filters.0.value"],
    ["number as object", { column: "qty", op: "eq", value: { $gt: 1 } }, "filters.0.value"],
    ["invalid date", { column: "date", op: "eq", value: "2026-02-30" }, "filters.0.value"],
    ["empty text", { column: "customer", op: "eq", value: "  " }, "filters.0.value"],
    ["text too long", { column: "customer", op: "contains", value: "x".repeat(201) }, "filters.0.value"],
    ["empty in", { column: "customer", op: "in", value: [] }, "filters.0.value"],
    ["too many in", { column: "customer", op: "in", value: Array.from({ length: 101 }, (_, i) => `c${i}`) }, "filters.0.value"],
    ["between not a pair", { column: "amount", op: "between", value: [1] }, "filters.0.value"],
    ["between reversed", { column: "amount", op: "between", value: [500, 100] }, "filters.0.value"],
    ["array for eq", { column: "amount", op: "eq", value: [1] }, "filters.0.value"],
  ])("rejects %s", (_name, filter, path) => {
    expect(issues({ filters: [filter] })[0]!.path).toBe(path);
  });

  it("reports every issue at once", () => {
    const r = issues({ filters: [{ column: "x", op: "eq", value: 1 }, { column: "status", op: "eq", value: "x" }], columns: ["zz"] });
    expect(r.map((i) => i.path)).toEqual(["filters.0.column", "filters.1.value", "columns.0"]);
  });
});

describe("validateSpec: date range", () => {
  it("accepts fixed dates and resolves presets in IST", () => {
    expect(plan({ dateRange: { from: "2026-04-01", to: "2026-04-30" } }).dateRange).toEqual({ column: "date", from: "2026-04-01", to: "2026-04-30" });
    expect(plan({ dateRange: { preset: "last_7_days" } }).dateRange).toEqual({ column: "date", from: "2026-10-09", to: "2026-10-15" });
    // 20:00 UTC on the 15th is already the 16th in IST.
    const late = validateSpec(salesDef, { dataset: "test.sales", dateRange: { preset: "today" } }, { now: new Date("2026-10-15T20:00:00Z") });
    expect(late.ok && late.plan.dateRange).toMatchObject({ from: "2026-10-16", to: "2026-10-16" });
  });

  it("rejects reversed, invalid, too long ranges and ranges on datasets without a date", () => {
    expect(issues({ dateRange: { from: "2026-05-01", to: "2026-04-01" } })[0]!.path).toBe("dateRange");
    expect(issues({ dateRange: { from: "2026-13-01", to: "2026-04-01" } })[0]!.path).toBe("dateRange.from");
    expect(issues({ dateRange: { from: "2020-01-01", to: "2026-04-01" } })[0]!.message).toMatch(/three years/);
    expect(issues({ dateRange: { preset: "forever" } })[0]!.path).toMatch(/^dateRange/);
    const noDate: DatasetDefinition = { ...salesDef, dateColumn: undefined };
    expect(validateSpec(noDate, { dataset: "test.sales", dateRange: { preset: "today" } }, { now: NOW })).toMatchObject({
      ok: false,
      issues: [{ path: "dateRange" }],
    });
    expect(plan({ dateRange: null }).dateRange).toBeNull();
  });
});

describe("validateSpec: group by and measures", () => {
  it("builds grouped output: groups then measures, with keys and types", () => {
    const p = plan({
      groupBy: ["date:month", "status"],
      measures: [{ column: "amount", fn: "sum" }, { fn: "count" }, { column: "qty", fn: "avg" }, { column: "number", fn: "count" }],
    });
    expect(p.mode).toBe("grouped");
    expect(p.groupBy).toEqual([{ column: "date", bucket: "month" }, { column: "status" }]);
    expect(p.columns.map((c) => [c.key, c.type, c.fn ?? null])).toEqual([
      ["date", "date", null],
      ["status", "enum", null],
      ["sum_amount", "money", "sum"],
      ["count", "number", "count"],
      ["avg_qty", "number", "avg"],
      ["count_number", "number", "count"],
    ]);
    expect(p.columns[0]!.label).toBe("Date (month)");
    expect(p.columns[0]!.aggregatable).toBeUndefined();
    // defaultSort "date" is grouped → used.
    expect(p.sort).toEqual([{ key: "date", dir: "desc" }]);
  });

  it("adds count when grouping without measures; sorts biggest first when no date is grouped", () => {
    const p = plan({ groupBy: ["customer"] });
    expect(p.measures).toEqual([{ key: "count", fn: "count", column: null }]);
    expect(p.sort).toEqual([{ key: "count", dir: "desc" }]);
  });

  it("measures without group by give a single summary row", () => {
    const p = plan({ measures: [{ column: "amount", fn: "max" }] });
    expect(p.mode).toBe("grouped");
    expect(p.groupBy).toEqual([]);
    expect(p.columns.map((c) => c.key)).toEqual(["max_amount"]);
  });

  it.each([
    ["sum on text", { measures: [{ column: "customer", fn: "sum" }] }, "measures.0.fn"],
    ["sum on non-aggregatable money", { measures: [{ column: "rate", fn: "sum" }] }, "measures.0.fn"],
    ["avg on date", { measures: [{ column: "date", fn: "avg" }] }, "measures.0.fn"],
    ["sum without column", { measures: [{ fn: "sum" }] }, "measures.0.column"],
    ["unknown measure column", { measures: [{ column: "x", fn: "count" }] }, "measures.0.column"],
    ["duplicate measure", { measures: [{ fn: "count" }, { column: "*", fn: "count" }] }, "measures.1"],
    ["group by non-groupable", { groupBy: ["amount"] }, "groupBy.0"],
    ["group by unknown", { groupBy: ["x"] }, "groupBy.0"],
    ["bucket on non-date", { groupBy: ["customer:month"] }, "groupBy.0"],
    ["unknown bucket", { groupBy: ["date:decade"] }, "groupBy.0"],
    ["group twice", { groupBy: ["date:month", "date:day"] }, "groupBy.1"],
    ["extra colon", { groupBy: ["date:month:x"] }, "groupBy.0"],
    ["ungrouped column in grouped report", { groupBy: ["status"], columns: ["customer"] }, "columns.0"],
    ["too many group by", { groupBy: ["date", "status", "customer", "placedAt"] }, "groupBy"],
  ])("rejects %s", (_n, spec, path) => {
    expect(issues(spec)[0]!.path).toBe(path);
  });
});

describe("validateSpec: sort", () => {
  it("only allows output columns and measure keys", () => {
    expect(plan({ sort: [{ column: "amount", dir: "desc" }, { column: "customer" }] }).sort).toEqual([
      { key: "amount", dir: "desc" },
      { key: "customer", dir: "asc" },
    ]);
    expect(plan({ groupBy: ["status"], measures: [{ column: "amount", fn: "sum" }], sort: [{ column: "sum_amount", dir: "desc" }] }).sort).toEqual([
      { key: "sum_amount", dir: "desc" },
    ]);
    expect(issues({ columns: ["customer"], sort: [{ column: "amount" }] })[0]!.path).toBe("sort.0.column");
    expect(issues({ sort: [{ column: "amount; DROP TABLE x" }] })[0]!.path).toBe("sort.0.column");
    expect(issues({ sort: [{ column: "amount", dir: "sideways" }] })[0]!.path).toBe("sort.0.dir");
    expect(issues({ sort: [{ column: "amount" }, { column: "amount" }] })[0]!.path).toBe("sort.1.column");
  });
});

describe("planReport", () => {
  it("throws 400 with all issues", () => {
    try {
      planReport(salesDef, { dataset: "test.sales", columns: ["x"] }, { now: NOW });
      throw new Error("no throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).status).toBe(400);
      expect((e as AppError).details).toEqual({ issues: [{ path: "columns.0", message: 'Unknown column "x"' }] });
    }
  });
});

describe("definitionProblems", () => {
  it("accepts the fixture and flags bad definitions", () => {
    expect(definitionProblems(salesDef)).toEqual([]);
    const bad: DatasetDefinition = {
      id: "Bad Id",
      label: "x",
      module: "x",
      dateColumn: "name",
      defaultSort: { column: "missing", dir: "asc" },
      columns: [
        { key: "name", label: "Name", type: "text", aggregatable: true },
        { key: "name", label: "Name", type: "text" },
        { key: "sum_x", label: "S", type: "number" },
        { key: "e", label: "E", type: "enum" },
        { key: "bad key", label: "B", type: "text" },
      ],
    };
    const p = definitionProblems(bad).join("\n");
    for (const m of ["invalid dataset id", "aggregatable but not", "duplicate column", "clashes", "needs options", "invalid column key", "defaultSort", "dateColumn"]) {
      expect(p).toContain(m);
    }
  });
});
