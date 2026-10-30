import { AppError } from "@rbms/core";
import { createDb } from "@rbms/db";
import { afterAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { expenses } from "./schema";
import { EXPENSE_SORT, ExpensesService, listQuery } from "./service";

// Never connects: only renders SQL.
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const T = "11111111-1111-4111-8111-111111111111";
const C1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const C2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const svc = new ExpensesService({ db });
const where = (q: Record<string, unknown>, without?: "category" | "paymentMethod" | "status") =>
  db.select().from(expenses).where(svc.listConditions(T, listQuery.parse(q), without)).toSQL();

describe("expense list", () => {
  it("keeps the 50 / 500 limits (CSV asks for 500) and takes comma lists", () => {
    expect(listQuery.parse({}).limit).toBe(50);
    expect(listQuery.parse({ limit: "500" }).limit).toBe(500);
    expect(() => listQuery.parse({ limit: "501" })).toThrow(ZodError);
    const p = listQuery.parse({ categoryId: `${C1},${C2}`, paymentMethod: "upi,cash", status: "cancelled" });
    expect(p).toMatchObject({ categoryId: [C1, C2], paymentMethod: ["upi", "cash"], status: ["cancelled"] });
    expect(() => listQuery.parse({ paymentMethod: "gold" })).toThrow(ZodError);
    expect(() => listQuery.parse({ from: "2026-10-02", to: "2026-10-01" })).toThrow(ZodError);
  });

  it("shows recorded expenses unless asked for a status or all", () => {
    expect(where({}).params).toContain("recorded");
    expect(where({ status: "all" }).sql).not.toContain('"expenses"."status" in');
    expect(where({ status: "recorded,cancelled" }).params).toEqual(expect.arrayContaining(["recorded", "cancelled"]));
  });

  it("filters category, payment mode and dates, searches vendor/note/reference, and drops one filter for its facet", () => {
    const q = where({ categoryId: C1, paymentMethod: "upi", from: "2026-10-01", to: "2026-10-31", q: "rent" });
    expect(q.sql).toContain('"expenses"."category_id" in ($');
    expect(q.sql).toContain('"expenses"."payment_method" in ($');
    expect(q.sql).toContain('"expenses"."reference" ilike');
    expect(q.params).toEqual(expect.arrayContaining([T, C1, "upi", "2026-10-01", "2026-10-31", "%rent%"]));
    expect(where({ categoryId: C1, paymentMethod: "upi" }, "category").params).not.toContain(C1);
    expect(where({ paymentMethod: "upi" }, "paymentMethod").params).not.toContain("upi");
    expect(where({}, "status").params).not.toContain("recorded");
  });

  it("sorts by date (default), amount and category name", () => {
    const render = (s?: string) => db.select().from(expenses).orderBy(...EXPENSE_SORT.orderBy(s)).toSQL().sql;
    expect(render()).toContain('order by "expenses"."date" desc nulls last, "expenses"."created_at" desc, "expenses"."id" desc');
    expect(render("-amount")).toContain('order by "expenses"."amount" desc');
    expect(render("category")).toContain('(select lower("expense_categories"."name") from "expense_categories" where');
    expect(() => render("vendor")).toThrow(AppError);
  });
});
