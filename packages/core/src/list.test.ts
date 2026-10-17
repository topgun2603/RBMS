import { and, sql, type SQL } from "drizzle-orm";
import { integer, PgDialect, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { z, ZodError } from "zod";
import { AppError } from "./errors";
import {
  defineSort,
  escapeLike,
  facetCounts,
  likePattern,
  listFilter,
  listQuerySchema,
  parseSortValue,
  rangeOrder,
  runList,
  searchAny,
  splitList,
  toCount,
} from "./list";

const things = pgTable("things", {
  id: uuid("id").primaryKey(),
  number: text("number"),
  total: integer("total").notNull(),
  status: text("status").notNull(),
});
const dialect = new PgDialect();
const render = (parts: SQL[]) => dialect.sqlToQuery(sql.join(parts, sql`, `));

describe("listQuerySchema", () => {
  it("defaults to 25 rows from 0, caps the page size", () => {
    const s = listQuerySchema();
    expect(s.parse({})).toEqual({ limit: 25, offset: 0, q: undefined, sort: undefined });
    expect(s.parse({ limit: "100", offset: "50" })).toMatchObject({ limit: 100, offset: 50 });
    expect(() => s.parse({ limit: "101" })).toThrow(ZodError);
    expect(() => s.parse({ limit: "0" })).toThrow(ZodError);
    expect(() => s.parse({ offset: "-1" })).toThrow(ZodError);
  });
  it("takes per-route limits", () => {
    const s = listQuerySchema({ defaultLimit: 50, maxLimit: 200 });
    expect(s.parse({}).limit).toBe(50);
    expect(s.parse({ limit: "200" }).limit).toBe(200);
  });
  it("trims q and drops it when empty", () => {
    const s = listQuerySchema();
    expect(s.parse({ q: "  meena " }).q).toBe("meena");
    expect(s.parse({ q: "   " }).q).toBeUndefined();
    expect(() => s.parse({ q: "x".repeat(101) })).toThrow(ZodError);
  });
  it("extends with route filters", () => {
    const s = listQuerySchema()
      .extend({
        status: listFilter.oneOf(["paid", "unpaid", "draft"] as const),
        customerId: listFilter.ids(),
        from: listFilter.date(),
        to: listFilter.date(),
        minTotal: listFilter.int(),
        open: listFilter.bool(),
      })
      .superRefine(rangeOrder("from", "to"));
    const p = s.parse({ status: "paid,unpaid", from: "2026-10-01", to: "2026-10-31", minTotal: "500", open: "true" });
    expect(p.status).toEqual(["paid", "unpaid"]);
    expect(p.from).toBe("2026-10-01");
    expect(p.minTotal).toBe(500);
    expect(p.open).toBe(true);
    expect(s.parse({ status: "", from: "" })).toMatchObject({ status: undefined, from: undefined });
    expect(() => s.parse({ status: "paid,nope" })).toThrow(ZodError);
    expect(() => s.parse({ from: "2026-13-45" })).toThrow(ZodError);
    expect(() => s.parse({ from: "01/10/2026" })).toThrow(ZodError);
    expect(() => s.parse({ from: "2026-10-31", to: "2026-10-01" })).toThrow(ZodError);
    expect(() => s.parse({ customerId: "not-a-uuid" })).toThrow(ZodError);
  });
});

describe("splitList", () => {
  it("splits commas and repeated params, trims and de-duplicates", () => {
    expect(splitList("a,b, c")).toEqual(["a", "b", "c"]);
    expect(splitList(["a", "b,a"])).toEqual(["a", "b"]);
    expect(splitList("")).toBeUndefined();
    expect(splitList(" , ")).toBeUndefined();
    expect(splitList(undefined)).toBeUndefined();
  });
});

describe("sorting", () => {
  const SORT = defineSort({ number: things.number, total: things.total, status: things.status }, { default: "-total", tieBreaker: things.id });

  it("parses field, -field and field:dir", () => {
    expect(parseSortValue("total", SORT.keys)).toEqual({ key: "total", desc: false, value: "total" });
    expect(parseSortValue("-total", SORT.keys)).toEqual({ key: "total", desc: true, value: "-total" });
    expect(parseSortValue("total:desc", SORT.keys)).toEqual({ key: "total", desc: true, value: "-total" });
    expect(parseSortValue("total:ASC", SORT.keys)).toEqual({ key: "total", desc: false, value: "total" });
    expect(parseSortValue("price", SORT.keys)).toBeNull();
  });

  it("falls back to the default sort", () => {
    expect(SORT.parse(undefined)).toMatchObject({ key: "total", desc: true });
    expect(SORT.parse("")).toMatchObject({ key: "total", desc: true });
  });

  it("rejects unknown fields with a 400 listing the allowed ones", () => {
    try {
      SORT.parse("-price");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const e = err as AppError;
      expect(e.status).toBe(400);
      expect(e.details).toEqual({ field: "sort", value: "-price", allowed: ["number", "total", "status"] });
      expect(e.message).toContain("number, total, status");
    }
    // SQL injection attempts are just unknown fields.
    expect(() => SORT.parse("total; drop table things")).toThrow(AppError);
  });

  it("orders by the field with nulls last, then the tie-breaker in the same direction", () => {
    const d = render(SORT.orderBy("-number"));
    expect(d.sql).toBe('"things"."number" desc nulls last, "things"."id" desc');
    const a = render(SORT.orderBy("total"));
    expect(a.sql).toBe('"things"."total" asc nulls last, "things"."id" asc');
    expect(render(SORT.orderBy(SORT.parse("status"))).sql).toBe('"things"."status" asc nulls last, "things"."id" asc');
  });

  it("appends several tie-breakers", () => {
    const S = defineSort({ total: things.total }, { default: "-total", tieBreaker: [things.number, things.id] });
    expect(render(S.orderBy(undefined)).sql).toBe('"things"."total" desc nulls last, "things"."number" desc, "things"."id" desc');
  });

  it("sorts by SQL expressions", () => {
    const S = defineSort({ balance: sql`${things.total} - 1` }, { default: "balance", tieBreaker: things.id });
    expect(render(S.orderBy("-balance")).sql).toBe('"things"."total" - 1 desc nulls last, "things"."id" desc');
  });
});

describe("search", () => {
  it("escapes LIKE wildcards", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
    expect(likePattern("a_b")).toBe("%a\\_b%");
  });
  it("ORs an ILIKE per expression", () => {
    const cond = searchAny(" 10% ", [things.number, sql`${things.status}`])!;
    const q = dialect.sqlToQuery(and(cond)!);
    expect(q.sql).toBe('("things"."number" ilike $1 or "things"."status" ilike $2)');
    expect(q.params).toEqual(["%10\\%%", "%10\\%%"]);
    expect(searchAny("  ", [things.number])).toBeUndefined();
    expect(searchAny(undefined, [things.number])).toBeUndefined();
  });
});

describe("runList", () => {
  it("returns items, total, limit and offset, running both queries", async () => {
    let counted = 0;
    const page = await runList(
      { limit: 2, offset: 4 },
      {
        rows: async () => [{ n: 1 }, { n: 2 }],
        count: async () => {
          counted++;
          return [{ total: "9" }];
        },
        map: (r) => r.n * 10,
      },
    );
    expect(page).toEqual({ items: [10, 20], total: 9, limit: 2, offset: 4 });
    expect(counted).toBe(1);
  });
  it("accepts plain numbers and empty count rows", () => {
    expect(toCount(5)).toBe(5);
    expect(toCount([])).toBe(0);
    expect(toCount([{ total: 3n }])).toBe(3);
  });
});

describe("facetCounts", () => {
  it("folds group-by rows into a map", () => {
    expect(facetCounts([{ key: "paid", n: "3" }, { key: null, n: 1 }, { key: "draft", n: 2 }])).toEqual({ paid: 3, draft: 2 });
  });
});

// Type-level: the schema output carries the filters.
const _typed = listQuerySchema().extend({ status: listFilter.oneOf(["a", "b"] as const) });
type _Out = z.output<typeof _typed>;
const _check: _Out["status"] = ["a"];
void _check;
