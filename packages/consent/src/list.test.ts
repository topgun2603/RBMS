import { AppError } from "@srirealtime/core";
import { createDb } from "@srirealtime/db";
import { afterAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { DATA_REQUEST_SORT, dataRequestListConditions, dataRequestListQuerySchema } from "./list";
import { dataRequests } from "./schema";

// Never connects: only renders SQL.
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const where = (q: Record<string, unknown>, omit?: "status" | "type") =>
  db.select().from(dataRequests).where(dataRequestListConditions(dataRequestListQuerySchema.parse(q), omit)).toSQL();

describe("privacy request list query", () => {
  it("keeps the 50/200 limits and the single-value form, and splits comma lists", () => {
    expect(dataRequestListQuerySchema.parse({}).limit).toBe(50);
    expect(() => dataRequestListQuerySchema.parse({ limit: "201" })).toThrow(ZodError);
    expect(dataRequestListQuerySchema.parse({ status: "pending" }).status).toEqual(["pending"]);
    expect(dataRequestListQuerySchema.parse({ status: "pending,failed", type: "delete" })).toMatchObject({ status: ["pending", "failed"], type: ["delete"] });
    expect(() => dataRequestListQuerySchema.parse({ type: "rectify" })).toThrow(ZodError);
  });

  it("filters status and type, and searches the user and request ids", () => {
    const q = where({ status: "failed", type: "export,delete", q: "4fa3_" });
    expect(q.sql).toContain('"data_requests"."status" in ($');
    expect(q.sql).toContain('"data_requests"."type" in ($');
    expect(q.sql).toContain('"data_requests"."user_id"::text ilike');
    expect(q.sql).toContain('"data_requests"."id"::text ilike');
    expect(q.params).toEqual(["failed", "export", "delete", "%4fa3\\_%", "%4fa3\\_%"]);
    expect(where({ status: "failed", type: "delete" }, "status").params).toEqual(["delete"]);
  });

  it("sorts by the whitelisted fields only", () => {
    const render = (s?: string) => db.select().from(dataRequests).orderBy(...DATA_REQUEST_SORT.orderBy(s)).toSQL().sql;
    expect(DATA_REQUEST_SORT.keys).toEqual(["created", "scheduled", "status", "type"]);
    expect(render()).toContain('order by "data_requests"."created_at" desc nulls last, "data_requests"."id" desc');
    expect(render("scheduled")).toContain('"data_requests"."scheduled_for" asc nulls last');
    expect(() => render("userId")).toThrow(AppError);
  });
});
