import { describe, expect, it } from "vitest";
import { webMessages } from "./messages";
import {
  activeFilterCount,
  clearTableFilters,
  emptyTableState,
  ownedParams,
  parseTableState,
  patchTableState,
  serializeTableState,
  tableApiParams,
  type ServerFilterDefs,
  type TableUrlOptions,
} from "./server-table-state";

const defs = {
  status: {
    kind: "options",
    label: "Status",
    options: [
      { value: "draft", label: "Draft" },
      { value: "paid", label: "Paid" },
      { value: "overdue", label: "Overdue" },
    ],
  },
  method: { kind: "options", label: "Paid by", param: "pay", single: true, options: [{ value: "upi", label: "UPI" }, { value: "cash", label: "Cash" }] },
  date: { kind: "dateRange", label: "Date" },
  customerId: { kind: "text" },
} satisfies ServerFilterDefs;

const opts: TableUrlOptions = { defaultPageSize: 25, pageSizes: [25, 50, 100], sortKeys: ["date", "total", "number"], defaultSort: "-date" };
const parse = (qs: string, o = opts) => parseTableState(new URLSearchParams(qs), defs, o);

describe("parseTableState", () => {
  it("gives defaults for an empty URL", () => {
    expect(parse("")).toEqual({
      pageIndex: 0,
      pageSize: 25,
      sort: { id: "date", desc: true },
      q: "",
      filters: { status: [], method: [], date: {}, customerId: undefined },
    });
  });

  it("reads page, size, sort, search and filters", () => {
    const s = parse("page=3&size=50&sort=total&q=%20meena%20&status=paid,overdue&pay=upi&from=2026-10-01&to=2026-10-31&customerId=c1");
    expect(s).toEqual({
      pageIndex: 2,
      pageSize: 50,
      sort: { id: "total", desc: false },
      q: "meena",
      filters: { status: ["paid", "overdue"], method: ["upi"], date: { from: "2026-10-01", to: "2026-10-31" }, customerId: "c1" },
    });
  });

  it("ignores bad values instead of failing", () => {
    const s = parse("page=-2&size=33&sort=-secret&status=lost,paid&pay=upi,cash&from=yesterday&to=2026-10-31");
    expect(s.pageIndex).toBe(0);
    expect(s.pageSize).toBe(25);
    expect(s.sort).toEqual({ id: "date", desc: true });
    expect(s.filters.status).toEqual(["paid"]);
    expect(s.filters.method).toEqual(["upi"]); // single
    expect(s.filters.date).toEqual({ to: "2026-10-31" });
    expect(parse("page=abc").pageIndex).toBe(0);
  });

  it("keeps the options' order and accepts repeated params", () => {
    expect(parse("status=overdue&status=draft").filters.status).toEqual(["draft", "overdue"]);
  });

  it("swaps a reversed date range", () => {
    expect(parse("from=2026-10-31&to=2026-10-01").filters.date).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("reads prefixed keys only", () => {
    const o = { ...opts, prefix: "inv" };
    const s = parse("inv.page=2&page=9&inv.status=paid&status=draft&inv.q=x", o);
    expect(s.pageIndex).toBe(1);
    expect(s.filters.status).toEqual(["paid"]);
    expect(s.q).toBe("x");
  });
});

describe("serializeTableState", () => {
  it("leaves defaults out", () => {
    expect(serializeTableState(emptyTableState(defs, opts), defs, opts)).toBe("");
  });

  it("round-trips", () => {
    const qs = "page=3&size=50&sort=total&q=meena&status=paid%2Coverdue&pay=upi&from=2026-10-01&to=2026-10-31&customerId=c1";
    const s = parse(qs);
    const out = serializeTableState(s, defs, opts);
    expect(parse(out)).toEqual(s);
    expect(new URLSearchParams(out).get("status")).toBe("paid,overdue");
    expect(new URLSearchParams(out).get("sort")).toBe("total");
  });

  it("keeps params it doesn't own and drops stale table params", () => {
    const base = new URLSearchParams("view=board&status=draft&page=4");
    const s = { ...emptyTableState(defs, opts), filters: { ...emptyTableState(defs, opts).filters, status: ["paid"] } };
    const out = new URLSearchParams(serializeTableState(s, defs, opts, base));
    expect(out.get("view")).toBe("board");
    expect(out.get("status")).toBe("paid");
    expect(out.has("page")).toBe(false);
  });

  it("writes a non-default sort and drops the default", () => {
    const s = emptyTableState(defs, opts);
    expect(serializeTableState({ ...s, sort: { id: "date", desc: false } }, defs, opts)).toBe("sort=date");
    expect(serializeTableState({ ...s, sort: { id: "date", desc: true } }, defs, opts)).toBe("");
  });

  it("lists every owned param", () => {
    expect(ownedParams(defs, { prefix: "p" })).toEqual(["p.page", "p.size", "p.sort", "p.q", "p.status", "p.pay", "p.from", "p.to", "p.customerId"]);
  });
});

describe("tableApiParams", () => {
  it("maps state to limit/offset/sort/q and filters", () => {
    const s = parse("page=3&size=50&sort=-total&q=meena&status=paid,overdue&pay=cash&from=2026-10-01&customerId=c1");
    expect(tableApiParams(s, defs, { branch: "b1", empty: "", skip: undefined, flag: true })).toEqual({
      limit: 50,
      offset: 100,
      sort: "-total",
      q: "meena",
      status: "paid,overdue",
      pay: "cash",
      from: "2026-10-01",
      customerId: "c1",
      branch: "b1",
      flag: "true",
    });
  });
});

describe("patchTableState", () => {
  const s = parse("page=4&status=paid");
  it("goes back to page 1 when the result set changes", () => {
    expect(patchTableState(s, { q: "ravi" }).pageIndex).toBe(0);
    expect(patchTableState(s, { pageSize: 50 }).pageIndex).toBe(0);
    expect(patchTableState(s, { sort: { id: "total", desc: true } }).pageIndex).toBe(0);
    const f = patchTableState(s, { filters: { status: ["draft"] } });
    expect(f.pageIndex).toBe(0);
    expect(f.filters).toMatchObject({ status: ["draft"], method: [], date: {} });
  });
  it("keeps the page for no-op changes and explicit pages", () => {
    expect(patchTableState(s, { q: "" }).pageIndex).toBe(3);
    expect(patchTableState(s, { filters: { status: ["paid"] } }).pageIndex).toBe(3);
    expect(patchTableState(s, { pageIndex: 7 }).pageIndex).toBe(7);
    expect(patchTableState(s, { q: "x", pageIndex: 2 }).pageIndex).toBe(2);
  });
});

describe("filters", () => {
  it("counts search and filters, not fixed text context", () => {
    expect(activeFilterCount(parse("customerId=c1"), defs)).toBe(0);
    expect(activeFilterCount(parse("q=a&status=paid&from=2026-10-01&customerId=c1"), defs)).toBe(3);
  });
  it("clears search and filters but keeps sort, size and text context", () => {
    const c = clearTableFilters(parse("page=3&size=50&sort=total&q=a&status=paid&pay=upi&from=2026-10-01&customerId=c1"), defs);
    expect(c).toEqual({
      pageIndex: 0,
      pageSize: 50,
      sort: { id: "total", desc: false },
      q: "",
      filters: { status: [], method: [], date: {}, customerId: "c1" },
    });
  });
});

describe("table strings", () => {
  it("has every web.table key in English and Tamil", () => {
    const en = Object.keys(webMessages.en).filter((k) => k.startsWith("web.table."));
    const ta = Object.keys(webMessages.ta).filter((k) => k.startsWith("web.table."));
    expect(en.length).toBeGreaterThan(30);
    expect(ta.sort()).toEqual(en.sort());
  });
});
