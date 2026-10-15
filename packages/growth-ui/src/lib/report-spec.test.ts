import { describe, expect, it } from "vitest";
import {
  bucketLabel,
  buildSpec,
  changeFilterColumn,
  changeFilterOp,
  changeGroupColumn,
  changeMeasureFn,
  defaultDateRange,
  effectiveMeasures,
  fileSlug,
  filterToSpec,
  formatTime,
  groupKey,
  initialState,
  isEmail,
  isIsoDate,
  issuesAt,
  measureKey,
  moveItem,
  newFilter,
  newGroup,
  newMeasure,
  opsFor,
  optionLabel,
  outputKeys,
  parseGroupKey,
  parseLimit,
  parseTime,
  parseValue,
  relativeParts,
  scheduleBody,
  scheduleToDraft,
  sortByLastRun,
  specToState,
  splitList,
  timingFromCron,
  validateSchedule,
  defaultScheduleDraft,
  type BuilderFilter,
  type BuilderState,
} from "./report-spec";
import type { DatasetColumn, DatasetInfo, ReportSchedule } from "./types";

const OPS: DatasetInfo["ops"] = {
  text: ["eq", "neq", "in", "contains"],
  number: ["eq", "neq", "in", "gte", "lte", "between"],
  money: ["eq", "neq", "in", "gte", "lte", "between"],
  date: ["eq", "gte", "lte", "between"],
  enum: ["eq", "neq", "in"],
};

const bills: DatasetInfo = {
  id: "invoices.bills",
  label: "Bills",
  module: "invoices",
  dateColumn: "date",
  defaultSort: { column: "date", dir: "desc" },
  columns: [
    { key: "date", label: "Bill date", type: "date", groupable: true },
    { key: "number", label: "Bill no.", type: "text" },
    { key: "customerName", label: "Customer", type: "text", groupable: true },
    { key: "gstin", label: "GSTIN", type: "text", default: false },
    {
      key: "status",
      label: "Status",
      type: "enum",
      groupable: true,
      options: [
        { value: "issued", label: "Unpaid" },
        { value: "paid", label: "Paid" },
      ],
    },
    { key: "items", label: "Items", type: "number", aggregatable: true },
    { key: "total", label: "Bill total", type: "money", aggregatable: true },
    { key: "creditLimit", label: "Credit limit", type: "money", default: false },
    { key: "secret", label: "Secret", type: "text", filterable: false, default: false },
  ],
  ops: OPS,
  measures: ["sum", "count", "avg", "min", "max"],
  dateBuckets: ["day", "week", "month", "quarter", "year"],
  datePresets: ["today", "this_month", "this_fy"],
};

const stock: DatasetInfo = { ...bills, id: "inventory.stock", dateColumn: undefined, datePresets: [] };
const col = (k: string) => bills.columns.find((c) => c.key === k)! as DatasetColumn;
const f = (over: Partial<BuilderFilter>): BuilderFilter => ({ id: "f", column: "number", op: "eq", value: "", value2: "", values: [], ...over });

describe("initialState", () => {
  it("turns on columns whose default isn't false, keeps dataset order", () => {
    const s = initialState(bills);
    expect(s.columns.filter((c) => c.on).map((c) => c.key)).toEqual(["date", "number", "customerName", "status", "items", "total"]);
    expect(s.columns).toHaveLength(bills.columns.length);
    expect(s.dateRange).toEqual({ kind: "preset", preset: "this_month" });
  });
  it("has no date range without a dateColumn", () => {
    expect(initialState(stock).dateRange).toEqual({ kind: "none" });
  });
  it("falls back to the first preset", () => {
    expect(defaultDateRange({ ...bills, datePresets: ["today", "this_fy"] })).toEqual({ kind: "preset", preset: "today" });
    expect(defaultDateRange({ ...bills, datePresets: [] })).toEqual({ kind: "none" });
  });
});

