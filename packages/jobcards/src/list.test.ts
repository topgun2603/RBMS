import { AppError } from "@srirealtime/core";
import { createDb } from "@srirealtime/db";
import { afterAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { jobcards } from "./schema";
import { JOB_SORT, JobcardsService, jobListQuery, updateInput } from "./service";

// Never connects: only renders SQL.
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const T = "11111111-1111-4111-8111-111111111111";
const svc = new JobcardsService({ db });
const where = (q: Record<string, unknown>, withStatus = true) =>
  db.select().from(jobcards).where(svc.listConditions(T, jobListQuery.parse(q), "2026-10-20", withStatus)).toSQL();

describe("job list query", () => {
  it("pages 25 / 200 and splits comma lists", () => {
    expect(jobListQuery.parse({}).limit).toBe(25);
    expect(jobListQuery.parse({ limit: "200" }).limit).toBe(200);
    expect(() => jobListQuery.parse({ limit: "201" })).toThrow(ZodError);
    const p = jobListQuery.parse({ status: "received,ready", template: "device", overdue: "1" });
    expect(p.status).toEqual(["received", "ready"]);
    expect(p.template).toEqual(["device"]);
    expect(p.overdue).toBe(true);
    expect(() => jobListQuery.parse({ status: "lost" })).toThrow(ZodError);
  });

  it("filters by tenant, status and overdue; drops status for the facets", () => {
    const q = where({ status: "received", overdue: "1" });
    expect(q.sql).toContain('"jobcards"."tenant_id" = $1');
    expect(q.sql).toContain('"jobcards"."status" in ($');
    expect(q.sql).toContain('"jobcards"."due_date" < $');
    expect(q.params).toContain("2026-10-20");
    expect(where({ status: "received" }, false).sql).not.toContain('"jobcards"."status" in');
  });

  it("searches customer, phone and details, and the number for JC-0012", () => {
    const q = where({ q: "JC-0012" });
    expect(q.sql).toContain('"jobcards"."customer_name" ilike');
    expect(q.sql).toContain('"jobcards"."fields"::text ilike');
    expect(q.sql).toContain('"jobcards"."number" = $');
    expect(q.params).toContain(12);
    expect(where({ q: "meena" }).sql).not.toContain('"jobcards"."number" =');
  });

  it("sorts by number, due and updated only", () => {
    expect(JOB_SORT.keys).toEqual(["number", "due", "updated"]);
    expect(JOB_SORT.default).toBe("-updated");
    expect(() => JOB_SORT.orderBy("customer")).toThrow(AppError);
  });
});

describe("job patch", () => {
  it("leaves out keys that weren't sent and clears the ones sent empty", () => {
    expect(updateInput.parse({ priority: "urgent" })).toEqual({ priority: "urgent" });
    expect(updateInput.parse({ notes: "", dueDate: null })).toEqual({ notes: null, dueDate: null });
  });
});