describe("moveItem", () => {
  it("moves and clamps", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b", "c"], 1, 9)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });
});

describe("filters", () => {
  it("ops follow the column type", () => {
    expect(opsFor(bills, col("status"))).toEqual(["eq", "neq", "in"]);
    expect(opsFor(bills, col("date"))).toEqual(["eq", "gte", "lte", "between"]);
    expect(opsFor(bills, undefined)).toEqual([]);
    expect(opsFor({ ...bills, ops: undefined as unknown as DatasetInfo["ops"] }, col("total"))).toContain("between");
  });
  it("new filters pick a sensible op and value", () => {
    expect(newFilter(bills, "number")).toMatchObject({ op: "contains", value: "" });
    expect(newFilter(bills, "status")).toMatchObject({ op: "eq", value: "issued" });
    expect(newFilter(bills, "date")).toMatchObject({ op: "between" });
    expect(newFilter(bills, "secret")).toBeNull();
    expect(newFilter(bills)?.column).toBe("date");
  });
  it("changing column resets op/value but keeps the id", () => {
    const x = changeFilterColumn(bills, f({ id: "keep", value: "x" }), "status");
    expect(x).toMatchObject({ id: "keep", column: "status", op: "eq", value: "issued" });
  });
  it("changing op to/from `in` carries the value", () => {
    expect(changeFilterOp(f({ value: "A1" }), "in").values).toEqual(["A1"]);
    expect(changeFilterOp(f({ op: "in", values: ["B2", "C3"] }), "eq").value).toBe("B2");
    const same = f({});
    expect(changeFilterOp(same, "eq")).toBe(same);
  });

  it("parses values per type", () => {
    expect(parseValue(col("number"), " INV-1 ")).toEqual({ ok: true, value: "INV-1" });
    expect(parseValue(col("number"), "x".repeat(201))).toMatchObject({ ok: false, key: "valueTooLong" });
    expect(parseValue(col("items"), "1,200")).toEqual({ ok: true, value: 1200 });
    expect(parseValue(col("items"), "abc")).toMatchObject({ ok: false, key: "valueNumber" });
    expect(parseValue(col("total"), "₹1,250.50")).toEqual({ ok: true, value: 125050 });
    expect(parseValue(col("total"), "12.345")).toMatchObject({ ok: false, key: "valueMoney" });
    expect(parseValue(col("date"), "2026-02-30")).toMatchObject({ ok: false, key: "valueDate" });
    expect(parseValue(col("date"), "2026-02-28")).toEqual({ ok: true, value: "2026-02-28" });
    expect(parseValue(col("status"), "paid")).toEqual({ ok: true, value: "paid" });
    expect(parseValue(col("status"), "nope")).toMatchObject({ ok: false, key: "valueOption" });
    expect(parseValue(col("number"), "  ")).toMatchObject({ ok: false, key: "valueRequired" });
  });

  it("money filters send paise; between and in are lists", () => {
    expect(filterToSpec(bills, f({ column: "total", op: "gte", value: "500" }))).toEqual({ filter: { column: "total", op: "gte", value: 50000 } });
    expect(filterToSpec(bills, f({ column: "total", op: "between", value: "1", value2: "2.5" }))).toEqual({
      filter: { column: "total", op: "between", value: [100, 250] },
    });
    expect(filterToSpec(bills, f({ column: "total", op: "in", values: ["1", "1.00", "2"] }))).toEqual({
      filter: { column: "total", op: "in", value: [100, 200] },
    });
    expect(filterToSpec(bills, f({ column: "status", op: "in", values: ["paid", "issued", "paid"] }))).toEqual({
      filter: { column: "status", op: "in", value: ["paid", "issued"] },
    });
  });

  it("reports problems with the right sub-path", () => {
    expect(filterToSpec(bills, f({ column: "nope" }))).toMatchObject({ issue: { key: "unknownColumn", sub: "column" } });
    expect(filterToSpec(bills, f({ column: "secret", value: "x" }))).toMatchObject({ issue: { key: "unknownColumn" } });
    expect(filterToSpec(bills, f({ column: "status", op: "contains", value: "paid" }))).toMatchObject({ issue: { key: "badOp", sub: "op" } });
    expect(filterToSpec(bills, f({ column: "status", op: "in" }))).toMatchObject({ issue: { key: "pickOne" } });
    expect(filterToSpec(bills, f({ column: "number", op: "in" }))).toMatchObject({ issue: { key: "valueList" } });
    expect(filterToSpec(bills, f({ column: "total", op: "in", values: ["1", "x"] }))).toMatchObject({ issue: { key: "valueMoney", params: { value: "x" } } });
    expect(filterToSpec(bills, f({ column: "date", op: "between", value: "2026-05-01", value2: "" }))).toMatchObject({ issue: { sub: "value2" } });
    expect(filterToSpec(bills, f({ column: "date", op: "between", value: "2026-05-02", value2: "2026-05-01" }))).toMatchObject({
      issue: { key: "fromAfterTo", sub: "value2" },
    });
    expect(filterToSpec(bills, f({ column: "number", op: "in", values: Array.from({ length: 101 }, (_, i) => `v${i}`) }))).toMatchObject({
      issue: { key: "tooManyValues" },
    });
  });
});

describe("groups and measures", () => {
  it("measure keys match the server", () => {
    expect(measureKey("count", null)).toBe("count");
    expect(measureKey("count", "total")).toBe("count");
    expect(measureKey("sum", "total")).toBe("sum_total");
    expect(measureKey("avg", "items")).toBe("avg_items");
  });
  it("group keys round-trip", () => {
    expect(groupKey({ column: "date", bucket: "month" })).toBe("date:month");
    expect(groupKey({ column: "status", bucket: null })).toBe("status");
    expect(parseGroupKey("date:week")).toEqual({ column: "date", bucket: "week" });
    expect(parseGroupKey("date:fortnight")).toEqual({ column: "date", bucket: null });
    expect(parseGroupKey("status")).toEqual({ column: "status", bucket: null });
  });
  it("new groups skip taken columns; dates default to month", () => {
    expect(newGroup(bills)).toMatchObject({ column: "date", bucket: "month" });
    expect(newGroup(bills, ["date"])).toMatchObject({ column: "customerName", bucket: null });
    expect(newGroup(bills, ["date", "customerName", "status"])).toBeNull();
    const g = newGroup(bills)!;
    expect(changeGroupColumn(bills, g, "status").bucket).toBeNull();
    expect(changeGroupColumn(bills, { ...g, bucket: null, column: "status" }, "date").bucket).toBe("month");
  });
  it("new measures: sum of the next aggregatable column, then count", () => {
    const a = newMeasure(bills);
    expect(a).toMatchObject({ fn: "sum", column: "items" });
    const b = newMeasure(bills, [a]);
    expect(b).toMatchObject({ fn: "sum", column: "total" });
    expect(newMeasure(bills, [a, b])).toMatchObject({ fn: "count", column: null });
    expect(newMeasure({ ...bills, measures: ["count"] })).toMatchObject({ fn: "count" });
  });
  it("changing fn handles the column", () => {
    const m = { id: "m", fn: "sum" as const, column: "total" };
    expect(changeMeasureFn(bills, m, "count")).toMatchObject({ fn: "count", column: null });
    expect(changeMeasureFn(bills, { id: "m", fn: "count", column: null }, "avg")).toMatchObject({ fn: "avg", column: "items" });
    expect(changeMeasureFn(bills, m, "max")).toMatchObject({ fn: "max", column: "total" });
  });
  it("count is the default measure when grouped", () => {
    expect(effectiveMeasures({ groupBy: [{ id: "g", column: "status", bucket: null }], measures: [] })).toEqual([
      { id: "auto-count", fn: "count", column: null },
    ]);
    expect(effectiveMeasures({ groupBy: [], measures: [] })).toEqual([]);
  });
});

const grouped = (over: Partial<BuilderState> = {}): BuilderState => ({
  ...initialState(bills),
  groupBy: [{ id: "g", column: "date", bucket: "month" }],
  measures: [
    { id: "a", fn: "count", column: null },
    { id: "b", fn: "sum", column: "total" },
  ],
  ...over,
});

describe("outputKeys", () => {
  it("rows mode: enabled columns in order", () => {
    const s = initialState(bills);
    s.columns = moveItem(s.columns, 5, 0);
    expect(outputKeys(bills, s).map((k) => k.key)).toEqual(["items", "date", "number", "customerName", "status", "total"]);
  });
  it("grouped mode: group columns then measure keys", () => {
    expect(outputKeys(bills, grouped()).map((k) => k.key)).toEqual(["date", "count", "sum_total"]);
    expect(outputKeys(bills, grouped({ measures: [] })).map((k) => k.key)).toEqual(["date", "count"]);
  });
});

describe("buildSpec", () => {
  it("builds the example monthly spec", () => {
    const r = buildSpec(bills, grouped({ dateRange: { kind: "preset", preset: "this_fy" } }));
    expect(r.issues).toEqual([]);
    expect(r.runnable).toBe(true);
    expect(r.spec).toEqual({
      dataset: "invoices.bills",
      groupBy: ["date:month"],
      measures: [{ fn: "count" }, { column: "total", fn: "sum" }],
      dateRange: { preset: "this_fy" },
    });
  });
  it("rows mode sends the enabled columns in order", () => {
    const s = initialState(bills);
    s.columns = s.columns.map((c) => ({ ...c, on: c.key === "total" || c.key === "number" }));
    s.columns = moveItem(s.columns, s.columns.findIndex((c) => c.key === "total"), 0);
    const r = buildSpec(bills, { ...s, dateRange: { kind: "none" } });
    expect(r.spec).toEqual({ dataset: "invoices.bills", columns: ["total", "number"] });
  });
  it("no columns → not runnable", () => {
    const s = initialState(bills);
    s.columns = s.columns.map((c) => ({ ...c, on: false }));
    const r = buildSpec(bills, s);
    expect(r.runnable).toBe(false);
    expect(r.issues[0]).toMatchObject({ path: "columns", key: "pickColumn" });
  });
  it("group by without measures sends count", () => {
    const r = buildSpec(bills, grouped({ measures: [], groupBy: [{ id: "g", column: "status", bucket: "month" }] }));
    expect(r.spec.groupBy).toEqual(["status"]);
    expect(r.spec.measures).toEqual([{ fn: "count" }]);
    expect(r.spec.columns).toBeUndefined();
  });
  it("measures only → grouped totals", () => {
    const r = buildSpec(bills, { ...initialState(bills), measures: [{ id: "m", fn: "sum", column: "total" }] });
    expect(r.spec).toMatchObject({ measures: [{ fn: "sum", column: "total" }] });
    expect(r.spec.groupBy).toBeUndefined();
  });
  it("reports duplicate measures, twice-grouped columns, too many groups and bad measure columns", () => {
    const r = buildSpec(
      bills,
      grouped({
        groupBy: [
          { id: "1", column: "status", bucket: null },
          { id: "2", column: "status", bucket: null },
          { id: "3", column: "date", bucket: "day" },
          { id: "4", column: "customerName", bucket: null },
        ],
        measures: [
          { id: "a", fn: "sum", column: "total" },
          { id: "b", fn: "sum", column: "total" },
          { id: "c", fn: "avg", column: "number" },
        ],
      }),
    );
    expect(r.spec.groupBy).toEqual(["status", "date:day"]);
    expect(r.spec.measures).toEqual([{ fn: "sum", column: "total" }]);
    expect(r.issues.map((i) => i.key).sort()).toEqual(["duplicateMeasure", "groupedTwice", "measureColumn", "tooManyGroups"].sort());
  });
  it("invalid filters are reported and left out", () => {
    const r = buildSpec(bills, {
      ...initialState(bills),
      filters: [f({ column: "total", op: "gte", value: "abc" }), f({ column: "status", op: "eq", value: "paid" })],
    });
    expect(r.spec.filters).toEqual([{ column: "status", op: "eq", value: "paid" }]);
    expect(issuesAt(r.issues, "filters.0")).toEqual([{ path: "filters.0.value", key: "valueMoney", params: undefined }]);
    expect(issuesAt(r.issues, "filters.1")).toEqual([]);
    expect(r.runnable).toBe(true);
  });
  it("keeps a sort on an output key, drops a dangling one", () => {
    expect(buildSpec(bills, grouped({ sort: { column: "sum_total", dir: "desc" } })).spec.sort).toEqual([{ column: "sum_total", dir: "desc" }]);
    expect(buildSpec(bills, grouped({ sort: { column: "number", dir: "asc" } })).spec.sort).toBeUndefined();
  });
  it("limit", () => {
    expect(parseLimit("")).toBeNull();
    expect(parseLimit("50")).toBe(50);
    expect(parseLimit("0")).toBeUndefined();
    expect(parseLimit("1.5")).toBeUndefined();
    expect(parseLimit("999999")).toBeUndefined();
    expect(buildSpec(bills, grouped({ limit: "20" })).spec.limit).toBe(20);
    expect(buildSpec(bills, grouped({ limit: "x" })).issues[0]).toMatchObject({ path: "limit", key: "limitRange" });
  });
  it("custom date ranges are validated; datasets without a date column send none", () => {
    expect(buildSpec(bills, grouped({ dateRange: { kind: "custom", from: "2026-04-01", to: "2026-04-30" } })).spec.dateRange).toEqual({
      from: "2026-04-01",
      to: "2026-04-30",
    });
    const bad = buildSpec(bills, grouped({ dateRange: { kind: "custom", from: "2026-05-01", to: "2026-04-30" } }));
    expect(bad.spec.dateRange).toBeUndefined();
    expect(bad.issues[0]).toMatchObject({ path: "dateRange.to", key: "fromAfterTo" });
    expect(buildSpec(bills, grouped({ dateRange: { kind: "custom", from: "", to: "" } })).issues[0]).toMatchObject({ path: "dateRange.from" });
    expect(buildSpec(stock, { ...initialState(stock), dateRange: { kind: "preset", preset: "today" } }).spec.dateRange).toBeUndefined();
  });
});

describe("specToState", () => {
  it("round-trips a grouped spec", () => {
    const s = grouped({
      filters: [
        f({ id: "x", column: "total", op: "between", value: "10", value2: "20.5" }),
        f({ id: "y", column: "status", op: "in", values: ["paid"] }),
      ],
      sort: { column: "sum_total", dir: "desc" },
      limit: "12",
      dateRange: { kind: "custom", from: "2026-04-01", to: "2026-06-30" },
    });
    const spec = buildSpec(bills, s).spec;
    const back = specToState(bills, spec);
    expect(buildSpec(bills, back).spec).toEqual(spec);
    expect(back.filters[0]).toMatchObject({ value: "10", value2: "20.5" });
    expect(back.groupBy[0]).toMatchObject({ column: "date", bucket: "month" });
  });
  it("rows spec: listed columns first and on, the rest off; unknown ones dropped", () => {
    const st = specToState(bills, { dataset: "invoices.bills", columns: ["total", "ghost", "number"], filters: [{ column: "ghost", op: "eq", value: 1 }] });
    expect(st.columns.slice(0, 3)).toEqual([
      { key: "total", on: true },
      { key: "number", on: true },
      { key: "date", on: false },
    ]);
    expect(st.filters).toEqual([]);
    expect(st.dateRange).toEqual({ kind: "none" });
  });
  it("empty columns → dataset defaults; preset range restored", () => {
    const st = specToState(bills, { dataset: "invoices.bills", dateRange: { preset: "this_fy" }, filters: [{ column: "total", op: "gte", value: 12345 }] });
    expect(st.columns).toEqual(initialState(bills).columns);
    expect(st.dateRange).toEqual({ kind: "preset", preset: "this_fy" });
    expect(st.filters[0]!.value).toBe("123.45");
  });
});

describe("formatting helpers", () => {
  const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { ...o, timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`)).replace("Sept", "Sep");
  it("bucket labels", () => {
    expect(bucketLabel("2026-10-01", "month", fmt)).toBe("Oct 2026");
    expect(bucketLabel("2026-01-01T00:00:00.000Z", "year", fmt)).toBe("2026");
    expect(bucketLabel("2026-08-01", "quarter", fmt)).toBe("Jul–Sep 2026");
    expect(bucketLabel("2026-10-12", "week", fmt, (d) => `Week of ${d}`)).toBe("Week of 12 Oct");
    expect(bucketLabel("2026-10-12", null, fmt)).toBe("12 Oct 2026");
    expect(bucketLabel("", "day", fmt)).toBe("");
  });
  it("enum option labels", () => {
    expect(optionLabel(col("status"), "paid")).toBe("Paid");
    expect(optionLabel(col("status"), "other")).toBe("other");
    expect(optionLabel(col("status"), null)).toBe("");
  });
  it("iso dates", () => {
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2025-02-29")).toBe(false);
    expect(isIsoDate("2025-2-1")).toBe(false);
  });
  it("relative parts", () => {
    const now = Date.parse("2026-10-16T10:00:00Z");
    expect(relativeParts("2026-10-16T09:59:30Z", now)).toEqual({ value: -30, unit: "second" });
    expect(relativeParts("2026-10-16T09:30:00Z", now)).toEqual({ value: -30, unit: "minute" });
    expect(relativeParts("2026-10-16T13:00:00Z", now)).toEqual({ value: 3, unit: "hour" });
    expect(relativeParts("2026-10-18T10:00:00Z", now)).toEqual({ value: 2, unit: "day" });
  });
  it("file slug", () => {
    expect(fileSlug("Monthly sales — FY 26")).toBe("monthly-sales-fy-26");
    expect(fileSlug("விற்பனை")).toBe("report");
  });
});

describe("schedules", () => {
  const sched = (over: Partial<ReportSchedule> = {}): ReportSchedule => ({
    id: "s1",
    reportId: "r1",
    preset: "weekly",
    cron: "30 9 * * 5",
    recipients: ["a@x.in"],
    format: "csv",
    active: false,
    lastRunAt: null,
    nextRunAt: null,
    lastStatus: null,
    lastError: null,
    lastRowCount: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    timing: { preset: "weekly", hour: 9, minute: 30, weekday: 5, dayOfMonth: 1 },
    ...over,
  });

  it("time helpers", () => {
    expect(formatTime(8, 5)).toBe("08:05");
    expect(parseTime("08:30")).toEqual({ hour: 8, minute: 30 });
    expect(parseTime("7:00")).toEqual({ hour: 7, minute: 0 });
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("8")).toBeNull();
  });
  it("cron fallback", () => {
    expect(timingFromCron("0 8 1 * *")).toEqual({ hour: 8, minute: 0, weekday: null, dayOfMonth: 1 });
    expect(timingFromCron("bad")).toBeNull();
  });
  it("schedule → draft (timing or cron)", () => {
    expect(scheduleToDraft(sched())).toEqual({ preset: "weekly", time: "09:30", weekday: 5, dayOfMonth: 1, recipients: ["a@x.in"], format: "csv", active: false });
    expect(scheduleToDraft(sched({ timing: null, preset: "monthly", cron: "15 7 20 * *" }))).toMatchObject({ time: "07:15", dayOfMonth: 20 });
  });
  it("validation", () => {
    const d = defaultScheduleDraft("me@shop.in");
    expect(validateSchedule(d)).toEqual({});
    expect(validateSchedule({ ...d, recipients: [] }).recipients).toBe("recipientsRequired");
    expect(validateSchedule({ ...d, recipients: ["nope"] }).recipients).toBe("recipientInvalid");
    expect(validateSchedule({ ...d, recipients: Array.from({ length: 11 }, (_, i) => `a${i}@x.in`) }).recipients).toBe("recipientsMax");
    expect(validateSchedule({ ...d, time: "99:00" }).time).toBe("time");
    expect(validateSchedule({ ...d, preset: "monthly", dayOfMonth: 31 }).dayOfMonth).toBe("dayOfMonth");
    expect(validateSchedule({ ...d, preset: "daily", dayOfMonth: 31 }).dayOfMonth).toBeUndefined();
  });
  it("body sends only what the preset needs, emails normalised", () => {
    const d = { ...defaultScheduleDraft(), recipients: ["A@X.in", "a@x.in", "b@y.in"], time: "18:45" };
    expect(scheduleBody("r1", d)).toEqual({ reportId: "r1", preset: "daily", hour: 18, minute: 45, recipients: ["a@x.in", "b@y.in"], format: "xlsx", active: true });
    expect(scheduleBody("r1", { ...d, preset: "weekly", weekday: 3 })).toMatchObject({ weekday: 3 });
    expect(scheduleBody("r1", { ...d, preset: "monthly", dayOfMonth: 15 })).toMatchObject({ dayOfMonth: 15 });
    expect(scheduleBody("r1", { ...d, preset: "monthly", dayOfMonth: 15 })).not.toHaveProperty("weekday");
  });
  it("emails and lists", () => {
    expect(isEmail("a@b.in")).toBe(true);
    expect(isEmail("a@b")).toBe(false);
    expect(splitList(" a@x.in, b@y.in;c@z.in\nd@w.in ")).toEqual(["a@x.in", "b@y.in", "c@z.in", "d@w.in"]);
  });
  it("sorts by last run, never-run last by next run", () => {
    const list = [
      sched({ id: "never-late", nextRunAt: "2026-10-20T00:00:00Z" }),
      sched({ id: "old", lastRunAt: "2026-10-01T00:00:00Z" }),
      sched({ id: "never-soon", nextRunAt: "2026-10-17T00:00:00Z" }),
      sched({ id: "new", lastRunAt: "2026-10-15T00:00:00Z" }),
    ];
    expect(sortByLastRun(list).map((s) => s.id)).toEqual(["new", "old", "never-soon", "never-late"]);
  });
});
